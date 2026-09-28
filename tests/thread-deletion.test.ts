import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { Database } from "../src/server/db.js";
import { migrate } from "../src/server/migrations.js";
import { Operations } from "../src/server/operations.js";
import { drainThreadDeletionQueue } from "../src/server/thread-deletion.js";

test("thread deletion is authorized, atomic, retryable and preserves shared documents", async () => {
  const pg = new PGlite(),
    db = new Database(pg as any);
  const objects = new Map<string, Buffer>();
  let unavailable = true;
  const store = {
    put: async () => {},
    get: async (key: string) => objects.get(key)!,
    remove: async (key: string) => {
      if (unavailable) throw new Error("private backend detail");
      objects.delete(key);
    },
  };
  try {
    await migrate(db);
    const ops = new Operations(db, store, {} as any);
    const owner = await ops.auth.bootstrap(
      "owner@example.test",
      "Owner",
      "Correct-Horse-Battery-123",
    );
    const project = await ops.executeOperation(owner, "projects.create", {
      name: "Delete fixtures",
      origins: ["https://example.test"],
    });
    const create = (body: string) =>
      ops.executeOperation(owner, "threads.create", {
        projectId: project.id,
        body,
        context: { url: "https://example.test", viewport: { width: 1000, height: 800 } },
        idempotencyKey: body,
      });
    let first = await create("Synthetic feedback with points and review");
    const second = await create("Preserved feedback");
    first = await ops.executeOperation(owner, "threads.reply", {
      threadId: first.id,
      revision: first.revision,
      body: "Synthetic discussion",
      idempotencyKey: randomUUID(),
    });
    const assetIds = [randomUUID(), randomUUID()];
    for (const [n, key] of ["owned/screenshot", "owned/video"].entries()) {
      objects.set(key, Buffer.from("synthetic"));
      await db.query(
        "INSERT INTO assets(id,project_id,thread_id,object_key,data,status) VALUES($1,$2,$3,$4,$5,'validated')",
        [
          assetIds[n],
          project.id,
          first.id,
          key,
          JSON.stringify({ contentType: n ? "video/webm" : "image/webp" }),
        ],
      );
    }
    const shared = "shared/document";
    objects.set(shared, Buffer.from("shared document"));
    await db.query(
      "INSERT INTO documents(id,project_id,object_key,data) VALUES($1,$2,$3,'{}')",
      [randomUUID(), project.id, shared],
    );
    await db.query(
      "INSERT INTO assets(id,project_id,thread_id,object_key,data,status) VALUES($1,$2,$3,$4,'{}','validated')",
      [randomUUID(), project.id, first.id, shared],
    );
    await db.query("INSERT INTO qa_baselines(thread_id,asset_id) VALUES($1,$2)", [
      first.id,
      assetIds[0],
    ]);
    const input = {
      projectId: project.id,
      threads: [{ threadId: first.id, revision: first.revision }],
      idempotencyKey: randomUUID(),
      confirmation: "DELETE",
    };
    const invite = await ops.executeOperation(owner, "members.invite", {
      email: "reviewer@example.test",
      projectId: project.id,
      role: "reviewer",
    });
    await ops.auth.acceptInvite(invite.token, "Reviewer", "Correct-Horse-Battery-123");
    const reviewer = (
      await ops.auth.login("reviewer@example.test", "Correct-Horse-Battery-123")
    ).actor;
    await assert.rejects(ops.executeOperation(reviewer, "threads.delete", input), {
      code: "FORBIDDEN",
    });
    await assert.rejects(
      ops.executeOperation(owner, "threads.delete", { ...input, confirmation: "yes" }),
      { code: "VALIDATION" },
    );
    await assert.rejects(
      ops.executeOperation(owner, "threads.delete", {
        ...input,
        threads: [...input.threads, { threadId: second.id, revision: 99 }],
      }),
      { code: "CONFLICT" },
    );
    assert.ok(await db.one("SELECT id FROM threads WHERE id=$1", [first.id]));
    assert.equal(objects.size, 3);
    const deleted = await ops.executeOperation(owner, "threads.delete", input);
    assert.equal(deleted.deletedCount, 1);
    assert.equal(deleted.cleanup.state, "failed");
    assert.equal(deleted.cleanup.remaining, 2);
    assert.ok(!JSON.stringify(deleted).includes("private backend detail"));
    for (const table of ["threads", "replies", "assets", "qa_baselines"]) {
      assert.equal(
        (
          await db.query(
            `SELECT * FROM ${table} WHERE ${table === "threads" ? "id" : "thread_id"}=$1`,
            [first.id],
          )
        ).length,
        0,
      );
    }
    await assert.rejects(
      ops.executeOperation(owner, "threads.get", { threadId: first.id }),
      { code: "NOT_FOUND" },
    );
    await assert.rejects(
      ops.executeOperation(reviewer, "threads.deletions", { projectId: project.id }),
      { code: "FORBIDDEN" },
    );
    const restarted = new Operations(db, store, {} as any);
    assert.equal(
      (
        await restarted.executeOperation(owner, "threads.deletions", {
          projectId: project.id,
          activeOnly: true,
        })
      ).items[0].cleanup.state,
      "failed",
    );
    await assert.rejects(create("Synthetic feedback with points and review"), {
      code: "NOT_FOUND",
    });
    // Background retries honor provider-failure backoff and live worker leases.
    await drainThreadDeletionQueue(db, store);
    assert.equal(
      (
        await db.one(
          "SELECT max(attempts)::integer AS attempts FROM thread_deletion_objects",
        )
      ).attempts,
      1,
    );
    await db.query(
      "UPDATE thread_deletion_objects SET next_at=now()-interval '1 second',lease_until=now()+interval '1 minute'",
    );
    await drainThreadDeletionQueue(db, store);
    assert.equal(
      (
        await db.one(
          "SELECT max(attempts)::integer AS attempts FROM thread_deletion_objects",
        )
      ).attempts,
      1,
    );
    unavailable = false;
    await db.query(
      "UPDATE thread_deletion_objects SET lease_until=now()-interval '1 second'",
    );
    await drainThreadDeletionQueue(db, store);
    assert.equal(
      (
        await db.one(
          "SELECT count(*)::integer AS pending FROM thread_deletion_objects WHERE state!='complete'",
        )
      ).pending,
      0,
    );
    const retried = await restarted.executeOperation(owner, "threads.delete", input);
    assert.equal(retried.id, deleted.id);
    assert.equal(retried.cleanup.state, "complete");
    assert.deepEqual([...objects.keys()], [shared]);
    assert.ok(await db.one("SELECT id FROM threads WHERE id=$1", [second.id]));
    assert.equal((await db.query("SELECT * FROM thread_deletions")).length, 1);
    await assert.rejects(
      ops.executeOperation(owner, "threads.delete", {
        ...input,
        threads: [{ threadId: second.id, revision: second.revision }],
      }),
      { code: "CONFLICT" },
    );
    const archived = await ops.executeOperation(owner, "threads.archive", {
      threadId: second.id,
      revision: second.revision,
      archived: true,
    });
    assert.equal(
      (await ops.executeOperation(owner, "threads.list", { projectId: project.id }))
        .total,
      0,
    );
    assert.equal(
      (
        await ops.executeOperation(owner, "threads.list", {
          projectId: project.id,
          archived: true,
        })
      ).items[0].id,
      archived.id,
    );
  } finally {
    await pg.close();
  }
});

