import { randomUUID } from "node:crypto";
import type { Database } from "./db.js";
import type { Actor } from "../shared/contracts.js";
import type { AssetStore } from "./assets.js";
import { access, event } from "./access.js";
import { hash } from "./auth.js";
import { fail } from "./errors.js";

export async function deletionReceipt(db: Database, id: string) {
  const row = await db.one(
    "SELECT id,project_id,thread_ids,created_at FROM thread_deletions WHERE id=$1",
    [id],
  );
  const counts = await db.one(
    `SELECT count(*)::integer AS total,
    count(*) FILTER (WHERE state!='complete')::integer AS remaining,
    count(*) FILTER (WHERE state='failed')::integer AS failed
    FROM thread_deletion_objects WHERE deletion_id=$1`,
    [id],
  );
  return {
    id: row.id,
    projectId: row.project_id,
    deletedCount: row.thread_ids.length,
    createdAt: new Date(row.created_at).toISOString(),
    cleanup: {
      state: counts.failed ? "failed" : counts.remaining ? "pending" : "complete",
      ...counts,
    },
  };
}

// Called under the account lock: validate the entire selection before deleting any row.
export async function manageThreadDeletion(
  db: Database,
  actor: Actor,
  name: string,
  input: any,
) {
  if (actor.kind !== "human")
    fail("FORBIDDEN", "A signed-in human maintainer must delete feedback", 403);
  await access(db, actor, input.projectId, "maintain");
  if (name === "threads.deletions") {
    const rows = await db.query(
      `SELECT d.id FROM thread_deletions d WHERE project_id=$1
      ORDER BY EXISTS(SELECT 1 FROM thread_deletion_objects o WHERE o.deletion_id=d.id AND o.state!='complete') DESC,created_at DESC LIMIT 100`,
      [input.projectId],
    );
    return { items: await Promise.all(rows.map((row) => deletionReceipt(db, row.id))) };
  }
  if (name === "threads.retryDeletion") {
    const row = await db.one(
      "SELECT id FROM thread_deletions WHERE id=$1 AND project_id=$2",
      [input.deletionId, input.projectId],
    );
    if (!row) fail("NOT_FOUND", "Deletion receipt not found", 404);
    return deletionReceipt(db, row.id);
  }
  const fingerprint = hash(JSON.stringify(input.threads));
  const previous = await db.one(
    "SELECT id,input_hash FROM thread_deletions WHERE actor_id=$1 AND request_key=$2",
    [actor.userId, input.idempotencyKey],
  );
  if (previous) {
    if (previous.input_hash !== fingerprint)
      fail("CONFLICT", "Deletion key was already used for a different selection", 409);
    const row = await db.one("SELECT project_id FROM thread_deletions WHERE id=$1", [
      previous.id,
    ]);
    if (row.project_id !== input.projectId)
      fail("CONFLICT", "Deletion key belongs to another project", 409);
    return deletionReceipt(db, previous.id);
  }
  const ids = input.threads.map((item: any) => item.threadId);
  for (const selected of input.threads) {
    const row = await db.one(
      "SELECT project_id,revision FROM threads WHERE id=$1 FOR UPDATE",
      [selected.threadId],
    );
    if (!row)
      fail("NOT_FOUND", "Selected feedback no longer exists; reload the list", 404);
    if (row.project_id !== input.projectId)
      fail("FORBIDDEN", "All selected feedback must belong to this project", 403);
    if (row.revision !== selected.revision)
      fail(
        "CONFLICT",
        "Selected feedback changed; reload and review your selection",
        409,
      );
  }
  // A GitHub request in flight may already have an external side effect. Require reconciliation.
  if (
    await db.one(
      "SELECT id FROM github_issue_requests WHERE thread_id=ANY($1::uuid[]) AND status='pending' LIMIT 1",
      [ids],
    )
  )
    fail(
      "CONFLICT",
      "Reconcile the pending GitHub issue creation before deleting this feedback",
      409,
    );
  const owned = await db.query(
    "SELECT id,object_key FROM assets WHERE thread_id=ANY($1::uuid[])",
    [ids],
  );
  const id = randomUUID();
  await db.query(
    "INSERT INTO thread_deletions(id,project_id,actor_id,request_key,input_hash,thread_ids) VALUES($1,$2,$3,$4,$5,$6)",
    [
      id,
      input.projectId,
      actor.userId,
      input.idempotencyKey,
      fingerprint,
      JSON.stringify(ids),
    ],
  );
  for (const asset of owned) {
    // Project documents have their own lifetime. Never enqueue a shared object.
    if (
      !(await db.one("SELECT id FROM documents WHERE object_key=$1", [asset.object_key]))
    )
      await db.query(
        "INSERT INTO thread_deletion_objects(deletion_id,object_key) VALUES($1,$2)",
        [id, asset.object_key],
      );
  }
  await db.query("DELETE FROM qa_baselines WHERE thread_id=ANY($1::uuid[])", [ids]);
  await db.query("DELETE FROM assets WHERE thread_id=ANY($1::uuid[])", [ids]);
  await db.query("DELETE FROM replies WHERE thread_id=ANY($1::uuid[])", [ids]);
  await db.query("DELETE FROM github_issue_requests WHERE thread_id=ANY($1::uuid[])", [
    ids,
  ]);
  await db.query(
    "DELETE FROM webhook_deliveries WHERE project_id=$1 AND payload->>'threadId'=ANY($2::text[])",
    [input.projectId, ids],
  );
  // Retain hash/ID-only retry tombstones: a delayed create/upload must never
  // recreate content that a maintainer has already deleted.
  await db.query("DELETE FROM events WHERE project_id=$1 AND entity_id=ANY($2::text[])", [
    input.projectId,
    [...ids, ...owned.map((a) => a.id)],
  ]);
  // Immutable exports may contain the deleted discussion. Invalidate project snapshots.
  await db.query("DELETE FROM export_snapshots WHERE project_id=$1", [input.projectId]);
  await db.query("DELETE FROM threads WHERE id=ANY($1::uuid[])", [ids]);
  for (const threadId of ids)
    await event(db, actor, input.projectId, threadId, "threads.deleted", {
      deletionId: id,
    });
  return deletionReceipt(db, id);
}

