import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { configFromEnv } from "../src/server/config.js";

const keys = [1, 2].map(() => generateKeyPairSync("rsa", { modulusLength: 2048 }));
const entries = keys.map((key, index) => ({
  id: String(index + 101),
  name: `Team ${index + 1}`,
  slug: `team-${index + 1}`,
  privateKeyBase64: Buffer.from(
    key.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  ).toString("base64"),
  owners: [index === 0 ? "First-Team" : "Second-Team"],
}));
const env = {
  DATABASE_URL: "postgres://localhost/synthetic",
  GITHUB_APPS_JSON: JSON.stringify(entries),
};

test("multiple App configuration validates identities, RSA keys and approved GitHub accounts without exposing secrets", () => {
  const config: any = configFromEnv(env);
  assert.equal(config.githubApps.length, 2);
  assert.equal(config.githubApps[0].id, "101");
  assert.deepEqual(config.githubApps[0].owners, ["first-team"]);
  assert.match(config.githubApps[0].privateKey, /PRIVATE KEY/);
  for (const invalid of [
    [...entries, entries[0]],
    [{ ...entries[0], owners: [] }],
    [{ ...entries[0], owners: ["bad/account"] }],
    [{ ...entries[0], id: "0" }],
    [{ ...entries[0], privateKeyBase64: "secret-canary-invalid-rsa" }],
    [{ ...entries[0], name: "" }],
    [{ ...entries[0], slug: "bad/slug" }],
    entries.map((entry) => ({ ...entry, slug: "duplicate" })),
  ]) {
    assert.throws(
      () => configFromEnv({ ...env, GITHUB_APPS_JSON: JSON.stringify(invalid) }),
      (error) => {
        assert.ok(!String(error).includes("secret-canary"));
        assert.ok(!String(error).includes(entries[0].privateKeyBase64));
        return true;
      },
    );
  }
  assert.throws(() => configFromEnv({ ...env, GITHUB_APPS_JSON: "{" }));
  assert.throws(() => configFromEnv({ ...env, GITHUB_APPS_JSON: " ".repeat(300001) }));
  assert.throws(() =>
    configFromEnv({
      ...env,
      GITHUB_APP_ID: "101",
      GITHUB_APP_SLUG: "legacy",
      GITHUB_APP_PRIVATE_KEY_BASE64: entries[0].privateKeyBase64,
    }),
  );
});

import { verify } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { Database } from "../src/server/db.js";
import { migrate } from "../src/server/migrations.js";
import { Operations } from "../src/server/operations.js";
import { GithubApp, githubRepo } from "../src/server/github-app.js";
import { pollGithubStatusSync } from "../src/server/github-status-worker.js";
import { operationRegistry, outputSchemas } from "../src/shared/contracts.js";

