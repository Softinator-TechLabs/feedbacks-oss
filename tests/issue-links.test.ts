import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { Database } from "../src/server/db.js";
import { migrate } from "../src/server/migrations.js";
import { Operations } from "../src/server/operations.js";

test("a maintainer can report Jira and Linear issues without remote verification", async () => {
  const pg = new PGlite();
  const db = new Database(pg as any);
  try {
    await migrate(db);
    const ops = new Operations(db, {} as any, {} as any);
    const owner = await ops.auth.bootstrap(
      "owner@example.test",
      "Owner",
      "Correct-Horse-Battery-123",
    );
    const project = await ops.executeOperation(owner, "projects.create", {
      name: "Review",
      origins: ["https://example.test"],
    });
    let thread = await ops.executeOperation(owner, "threads.create", {
      projectId: project.id,
      body: "Fix checkout",
      context: { url: "https://example.test", viewport: { width: 1000, height: 800 } },
      idempotencyKey: "issue-links",
    });
    thread = await ops.executeOperation(owner, "threads.linkIssue", {
      threadId: thread.id,
      revision: thread.revision,
      url: "https://acme.atlassian.net/browse/WEB-42/",
    });
    assert.deepEqual(
      thread.externalIssues.map((issue: any) => ({
        url: issue.url,
        provider: issue.provider,
        verification: issue.verification,
      })),
      [
        {
          url: "https://acme.atlassian.net/browse/WEB-42",
          provider: "jira",
          verification: "reported",
        },
      ],
    );
    thread = await ops.executeOperation(owner, "threads.linkIssue", {
      threadId: thread.id,
      revision: thread.revision,
      url: "https://linear.app/acme/issue/ENG-27/fix-checkout",
    });
    assert.equal(thread.externalIssues[1].provider, "linear");
    assert.equal(thread.externalIssues[1].verification, "reported");
    assert.equal(
      thread.externalIssues[1].url,
      "https://linear.app/acme/issue/ENG-27/fix-checkout",
    );
    assert.equal(thread.work.state, "open");

    thread = await ops.executeOperation(owner, "threads.linkIssue", {
      threadId: thread.id,
      revision: thread.revision,
      url: "https://linear.app/acme/issue/ENG-27/renamed-title",
    });
    assert.equal(
      thread.externalIssues.length,
      2,
      "a changed Linear slug is the same Issue",
    );
  } finally {
    await pg.close();
  }
});

test("reported issue links reject lookalike hosts and non-issue URLs", async () => {
  const pg = new PGlite();
  const db = new Database(pg as any);
  try {
    await migrate(db);
    const ops = new Operations(db, {} as any, {} as any);
    const owner = await ops.auth.bootstrap(
      "owner@example.test",
      "Owner",
      "Correct-Horse-Battery-123",
    );
    const project = await ops.executeOperation(owner, "projects.create", {
      name: "Review",
      origins: ["https://example.test"],
    });
    const thread = await ops.executeOperation(owner, "threads.create", {
      projectId: project.id,
      body: "Fix checkout",
      context: { url: "https://example.test", viewport: { width: 1000, height: 800 } },
      idempotencyKey: "issue-links-rejected",
    });
    for (const url of [
      "https://acme.atlassian.net.evil.test/browse/WEB-42",
      "https://acme.atlassian.net/browse/WEB-42?redirect=evil",
      "https://linear.app.evil.test/acme/issue/ENG-27",
      "https://linear.app/acme/issue/ENG-27#private",
      "https://linear.app/acme/issue/ENG-27/comments/reply",
      "https://github.com/acme/repo/issues/2?tab=comments",
    ]) {
      await assert.rejects(
        ops.executeOperation(owner, "threads.linkIssue", {
          threadId: thread.id,
          revision: thread.revision,
          url,
        }),
        { code: "VALIDATION" },
        url,
      );
    }
    const unchanged = await ops.executeOperation(owner, "threads.get", {
      threadId: thread.id,
    });
    assert.equal(unchanged.revision, thread.revision);
    assert.equal(unchanged.externalIssues.length, 0);
  } finally {
    await pg.close();
  }
});
