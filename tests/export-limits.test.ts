import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { Database } from "../src/server/db.js";
import { migrate } from "../src/server/migrations.js";
import { Operations } from "../src/server/operations.js";
import { exportLimits, purgeExpiredExports } from "../src/server/export-limits.js";

test("viewer export quotas share user/project budgets, retain stable pages and enforce revocation", async () => {
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
      name: "Exports",
      origins: ["https://example.test"],
    });
    const invite = await ops.executeOperation(owner, "members.invite", {
      email: "viewer@example.test",
      projectId: project.id,
      role: "viewer",
    });
    await ops.auth.acceptInvite(invite.token, "Viewer", "Correct-Horse-Battery-123");
    const viewer = (
      await ops.auth.login("viewer@example.test", "Correct-Horse-Battery-123")
    ).actor;
    const thread = await ops.executeOperation(owner, "threads.create", {
      projectId: project.id,
      body: "Original",
      context: { url: "https://example.test", viewport: { width: 1440, height: 900 } },
      idempotencyKey: "export-original",
    });
    const request = { projectId: project.id, limit: 1 };
    const first = await ops.executeOperation(viewer, "context.export", request);
    for (let count = 1; count < exportLimits.activePerUser; count++)
      await ops.executeOperation(viewer, "context.export", request);
    await assert.rejects(ops.executeOperation(viewer, "context.export", request), {
      code: "EXPORT_CAPACITY",
    });
    const size = await db.one("SELECT count(*)::integer AS count FROM export_snapshots");
    assert.equal(
      size.count,
      4,
      "the rejected request must not allocate another snapshot",
    );
    await ops.executeOperation(owner, "threads.reply", {
      threadId: thread.id,
      revision: 1,
      body: "Later",
      idempotencyKey: "export-later",
    });
    const stable = await ops.executeOperation(viewer, "context.export", {
      ...request,
      snapshotId: first.snapshotId,
    });
    assert.equal(stable.items[0].revision, 1);
    assert.equal(stable.items[0].importance, undefined);

    const agents = [];
    for (const name of ["First tool", "Second tool"]) {
      const token = await ops.executeOperation(owner, "tokens.create", {
        name,
        projectIds: [project.id],
        scopes: ["context.export"],
      });
      agents.push(await ops.auth.authenticate(token.token));
    }
    for (const actor of [owner, agents[0], agents[1], owner])
      await ops.executeOperation(actor, "context.export", request);
    await assert.rejects(ops.executeOperation(agents[1], "context.export", request), {
      code: "EXPORT_CAPACITY",
    });
    await assert.rejects(
      ops.executeOperation(agents[0], "context.export", {
        ...request,
        snapshotId: first.snapshotId,
      }),
      { code: "SNAPSHOT_EXPIRED" },
    );
    await ops.executeOperation(owner, "members.grant", {
      projectId: project.id,
      userId: viewer.userId,
      role: "viewer",
      remove: true,
    });
    await assert.rejects(
      ops.executeOperation(viewer, "context.export", {
        ...request,
        snapshotId: first.snapshotId,
      }),
      { code: "FORBIDDEN" },
    );
    await db.query("UPDATE export_snapshots SET expires_at=now()-interval '1 second'");
    await db.query("UPDATE export_requests SET created_at=now()-interval '2 minutes'");
    await purgeExpiredExports(db);
    assert.equal(
      (await db.one("SELECT count(*)::integer AS count FROM export_snapshots")).count,
      0,
    );
    assert.equal(
      (await db.one("SELECT count(*)::integer AS count FROM export_requests")).count,
      0,
    );
  } finally {
    await pg.close();
  }
});

test("oversized exports fail before expansion and still consume persistent attempt budgets", async () => {
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
      name: "Large project",
      origins: ["https://example.test"],
    });
    const thread = await ops.executeOperation(owner, "threads.create", {
      projectId: project.id,
      body: "Original",
      context: { url: "https://example.test", viewport: { width: 1000, height: 800 } },
      idempotencyKey: "export-large",
    });
    // A realistic accumulated discussion: each body remains below the API's 12k limit.
    await db.query(
      "INSERT INTO replies(id,thread_id,data) SELECT md5(n::text)::uuid,$1,$2::jsonb FROM generate_series(1,400) n",
      [
        thread.id,
        JSON.stringify({
          body: "a".repeat(11000),
          author: { id: owner.id, userId: owner.userId, name: owner.name, kind: "human" },
          intent: "request",
          mentions: [],
          trust: "untrusted_discussion",
        }),
      ],
    );
    let expansions = 0;
    const query = pg.query.bind(pg);
    pg.query = ((sql: string, ...args: any[]) => {
      if (sql.includes("SELECT id,data,created_at FROM replies")) expansions++;
      return (query as any)(sql, ...args);
    }) as any;
    for (let count = 0; count < exportLimits.requestsPerUser; count++)
      await assert.rejects(
        ops.executeOperation(owner, "context.export", {
          projectId: project.id,
          limit: 1,
        }),
        { code: "EXPORT_TOO_LARGE" },
      );
    await assert.rejects(
      ops.executeOperation(owner, "context.export", { projectId: project.id, limit: 1 }),
      { code: "EXPORT_RATE_LIMITED" },
    );
    assert.equal(expansions, 0, "reject before expanding any complete discussion");
    assert.equal(
      (await db.one("SELECT count(*)::integer AS count FROM export_snapshots")).count,
      0,
    );
    assert.equal(
      (await db.one("SELECT count(*)::integer AS count FROM export_requests")).count,
      exportLimits.requestsPerUser,
    );
  } finally {
    await pg.close();
  }
});