async function fixture(legacy = false) {
  const pg = new PGlite(),
    db = new Database(pg as any);
  const config = configFromEnv(
    legacy
      ? {
          DATABASE_URL: env.DATABASE_URL,
          GITHUB_APP_ID: entries[0].id,
          GITHUB_APP_SLUG: entries[0].slug,
          GITHUB_APP_PRIVATE_KEY_BASE64: entries[0].privateKeyBase64,
          GITHUB_APPS_JSON: JSON.stringify([entries[1]]),
        }
      : env,
  );
  const calls: { appId: string; path: string; method: string }[] = [];
  const issues = new Map<string, { body: string; state: string }>();
  let failWrite = false;
  const fetcher: typeof fetch = async (url, init) => {
    const path = new URL(String(url)).pathname;
    const bearer = String((init!.headers as any).Authorization).slice(7);
    let appId: string;
    if (bearer.includes(".")) {
      const parts = bearer.split(".");
      appId = String(JSON.parse(Buffer.from(parts[1], "base64url").toString()).iss);
      assert.equal(
        verify(
          "RSA-SHA256",
          Buffer.from(parts.slice(0, 2).join(".")),
          keys[Number(appId) - 101].publicKey,
          Buffer.from(parts[2], "base64url"),
        ),
        true,
      );
    } else appId = bearer.replace("token-", "");
    calls.push({ appId, path, method: init?.method ?? "GET" });
    const expectedOwner = appId === "101" ? "first-team" : "second-team";
    if (path.startsWith("/repos/"))
      assert.equal(path.split("/")[2].toLowerCase(), expectedOwner);
    if (path.endsWith("/installation"))
      return Response.json({ id: Number(appId) + 1000 });
    if (path.endsWith("/access_tokens")) {
      assert.equal(path.split("/")[3], String(Number(appId) + 1000));
      const body = JSON.parse(String(init!.body));
      assert.equal(body.repositories.length, 1);
      assert.deepEqual(Object.keys(body.permissions), ["issues"]);
      return Response.json({ token: `token-${appId}` });
    }
    if (path.endsWith("/issues") && init?.method === "POST") {
      const input = JSON.parse(String(init.body));
      issues.set(`${path}/13`, { body: input.body, state: "open" });
      if (failWrite) throw new Error("Synthetic lost write response");
      return Response.json({ number: 13 }, { status: 201 });
    }
    if (path.includes("/issues/")) {
      const issue = issues.get(path);
      assert.ok(issue);
      if (init?.method === "PATCH") issue.state = JSON.parse(String(init.body)).state;
      return Response.json({
        html_url: `https://github.com/${path.slice(7)}`,
        number: 13,
        ...issue,
      });
    }
    if (/^\/repos\/[^/]+\/[^/]+$/.test(path)) return Response.json({ private: true });
    throw new Error(`Unexpected synthetic path ${path}`);
  };
  await migrate(db);
  const github = new GithubApp(config, fetcher),
    ops = new Operations(db, {} as any, config, github);
  const owner = await ops.auth.bootstrap(
    "owner@example.test",
    "Owner",
    "Correct-Horse-Battery-123",
  );
  const project = async (account: string, repo = "site") =>
    ops.executeOperation(owner, "projects.create", {
      name: account,
      origins: ["https://example.test"],
      repositoryUrl: `https://github.com/${account}/${repo}`,
    });
  const thread = async (p: any, key: string) =>
    ops.executeOperation(owner, "threads.create", {
      projectId: p.id,
      body: "Synthetic checkout feedback",
      context: { url: "https://example.test", viewport: { width: 1000, height: 800 } },
      idempotencyKey: key,
    });
  const select = (p: any, appId: string | null, actor = owner) =>
    ops.executeOperation(actor, "github.appSelect", {
      projectId: p.id,
      revision: p.revision,
      appId,
    });
  return {
    pg,
    db,
    config,
    github,
    ops,
    owner,
    calls,
    issues,
    project,
    thread,
    select,
    setFailWrite(value: boolean) {
      failWrite = value;
    },
  };
}

test("selecting an App repeatedly preserves account restrictions and the root credential catalog", async () => {
  const f = await fixture(true);
  try {
    const selected = f.github.forApp("102");
    await assert.rejects(
      selected.forApp("102").check(githubRepo("https://github.com/First-Team/site")),
      { code: "GITHUB_ACCOUNT_NOT_ALLOWED" },
    );
    assert.equal(f.calls.length, 0);
    await selected.forApp("102").check(githubRepo("https://github.com/Second-Team/site"));
    await selected.forApp("101").check(githubRepo("https://github.com/First-Team/site"));
    assert.deepEqual(
      f.calls.map((call) => call.appId),
      ["102", "102", "101", "101"],
    );
  } finally {
    await f.pg.close();
  }
});

test("explicit disabling and pinning the inherited App persist without resetting the same effective connection", async () => {
  const disabled = await fixture();
  try {
    const created = await disabled.project("First-Team");
    const p = await disabled.select(created, null);
    assert.equal(p.githubAppId, null);
    assert.equal(p.revision, created.revision + 1);
    disabled.config.githubAppId = entries[0].id;
    disabled.config.githubAppSlug = entries[0].slug;
    disabled.config.githubAppPrivateKey = Buffer.from(
      entries[0].privateKeyBase64,
      "base64",
    ).toString();
    const connection = await disabled.ops.executeOperation(
      disabled.owner,
      "github.connection",
      {
        projectId: p.id,
      },
    );
    assert.equal(connection.appId, null);
    assert.equal(connection.configured, false);
    assert.equal(disabled.calls.length, 0);
    assert.equal((await disabled.select(p, null)).revision, p.revision);
  } finally {
    await disabled.pg.close();
  }
  const f = await fixture(true);
  try {
    let p = await f.project("First-Team");
    p = await f.ops.executeOperation(f.owner, "github.connect", {
      projectId: p.id,
      revision: p.revision,
    });
    p = await f.ops.executeOperation(f.owner, "github.statusSyncConfigure", {
      projectId: p.id,
      revision: p.revision,
      enabled: true,
    });
    const pinned = await f.select(p, "101");
    assert.equal(pinned.githubAppId, "101");
    assert.equal(pinned.revision, p.revision + 1);
    assert.equal(pinned.githubConnected, true);
    assert.equal(pinned.githubStatusSync, true);
    assert.deepEqual(pinned.githubRepositories, p.githubRepositories);
    assert.equal((await f.select(pinned, "101")).revision, pinned.revision);
  } finally {
    await f.pg.close();
  }
});

