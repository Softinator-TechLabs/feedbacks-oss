import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { Database } from "../src/server/db.js";
import { migrate } from "../src/server/migrations.js";
import { Operations } from "../src/server/operations.js";
import { GithubApp } from "../src/server/github-app.js";
import { configFromEnv } from "../src/server/config.js";

const key = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = key.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
async function fixture(legacy = false) {
  const pg = new PGlite(),
    db = new Database(pg as any);
  await migrate(db);
  const objects = new Map<string, Buffer>();
  const store = {
    put: async (k: string, b: Buffer) => {
      objects.set(k, b);
    },
    get: async (k: string) => {
      const b = objects.get(k);
      if (!b) throw new Error("missing");
      return b;
    },
    remove: async (k: string) => {
      objects.delete(k);
    },
  };
  const config = configFromEnv({
    DATABASE_URL: "postgres://synthetic",
    APP_ORIGIN: "http://localhost:3000",
    ...(legacy
      ? {
          GITHUB_APP_ID: "303",
          GITHUB_APP_SLUG: "reviewer-private",
          GITHUB_APP_PRIVATE_KEY_BASE64: Buffer.from(pem).toString("base64"),
        }
      : {}),
  });
  let conversions = 0;
  const calls: { path: string; method: string }[] = [];
  const info: any = {
    id: 303,
    slug: "reviewer-private",
    name: "Reviewer private",
    owner: { login: "Second-Team", type: "Organization" },
    permissions: { metadata: "read", issues: "write" },
    events: [],
  };
  let onConvert: (() => Promise<void>) | undefined;
  let issueState = "open",
    issueBody = "Synthetic",
    failWrite = false;
  const fetcher: typeof fetch = async (url, init) => {
    const path = new URL(String(url)).pathname;
    calls.push({ path, method: init?.method ?? "GET" });
    if (path.startsWith("/app-manifests/")) {
      assert.equal((init?.headers as any).Authorization, undefined);
      conversions++;
      await onConvert?.();
      return Response.json({ ...info, pem });
    }
    const bearer = String((init!.headers as any).Authorization).slice(7);
    if (bearer.includes(".")) {
      const parts = bearer.split(".");
      assert.equal(
        String(JSON.parse(Buffer.from(parts[1], "base64url").toString()).iss),
        "303",
      );
      assert.equal(
        verify(
          "RSA-SHA256",
          Buffer.from(parts.slice(0, 2).join(".")),
          key.publicKey,
          Buffer.from(parts[2], "base64url"),
        ),
        true,
      );
    } else assert.equal(bearer, "installation-token");
    if (path === "/app") return Response.json(info);
    if (path.startsWith("/repos/"))
      assert.equal(path.split("/")[2].toLowerCase(), "second-team");
    if (path.endsWith("/installation")) return Response.json({ id: 444 });
    if (path.endsWith("/access_tokens")) {
      const body = JSON.parse(String(init!.body));
      assert.deepEqual(body.repositories, ["core"]);
      assert.deepEqual(body.permissions, {
        issues: init!.method === "POST" ? body.permissions.issues : undefined,
      });
      return Response.json({ token: "installation-token" });
    }
    if (path.endsWith("/issues") && init?.method === "POST") {
      issueBody = JSON.parse(String(init.body)).body;
      if (failWrite) throw new Error("Synthetic uncertain response");
      return Response.json({ number: 17 }, { status: 201 });
    }
    if (path.endsWith("/issues/17")) {
      if (init?.method === "PATCH") issueState = JSON.parse(String(init.body)).state;
      return Response.json({
        number: 17,
        state: issueState,
        body: issueBody,
        html_url: "https://github.com/Second-Team/core/issues/17",
      });
    }
    throw new Error("Unexpected synthetic GitHub path " + path);
  };
  const ops = new Operations(db, store, config, new GithubApp(config, fetcher));
  await ops.auth.bootstrap("owner@example.test", "Owner", "Synthetic-Password-123");
  const login = await ops.auth.login("owner@example.test", "Synthetic-Password-123");
  const owner = await ops.auth.authenticate(undefined, login.token);
  const start = () =>
    ops.executeOperation(owner, "github.appSetupStart", {
      account: "Second-Team",
      accountType: "organization",
    });
  const finish = (state: string) =>
    ops.executeOperation(owner, "github.appSetupComplete", {
      state,
      code: "0123456789abcdef0123456789abcdef01234567",
    });
  return {
    pg,
    db,
    ops,
    owner,
    config,
    store,
    objects,
    fetcher,
    info,
    calls,
    login,
    setConvertHook(value: () => Promise<void>) {
      onConvert = value;
    },
    setFailWrite(value: boolean) {
      failWrite = value;
    },
    setIssueState(value: string) {
      issueState = value;
    },
    start,
    finish,
    conversions: () => conversions,
  };
}
test("owner creates a private organization App without environment edits; credentials survive a new Operations instance", async () => {
  const f = await fixture();
  try {
    const setup = await f.start(),
      action = new URL(setup.actionUrl),
      manifest = JSON.parse(setup.manifest);
    assert.equal(action.origin, "https://github.com");
    assert.equal(action.pathname, "/organizations/second-team/settings/apps/new");
    assert.equal(manifest.public, false);
    assert.deepEqual(manifest.default_permissions, { metadata: "read", issues: "write" });
    const created = await f.finish(action.searchParams.get("state")!);
    assert.equal(created.id, "303");
    assert.ok(!JSON.stringify(created).includes("PRIVATE KEY"));
    assert.ok(
      !JSON.stringify(await f.db.query("SELECT * FROM github_managed_apps")).includes(
        "PRIVATE KEY",
      ),
    );
    assert.equal(f.objects.size, 1);
    const restarted = new Operations(
      f.db,
      f.store,
      f.config,
      new GithubApp(f.config, f.fetcher),
    );
    const inventory = await restarted.executeOperation(f.owner, "github.apps", {});
    assert.equal(inventory.apps[0].source, "feedbacks");
    const p = await restarted.executeOperation(f.owner, "projects.create", {
      name: "Reviewer",
      origins: ["https://example.test"],
      repositoryUrl: "https://github.com/Second-Team/core",
    });
    const assigned = await restarted.executeOperation(f.owner, "github.appSelect", {
      projectId: p.id,
      revision: p.revision,
      appId: "303",
    });
    const connected = await restarted.executeOperation(f.owner, "github.connect", {
      projectId: p.id,
      revision: assigned.revision,
    });
    assert.equal(connected.githubConnected, true);
    await assert.rejects(f.finish(action.searchParams.get("state")!), {
      code: "GITHUB_SETUP_EXPIRED",
    });
    assert.equal(f.conversions(), 1);
  } finally {
    await f.pg.close();
  }
});
test("registration state is session bound, expires and never exchanges an invalid code", async () => {
  const f = await fixture();
  try {
    const setup = await f.start(),
      state = new URL(setup.actionUrl).searchParams.get("state")!;
    const login = await f.ops.auth.login("owner@example.test", "Synthetic-Password-123");
    const other = await f.ops.auth.authenticate(undefined, login.token);
    await assert.rejects(
      f.ops.executeOperation(other, "github.appSetupComplete", {
        state,
        code: "0123456789abcdef0123456789abcdef01234567",
      }),
      { code: "GITHUB_SETUP_EXPIRED" },
    );
    assert.equal(f.conversions(), 0);
    await f.db.query("UPDATE github_app_setups SET expires_at=now()-interval '1 minute'");
    await assert.rejects(f.finish(state), { code: "GITHUB_SETUP_EXPIRED" });
    assert.equal(f.conversions(), 0);
  } finally {
    await f.pg.close();
  }
});

