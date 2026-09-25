import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { Database } from "../src/server/db.js";
import { migrate } from "../src/server/migrations.js";
import { Operations } from "../src/server/operations.js";
import { GithubApp } from "../src/server/github-app.js";
import { pollGithubStatusSync } from "../src/server/github-status-worker.js";

test("opt-in status sync reads a verified closed Issue and resolves its thread once", async () => {
  const pg = new PGlite();
  const db = new Database(pg as any);
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const config: any = {
    githubAppId: "123",
    githubAppSlug: "feedbacks-test",
    githubAppPrivateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
  let posts = 0;
  let createdBody = "";
  let patches = 0;
  let state: "open" | "closed" = "closed";
  const url = "https://github.com/acme/site/issues/13";
  const fetcher: typeof fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/installation")) return Response.json({ id: 91 });
    if (path.endsWith("/access_tokens"))
      return Response.json({ token: "installation-token" });
    if (path.endsWith("/issues") && init?.method === "POST") {
      posts++;
      createdBody = JSON.parse(String(init.body)).body;
      return Response.json({ number: 13 }, { status: 201 });
    }
    if (path.endsWith("/issues/13") && init?.method === "PATCH") {
      patches++;
      state = JSON.parse(String(init.body)).state;
      return Response.json({ number: 13, state });
    }
    if (path.endsWith("/issues/13"))
      return Response.json({ html_url: url, number: 13, state, body: createdBody });
    throw new Error(`Unexpected GitHub API ${path}`);
  };
  try {
    await migrate(db);
    const ops = new Operations(db, {} as any, config, new GithubApp(config, fetcher));
    const owner = await ops.auth.bootstrap(
      "owner@example.test",
      "Owner",
      "Correct-Horse-Battery-123",
    );
    const project = await ops.executeOperation(owner, "projects.create", {
      name: "Site",
      origins: ["https://example.test"],
      repositoryUrl: "https://github.com/acme/site",
    });
    const connected = await ops.executeOperation(owner, "github.connect", {
      projectId: project.id,
      revision: project.revision,
    });
    const key = await ops.executeOperation(owner, "tokens.create", {
      name: "Scoped reviewer",
      projectIds: [project.id],
      scopes: ["threads.issueDraft"],
    });
    const agent = await ops.auth.authenticate(key.token);
    await assert.rejects(
      ops.executeOperation(agent, "github.statusSyncConfigure", {
        projectId: project.id,
        revision: connected.revision,
        enabled: true,
      }),
      { code: "FORBIDDEN" },
    );
    const thread = await ops.executeOperation(owner, "threads.create", {
      projectId: project.id,
      body: "Checkout breaks",
      context: { url: "https://example.test", viewport: { width: 1000, height: 800 } },
      idempotencyKey: "status-sync-thread",
    });
    const linked = await ops.executeOperation(owner, "github.issueCreate", {
      threadId: thread.id,
      revision: thread.revision,
      reviewed: true,
      title: "Checkout breaks",
      body: "Reviewed details",
      idempotencyKey: "status-create-issue",
    });
    await assert.rejects(
      ops.executeOperation(owner, "github.statusSync", {
        threadId: thread.id,
        revision: linked.revision,
        issueUrl: url,
        source: "github",
      }),
      { code: "GITHUB_SYNC_DISABLED" },
    );
    assert.equal(linked.externalIssues[0].verification, "github_verified");
    const enabled = await ops.executeOperation(owner, "github.statusSyncConfigure", {
      projectId: connected.id,
      revision: connected.revision,
      enabled: true,
    });
    assert.equal(enabled.githubStatusSync, true);
    const pulled = await ops.executeOperation(owner, "github.statusSync", {
      threadId: thread.id,
      revision: linked.revision,
      issueUrl: url,
      source: "github",
    });
    assert.equal(pulled.work.state, "resolved");
    assert.equal(pulled.externalIssues[0].state, "closed");
    const again = await ops.executeOperation(owner, "github.statusSync", {
      threadId: thread.id,
      revision: pulled.revision,
      issueUrl: url,
      source: "github",
    });
    assert.equal(again.revision, pulled.revision);
    assert.equal(posts, 1);
    assert.equal(patches, 0);
    const reopened = await ops.executeOperation(owner, "threads.status", {
      threadId: thread.id,
      revision: again.revision,
      state: "open",
    });
    const pushed = await ops.executeOperation(owner, "github.statusSync", {
      threadId: thread.id,
      revision: reopened.revision,
      issueUrl: url,
      source: "feedbacks",
    });
    assert.equal(pushed.externalIssues[0].state, "open");
    assert.equal(patches, 1);
    const disabled = await ops.executeOperation(owner, "github.disconnect", {
      projectId: connected.id,
      revision: enabled.revision,
    });
    assert.equal(disabled.githubStatusSync, false);
    await assert.rejects(
      ops.executeOperation(owner, "github.statusSync", {
        threadId: thread.id,
        revision: pushed.revision,
        issueUrl: url,
        source: "github",
      }),
      { code: "GITHUB_SYNC_DISABLED" },
    );
  } finally {
    await pg.close();
  }
});

