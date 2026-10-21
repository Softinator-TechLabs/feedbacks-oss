import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { PGlite } from "@electric-sql/pglite";
import { Database } from "../src/server/db.js";
import { migrate } from "../src/server/migrations.js";
import { Operations } from "../src/server/operations.js";
import { configFromEnv } from "../src/server/config.js";

test("optional OAuth broker requires installation keys, isolates flows, bounds consent and rejects replay", async () => {
  const key = "synthetic-installation-key-".padEnd(40, "a"),
    second = "different-installation-key-".padEnd(40, "b");
  const child = spawn(process.execPath, ["scripts/tracker-oauth-broker.mjs"], {
    env: {
      ...process.env,
      PORT: "0",
      TRACKER_BROKER_PUBLIC_ORIGIN: "https://broker.example.test",
      TRACKER_BROKER_INSTALLATION_KEYS: JSON.stringify([key, second]),
      TRACKER_BROKER_JIRA_CLIENT_ID: "synthetic-client-id",
      TRACKER_BROKER_JIRA_CLIENT_SECRET: "synthetic-client-secret",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const port = await new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error("Broker did not start")), 10000);
      child.once("error", reject);
      child.stdout!.on("data", (bytes) => {
        const match = bytes.toString().match(/loopback port (\d+)/);
        if (match) {
          clearTimeout(timeout);
          resolve(Number(match[1]));
        }
      });
      child.once("exit", () => reject(Error("Broker exited before listening")));
    });
    const origin = `http://127.0.0.1:${port}`;
    const post = (path: string, body: any, token = key) =>
      fetch(origin + path, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
    assert.equal((await fetch(origin + "/healthz")).status, 200);
    assert.equal((await post("/v1/start", { provider: "jira" }, "wrong")).status, 401);
    assert.equal((await post("/v1/start", { provider: "unknown" })).status, 400);
    const started = await post("/v1/start", { provider: "jira" });
    assert.equal(started.headers.get("cache-control"), "no-store");
    const flow = await started.json(),
      authorize = new URL(flow.authorizeUrl);
    assert.equal(authorize.origin, "https://auth.atlassian.com");
    assert.equal(
      authorize.searchParams.get("redirect_uri"),
      "https://broker.example.test/oauth/jira/callback",
    );
    assert.ok(authorize.searchParams.get("state")!.length > 30);
    assert.ok(!JSON.stringify(flow).includes("synthetic-client-secret"));
    assert.equal((await post("/v1/poll", flow, second)).status, 410);
    assert.equal((await post("/v1/poll", { ...flow, pollToken: "wrong" })).status, 410);
    assert.deepEqual(await (await post("/v1/poll", flow)).json(), { status: "pending" });
    assert.equal(
      (await fetch(origin + "/oauth/jira/callback?state=invalid&code=attacker")).status,
      410,
    );
    assert.equal((await post("/v1/ack", flow)).status, 200);
    assert.equal((await post("/v1/poll", flow)).status, 410);
  } finally {
    child.kill("SIGTERM");
    await once(child, "exit").catch(() => {});
  }
});

test("local Jira OAuth completion stays session-bound and seals tokens only for a consented site", async () => {
  const pg = new PGlite(),
    originalFetch = globalThis.fetch;
  try {
    const db = new Database(pg as any);
    await migrate(db);
    const config = configFromEnv({
      DATABASE_URL: "postgres://synthetic",
      TRACKER_OAUTH_BROKER_URL: "https://broker.example.test",
      TRACKER_OAUTH_INSTALLATION_KEY: "synthetic-installation-key".padEnd(40, "a"),
    });
    const objects = new Map<string, Buffer>(),
      store: any = {
        put: async (key: string, value: Buffer) => objects.set(key, value),
        get: async (key: string) => objects.get(key)!,
      };
    const ops = new Operations(db, store, config);
    await ops.auth.bootstrap("owner@example.test", "Owner", "Correct-Horse-Battery-123");
    const login = await ops.auth.login("owner@example.test", "Correct-Horse-Battery-123"),
      owner = await ops.auth.authenticate(undefined, login.token);
    const project = await ops.executeOperation(owner, "projects.create", {
      name: "Synthetic",
      origins: ["https://example.test"],
    });
    const cloudId = "b59926c7-6474-4931-8cc2-34af0d589444";
    globalThis.fetch = (async (raw: any, init?: RequestInit) => {
      const url = new URL(String(raw));
      assert.equal(url.origin, "https://broker.example.test");
      assert.ok((init!.headers as any).authorization.startsWith("Bearer "));
      const body =
        url.pathname === "/v1/start"
          ? {
              flowId: "synthetic-remote-flow",
              pollToken: "synthetic-poll-secret",
              authorizeUrl: "https://auth.atlassian.com/authorize?state=synthetic",
            }
          : url.pathname === "/v1/poll"
            ? {
                status: "ready",
                token: {
                  access_token: "synthetic-jira-access",
                  refresh_token: "synthetic-jira-refresh",
                  expires_in: 3600,
                },
                resources: [
                  {
                    id: cloudId,
                    name: "Synthetic Jira",
                    url: "https://synthetic.atlassian.net",
                  },
                ],
              }
            : { removed: true };
      return new Response(JSON.stringify(body));
    }) as typeof fetch;
    const flow = await ops.executeOperation(owner, "trackers.oauthStart", {
      projectId: project.id,
      provider: "jira",
      label: "Synthetic Jira",
      configuration: { targetId: "QA", issueTypeId: "10001" },
    });
    assert.ok(!JSON.stringify(flow).includes("synthetic-poll-secret"));
    const otherLogin = await ops.auth.login(
        "owner@example.test",
        "Correct-Horse-Battery-123",
      ),
      sameUserOtherSession = await ops.auth.authenticate(undefined, otherLogin.token);
    await assert.rejects(
      ops.executeOperation(sameUserOtherSession, "trackers.oauthComplete", {
        flowId: flow.flowId,
      }),
      { code: "TRACKER_OAUTH_EXPIRED" },
    );
    assert.equal(
      (
        await ops.executeOperation(owner, "trackers.oauthComplete", {
          flowId: flow.flowId,
        })
      ).status,
      "choose_site",
    );
    const connected = await ops.executeOperation(owner, "trackers.oauthComplete", {
      flowId: flow.flowId,
      cloudId,
    });
    assert.equal(connected.status, "connected");
    assert.equal(connected.connection.configuration.site, "synthetic");
    assert.equal(connected.connection.configuration.cloudId, cloudId);
    assert.ok(!JSON.stringify(connected).includes("synthetic-jira-access"));
    await assert.rejects(
      ops.executeOperation(owner, "trackers.oauthComplete", {
        flowId: flow.flowId,
        cloudId,
      }),
      { code: "TRACKER_OAUTH_EXPIRED" },
    );
    const row = await db.one("SELECT * FROM tracker_connections WHERE id=$1", [
      connected.connection.id,
    ]);
    assert.ok(!JSON.stringify(row).includes("synthetic-jira-access"));
  } finally {
    globalThis.fetch = originalFetch;
    await pg.close();
  }
});