test("cleanup is bounded and bulk deletion rejects cross-project, duplicate and oversized selections", async () => {
  const pg = new PGlite(),
    db = new Database(pg as any);
  const removed = new Set<string>();
  try {
    await migrate(db);
    const ops = new Operations(
      db,
      {
        remove: async (key: string) => {
          removed.add(key);
        },
      } as any,
      {} as any,
    );
    const owner = await ops.auth.bootstrap(
      "owner@example.test",
      "Owner",
      "Correct-Horse-Battery-123",
    );
    const project = await ops.executeOperation(owner, "projects.create", {
      name: "One",
      origins: ["https://example.test"],
    });
    const other = await ops.executeOperation(owner, "projects.create", {
      name: "Other",
      origins: ["https://example.test"],
    });
    const create = (projectId: string) =>
      ops.executeOperation(owner, "threads.create", {
        projectId,
        body: "Synthetic bulk fixture",
        context: { url: "https://example.test", viewport: { width: 900, height: 600 } },
        idempotencyKey: randomUUID(),
      });
    const thread = await create(project.id),
      outside = await create(other.id);
    const selected = { threadId: thread.id, revision: thread.revision };
    const input = {
      projectId: project.id,
      threads: [selected],
      idempotencyKey: randomUUID(),
      confirmation: "DELETE",
    };
    await assert.rejects(
      ops.executeOperation(owner, "threads.delete", {
        ...input,
        threads: [selected, { threadId: outside.id, revision: 1 }],
      }),
      { code: "FORBIDDEN" },
    );
    await assert.rejects(
      ops.executeOperation(owner, "threads.delete", {
        ...input,
        threads: [selected, selected],
      }),
      { code: "VALIDATION" },
    );
    await assert.rejects(
      ops.executeOperation(owner, "threads.delete", {
        ...input,
        threads: Array.from({ length: 51 }, () => ({
          threadId: randomUUID(),
          revision: 1,
        })),
      }),
      { code: "VALIDATION" },
    );
    assert.equal((await db.query("SELECT * FROM thread_deletions")).length, 0);
    const assetIds: string[] = [];
    for (let n = 0; n < 14; n++) {
      const id = randomUUID();
      assetIds.push(id);
      await db.query(
        "INSERT INTO assets(id,project_id,thread_id,object_key,data,status) VALUES($1,$2,$3,$4,'{}','validated')",
        [id, project.id, thread.id, `synthetic/${n}`],
      );
    }
    const deleted = await ops.executeOperation(owner, "threads.delete", input);
    assert.equal(removed.size, 12);
    assert.equal(deleted.cleanup.state, "pending");
    assert.equal(deleted.cleanup.remaining, 2);
    await assert.rejects(
      ops.executeOperation(owner, "assets.get", { assetId: assetIds[13] }),
      { code: "NOT_FOUND" },
    );
    await assert.rejects(
      ops.executeOperation(owner, "threads.retryDeletion", {
        projectId: other.id,
        deletionId: deleted.id,
      }),
      { code: "NOT_FOUND" },
    );
    const worker = await import("../src/server/thread-deletion.js");
    assert.equal(typeof worker.drainThreadDeletionQueue, "function");
    await worker.drainThreadDeletionQueue(db, {
      remove: async (key: string) => {
        removed.add(key);
      },
    } as any);
    const complete = (
      await ops.executeOperation(owner, "threads.deletions", { projectId: project.id })
    ).items[0];
    assert.equal(complete.cleanup.state, "complete");
    assert.deepEqual(
      (
        await ops.executeOperation(owner, "threads.deletions", {
          projectId: project.id,
          activeOnly: true,
        })
      ).items,
      [],
    );
    assert.equal(removed.size, 14);
    assert.equal(
      (await ops.executeOperation(owner, "threads.get", { threadId: outside.id })).id,
      outside.id,
    );
  } finally {
    await pg.close();
  }
});
