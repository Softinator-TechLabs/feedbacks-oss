import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { PGlite } from "@electric-sql/pglite";
import { Database } from "../src/server/db.js";
import { migrate } from "../src/server/migrations.js";
import { Operations } from "../src/server/operations.js";
import { createApp } from "../src/server/app.js";
import { McpOAuth } from "../src/server/oauth.js";
import { revokeCredentials } from "../src/server/auth.js";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const verifier = () => `${randomUUID()}${randomUUID()}`.replaceAll("-", "");
test("own-server OAuth consent, PKCE, scope, audience and credential lifecycle", async (t) => {
  const pg = new PGlite(),
    db = new Database(pg as any);
  await migrate(db);
  const config: any = {
    appOrigin: "http://localhost:3000",
    mcpOAuthEnabled: true,
    production: false,
  };
  const ops = new Operations(db, {} as any, config);
  const owner = await ops.auth.bootstrap(
    "owner@example.test",
    "Owner",
    "Correct-Horse-Battery-123",
  );
  const project = await ops.executeOperation(owner, "projects.create", {
    name: "Review",
    origins: ["https://example.test"],
  });
  const outside = await ops.executeOperation(owner, "projects.create", {
    name: "Other",
    origins: ["https://other.test"],
  });
  const thread = await ops.executeOperation(owner, "threads.create", {
    projectId: project.id,
    body: "Fix spacing",
    context: { url: "https://example.test/", viewport: { width: 1440, height: 900 } },
    idempotencyKey: "oauth-review",
  });
  const server = createApp(config, db, {} as any).listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  // Set the synthetic installation's public origin to the actual loopback listener.
  config.appOrigin = base;
  const resource = `${config.appOrigin}/mcp`,
    oauth = new McpOAuth(db, config);
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  const login = await post(
    "/api/auth.login",
    { email: "owner@example.test", password: "Correct-Horse-Battery-123" },
    { Origin: config.appOrigin },
  );
  const session = await login.json(),
    cookie = login.headers.get("set-cookie")!.split(";")[0];
  const headers = {
    Origin: config.appOrigin,
    Cookie: cookie,
    "X-CSRF-Token": session.data.csrf,
  };
  const registered = await (
    await post("/oauth/register", {
      client_name: "Test coding assistant",
      redirect_uris: ["https://client.example.test/callback"],
    })
  ).json();
  const clientId = registered.client_id;
  const params = (proof: string, scope = "feedbacks:read offline_access") => ({
    client_id: clientId,
    response_type: "code",
    redirect_uri: registered.redirect_uris[0],
    resource,
    state: "state-bound-to-client",
    code_challenge: createHash("sha256").update(proof).digest("base64url"),
    code_challenge_method: "S256",
    scope,
  });
  const begin = async (scope?: string) => {
    const proof = verifier(),
      parameters = params(proof, scope);
    const response = await fetch(
      `${base}/oauth/authorize?${new URLSearchParams(parameters)}`,
      { redirect: "manual" },
    );
    assert.equal(response.status, 303);
    return {
      proof,
      request: new URL(response.headers.get("location")!).searchParams.get("request")!,
      parameters,
    };
  };
  const approve = async (flow: Awaited<ReturnType<typeof begin>>, reply = false) => {
    const response = await post(
      "/oauth/consent",
      { request: flow.request, approve: true, projectIds: [project.id], reply },
      headers,
    );
    assert.equal(response.status, 200);
    const callback = new URL((await response.json()).data.redirect);
    assert.equal(callback.searchParams.get("state"), "state-bound-to-client");
    assert.equal(callback.searchParams.get("iss"), config.appOrigin);
    return {
      grant_type: "authorization_code",
      client_id: clientId,
      resource,
      code: callback.searchParams.get("code")!,
      redirect_uri: registered.redirect_uris[0],
      code_verifier: flow.proof,
    };
  };
  const exchange = async (input: Record<string, string>) =>
    fetch(`${base}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(input),
    });
  try {
    await t.test("metadata and challenge advertise the own installation", async () => {
      const discovery = await (
        await fetch(`${base}/.well-known/oauth-protected-resource/mcp`)
      ).json();
      assert.equal(discovery.resource, resource);
      assert.deepEqual(discovery.authorization_servers, [config.appOrigin]);
      const metadata = await (
        await fetch(`${base}/.well-known/oauth-authorization-server`)
      ).json();
      assert.deepEqual(metadata.code_challenge_methods_supported, ["S256"]);
      assert.equal(metadata.authorization_response_iss_parameter_supported, true);
      const unauthenticated = await post("/mcp", {});
      assert.equal(unauthenticated.status, 401);
      assert.match(
        unauthenticated.headers.get("www-authenticate")!,
        /resource_metadata=/,
      );
    });
    await t.test(
      "reject unregistered redirects, wrong audience, unknown scopes and missing PKCE",
      async () => {
        for (const changes of [
          { redirect_uri: "https://attacker.test/callback" },
          { resource: "https://other.test/mcp" },
          { scope: "feedbacks:read owner:admin" },
          { code_challenge_method: "plain" },
        ]) {
          const response = await fetch(
            `${base}/oauth/authorize?${new URLSearchParams({ ...params(verifier()), ...changes })}`,
            { redirect: "manual" },
          );
          assert.equal(response.status, 400);
          assert.equal(response.headers.get("location"), null);
        }
        for (const uri of [
          "http://remote.test/callback",
          "https://user:pass@example.test/callback",
          "https://example.test/callback#fragment",
        ])
          assert.equal(
            (await post("/oauth/register", { redirect_uris: [uri] })).status,
            400,
          );
        assert.equal(
          (
            await post("/oauth/register", {
              redirect_uris: ["http://127.0.0.1:49152/callback"],
            })
          ).status,
          201,
        );
      },
    );
    await t.test(
      "consent needs a human session, origin, CSRF and actual project permission",
      async () => {
        const flow = await begin();
        const body = { request: flow.request, approve: true, projectIds: [project.id] };
        assert.equal(
          (await post("/oauth/consent", body, { Cookie: cookie })).status,
          403,
        );
        assert.equal(
          (
            await post("/oauth/consent", body, {
              Origin: config.appOrigin,
              Cookie: cookie,
            })
          ).status,
          403,
        );
        assert.equal(
          (await post("/oauth/consent", { ...body, projectIds: [randomUUID()] }, headers))
            .status,
          404,
        );
        assert.equal(
          (await post("/oauth/consent", { ...body, reply: true }, headers)).status,
          400,
        );
        const denied = await post(
          "/oauth/consent",
          { request: flow.request, approve: false },
          headers,
        );
        assert.match((await denied.json()).data.redirect, /error=access_denied/);
        assert.equal((await post("/oauth/consent", body, headers)).status, 400);
      },
    );
    const flow = await begin(),
      code = await approve(flow);
    await t.test(
      "failed PKCE and resource checks do not consume a valid code",
      async () => {
        assert.equal(
          (await exchange({ ...code, code_verifier: verifier() })).status,
          400,
        );
        assert.equal(
          (await exchange({ ...code, resource: `${base}/other` })).status,
          400,
        );
      },
    );
    const issuedResponse = await exchange(code);
    assert.equal(issuedResponse.status, 200);
    const issued = await issuedResponse.json();
    await t.test(
      "actual MCP SDK reads selected project and denies extra project/write/admin",
      async () => {
        const client = new Client({ name: "oauth-test", version: "1" });
        try {
          await client.connect(
            new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
              requestInit: {
                headers: { Authorization: `Bearer ${issued.access_token}` },
              },
            }),
          );
          const tools = await client.listTools();
          assert.ok(tools.tools.some((tool) => tool.name === "threads.get"));
          assert.ok(
            !tools.tools.some(
              (tool) => tool.name === "threads.reply" || tool.name === "members.create",
            ),
          );
          assert.deepEqual(
            tools.tools.find((tool) => tool.name === "threads.get")!._meta
              ?.securitySchemes,
            [{ type: "oauth2", scopes: ["feedbacks:read"] }],
          );
          // The client SDK strips non-standard root fields; verify the wire
          // descriptor too, as directory scanners consume that response.
          const wire = await post(
            "/mcp",
            { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
            {
              Authorization: `Bearer ${issued.access_token}`,
              Accept: "application/json, text/event-stream",
              "MCP-Protocol-Version": "2025-06-18",
            },
          );
          assert.equal(wire.status, 200);
          const descriptor = (await wire.json()).result.tools.find(
            (tool: any) => tool.name === "threads.get",
          );
          assert.deepEqual(descriptor.securitySchemes, [
            { type: "oauth2", scopes: ["feedbacks:read"] },
          ]);
          const read = await client.callTool({
            name: "threads.get",
            arguments: { threadId: thread.id },
          });
          assert.ok(!read.isError);
          const denied = await client.callTool({
            name: "projects.get",
            arguments: { projectId: outside.id },
          });
          assert.equal(denied.isError, true);
        } finally {
          await client.close();
        }
        // OAuth access cannot be reused for the JSON API or another MCP audience.
        await assert.rejects(
          ops.auth.authenticate(issued.access_token),
          /expired or revoked/,
        );
        await assert.rejects(
          ops.auth.authenticate(issued.access_token, undefined, "https://other.test/mcp"),
          /expired or revoked/,
        );
        const actor = await ops.auth.authenticate(
          issued.access_token,
          undefined,
          resource,
        );
        assert.equal(actor.ownerAdmin, false);
        assert.equal(actor.canResolve, false);
        await assert.rejects(
          ops.executeOperation(actor, "threads.reply", {
            threadId: thread.id,
            body: "No",
            revision: 1,
            idempotencyKey: "oauth-denied",
          }),
          /scope/i,
        );
        const manual = await ops.executeOperation(owner, "tokens.create", {
          name: "Local adapter",
          projectIds: [project.id],
          scopes: ["projects.list"],
          expiresInDays: 1,
        });
        assert.equal((await ops.auth.authenticate(manual.token)).kind, "agent");
      },
    );
    await t.test(
      "rotated refresh replay revokes descendants and code replay revokes its grant",
      async () => {
        const refresh = {
          grant_type: "refresh_token",
          client_id: clientId,
          resource,
          refresh_token: issued.refresh_token,
        };
        const renewed = await (await exchange(refresh)).json();
        assert.ok(renewed.access_token && renewed.refresh_token !== issued.refresh_token);
        await assert.rejects(
          ops.auth.authenticate(issued.access_token, undefined, resource),
        );
        assert.equal((await exchange(refresh)).status, 400);
        await assert.rejects(
          ops.auth.authenticate(renewed.access_token, undefined, resource),
        );
        assert.equal(
          (await exchange({ ...refresh, refresh_token: renewed.refresh_token })).status,
          400,
        );
        const another = await approve(await begin());
        const token = await (await exchange(another)).json();
        assert.equal((await exchange(another)).status, 400);
        await assert.rejects(
          ops.auth.authenticate(token.access_token, undefined, resource),
        );
      },
    );
    await t.test(
      "explicit reply connection, revocation, opt-out and account credential reset",
      async () => {
        const grant = await approve(
          await begin("feedbacks:read feedbacks:reply offline_access"),
          true,
        );
        const token = await (await exchange(grant)).json();
        const actor = await ops.auth.authenticate(
          token.access_token,
          undefined,
          resource,
        );
        await ops.executeOperation(actor, "threads.reply", {
          threadId: thread.id,
          body: "Reviewed spacing",
          revision: 1,
          idempotencyKey: "oauth-reply",
        });
        const revoke = await post("/oauth/revoke", {
          client_id: clientId,
          token: token.refresh_token,
        });
        assert.equal(revoke.status, 200);
        await assert.rejects(
          ops.auth.authenticate(token.access_token, undefined, resource),
        );
        const next = await (await exchange(await approve(await begin()))).json();
        config.mcpOAuthEnabled = false;
        assert.equal(
          (await post("/mcp", {}, { Authorization: `Bearer ${next.access_token}` }))
            .status,
          401,
        );
        assert.equal(
          (
            await exchange({
              grant_type: "refresh_token",
              client_id: clientId,
              resource,
              refresh_token: next.refresh_token,
            })
          ).status,
          503,
        );
        config.mcpOAuthEnabled = true;
        const approvedCode = await approve(await begin());
        await revokeCredentials(db, owner.userId);
        assert.equal((await exchange(approvedCode)).status, 400);
        assert.equal(
          (
            await exchange({
              grant_type: "refresh_token",
              client_id: clientId,
              resource,
              refresh_token: next.refresh_token,
            })
          ).status,
          400,
        );
      },
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pg.close();
  }
});
