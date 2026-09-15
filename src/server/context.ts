import { randomUUID } from "node:crypto";
import type { Database } from "./db.js";
import type { Actor } from "../shared/contracts.js";
import { access, canReadPolicy, event } from "./access.js";
import { publicActor } from "./auth.js";
import { fullThread } from "./feedback.js";
import { fail } from "./errors.js";
import {
  availableExportBytes,
  checkExportSource,
  requireExportSize,
} from "./export-limits.js";
export async function instructions(db: Database, a: Actor, op: string, i: any) {
  await access(db, a, i.projectId, op === "instructions.publish" ? "maintain" : "read");
  if (op === "instructions.publish") {
    if (a.kind !== "human" && !(a.kind === "agent" && a.owner && a.ownerAdmin))
      fail("FORBIDDEN", "A maintainer must approve instructions in the web app", 403);
    await db.query("SELECT id FROM projects WHERE id=$1 FOR UPDATE", [i.projectId]);
    const current = await db.one(
      "SELECT COALESCE(max(version),0)::integer AS version FROM instructions WHERE project_id=$1",
      [i.projectId],
    );
    if (current.version !== i.revision)
      fail("CONFLICT", "Instructions changed; reload before publishing", 409);
    const id = randomUUID();
    await db.query(
      "INSERT INTO instructions(id,project_id,version,body,actor) VALUES($1,$2,$3,$4,$5)",
      [id, i.projectId, current.version + 1, i.body, JSON.stringify(publicActor(a))],
    );
    await event(db, a, i.projectId, id, "instructions.published", {
      version: current.version + 1,
    });
  }
  const items = await db.query(
    'SELECT id,version,body,actor,created_at AS "createdAt" FROM instructions WHERE project_id=$1 ORDER BY version DESC',
    [i.projectId],
  );
  return {
    trust: "approved_project_instructions",
    revision: items[0]?.version ?? 0,
    items,
  };
}
export async function context(db: Database, a: Actor, op: string, i: any) {
  const project = await access(db, a, i.projectId);
  if (op === "context.changes") {
    const items = await db.query(
      'SELECT cursor::text,entity_id AS "entityId",kind,actor,created_at AS "createdAt" FROM events WHERE project_id=$1 AND cursor>$2::bigint ORDER BY cursor LIMIT $3',
      [i.projectId, i.cursor, i.limit],
    );
    return {
      schemaVersion: 1,
      // Likes expose aggregate refresh signals, not individual voting activity.
      // Keep attribution in the internal audit row and on other public events.
      items: items.map(({ actor, ...item }) =>
        item.kind === "discussion.like.changed" ? item : { ...item, actor },
      ),
      cursor: items.at(-1)?.cursor ?? i.cursor,
      hasMore: items.length === i.limit,
    };
  }
  let snapshot: any;
  if (i.snapshotId) {
    snapshot = await db.one(
      "SELECT * FROM export_snapshots WHERE id=$1 AND actor_id=$2 AND project_id=$3 AND expires_at>now()",
      [i.snapshotId, a.id, i.projectId],
    );
    if (!snapshot) fail("SNAPSHOT_EXPIRED", "Export expired; start a new export", 410);
  } else {
    const maximumBytes = await availableExportBytes(db, a, i.projectId);
    await checkExportSource(db, i.projectId);
    // Operations holds the account/domain transaction lock for this entire read;
    // service writes cannot interleave rows and the committed cursor. Pages retain
    // this immutable snapshot; the per-project event lock orders later commits.
    const rows = await db.query(
      "SELECT * FROM threads WHERE project_id=$1 ORDER BY created_at,id",
      [i.projectId],
    );
    const cursor = await db.one(
      "SELECT COALESCE(max(cursor),0)::text AS cursor FROM events WHERE project_id=$1",
      [i.projectId],
    );
    const data = {
      schemaVersion: 1,
      project,
      approvedInstructions: await instructions(db, a, "instructions.get", i),
      discussionTrust: "untrusted_discussion",
      cursor: cursor.cursor,
      items: [] as any[],
    };
    let bytes = Buffer.byteLength(JSON.stringify(data));
    requireExportSize(bytes, maximumBytes);
    for (const row of rows) {
      const item = await fullThread(db, a, row);
      bytes += Buffer.byteLength(JSON.stringify(item)) + 1;
      requireExportSize(bytes, maximumBytes);
      data.items.push(item);
    }
    const serialized = JSON.stringify(data);
    const byteLength = Buffer.byteLength(serialized);
    requireExportSize(byteLength, maximumBytes);
    snapshot = { id: randomUUID(), data };
    await db.query(
      "INSERT INTO export_snapshots(id,actor_id,user_id,project_id,data,byte_length,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '15 minutes')",
      [snapshot.id, a.id, a.userId, i.projectId, serialized, byteLength],
    );
  }
  const items = snapshot.data.items.slice(i.offset, i.offset + i.limit);
  if (!canReadPolicy(a))
    for (const item of items) {
      delete item.importance;
      delete item.reviewerContext;
      delete item.view?.weightedPreference;
    }
  return {
    ...snapshot.data,
    items,
    snapshotId: snapshot.id,
    total: snapshot.data.items.length,
    nextOffset:
      i.offset + items.length < snapshot.data.items.length
        ? i.offset + items.length
        : null,
  };
}
