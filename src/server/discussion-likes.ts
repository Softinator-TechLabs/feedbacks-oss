import type { Database } from "./db.js";
import type { Actor } from "../shared/contracts.js";
import { event } from "./access.js";
import { fail } from "./errors.js";

export async function discussionLikes(db: Database, a: Actor, threadId: string) {
  const rows = await db.query(
    'SELECT COALESCE(reply_id,thread_id) AS id,count(*)::integer AS "uniqueLikes",bool_or(user_id=$2) AS liked FROM discussion_likes WHERE thread_id=$1 GROUP BY COALESCE(reply_id,thread_id)',
    [threadId, a.userId],
  );
  return new Map<string, { uniqueLikes: number; liked: boolean }>(
    rows.map((r) => [
      r.id,
      { uniqueLikes: r.uniqueLikes, liked: a.kind === "human" && !!r.liked },
    ]),
  );
}

// The caller has already authenticated and locked the writable parent thread.
// Votes have their own storage/event: they never save or revise the discussion.
export async function setDiscussionLike(
  db: Database,
  a: Actor,
  row: any,
  input: { replyId?: string; liked: boolean },
) {
  if (a.kind !== "human" || !a.sessionHash)
    fail("FORBIDDEN", "Discussion likes require a signed-in human web session", 403);
  const replyId = input.replyId ?? null;
  if (
    replyId &&
    !(await db.one("SELECT id FROM replies WHERE id=$1 AND thread_id=$2", [
      replyId,
      row.id,
    ]))
  )
    fail("NOT_FOUND", "Reply not found in this feedback", 404);
  const changed = input.liked
    ? await db.query(
        "INSERT INTO discussion_likes(thread_id,reply_id,user_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING user_id",
        [row.id, replyId, a.userId],
      )
    : await db.query(
        "DELETE FROM discussion_likes WHERE thread_id=$1 AND reply_id IS NOT DISTINCT FROM $2::uuid AND user_id=$3 RETURNING user_id",
        [row.id, replyId, a.userId],
      );
  if (changed.length)
    await event(db, a, row.project_id, row.id, "discussion.like.changed", {
      replyId,
      liked: input.liked,
    });
  const likes = (await discussionLikes(db, a, row.id)).get(replyId ?? row.id) ?? {
    uniqueLikes: 0,
    liked: false,
  };
  return { threadId: row.id, replyId, ...likes };
}
