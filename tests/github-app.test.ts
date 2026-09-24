import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { Database } from "../src/server/db.js";
import { migrate } from "../src/server/migrations.js";
import { Operations } from "../src/server/operations.js";
import { GithubApp, githubRepo } from "../src/server/github-app.js";

test("GitHub repository parser rejects non-canonical URLs", () => {
  assert.deepEqual(githubRepo("https://github.com/acme/site"), {
    owner: "acme",
    repo: "site",
    fullName: "acme/site",
  });
  for (const value of [
    "broken",
    "https://github.com/acme/site?x=1",
    "https://evil.test/acme/site",
    "https://github.com/acme/site/issues",
  ]) {
    assert.throws(() => githubRepo(value), { code: "GITHUB_REPOSITORY_REQUIRED" });
  }
});

test("GitHub App creates an Issue only after connection and explicit human review", async () => {
  const pg = new PGlite();
  const db = new Database(pg as any);
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const config: any = {
    githubAppId: "123",
    githubAppSlug: "feedbacks-test",
    githubAppPrivateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
  const calls: string[] = [];
  let createdBody = "";
  const fetcher: typeof fetch = async (url, init) => {
    const path = new URL(String(url)).pathname;
    calls.push(`${init?.method ?? "GET"} ${path}`);
    if (path.endsWith("/installation")) return Response.json({ id: 91 });
    if (path.endsWith("/access_tokens"))
      return Response.json({ token: "installation-token" });
    if (path.endsWith("/issues") && init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      assert.match(body.body, /feedbacks-request:/);
      createdBody = body.body;
      return Response.json({ number: 13 }, { status: 201 });
    }
    if (path.endsWith("/issues/13"))
      return Response.json({
        html_url: "https://github.com/acme/site/issues/13",
        number: 13,
        state: "open",
        body: createdBody,
      });
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
    const thread = await ops.executeOperation(owner, "threads.create", {
      projectId: project.id,
      body: "Checkout breaks",
      context: { url: "https://example.test", viewport: { width: 1000, height: 800 } },
      idempotencyKey: "github-test-thread",
    });
    const pending = () =>
      ops.executeOperation(owner, "github.issueCreate", {
        threadId: thread.id,
        revision: thread.revision,
        reviewed: true,
        title: "Checkout breaks",
        body: "Approved body",
        idempotencyKey: "github-create-issue-1",
      });
    await assert.rejects(pending(), { code: "GITHUB_NOT_CONNECTED" });
    const key = await ops.executeOperation(owner, "tokens.create", {
      name: "Reviewer agent",
      projectIds: [project.id],
      scopes: ["threads.issueDraft"],
    });
    const agent = await ops.auth.authenticate(key.token);
    await assert.rejects(
      ops.executeOperation(agent, "github.connect", {
        projectId: project.id,
        revision: project.revision,
      }),
      { code: "FORBIDDEN" },
    );
    const connected = await ops.executeOperation(owner, "github.connect", {
      projectId: project.id,
      revision: project.revision,
    });
    assert.equal(connected.githubConnected, true);
    const created = await pending();
    assert.equal(created.externalIssues[0].url, "https://github.com/acme/site/issues/13");
    assert.equal(created.externalIssues[0].verification, "github_verified");
    const repeat = await pending();
    assert.equal(repeat.id, thread.id);
    assert.equal(
      calls.filter((call) => call === "POST /repos/acme/site/issues").length,
      1,
    );
    await assert.rejects(
      ops.executeOperation(owner, "github.issueCreate", {
        threadId: thread.id,
        revision: thread.revision,
        reviewed: true,
        title: "Changed",
        body: "Approved body",
        idempotencyKey: "github-create-issue-1",
      }),
      { code: "IDEMPOTENCY_CONFLICT" },
    );
  } finally {
    await pg.close();
  }
});

test("uncertain external Issue writes are never retried automatically", async () => {
  const pg = new PGlite();
  const db = new Database(pg as any);
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const config: any = {
    githubAppId: "123",
    githubAppSlug: "feedbacks-test",
    githubAppPrivateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
  let posts = 0;
  let firstThreadId = "";
  const fetcher: typeof fetch = async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith("/installation")) return Response.json({ id: 91 });
    if (path.endsWith("/access_tokens"))
      return Response.json({ token: "installation-token" });
    if (path.endsWith("/issues") && init?.method === "POST") {
      posts += 1;
      throw new Error("Connection broke after GitHub may have created the Issue");
    }
    if (path.endsWith("/issues/14")) {
      const request = await db.one(
        "SELECT id FROM github_issue_requests WHERE thread_id=$1",
        [firstThreadId],
      );
      return Response.json({
        html_url: "https://github.com/acme/site/issues/14",
        state: "open",
        body: `Approved body\n\n<!-- feedbacks-request:${request.id} -->`,
      });
    }
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
    const thread = await ops.executeOperation(owner, "threads.create", {
      projectId: connected.id,
      body: "Checkout breaks",
      context: { url: "https://example.test", viewport: { width: 1000, height: 800 } },
      idempotencyKey: "github-uncertain-thread",
    });
    firstThreadId = thread.id;
    const input = {
      threadId: thread.id,
      revision: thread.revision,
      reviewed: true,
      title: "Checkout breaks",
      body: "Approved body",
      idempotencyKey: "github-uncertain-key",
    };
    await assert.rejects(ops.executeOperation(owner, "github.issueCreate", input), {
      code: "GITHUB_UNAVAILABLE",
    });
    await assert.rejects(ops.executeOperation(owner, "github.issueCreate", input), {
      code: "GITHUB_UNCERTAIN",
    });
    assert.equal(posts, 1);
    const another = await ops.executeOperation(owner, "threads.create", {
      projectId: connected.id,
      body: "Another issue",
      context: { url: "https://example.test", viewport: { width: 1000, height: 800 } },
      idempotencyKey: "github-abandon-thread",
    });
    await assert.rejects(
      ops.executeOperation(owner, "github.issueCreate", {
        threadId: another.id,
        revision: another.revision,
        reviewed: true,
        title: "Another issue",
        body: "Reviewed body",
        idempotencyKey: "github-abandon-key",
      }),
      { code: "GITHUB_UNAVAILABLE" },
    );
    assert.deepEqual(
      await ops.executeOperation(owner, "github.issueState", { threadId: another.id }),
      {
        status: "pending",
        issueUrl: null,
        canAbandon: false,
      },
    );
    await assert.rejects(
      ops.executeOperation(owner, "github.issueAbandon", {
        threadId: another.id,
        revision: another.revision,
        confirmedAbsent: true,
      }),
      { code: "GITHUB_PENDING" },
    );
    await db.query(
      "UPDATE github_issue_requests SET created_at=now()-interval '11 minutes' WHERE thread_id=$1",
      [another.id],
    );
    assert.equal(
      (await ops.executeOperation(owner, "github.issueState", { threadId: another.id }))
        .canAbandon,
      true,
    );
    await ops.executeOperation(owner, "github.issueAbandon", {
      threadId: another.id,
      revision: another.revision,
      confirmedAbsent: true,
    });
    assert.deepEqual(
      await ops.executeOperation(owner, "github.issueState", { threadId: another.id }),
      {
        status: "none",
        issueUrl: null,
        canAbandon: false,
      },
    );
    const changedProject = await ops.executeOperation(owner, "projects.update", {
      projectId: connected.id,
      revision: connected.revision,
      name: "Site",
      origins: ["https://example.test"],
      repositoryUrl: "https://github.com/acme/next",
    });
    assert.equal(changedProject.githubConnected, false);
    const manuallyLinked = await ops.executeOperation(owner, "threads.linkIssue", {
      threadId: thread.id,
      revision: thread.revision,
      url: "https://github.com/acme/site/issues/14",
    });
    assert.equal(manuallyLinked.externalIssues[0].verification, "reported");
    const reconciled = await ops.executeOperation(owner, "github.issueReconcile", {
      threadId: thread.id,
      revision: manuallyLinked.revision,
      issueUrl: "https://github.com/acme/site/issues/14",
    });
    assert.equal(reconciled.externalIssues[0].verification, "github_verified");
    const refreshed = await ops.executeOperation(owner, "github.issueRefresh", {
      threadId: thread.id,
      revision: reconciled.revision,
      issueUrl: "https://github.com/acme/site/issues/14",
    });
    assert.equal(refreshed.externalIssues[0].state, "open");
    const replay = await ops.executeOperation(owner, "github.issueCreate", input);
    assert.equal(replay.id, thread.id);
    assert.equal(posts, 2);
  } finally {
    await pg.close();
  }
});
