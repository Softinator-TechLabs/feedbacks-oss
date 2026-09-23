import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { Database } from "../src/server/db.js";
import { migrate } from "../src/server/migrations.js";
import { Operations } from "../src/server/operations.js";
import { outputSchemas } from "../src/shared/contracts.js";

test("human review sign-off keeps a separate, attributed round history", async () => {
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
    const invitation = await ops.executeOperation(owner, "members.invite", {
      email: "client@example.test",
      projectId: project.id,
      role: "reviewer",
    });
    await ops.auth.acceptInvite(invitation.token, "Client", "Correct-Horse-Battery-123");
    const client = (
      await ops.auth.login("client@example.test", "Correct-Horse-Battery-123")
    ).actor;
    const thread = await ops.executeOperation(owner, "threads.create", {
      projectId: project.id,
      body: "Review the checkout page",
      context: { url: "https://example.test", viewport: { width: 1000, height: 800 } },
      idempotencyKey: "checkout-review-1",
    });
    const approved = await ops.executeOperation(client, "threads.review", {
      threadId: thread.id,
      revision: thread.revision,
      decision: "approved",
      note: "Layout looks good",
    });
    assert.equal(approved.review.state, "approved");
    assert.equal(approved.review.round, 1);
    assert.equal(approved.review.history[0].actor.name, "Client");
    assert.equal(approved.work.state, "open");
    outputSchemas["threads.review"].parse(approved);
    await assert.rejects(
      ops.executeOperation(client, "threads.review", {
        threadId: thread.id,
        revision: approved.revision,
        decision: "changes_requested",
      }),
      { code: "VALIDATION" },
    );
    const reopened = await ops.executeOperation(client, "threads.review", {
      threadId: thread.id,
      revision: approved.revision,
      decision: "reopen",
    });
    assert.equal(reopened.review.round, 2);
    assert.equal(reopened.review.state, "open");
    const changes = await ops.executeOperation(client, "threads.review", {
      threadId: thread.id,
      revision: reopened.revision,
      decision: "changes_requested",
      note: "Mobile spacing still needs work",
    });
    assert.equal(changes.review.history.length, 3);
    assert.equal(changes.review.history[0].round, 1);
    assert.equal(changes.review.history[2].round, 2);
    await assert.rejects(
      ops.executeOperation(client, "threads.review", {
        threadId: thread.id,
        revision: reopened.revision,
        decision: "approved",
      }),
      { code: "CONFLICT" },
    );
    const key = await ops.executeOperation(owner, "tokens.create", {
      name: "Review agent",
      projectIds: [project.id],
      scopes: ["threads.get"],
    });
    const agent = await ops.auth.authenticate(key.token);
    await assert.rejects(
      ops.executeOperation(agent, "threads.review", {
        threadId: thread.id,
        revision: changes.revision,
        decision: "approved",
      }),
      { code: "FORBIDDEN" },
    );
  } finally {
    await pg.close();
  }
});