test("worker pulls a one-sided GitHub close, pushes a one-sided Feedbacks reopen, and stops on conflict", async () => {
  const pg = new PGlite();
  const db = new Database(pg as any);
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const config: any = {
    githubAppId: "123",
    githubAppSlug: "feedbacks-test",
    githubAppPrivateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
  const url = "https://github.com/acme/site/issues/21";
  let githubState: "open" | "closed" = "open";
  let patchCount = 0;
  let failPatch = false;
  const fetcher: typeof fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/installation")) return Response.json({ id: 91 });
    if (path.endsWith("/access_tokens"))
      return Response.json({ token: "installation-token" });
    if (path.endsWith("/issues/21") && init?.method === "PATCH") {
      patchCount++;
      if (failPatch) throw new Error("GitHub response lost after PATCH");
      githubState = JSON.parse(String(init.body)).state;
      return Response.json({ state: githubState });
    }
    if (path.endsWith("/issues/21"))
      return Response.json({ html_url: url, number: 21, state: githubState, body: "" });
    throw new Error(`Unexpected GitHub API ${path}`);
  };
  try {
    await migrate(db);
    const github = new GithubApp(config, fetcher);
    const ops = new Operations(db, {} as any, config, github);
    const owner = await ops.auth.bootstrap(
      "owner@example.test",
      "Owner",
      "Correct-Horse-Battery-123",
    );
    const project = await ops.executeOperation(owner, "projects.create", {
      name: "Site",
      origins: ["https://example.test"],
      repositoryUrl: "https://github.com/acme/site",
    });
    const connected = await ops.executeOperation(owner, "github.connect", {
      projectId: project.id,
      revision: project.revision,
    });
    const thread = await ops.executeOperation(owner, "threads.create", {
      projectId: project.id,
      body: "Checkout breaks",
      context: { url: "https://example.test", viewport: { width: 1000, height: 800 } },
      idempotencyKey: "status-worker-thread",
    });
    await db.query(
      "UPDATE threads SET data=jsonb_set(data,'{externalIssues}',jsonb_build_array(jsonb_build_object('url',$2::text,'repository','acme/site','number',21,'verification','github_verified','state','open'))) WHERE id=$1",
      [thread.id, url],
    );
    await pollGithubStatusSync(db, config, github);
    let current = await ops.executeOperation(owner, "threads.get", {
      threadId: thread.id,
    });
    assert.equal(current.work.state, "open");
    const enabled = await ops.executeOperation(owner, "github.statusSyncConfigure", {
      projectId: connected.id,
      revision: connected.revision,
      enabled: true,
    });
    await pollGithubStatusSync(db, config, github);
    githubState = "closed";
    await db.query(
      "UPDATE github_status_sync SET next_at=now()-interval '1 minute' WHERE thread_id=$1",
      [thread.id],
    );
    await pollGithubStatusSync(db, config, github);
    current = await ops.executeOperation(owner, "threads.get", { threadId: thread.id });
    assert.equal(current.work.state, "resolved");
    const reopened = await ops.executeOperation(owner, "threads.status", {
      threadId: thread.id,
      revision: current.revision,
      state: "open",
    });
    await db.query(
      "UPDATE github_status_sync SET next_at=now()-interval '1 minute' WHERE thread_id=$1",
      [thread.id],
    );
    await pollGithubStatusSync(db, config, github);
    assert.equal(githubState, "open");
    assert.equal(patchCount, 1);
    const synced = await ops.executeOperation(owner, "threads.get", {
      threadId: thread.id,
    });
    assert.equal(synced.externalIssues[0].state, "open");
    githubState = "closed";
    await ops.executeOperation(owner, "threads.status", {
      threadId: thread.id,
      revision: synced.revision,
      state: "resolved",
    });
    await db.query(
      "UPDATE github_status_sync SET next_at=now()-interval '1 minute' WHERE thread_id=$1",
      [thread.id],
    );
    await pollGithubStatusSync(db, config, github);
    const status = await ops.executeOperation(owner, "github.statusSyncState", {
      threadId: thread.id,
    });
    assert.equal(status.status, "conflict");
    assert.equal(patchCount, 1);
    const conflicted = await ops.executeOperation(owner, "threads.get", {
      threadId: thread.id,
    });
    const resolved = await ops.executeOperation(owner, "github.statusSync", {
      threadId: thread.id,
      revision: conflicted.revision,
      issueUrl: url,
      source: "github",
    });
    assert.equal(
      (
        await ops.executeOperation(owner, "github.statusSyncState", {
          threadId: thread.id,
        })
      ).status,
      "ready",
    );
    await ops.executeOperation(owner, "threads.status", {
      threadId: thread.id,
      revision: resolved.revision,
      state: "open",
    });
    failPatch = true;
    await db.query(
      "UPDATE github_status_sync SET next_at=now()-interval '1 minute' WHERE thread_id=$1",
      [thread.id],
    );
    await pollGithubStatusSync(db, config, github);
    assert.equal(
      (
        await ops.executeOperation(owner, "github.statusSyncState", {
          threadId: thread.id,
        })
      ).status,
      "uncertain",
    );
    await pollGithubStatusSync(db, config, github);
    assert.equal(patchCount, 2);
    const disconnected = await ops.executeOperation(owner, "github.disconnect", {
      projectId: connected.id,
      revision: enabled.revision,
    });
    assert.equal(disconnected.githubStatusSync, false);
  } finally {
    await pg.close();
  }
});
