import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { Database } from "../src/server/db.js";
import { migrate } from "../src/server/migrations.js";
import { Operations } from "../src/server/operations.js";

test("manual feedback needs no invented page or viewport and keeps reusable tags", async () => {
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
    const input = {
      projectId: project.id,
      body: "Make the review easier",
      tags: ["accessibility"],
      idempotencyKey: "manual-feedback-body-only",
    };
    const thread = await ops.executeOperation(owner, "threads.create", input);
    assert.deepEqual(thread.context, {});
    assert.deepEqual(thread.tags, ["accessibility"]);
    assert.equal(
      (await ops.executeOperation(owner, "threads.create", input)).id,
      thread.id,
    );
    assert.equal(
      (await ops.executeOperation(owner, "threads.get", { threadId: thread.id })).body,
      input.body,
    );
    assert.equal(
      (
        await ops.executeOperation(owner, "threads.list", {
          projectId: project.id,
          tag: "accessibility",
        })
      ).items[0].id,
      thread.id,
    );
    assert.equal(
      (
        await ops.executeOperation(owner, "projects.taxonomy.get", {
          projectId: project.id,
        })
      ).tags[0].name,
      "accessibility",
    );
    const linked = await ops.executeOperation(owner, "threads.create", {
      ...input,
      pageUrl: "https://example.test/help?token=private#section",
      idempotencyKey: "manual-feedback-page-link",
    });
    assert.equal(linked.context.url, "https://example.test/help");
    assert.equal(linked.context.viewport, undefined);
    assert.equal(linked.context.deviceClass, undefined);
    await assert.rejects(
      ops.executeOperation(owner, "threads.create", {
        ...input,
        pageUrl: "https://outside.test",
        idempotencyKey: "manual-feedback-bad-origin",
      }),
      { code: "ORIGIN_NOT_ALLOWED" },
    );
    await assert.rejects(
      ops.executeOperation(owner, "threads.create", {
        ...input,
        pageUrl: "javascript:alert(1)",
        idempotencyKey: "manual-feedback-bad-protocol",
      }),
      { code: "VALIDATION" },
    );
    await assert.rejects(
      ops.executeOperation({ ...owner, scopes: ["threads.get"] }, "threads.create", {
        ...input,
        idempotencyKey: "manual-feedback-denied",
      }),
      { code: "FORBIDDEN" },
    );
    await assert.rejects(
      ops.executeOperation(owner, "threads.create", {
        ...input,
        context: { url: "https://example.test" },
        idempotencyKey: "manual-feedback-invalid-capture",
      }),
      { code: "VALIDATION" },
    );
    await assert.rejects(
      ops.executeOperation(owner, "threads.create", {
        ...input,
        pageUrl: "https://example.test",
        context: { url: "https://example.test", viewport: { width: 390, height: 844 } },
        idempotencyKey: "manual-feedback-mixed-context",
      }),
      { code: "VALIDATION" },
    );
  } finally {
    await pg.close();
  }
});
