import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { Database } from "../src/server/db.js";
import { migrate } from "../src/server/migrations.js";
import { Operations } from "../src/server/operations.js";
import { agentOperations } from "../src/shared/contracts.js";

test("a human project maintainer can register and clear a Figma reference without sharing thread content", async () => {
  const pg = new PGlite();
  try {
    const db = new Database(pg as any);
    await migrate(db);
    const ops = new Operations(
      db,
      {} as any,
      { appOrigin: "http://localhost:3000" } as any,
    );
    const owner = await ops.auth.bootstrap(
      "owner@example.test",
      "Owner",
      "Correct-Horse-Battery-123",
    );
    const project = await ops.executeOperation(owner, "projects.create", {
      name: "Design review",
      origins: ["https://example.test"],
    });
    const invitation = await ops.executeOperation(owner, "members.invite", {
      email: "reviewer@example.test",
      projectId: project.id,
      role: "reviewer",
    });
    await ops.auth.acceptInvite(
      invitation.token,
      "Reviewer",
      "Correct-Horse-Battery-123",
    );
    const reviewer = (
      await ops.auth.login("reviewer@example.test", "Correct-Horse-Battery-123")
    ).actor;
    const thread = await ops.executeOperation(owner, "threads.create", {
      projectId: project.id,
      body: "Private feedback text",
      context: {
        url: "https://example.test/page",
        viewport: { width: 1200, height: 800 },
      },
      idempotencyKey: "figma-reference-thread",
    });
    assert.equal(thread.figmaReference, null);
    assert.ok(!agentOperations.includes("threads.figmaReference"));

    await assert.rejects(
      ops.executeOperation(reviewer, "threads.figmaReference", {
        threadId: thread.id,
        revision: thread.revision,
        url: "https://www.figma.com/design/AbC123456/Mockup",
      }),
      { code: "FORBIDDEN" },
    );
    for (const url of [
      "https://figma.com.evil.test/design/AbC123456/Mockup",
      "http://www.figma.com/design/AbC123456/Mockup",
      "https://www.figma.com/community/file/AbC123456",
      "https://www.figma.com/design/../../outside",
    ]) {
      await assert.rejects(
        ops.executeOperation(owner, "threads.figmaReference", {
          threadId: thread.id,
          revision: thread.revision,
          url,
        }),
        { code: "VALIDATION" },
      );
    }

    const linked = await ops.executeOperation(owner, "threads.figmaReference", {
      threadId: thread.id,
      revision: thread.revision,
      url: "https://www.figma.com/design/AbC123456/Mockup?node-id=12-34&t=private-tracker#secret",
    });
    assert.equal(
      linked.figmaReference.url,
      "https://www.figma.com/design/AbC123456?node-id=12-34",
    );
    assert.equal(linked.figmaReference.linkedBy.userId, owner.userId);
    assert.equal(linked.body, "Private feedback text");
    assert.deepEqual(linked.assets, []);
    assert.deepEqual(linked.externalIssues, []);
    assert.equal(linked.work.state, "open");
    assert.deepEqual(
      (await ops.executeOperation(reviewer, "threads.get", { threadId: thread.id }))
        .figmaReference.url,
      linked.figmaReference.url,
    );
    await assert.rejects(
      ops.executeOperation(owner, "threads.figmaReference", {
        threadId: thread.id,
        revision: thread.revision,
        url: null,
      }),
      { code: "CONFLICT" },
    );
    const cleared = await ops.executeOperation(owner, "threads.figmaReference", {
      threadId: thread.id,
      revision: linked.revision,
      url: null,
    });
    assert.equal(cleared.figmaReference, null);
  } finally {
    await pg.close();
  }
});
