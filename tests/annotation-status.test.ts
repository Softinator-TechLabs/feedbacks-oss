import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { Database } from "../src/server/db.js";
import { migrate } from "../src/server/migrations.js";
import { Operations } from "../src/server/operations.js";

test("point lifecycle preserves evidence, permissions and accurate paginated page counts", async () => {
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
      origins: ["https://globaljournals.org"],
    });
    const other = await ops.executeOperation(owner, "projects.create", {
      name: "Other",
      origins: ["https://globaljournals.org"],
    });
    const invite = await ops.executeOperation(owner, "members.invite", {
      email: "reviewer@example.test",
      projectId: project.id,
      role: "reviewer",
    });
    await ops.auth.acceptInvite(invite.token, "Reviewer", "Correct-Horse-Battery-123");
    const reviewer = (
      await ops.auth.login("reviewer@example.test", "Correct-Horse-Battery-123")
    ).actor;
    const points = [0, 1, 2].map((n) => ({
      id: randomUUID(),
      body: `Point ${n + 1}`,
      anchor: { selector: `#point-${n}`, confidence: "element" },
    }));
    let thread = await ops.executeOperation(reviewer, "threads.create", {
      projectId: project.id,
      body: "Page review",
      context: {
        url: "https://globaljournals.org/?token=private#heading",
        viewport: { width: 1440, height: 900 },
        annotations: points,
      },
      idempotencyKey: "point-lifecycle-create",
    });
    const update = (
      actor: any,
      point: string,
      state: string,
      revision = thread.revision,
    ) =>
      ops.executeOperation(actor, "threads.annotationStatus" as any, {
        threadId: thread.id,
        revision,
        annotationId: point,
        state,
      });
    await assert.rejects(update(reviewer, points[0].id, "resolved"), {
      code: "FORBIDDEN",
    });
    thread = await update(owner, points[0].id, "resolved");
    assert.equal(thread.work.state, "open");
    assert.equal(thread.annotationStates[points[0].id].state, "resolved");
    assert.equal(thread.annotationStates[points[0].id].actor.name, "Owner");
    assert.deepEqual(
      thread.context.annotations.map((p: any) => p.body),
      points.map((p) => p.body),
    );
    await assert.rejects(update(owner, points[1].id, "resolved", 1), {
      code: "CONFLICT",
    });
    await assert.rejects(update(owner, randomUUID(), "resolved"), { code: "NOT_FOUND" });
    await assert.rejects(update(reviewer, points[1].id, "removed"), {
      code: "FORBIDDEN",
    });
    thread = await update(owner, points[2].id, "removed");
    const list = (extra = {}) =>
      ops.executeOperation(reviewer, "threads.list", {
        projectId: project.id,
        url: "https://globaljournals.org/",
        includeSummary: true,
        limit: 1,
        ...extra,
      });
    let result = await list();
    assert.deepEqual(result.summary.points, {
      open: 1,
      resolved: 1,
      closed: 0,
      removed: 1,
      total: 2,
    });
    thread = await ops.executeOperation(owner, "threads.status", {
      threadId: thread.id,
      revision: thread.revision,
      state: "resolved",
    });
    result = await list();
    assert.equal(result.items.length, 0);
    assert.deepEqual(result.summary.points, {
      open: 0,
      resolved: 2,
      closed: 0,
      removed: 1,
      total: 2,
    });
    assert.deepEqual(result.summary.threads, { open: 0, closed: 1, total: 1 });
    // Reopening the thread retains the previously resolved and removed point decisions.
    thread = await ops.executeOperation(owner, "threads.status", {
      threadId: thread.id,
      revision: thread.revision,
      state: "open",
    });
    thread = await update(owner, points[2].id, "open");
    assert.equal((await list()).summary.points.open, 2);
    // Pagination cannot truncate counts, and website/page/device filters stay separate.
    for (let n = 0; n < 203; n++)
      await ops.executeOperation(owner, "threads.create", {
        projectId: project.id,
        body: "Another member",
        context: {
          url:
            n === 202
              ? "https://globaljournals.org/other"
              : "https://globaljournals.org/",
          viewport: { width: 390, height: 844 },
          annotations: [{ ...points[0], id: randomUUID() }],
        },
        idempotencyKey: `point-count-${n}`,
      });
    result = await list();
    assert.equal(result.items.length, 1);
    assert.equal(result.summary.threads.total, 203);
    assert.equal(result.summary.points.total, 205);
    assert.equal((await list({ deviceClass: "mobile" })).summary.points.total, 202);
    assert.equal(
      (await list({ url: undefined, hostname: "globaljournals.org" })).summary.points
        .total,
      206,
    );
    await assert.rejects(list({ projectId: other.id }), { code: "FORBIDDEN" });
    const key = await ops.executeOperation(owner, "tokens.create", {
      name: "Old scope",
      projectIds: [project.id],
      scopes: ["threads.status"],
      canResolve: true,
    });
    await assert.rejects(
      update(await ops.auth.authenticate(key.token), points[1].id, "resolved"),
      { code: "FORBIDDEN" },
    );
    const audit = await db.query(
      "SELECT data FROM events WHERE entity_id=$1 AND kind='threads.annotationStatus'",
      [thread.id],
    );
    assert.equal(audit.length, 3);
    assert.equal(audit[0].data.annotationId, points[0].id);
  } finally {
    await pg.close();
  }
});