// Persistent outbox, processed only after the deleting transaction has committed.
// Both HTTP retry and the background drain share leases; storage runs without auth locks.
async function removeCandidates(
  db: Database,
  store: AssetStore,
  candidates: any[],
  scheduled: boolean,
) {
  for (let start = 0; start < candidates.length; start += 4) {
    await Promise.all(
      candidates.slice(start, start + 4).map(async ({ deletion_id, object_key }) => {
        const lease = randomUUID();
        const claimed = await db.one(
          `UPDATE thread_deletion_objects SET lease_id=$3,lease_until=now()+interval '60 seconds',attempts=attempts+1
        WHERE deletion_id=$1 AND object_key=$2 AND state!='complete' AND (lease_until IS NULL OR lease_until<now())
        ${scheduled ? "AND next_at<=now()" : ""} RETURNING attempts`,
          [deletion_id, object_key, lease],
        );
        if (!claimed) return;
        let state = "complete";
        try {
          await store.remove(object_key);
        } catch {
          state = "failed";
        }
        const backoff = Math.min(3600, 30 * 2 ** Math.min(claimed.attempts - 1, 7));
        await db.query(
          "UPDATE thread_deletion_objects SET state=$4,lease_until=NULL,lease_id=NULL,next_at=now()+($5 * interval '1 second') WHERE deletion_id=$1 AND object_key=$2 AND lease_id=$3",
          [deletion_id, object_key, lease, state, backoff],
        );
      }),
    );
  }
}

export async function cleanupDeletedObjects(
  db: Database,
  store: AssetStore,
  deletionId: string,
) {
  const candidates = await db.query(
    "SELECT deletion_id,object_key FROM thread_deletion_objects WHERE deletion_id=$1 AND state!='complete' AND (lease_until IS NULL OR lease_until<now()) ORDER BY object_key LIMIT 12",
    [deletionId],
  );
  await removeCandidates(db, store, candidates, false);
  return deletionReceipt(db, deletionId);
}

// Durable, global and bounded: the browser may close and the server may restart.
export async function drainThreadDeletionQueue(db: Database, store: AssetStore) {
  const candidates = await db.query(
    "SELECT deletion_id,object_key FROM thread_deletion_objects WHERE state!='complete' AND next_at<=now() AND (lease_until IS NULL OR lease_until<now()) ORDER BY next_at,deletion_id,object_key LIMIT 12",
  );
  await removeCandidates(db, store, candidates, true);
}
