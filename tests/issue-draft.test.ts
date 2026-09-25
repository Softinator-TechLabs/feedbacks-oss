import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { Database } from "../src/server/db.js";
import { migrate } from "../src/server/migrations.js";
import { Operations } from "../src/server/operations.js";
import { operationRegistry, outputSchemas } from "../src/shared/contracts.js";

test("Issue draft is scoped and excludes private metadata and assets", async () => {
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
      repositoryUrl: "https://github.com/example/repo",
    });
    const thread = await ops.executeOperation(owner, "threads.create", {
      projectId: project.id,
      body: "Fix checkout @all <script>\nAlignment is off.",
      context: { url: "https://example.test", viewport: { width: 1000, height: 800 } },
      idempotencyKey: "checkout-issue-draft",
    });
    const key = await ops.executeOperation(owner, "tokens.create", {
      name: "Issue drafting agent",
      projectIds: [project.id],
      scopes: ["threads.issueDraft"],
    });
    const agent = await ops.auth.authenticate(key.token);
    const draft = await ops.executeOperation(agent, "threads.issueDraft", {
      threadId: thread.id,
    });
    outputSchemas["threads.issueDraft"].parse(draft);
    assert.equal(operationRegistry["threads.issueDraft"].readOnly, true);
    assert.equal(draft.repositoryUrl, "https://github.com/example/repo");
    assert.equal(draft.requiresReview, true);
    assert.equal(draft.trust, "untrusted_discussion");
    assert.match(draft.body, /＠all &lt;script&gt;/);
    assert.match(draft.warnings.join(" "), /issue tracker/i);
    assert.doesNotMatch(draft.warnings.join(" "), /GitHub tool/i);
    for (const privateField of ["reviewerContext", "importance", "diagnostics", "assets"])
      assert.equal(Object.hasOwn(draft, privateField), false);
    const other = await ops.executeOperation(owner, "projects.create", {
      name: "Other",
      origins: ["https://other.test"],
    });
    const outside = await ops.executeOperation(owner, "threads.create", {
      projectId: other.id,
      body: "Private report",
      context: { url: "https://other.test", viewport: { width: 1000, height: 800 } },
      idempotencyKey: "private-issue-draft",
    });
    await assert.rejects(
      ops.executeOperation(agent, "threads.issueDraft", { threadId: outside.id }),
      { code: "FORBIDDEN" },
    );
  } finally {
    await pg.close();
  }
});