test("owner assigns two private Apps; creation, refresh and polling use the project identity", async () => {
  const f = await fixture();
  try {
    let first = await f.project("First-Team"),
      second = await f.project("Second-Team");
    first = await f.select(first, "101");
    second = await f.select(second, "102");
    for (let p of [first, second]) {
      const connection = await f.ops.executeOperation(f.owner, "github.connection", {
        projectId: p.id,
      });
      outputSchemas["github.connection"].parse(connection);
      assert.equal(connection.appId, p.githubAppId);
      assert.equal(connection.apps.length, 2);
      assert.ok(!JSON.stringify(connection).includes("PRIVATE KEY"));
      assert.ok(!JSON.stringify(connection).includes(entries[0].privateKeyBase64));
      assert.equal(
        connection.installUrl,
        `https://github.com/apps/team-${p.githubAppId === "101" ? "1" : "2"}/installations/new`,
      );
      p = await f.ops.executeOperation(f.owner, "github.connect", {
        projectId: p.id,
        revision: p.revision,
      });
      const t = await f.thread(p, `multiple-app-thread-${p.githubAppId}`);
      const created = await f.ops.executeOperation(f.owner, "github.issueCreateQuick", {
        threadId: t.id,
        revision: t.revision,
        idempotencyKey: `multiple-app-issue-${p.githubAppId}`,
      });
      assert.equal(created.externalIssues[0].githubAppId, p.githubAppId);
      assert.equal(
        (await f.db.one(
          "SELECT github_app_id FROM github_issue_requests WHERE thread_id=$1",
          [t.id],
        ))!.github_app_id,
        p.githubAppId,
      );
      await f.ops.executeOperation(f.owner, "github.issueRefresh", {
        threadId: t.id,
        revision: created.revision,
        issueUrl: created.externalIssues[0].url,
      });
      await f.ops.executeOperation(f.owner, "github.statusSyncConfigure", {
        projectId: p.id,
        revision: p.revision,
        enabled: true,
      });
      await pollGithubStatusSync(f.db, f.config, f.github);
      assert.equal(
        (await f.db.one("SELECT status FROM github_status_sync WHERE thread_id=$1", [
          t.id,
        ]))!.status,
        "ready",
      );
      const current = await f.ops.executeOperation(f.owner, "threads.get", {
        threadId: t.id,
      });
      const resolved = await f.ops.executeOperation(f.owner, "threads.status", {
        threadId: t.id,
        revision: current.revision,
        state: "resolved",
      });
      await f.ops.executeOperation(f.owner, "github.statusSync", {
        threadId: t.id,
        revision: resolved.revision,
        issueUrl: created.externalIssues[0].url,
        source: "feedbacks",
      });
      assert.equal(f.issues.get(`/repos/${p.name}/site/issues/13`)!.state, "closed");
      const afterSync = await f.ops.executeOperation(f.owner, "threads.get", {
        threadId: t.id,
      });
      await f.ops.executeOperation(f.owner, "threads.status", {
        threadId: t.id,
        revision: afterSync.revision,
        state: "open",
      });
      await f.db.query(
        "UPDATE github_status_sync SET next_at=now()-interval '1 minute' WHERE thread_id=$1",
        [t.id],
      );
      await pollGithubStatusSync(f.db, f.config, f.github);
      assert.equal(f.issues.get(`/repos/${p.name}/site/issues/13`)!.state, "open");
    }
    assert.ok(
      f.calls.some(
        (c) => c.appId === "101" && c.path.endsWith("/issues") && c.method === "POST",
      ),
    );
    assert.ok(
      f.calls.some(
        (c) => c.appId === "102" && c.path.endsWith("/issues") && c.method === "POST",
      ),
    );
    assert.ok(
      f.calls.some(
        (c) => c.appId === "102" && c.path.endsWith("/issues/13") && c.method === "GET",
      ),
    );
  } finally {
    await f.pg.close();
  }
});

