import type { Database } from "./db.js";
import type { Actor } from "../shared/contracts.js";
import { threadRow } from "./thread-read-model.js";

// Only saved lifecycle metadata. Never return raw events, actors, private data,
// discussion text or diagnostics through the ordinary thread read grant.
const kinds = [
  "thread.created",
  "thread.asset",
  "threads.move",
  "threads.reply",
  "threads.editReply",
  "threads.deleteReply",
  "threads.annotationStatus",
  "threads.status",
  "threads.archive",
];
export async function threadActivity(
  db: Database,
  actor: Actor,
  input: { threadId: string; before?: string; limit: number },
) {
  const thread = await threadRow(db, actor, input.threadId);
  const rows = await db.query(
    `SELECT cursor::text,kind,created_at,data->'revision' AS revision FROM events
     WHERE project_id=$1 AND entity_id=$2 AND kind=ANY($3::text[])
       AND ($4::numeric IS NULL OR cursor<$4::numeric)
     ORDER BY cursor DESC LIMIT $5`,
    [thread.project_id, thread.id, kinds, input.before ?? null, input.limit + 1],
  );
  const items = rows.slice(0, input.limit).map((row) => ({
    cursor: row.cursor,
    kind: row.kind,
    createdAt: new Date(row.created_at).toISOString(),
    ...(typeof row.revision === "number" ? { revision: row.revision } : {}),
  }));
  return {
    threadId: thread.id,
    revision: thread.revision,
    coverage: "recorded_events_only" as const,
    limitation:
      "These are recorded saves, not upload attempts or a pre-change content snapshot. Missing events do not prove an action was never attempted.",
    items,
    nextBefore: rows.length > input.limit ? items.at(-1)!.cursor : null,
  };
}