async function createApp(f: Awaited<ReturnType<typeof fixture>>) {
  const started = await f.start();
  return f.finish(new URL(started.actionUrl).searchParams.get("state")!);
}
async function project(f: Awaited<ReturnType<typeof fixture>>) {
  const created = await f.ops.executeOperation(f.owner, "projects.create", {
    name: "Synthetic project",
    origins: ["https://example.test"],
    repositoryUrl: "https://github.com/Second-Team/core",
  });
  const assigned = await f.ops.executeOperation(f.owner, "github.appSelect", {
    projectId: created.id,
    revision: created.revision,
    appId: "303",
  });
  return f.ops.executeOperation(f.owner, "github.connect", {
    projectId: created.id,
    revision: assigned.revision,
  });
}
test("managed credentials reject wrong accounts, extra permissions and public Apps before persistence", async () => {
  const f = await fixture();
  try {
    for (const change of [
      { owner: { login: "Other-Team", type: "Organization" } },
      { permissions: { metadata: "read", issues: "write", contents: "read" } },
      { public: true },
    ]) {
      const original = structuredClone(f.info);
      Object.assign(f.info, change);
      await assert.rejects(createApp(f), { code: "GITHUB_APP_INVALID" });
      for (const field of Object.keys(f.info)) delete f.info[field];
      Object.assign(f.info, original);
      assert.equal(f.objects.size, 0);
      assert.equal((await f.db.query("SELECT * FROM github_managed_apps")).length, 0);
    }
  } finally {
    await f.pg.close();
  }
});
test("owner is rechecked after GitHub conversion and external storage; callback is single-use concurrently", async () => {
  const f = await fixture();
  try {
    const setup = await f.start(),
      state = new URL(setup.actionUrl).searchParams.get("state")!;
    const results = await Promise.allSettled([f.finish(state), f.finish(state)]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(f.conversions(), 1);
    const app = await f.ops.executeOperation(f.owner, "github.appUpdate", {
      appId: "303",
      revision: 1,
      name: "Custom label",
    });
    assert.equal(app.name, "Custom label");
    const before = f.objects.size;
    const original = f.store.put;
    f.store.put = async (k, b) => {
      await original(k, b);
      await f.db.query("UPDATE users SET owner=false WHERE id=$1", [f.owner.userId]);
    };
    await assert.rejects(
      f.ops.executeOperation(f.owner, "github.appImport", {
        appId: "303",
        revision: 2,
        privateKey: pem,
      }),
      { code: "FORBIDDEN" },
    );
    assert.equal(f.objects.size, before);
    assert.equal(
      (await f.db.one("SELECT revision FROM github_managed_apps")).revision,
      2,
    );
  } finally {
    await f.pg.close();
  }
  const revoked = await fixture();
  try {
    revoked.setConvertHook(async () => {
      await revoked.db.query("UPDATE users SET owner=false WHERE id=$1", [
        revoked.owner.userId,
      ]);
    });
    await assert.rejects(createApp(revoked), { code: "FORBIDDEN" });
    assert.equal(revoked.objects.size, 0);
  } finally {
    await revoked.pg.close();
  }
});
test("adoption, rename, key update and reconnect work without env changes; disabled legacy credentials never fall back", async () => {
  const f = await fixture(true);
  try {
    const app = await f.ops.executeOperation(f.owner, "github.appAdopt", {
      appId: "303",
    });
    assert.equal(app.source, "feedbacks");
    assert.deepEqual(app.owners, [], "Legacy installation policy survives adoption");
    const p = await project(f);
    await f.ops.executeOperation(f.owner, "github.appUpdate", {
      appId: "303",
      revision: app.revision,
      name: "My private App",
    });
    const rotated = await f.ops.executeOperation(f.owner, "github.appImport", {
      appId: "303",
      revision: 2,
      privateKey: pem,
    });
    assert.equal(rotated.name, "My private App");
    const before = f.objects.size;
    await assert.rejects(
      f.ops.executeOperation(f.owner, "github.appImport", {
        appId: "303",
        revision: 1,
        privateKey: pem,
      }),
      { code: "CONFLICT" },
    );
    assert.equal(f.objects.size, before);
    const disabled = await f.ops.executeOperation(f.owner, "github.appEnable", {
      appId: "303",
      revision: rotated.revision,
      enabled: false,
    });
    const keyUpdated = await f.ops.executeOperation(f.owner, "github.appImport", {
      appId: "303",
      revision: disabled.revision,
      privateKey: pem,
    });
    assert.equal(keyUpdated.enabled, false);
    const calls = f.calls.length;
    const connection = await f.ops.executeOperation(f.owner, "github.connection", {
      projectId: p.id,
    });
    assert.equal(connection.configured, false);
    assert.equal(f.calls.length, calls);
    await assert.rejects(
      f.ops.executeOperation(f.owner, "github.connect", {
        projectId: p.id,
        revision: p.revision,
      }),
      { code: "GITHUB_UNAVAILABLE" },
    );
    assert.equal(f.calls.length, calls);
    await f.ops.executeOperation(f.owner, "github.appEnable", {
      appId: "303",
      revision: keyUpdated.revision,
      enabled: true,
    });
    assert.equal(
      (await f.ops.executeOperation(f.owner, "github.connection", { projectId: p.id }))
        .configured,
      true,
    );
    assert.ok(f.calls.length > calls);
    assert.ok(
      !JSON.stringify(await f.db.query("SELECT * FROM events")).includes("PRIVATE KEY"),
    );
  } finally {
    await f.pg.close();
  }
});
test("managed keys fail closed on missing or modified storage; restoring the object recovers routing", async () => {
  const f = await fixture();
  try {
    await createApp(f);
    const p = await project(f);
    const [objectKey, keyBytes] = [...f.objects.entries()][0];
    f.objects.delete(objectKey);
    const calls = f.calls.length;
    await assert.rejects(
      f.ops.executeOperation(f.owner, "github.connect", {
        projectId: p.id,
        revision: p.revision,
      }),
      { code: "GITHUB_STORAGE_UNAVAILABLE" },
    );
    assert.equal(f.calls.length, calls);
    f.objects.set(objectKey, Buffer.alloc(32));
    await assert.rejects(
      f.ops.executeOperation(f.owner, "github.connect", {
        projectId: p.id,
        revision: p.revision,
      }),
      { code: "GITHUB_STORAGE_UNAVAILABLE" },
    );
    assert.equal(f.calls.length, calls);
    f.objects.set(objectKey, keyBytes);
    assert.equal(
      (await f.ops.executeOperation(f.owner, "github.connection", { projectId: p.id }))
        .installation,
      "installed",
    );
    await f.db.query(
      "UPDATE github_managed_apps SET envelope=jsonb_set(envelope,'{tag}','\"AAAA\"')",
    );
    await assert.rejects(
      f.ops.executeOperation(f.owner, "github.connect", {
        projectId: p.id,
        revision: p.revision,
      }),
      { code: "GITHUB_STORAGE_UNAVAILABLE" },
    );
  } finally {
    await f.pg.close();
  }
  const failed = await fixture();
  try {
    failed.store.put = async () => {
      throw new Error("synthetic sensitive storage response");
    };
    await assert.rejects(createApp(failed), (error) => {
      assert.equal((error as any).code, "GITHUB_STORAGE_UNAVAILABLE");
      assert.ok(!String(error).includes("sensitive"));
      return true;
    });
    assert.equal((await failed.db.query("SELECT * FROM github_managed_apps")).length, 0);
  } finally {
    await failed.pg.close();
  }
});
test("only human server owners manage Apps; members and agent/extension identities never reach GitHub", async () => {
  const f = await fixture();
  try {
    const token = await f.ops.executeOperation(f.owner, "tokens.create", {
      name: "Synthetic agent",
      projectIds: [],
      scopes: ["projects.list"],
    });
    const agent = await f.ops.auth.authenticate(token.token);
    const paired = await f.ops.auth.issueToken(
      f.db,
      f.owner,
      {
        name: "Synthetic extension",
        projectIds: [],
        scopes: ["projects.list"],
        expiresInDays: 1,
      },
      "extension",
    );
    const extension = await f.ops.auth.authenticate(paired.token);
    const member = await f.ops.executeOperation(f.owner, "members.create", {
      name: "Member",
      email: "member@example.test",
      password: "Synthetic-Password-123",
    });
    const login = await f.ops.auth.login("member@example.test", "Synthetic-Password-123");
    let human = await f.ops.auth.authenticate(undefined, login.token);
    await f.ops.auth.changePassword(
      human,
      "Synthetic-Password-123",
      "New-Synthetic-Password-123",
    );
    const renewed = await f.ops.auth.login(
      "member@example.test",
      "New-Synthetic-Password-123",
    );
    human = await f.ops.auth.authenticate(undefined, renewed.token);
    const inputs: any = {
      "github.apps": {},
      "github.appSetupStart": { account: "Second-Team", accountType: "organization" },
      "github.appSetupComplete": { state: "A".repeat(43), code: "b".repeat(40) },
      "github.appImport": { appId: "303", revision: null, privateKey: pem },
      "github.appAdopt": { appId: "303" },
      "github.appUpdate": { appId: "303", revision: 1, name: "Rename" },
      "github.appEnable": { appId: "303", revision: 1, enabled: false },
    };
    for (const actor of [human, agent, extension])
      for (const [operation, input] of Object.entries(inputs))
        await assert.rejects(f.ops.executeOperation(actor, operation as any, input), {
          code: "FORBIDDEN",
        });
    assert.equal(f.calls.length, 0);
    assert.equal(f.objects.size, 0);
    assert.ok(member.id);
  } finally {
    await f.pg.close();
  }
});

test("a catalog snapshot paused before reservation cannot create an Issue after the App is adopted and disconnected", async () => {
  for (const legacy of [true, false]) {
    const f = await fixture(legacy);
    try {
      if (!legacy) await createApp(f);
      const p = await project(f);
      const t = await f.ops.executeOperation(f.owner, "threads.create", {
        projectId: p.id,
        body: "Synthetic feedback",
        context: { url: "https://example.test", viewport: { width: 1000, height: 800 } },
        idempotencyKey: "paused-catalog-thread",
      });
      const originalQuery = f.db.query.bind(f.db);
      let pause = true,
        release!: () => void,
        signal!: () => void;
      const ready = new Promise<void>((resolve) => {
          signal = resolve;
        }),
        gate = new Promise<void>((resolve) => {
          release = resolve;
        });
      f.db.query = async (sql: string, params?: any[]) => {
        const result = await originalQuery(sql, params);
        if (
          pause &&
          sql.startsWith("SELECT * FROM github_managed_apps ORDER BY app_id")
        ) {
          pause = false;
          signal();
          await gate;
        }
        return result;
      };
      const write = f.ops.executeOperation(f.owner, "github.issueCreate", {
        threadId: t.id,
        revision: t.revision,
        reviewed: true,
        title: "Synthetic",
        body: "Reviewed synthetic",
        idempotencyKey: "paused-catalog-issue",
      });
      // Attach the rejection handler before allowing the blocked request to resume.
      const rejected = assert.rejects(write, { code: "GITHUB_UNAVAILABLE" });
      await ready;
      const app = legacy
        ? await f.ops.executeOperation(f.owner, "github.appAdopt", { appId: "303" })
        : (await f.ops.executeOperation(f.owner, "github.apps", {})).apps[0];
      await f.ops.executeOperation(f.owner, "github.appEnable", {
        appId: "303",
        revision: app.revision,
        enabled: false,
      });
      const calls = f.calls.length;
      release();
      await rejected;
      assert.equal(f.calls.length, calls);
      assert.equal((await f.db.query("SELECT * FROM github_issue_requests")).length, 0);
    } finally {
      await f.pg.close();
    }
  }
});
test("key recovery is allowed for the same App while writes are pending; disconnect remains blocked and reconciliation uses the original identity", async () => {
  const f = await fixture();
  try {
    const app = await createApp(f),
      p = await project(f);
    const t = await f.ops.executeOperation(f.owner, "threads.create", {
      projectId: p.id,
      body: "Synthetic",
      context: { url: "https://example.test", viewport: { width: 1000, height: 800 } },
      idempotencyKey: "pending-recovery-thread",
    });
    f.setFailWrite(true);
    await assert.rejects(
      f.ops.executeOperation(f.owner, "github.issueCreateQuick", {
        threadId: t.id,
        revision: t.revision,
        idempotencyKey: "pending-recovery-issue",
      }),
      { code: "GITHUB_UNAVAILABLE" },
    );
    await assert.rejects(
      f.ops.executeOperation(f.owner, "github.appEnable", {
        appId: "303",
        revision: app.revision,
        enabled: false,
      }),
      { code: "GITHUB_PENDING" },
    );
    const [objectKey] = [...f.objects.keys()];
    f.objects.delete(objectKey);
    const restored = await f.ops.executeOperation(f.owner, "github.appImport", {
      appId: "303",
      revision: app.revision,
      privateKey: pem,
    });
    assert.equal(restored.revision, app.revision + 1);
    const result = await f.ops.executeOperation(f.owner, "github.issueReconcile", {
      threadId: t.id,
      revision: t.revision,
      issueUrl: "https://github.com/Second-Team/core/issues/17",
    });
    assert.equal(result.externalIssues[0].githubAppId, "303");
    assert.equal(
      f.calls.filter((call) => call.path.endsWith("/issues") && call.method === "POST")
        .length,
      1,
    );
  } finally {
    await f.pg.close();
  }
});

test("background sync uses managed keys after restart and skips disconnected Apps without claiming a lease", async () => {
  const { pollGithubStatusSync } = await import("../src/server/github-status-worker.js");
  const f = await fixture();
  try {
    const app = await createApp(f),
      p = await project(f);
    const t = await f.ops.executeOperation(f.owner, "threads.create", {
      projectId: p.id,
      body: "Synthetic",
      context: { url: "https://example.test", viewport: { width: 1000, height: 800 } },
      idempotencyKey: "managed-worker-thread",
    });
    const linked = await f.ops.executeOperation(f.owner, "github.issueCreateQuick", {
      threadId: t.id,
      revision: t.revision,
      idempotencyKey: "managed-worker-issue",
    });
    await f.ops.executeOperation(f.owner, "github.statusSyncConfigure", {
      projectId: p.id,
      revision: p.revision,
      enabled: true,
    });
    await pollGithubStatusSync(
      f.db,
      f.config,
      new GithubApp(f.config, f.fetcher),
      f.store,
    );
    assert.equal(
      (await f.db.one("SELECT status FROM github_status_sync")).status,
      "ready",
    );
    await f.ops.executeOperation(f.owner, "github.appEnable", {
      appId: "303",
      revision: app.revision,
      enabled: false,
    });
    await f.db.query("UPDATE github_status_sync SET next_at=now()-interval '1 minute'");
    const calls = f.calls.length;
    await pollGithubStatusSync(
      f.db,
      f.config,
      new GithubApp(f.config, f.fetcher),
      f.store,
    );
    assert.equal(f.calls.length, calls);
    assert.equal(
      (await f.db.one("SELECT lease_until FROM github_status_sync")).lease_until,
      null,
    );
    assert.equal(linked.externalIssues[0].githubAppId, "303");
  } finally {
    await f.pg.close();
  }
});
test("HTTP start requires CSRF; registration has narrow CSP; callback bridge strips one-time codes and invokes the protected operation", async () => {
  const { createApp: makeHttpApp } = await import("../src/server/app.js");
  const f = await fixture();
  let server: any;
  try {
    server = makeHttpApp(f.config, f.db, f.store).listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const post = (body: any, csrf?: string) =>
      fetch(base + "/api/github.appSetupStart", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: f.config.appOrigin,
          Cookie: "feedbacks_session=" + f.login.token,
          ...(csrf ? { "X-CSRF-Token": csrf } : {}),
        },
        body: JSON.stringify(body),
      });
    const input = { account: "Second-Team", accountType: "organization" };
    assert.equal((await post(input)).status, 403);
    const result = await post(input, f.login.csrf);
    assert.equal(result.status, 200);
    const setup = (await result.json()).data,
      state = new URL(setup.actionUrl).searchParams.get("state");
    const page = await fetch(base + "/api/github-app/register?state=" + state, {
      headers: { Cookie: "feedbacks_session=" + f.login.token },
    });
    assert.equal(page.status, 200);
    assert.match(
      page.headers.get("content-security-policy")!,
      /form-action https:\/\/github.com/,
    );
    assert.equal(page.headers.get("cache-control"), "no-store");
    assert.equal(page.headers.get("referrer-policy"), "no-referrer");
    const html = await page.text();
    assert.ok(html.includes("github-app-register.js"));
    assert.ok(!html.includes("PRIVATE KEY"));
    assert.ok(html.includes("&quot;public&quot;:false"));
    const callback = await fetch(
      base + "/api/github-app/setup-callback?state=" + state + "&code=" + "a".repeat(40),
    );
    assert.equal(callback.status, 200);
    assert.equal(callback.headers.get("cache-control"), "no-store");
    assert.match(callback.headers.get("content-security-policy")!, /form-action 'self'/);
    assert.ok((await callback.text()).includes("github-app-callback.js"));
    assert.equal(f.conversions(), 0);
    const invalid = await fetch(
      base + "/api/github-app/setup-callback?state=invalid&code=secret-canary",
      { redirect: "manual" },
    );
    assert.equal(invalid.status, 303);
    assert.equal(invalid.headers.get("location"), "/github-apps?setup=failed");
  } finally {
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(resolve));
    }
    await f.pg.close();
  }
});