test("App selection is human-owner-only, revision checked, account restricted and preserved on project edits", async () => {
  const f = await fixture();
  try {
    let p = await f.project("Second-Team");
    const key = await f.ops.executeOperation(f.owner, "tokens.create", {
      name: "Synthetic agent",
      projectIds: [p.id],
      scopes: ["projects.get"],
    });
    const agent = await f.ops.auth.authenticate(key.token);
    await assert.rejects(f.select(p, "102", agent), { code: "FORBIDDEN" });
    await assert.rejects(f.ops.executeOperation(agent, "github.apps", {}), {
      code: "FORBIDDEN",
    });
    const member = await f.ops.executeOperation(f.owner, "members.create", {
      email: "maintainer@example.test",
      name: "Maintainer",
      password: "Correct-Horse-Battery-123",
    });
    await f.ops.executeOperation(f.owner, "members.grant", {
      projectId: p.id,
      userId: member.id,
      role: "maintainer",
    });
    const login = await f.ops.auth.login(
      "maintainer@example.test",
      "Correct-Horse-Battery-123",
    );
    let maintainer = await f.ops.auth.authenticate(undefined, login.token);
    await f.ops.auth.changePassword(
      maintainer,
      "Correct-Horse-Battery-123",
      "New-Correct-Horse-Battery-123",
    );
    const renewed = await f.ops.auth.login(
      "maintainer@example.test",
      "New-Correct-Horse-Battery-123",
    );
    maintainer = await f.ops.auth.authenticate(undefined, renewed.token);
    await assert.rejects(f.select(p, "102", maintainer), { code: "FORBIDDEN" });
    await assert.rejects(f.ops.executeOperation(maintainer, "github.apps", {}), {
      code: "FORBIDDEN",
    });
    await assert.rejects(f.select(p, "999"), { code: "GITHUB_UNAVAILABLE" });
    p = await f.select(p, "101");
    const before = f.calls.length;
    await assert.rejects(
      f.ops.executeOperation(f.owner, "github.connect", {
        projectId: p.id,
        revision: p.revision,
      }),
      { code: "GITHUB_ACCOUNT_NOT_ALLOWED" },
    );
    assert.equal(f.calls.length, before);
    await assert.rejects(f.select({ ...p, revision: p.revision - 1 }, "102"), {
      code: "CONFLICT",
    });
    p = await f.select(p, "102");
    p = await f.ops.executeOperation(f.owner, "projects.update", {
      projectId: p.id,
      revision: p.revision,
      name: "Renamed",
      origins: p.origins,
      repositoryUrl: p.repositoryUrl,
    });
    assert.equal(p.githubAppId, "102");
    const info = await f.ops.executeOperation(maintainer, "github.connection", {
      projectId: p.id,
    });
    assert.equal(info.canSelectApp, false);
    assert.deepEqual(info.apps, []);
    assert.equal(info.appId, "102");
  } finally {
    await f.pg.close();
  }
});

test("owner App inventory is available before creating projects and exposes only safe metadata", async () => {
  const f = await fixture(true);
  try {
    const inventory = await f.ops.executeOperation(f.owner, "github.apps", {});
    assert.equal(operationRegistry["github.apps"].readOnly, true);
    outputSchemas["github.apps"].parse(inventory);
    assert.equal(inventory.defaultAppId, "101");
    assert.deepEqual(
      inventory.apps.map((app: any) => app.id),
      ["101", "102"],
    );
    assert.deepEqual(inventory.apps[1].owners, ["second-team"]);
    assert.ok(!JSON.stringify(inventory).includes("PRIVATE KEY"));
    assert.ok(!JSON.stringify(inventory).includes(entries[0].privateKeyBase64));
    assert.equal(f.calls.length, 0);
    f.config.githubAppId = undefined;
    f.config.githubAppSlug = undefined;
    f.config.githubAppPrivateKey = undefined;
    f.config.githubApps = [];
    assert.deepEqual(await f.ops.executeOperation(f.owner, "github.apps", {}), {
      defaultAppId: null,
      apps: [],
    });
  } finally {
    await f.pg.close();
  }
});

