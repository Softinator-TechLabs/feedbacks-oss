import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { Database } from "../src/server/db.js";
import { migrate } from "../src/server/migrations.js";
import { Operations } from "../src/server/operations.js";

test("authors can edit earlier replies with a visible edit time; other members cannot", async () => {
  const pg = new PGlite();
  try {
    const db = new Database(pg as any);
    await migrate(db);
    const ops = new Operations(
      db,
      {} as any,
      {
        appOrigin: "http://localhost:3000",
      } as any,
    );
    await ops.auth.bootstrap("owner@example.test", "Owner", "Correct-Horse-Battery-123");
    const owner = await ops.auth.authenticate(
      undefined,
      (await ops.auth.login("owner@example.test", "Correct-Horse-Battery-123")).token,
    );
    const project = await ops.executeOperation(owner, "projects.create", {
      name: "Review",
      origins: ["https://example.test"],
    });
    const invite = await ops.executeOperation(owner, "members.invite", {
      email: "reviewer@example.test",
      projectId: project.id,
      role: "reviewer",
    });
    await ops.auth.acceptInvite(invite.token, "Reviewer", "Correct-Horse-Battery-123");
    const reviewer = await ops.auth.authenticate(
      undefined,
      (await ops.auth.login("reviewer@example.test", "Correct-Horse-Battery-123")).token,
    );
    const thread = await ops.executeOperation(owner, "threads.create", {
      projectId: project.id,
      body: "Please check this page",
      context: {
        url: "https://example.test/",
        viewport: { width: 1280, height: 800 },
      },
      idempotencyKey: "create-thread",
    });
    const posted = await ops.executeOperation(reviewer, "threads.reply", {
      threadId: thread.id,
      revision: thread.revision,
      body: "The first wording",
      idempotencyKey: "create-reply",
    });
    const reply = posted.replies[0];
    assert.equal(reply.editedAt, undefined);
    await assert.rejects(
      ops.executeOperation(owner, "threads.editReply", {
        threadId: thread.id,
        replyId: reply.id,
        revision: posted.revision,
        body: "Overwritten by owner",
        idempotencyKey: "wrong-author-edit",
      }),
      { code: "FORBIDDEN" },
    );
    await assert.rejects(
      ops.executeOperation(owner, "threads.deleteReply", {
        threadId: thread.id,
        replyId: reply.id,
        revision: posted.revision,
        idempotencyKey: "wrong-author-delete",
      }),
      { code: "FORBIDDEN" },
    );
    const editInput = {
      threadId: thread.id,
      replyId: reply.id,
      revision: posted.revision,
      body: "The corrected wording",
      idempotencyKey: "edit-own-reply",
    };
    const edited = await ops.executeOperation(reviewer, "threads.editReply", editInput);
    assert.equal(edited.replies[0].body, "The corrected wording");
    assert.equal(edited.replies[0].createdAt, reply.createdAt);
    assert.equal(edited.replies[0].author.userId, reviewer.userId);
    assert.ok(Date.parse(edited.replies[0].editedAt) >= Date.parse(reply.createdAt));
    assert.equal(edited.response.state, "unanswered");
    assert.equal(edited.revision, posted.revision + 1);
    assert.equal(
      (await ops.executeOperation(owner, "threads.get", { threadId: thread.id }))
        .replies[0].editedAt,
      edited.replies[0].editedAt,
    );
    const retried = await ops.executeOperation(reviewer, "threads.editReply", editInput);
    assert.equal(retried.revision, edited.revision);
    assert.equal(retried.replies[0].editedAt, edited.replies[0].editedAt);
    await assert.rejects(
      ops.executeOperation(reviewer, "threads.editReply", {
        ...editInput,
        body: "Conflicting retry",
      }),
      { code: "IDEMPOTENCY_CONFLICT" },
    );
    await assert.rejects(
      ops.executeOperation(reviewer, "threads.editReply", {
        ...editInput,
        revision: posted.revision,
        idempotencyKey: "stale-reply-edit",
      }),
      { code: "CONFLICT" },
    );
  } finally {
    await pg.close();
  }
});

test("deleting an own reply removes its likes and rebuilds response state", async () => {
  const pg = new PGlite();
  try {
    const db = new Database(pg as any);
    await migrate(db);
    const ops = new Operations(
      db,
      {} as any,
      {
        appOrigin: "http://localhost:3000",
      } as any,
    );
    await ops.auth.bootstrap("owner@example.test", "Owner", "Correct-Horse-Battery-123");
    const owner = await ops.auth.authenticate(
      undefined,
      (await ops.auth.login("owner@example.test", "Correct-Horse-Battery-123")).token,
    );
    const project = await ops.executeOperation(owner, "projects.create", {
      name: "Review",
      origins: ["https://example.test"],
    });
    const thread = await ops.executeOperation(owner, "threads.create", {
      projectId: project.id,
      body: "Original request",
      context: {
        url: "https://example.test/",
        viewport: { width: 1280, height: 800 },
      },
      idempotencyKey: "create-thread",
    });
    const posted = await ops.executeOperation(owner, "threads.reply", {
      threadId: thread.id,
      revision: thread.revision,
      body: "Resolved response",
      intent: "response",
      idempotencyKey: "create-reply",
    });
    const replyId = posted.replies[0].id;
    await ops.executeOperation(owner, "threads.like", {
      threadId: thread.id,
      replyId,
      liked: true,
    });
    const deleteInput = {
      threadId: thread.id,
      replyId,
      revision: posted.revision,
      idempotencyKey: "delete-own-reply",
    };
    const deleted = await ops.executeOperation(owner, "threads.deleteReply", deleteInput);
    assert.equal(deleted.replies.length, 0);
    assert.equal(deleted.response.state, "unanswered");
    assert.equal(deleted.response.lastResponse, null);
    assert.equal(deleted.revision, posted.revision + 1);
    assert.equal(
      (await ops.executeOperation(owner, "threads.get", { threadId: thread.id })).replies
        .length,
      0,
    );
    assert.equal(
      (await db.query("SELECT * FROM discussion_likes WHERE reply_id=$1", [replyId]))
        .length,
      0,
    );
    assert.equal(
      (
        await ops.executeOperation(owner, "views.get", {
          projectId: project.id,
          context: {
            url: "https://example.test/",
            viewport: { width: 1280, height: 800 },
          },
        })
      ).discussionCount,
      1,
    );
    const retried = await ops.executeOperation(owner, "threads.deleteReply", deleteInput);
    assert.equal(retried.revision, deleted.revision);
    await assert.rejects(
      ops.executeOperation(owner, "threads.deleteReply", {
        ...deleteInput,
        revision: deleted.revision,
        idempotencyKey: "delete-missing-reply",
      }),
      { code: "NOT_FOUND" },
    );
  } finally {
    await pg.close();
  }
});