test("vault uses the existing least-privilege installation prefix and rejects another server identity", async () => {
  const { sealGithubKey, openGithubKey, githubKeyPrefix } = await import(
    "../src/server/github-app-vault.js"
  );
  const config = configFromEnv({ DATABASE_URL: "postgres://synthetic" });
  config.production = true;
  const prefix = `feedbacks/production/organizations/${config.organizationId}/server-secrets/github-apps/`,
    identity = config.organizationId + ":303",
    objects = new Map<string, Buffer>();
  assert.equal(githubKeyPrefix(config), prefix);
  const store = {
    put: async (k: string, b: Buffer) => {
      assert.ok(k.startsWith(prefix), "No broader S3 object permission required");
      objects.set(k, b);
    },
    get: async (k: string) => {
      assert.ok(k.startsWith(prefix));
      const value = objects.get(k);
      assert.ok(value);
      return value;
    },
    remove: async (k: string) => {
      objects.delete(k);
    },
  };
  const sealed = await sealGithubKey(store, identity, pem, prefix);
  assert.equal(
    await openGithubKey(store, identity, sealed.objectKey, sealed.envelope, prefix),
    pem,
  );
  await assert.rejects(
    openGithubKey(store, "another-server:303", sealed.objectKey, sealed.envelope, prefix),
    { code: "GITHUB_STORAGE_UNAVAILABLE" },
  );
  await assert.rejects(
    openGithubKey(
      store,
      identity,
      "server-secrets/github-apps/" + "a".repeat(36) + ".key",
      sealed.envelope,
      prefix,
    ),
    { code: "GITHUB_STORAGE_UNAVAILABLE" },
  );
});