test("switching clears connections and sync but retains provenance; removed credentials never use another App", async () => {
  const f = await fixture();
  try {
    let p = await f.select(await f.project("First-Team"), "101");
    p = await f.ops.executeOperation(f.owner, "github.connect", {
      projectId: p.id,
      revision: p.revision,
    });
    const t = await f.thread(p, "switch-app-thread");
    const linked = await f.ops.executeOperation(f.owner, "github.issueCreate", {
      threadId: t.id,
      revision: t.revision,
      reviewed: true,
      title: "Synthetic",
      body: "Reviewed synthetic body",
      idempotencyKey: "switch-app-issue",
    });
    p = await f.ops.executeOperation(f.owner, "github.statusSyncConfigure", {
      projectId: p.id,
      revision: p.revision,
      enabled: true,
    });
    await f.db.query(
      "INSERT INTO github_status_sync(thread_id,issue_url,lease_until) VALUES($1,$2,now()+interval '1 minute')",
      [t.id, linked.externalIssues[0].url],
    );
    await assert.rejects(f.select(p, "102"), { code: "GITHUB_PENDING" });
    await f.db.query(
      "UPDATE github_status_sync SET lease_until=NULL,status='uncertain' WHERE thread_id=$1",
      [t.id],
    );
    await assert.rejects(f.select(p, "102"), { code: "GITHUB_PENDING" });
    await f.db.query("UPDATE github_status_sync SET status='ready' WHERE thread_id=$1", [
      t.id,
    ]);
    p = await f.select(p, "102");
    assert.equal(p.githubConnected, false);
    assert.equal(p.githubStatusSync, false);
    assert.deepEqual(p.githubRepositories, []);
    const before = f.calls.length;
    const refreshed = await f.ops.executeOperation(f.owner, "github.issueRefresh", {
      threadId: t.id,
      revision: linked.revision,
      issueUrl: linked.externalIssues[0].url,
    });
    assert.ok(f.calls.slice(before).every((c) => c.appId === "101"));
    f.config.githubApps = f.config.githubApps!.filter((app) => app.id !== "101");
    const count = f.calls.length;
    await assert.rejects(
      f.ops.executeOperation(f.owner, "github.issueRefresh", {
        threadId: t.id,
        revision: refreshed.revision,
        issueUrl: refreshed.externalIssues[0].url,
      }),
      { code: "GITHUB_UNAVAILABLE" },
    );
    assert.equal(f.calls.length, count);
    f.config.githubApps = [];
    const info = await f.ops.executeOperation(f.owner, "github.connection", {
      projectId: p.id,
    });
    assert.equal(info.configured, false);
    assert.equal(info.appId, "102");
  } finally {
    await f.pg.close();
  }
});

test("an uncertain Issue request blocks App switching and reconciliation stays with its reserved App", async () => {
  const f = await fixture();
  try {
    let p = await f.select(await f.project("Second-Team"), "102");
    p = await f.ops.executeOperation(f.owner, "github.connect", {
      projectId: p.id,
      revision: p.revision,
    });
    const t = await f.thread(p, "pending-app-thread");
    f.setFailWrite(true);
    await assert.rejects(
      f.ops.executeOperation(f.owner, "github.issueCreate", {
        threadId: t.id,
        revision: t.revision,
        reviewed: true,
        title: "Synthetic",
        body: "Reviewed",
        idempotencyKey: "pending-app-issue",
      }),
      { code: "GITHUB_UNAVAILABLE" },
    );
    await assert.rejects(f.select(p, "101"), { code: "GITHUB_PENDING" });
    const recovered = await f.ops.executeOperation(f.owner, "github.issueReconcile", {
      threadId: t.id,
      revision: t.revision,
      issueUrl: "https://github.com/Second-Team/site/issues/13",
    });
    assert.equal(recovered.externalIssues[0].githubAppId, "102");
    assert.equal(
      f.calls.filter((c) => c.method === "POST" && c.path.endsWith("/issues")).length,
      1,
    );
  } finally {
    await f.pg.close();
  }
});

test("legacy default and unlabelled links survive explicit selection of an additional App", async () => {
  const f = await fixture(true);
  try {
    let p = await f.project("First-Team");
    p = await f.ops.executeOperation(f.owner, "github.connect", {
      projectId: p.id,
      revision: p.revision,
    });
    const t = await f.thread(p, "legacy-app-thread");
    const linked = await f.ops.executeOperation(f.owner, "github.issueCreateQuick", {
      threadId: t.id,
      revision: t.revision,
      idempotencyKey: "legacy-app-issue",
    });
    await f.db.query(
      "UPDATE threads SET data=jsonb_set(data,'{externalIssues,0}',(data->'externalIssues'->0)-'githubAppId') WHERE id=$1",
      [t.id],
    );
    p = await f.select(p, "102");
    const count = f.calls.length;
    await f.ops.executeOperation(f.owner, "github.issueRefresh", {
      threadId: t.id,
      revision: linked.revision,
      issueUrl: linked.externalIssues[0].url,
    });
    assert.ok(f.calls.slice(count).every((c) => c.appId === "101"));
    p = await f.select(p, null);
    const info = await f.ops.executeOperation(f.owner, "github.connection", {
      projectId: p.id,
    });
    assert.equal(info.configured, false);
  } finally {
    await f.pg.close();
  }
});
