import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { Database } from "../src/server/db.js";
import { migrate } from "../src/server/migrations.js";
import { Operations } from "../src/server/operations.js";
import { LocalAssets } from "../src/server/assets.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
test("HTTP session requires origin and CSRF; scoped MCP performs read after write and rejects writes", async () => {
  const { createApp } = await import("../src/server/app.js");
  const pg = new PGlite(),
    dir = await mkdtemp(path.join(tmpdir(), "feedbacks-http-"));
  let server: any;
  try {
    const db = new Database(pg as any);
    await migrate(db);
    const config: any = {
        appOrigin: "http://localhost:3000",
        production: false,
        organizationId: "00000000-0000-4000-8000-000000000001",
      },
      store = new LocalAssets(dir);
    const ops = new Operations(db, store, config);
    await ops.auth.bootstrap("owner@example.test", "Owner", "Correct-Horse-Battery-123");
    const app = createApp(config, db, store);
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const post = async (op: string, input: any, headers: any = {}) =>
      fetch(`${base}/api/${op}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(input),
      });
    assert.equal(
      (
        await post("auth.login", {
          email: "owner@example.test",
          password: "Correct-Horse-Battery-123",
        })
      ).status,
      403,
    );
    const login = await post(
      "auth.login",
      { email: "owner@example.test", password: "Correct-Horse-Battery-123" },
      { Origin: config.appOrigin },
    );
    assert.equal(login.status, 200);
    const session = await login.json(),
      cookie = login.headers.get("set-cookie")!.split(";")[0];
    const headers = {
      Origin: config.appOrigin,
      Cookie: cookie,
      "X-CSRF-Token": session.data.csrf,
    };
    assert.equal(
      (
        await post(
          "projects.create",
          { name: "Bad", origins: ["https://example.test"] },
          { Origin: config.appOrigin, Cookie: cookie },
        )
      ).status,
      403,
    );
    const p = await (
      await post(
        "projects.create",
        { name: "Site", origins: ["https://example.test"] },
        headers,
      )
    ).json();
    assert.equal(p.ok, true);
    const created = await (
      await post(
        "threads.create",
        {
          projectId: p.data.id,
          body: "Fix spacing",
          diagnostics: {
            approved: true,
            source: "browser_opt_in",
            startedAt: "2026-09-16T10:00:00Z",
            endedAt: "2026-09-16T10:00:01Z",
            console: [
              {
                level: "warn",
                message: "Request failed https://example.test/api?token=sensitive",
                atMs: 10,
              },
            ],
            network: [
              {
                url: "https://example.test/api?private=value",
                type: "fetch",
                status: null,
                durationMs: 20,
                atMs: 15,
              },
            ],
          },
          context: {
            url: "https://example.test/",
            viewport: { width: 1440, height: 900 },
          },
          idempotencyKey: "http-create",
        },
        headers,
      )
    ).json();
    assert.equal(created.ok, true);
    assert.equal(created.data.diagnostics.trust, "untrusted_diagnostics");
    assert.equal(created.data.diagnostics.network[0].url, "https://example.test/api");
    assert.ok(!JSON.stringify(created.data.diagnostics).includes("sensitive"));
    const token = await (
      await post(
        "tokens.create",
        {
          name: "Read agent",
          projectIds: [p.data.id],
          scopes: ["projects.list", "threads.get"],
        },
        headers,
      )
    ).json();
    assert.equal(token.ok, true);
    const bearer = { Authorization: `Bearer ${token.data.token}` };
    assert.equal(
      (await post("threads.get", { threadId: created.data.id }, bearer)).status,
      200,
    );
    assert.equal(
      (
        await post(
          "threads.reply",
          {
            threadId: created.data.id,
            revision: 1,
            body: "No scope",
            idempotencyKey: "http-denied",
          },
          bearer,
        )
      ).status,
      403,
    );
    const mcp = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        ...bearer,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "test", version: "1" },
        },
      }),
    });
    assert.equal(mcp.status, 200);
    assert.match(await mcp.text(), /protocolVersion/);
    const listing = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        ...bearer,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list", params: {} }),
    });
    const catalog = await listing.json();
    assert.ok(catalog.result?.tools?.length > 10, JSON.stringify(catalog));
    assert.ok(
      catalog.result.tools.every((tool: any) => tool.inputSchema && tool.outputSchema),
    );
    const tools = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        ...bearer,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "threads.get", arguments: { threadId: created.data.id } },
      }),
    });
    const result = await tools.json();
    assert.equal(result.result.structuredContent.id, created.data.id);
    assert.deepEqual(
      result.result.structuredContent.diagnostics,
      created.data.diagnostics,
    );
    for (const adapterArgs of [
      ["--import", "tsx", "src/cli/mcp.ts"],
      ["dist/codex-plugin/feedbacks/mcp.mjs"],
    ]) {
      const stdio = new Client({ name: "stdio-verification", version: "1" });
      try {
        await stdio.connect(
          new StdioClientTransport({
            command: process.execPath,
            args: adapterArgs,
            env: {
              PATH: process.env.PATH ?? "",
              FEEDBACKS_URL: base,
              FEEDBACKS_TOKEN: token.data.token,
            },
            stderr: "pipe",
          }),
        );
        assert.ok((await stdio.listTools()).tools.length > 10);
        const stdioRead = await stdio.callTool({
          name: "threads.get",
          arguments: { threadId: created.data.id },
        });
        assert.equal((stdioRead.structuredContent as any).id, created.data.id);
        assert.deepEqual(
          (stdioRead.structuredContent as any).diagnostics,
          created.data.diagnostics,
        );
      } finally {
        await stdio.close();
      }
    }
    await post("tokens.revoke", { tokenId: token.data.id }, headers);
    assert.equal(
      (await post("threads.get", { threadId: created.data.id }, bearer)).status,
      401,
    );
    for (let attempt = 0; attempt < 30; attempt++)
      assert.equal(
        (
          await post(
            "pairing.request",
            {},
            { "X-Forwarded-For": `192.0.2.${attempt + 1}` },
          )
        ).status,
        200,
      );
    assert.equal(
      (await post("pairing.request", {}, { "X-Forwarded-For": "198.51.100.1" })).status,
      429,
      "untrusted forwarded IPs cannot bypass the direct-ingress limiter",
    );
  } finally {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    await pg.close();
    await rm(dir, { recursive: true, force: true });
  }
});