test("common integration catalog lists only implemented providers and safe current counts for human owners", async () => {
  const { agentOperations, ownerTokenScopes } = await import(
    "../src/shared/contracts.js"
  );
  assert.equal(agentOperations.includes("integrations.catalog"), false);
  assert.equal(ownerTokenScopes.includes("integrations.catalog"), false);
  const f = await fixture(true);
  try {
    const before = await f.ops.executeOperation(f.owner, "integrations.catalog", {});
    assert.deepEqual(
      before.providers.map((provider: any) => provider.id),
      ["github"],
    );
    assert.equal(before.providers[0].configuredConnections, 1);
    assert.equal(before.providers[0].storage.environment, 1);
    await createApp(f);
    const after = await f.ops.executeOperation(f.owner, "integrations.catalog", {});
    assert.equal(after.providers[0].configuredConnections, 1);
    assert.equal(after.providers[0].storage.feedbacks, 1);
    assert.equal(after.providers[0].storage.environment, 0);
    assert.ok(!JSON.stringify(after).includes("PRIVATE KEY"));
    assert.ok(!JSON.stringify(after).includes("ciphertext"));
    const member = await f.ops.executeOperation(f.owner, "members.create", {
      name: "Member",
      email: "member@example.test",
      password: "Synthetic-Password-123",
      grants: [],
    });
    const login = await f.ops.auth.login("member@example.test", "Synthetic-Password-123");
    await f.db.query("UPDATE users SET must_change_password=false WHERE id=$1", [
      member.id,
    ]);
    const actor = await f.ops.auth.authenticate(undefined, login.token);
    await assert.rejects(f.ops.executeOperation(actor, "integrations.catalog", {}), {
      code: "FORBIDDEN",
    });
    const token = await f.ops.executeOperation(f.owner, "tokens.create", {
      name: "Synthetic integration agent",
      ownerAdmin: true,
      scopes: ["projects.list"],
    });
    await f.db.query(
      "UPDATE tokens SET scopes=scopes || '[\"integrations.catalog\"]'::jsonb WHERE id=$1",
      [token.id],
    );
    const agent = await f.ops.auth.authenticate(token.token);
    await assert.rejects(f.ops.executeOperation(agent, "integrations.catalog", {}), {
      code: "FORBIDDEN",
    });
    const paired = await f.ops.auth.issueToken(
      f.db,
      f.owner,
      {
        name: "Synthetic integration extension",
        projectIds: [],
        scopes: ["integrations.catalog"],
        expiresInDays: 1,
      },
      "extension",
    );
    await assert.rejects(
      f.ops.executeOperation(
        await f.ops.auth.authenticate(paired.token),
        "integrations.catalog",
        {},
      ),
      { code: "FORBIDDEN" },
    );
    await f.ops.executeOperation(f.owner, "github.appEnable", {
      appId: "303",
      revision: 1,
      enabled: false,
    });
    const disabled = await f.ops.executeOperation(f.owner, "integrations.catalog", {});
    assert.equal(disabled.providers[0].configuredConnections, 1);
    assert.equal(disabled.providers[0].activeConnections, 0);
    assert.deepEqual(disabled.providers[0].storage, { feedbacks: 1, environment: 0 });
  } finally {
    await f.pg.close();
  }
});
