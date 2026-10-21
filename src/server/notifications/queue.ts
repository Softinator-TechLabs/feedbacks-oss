import { randomUUID } from "node:crypto";
import type { Database } from "../db.js";
import { effectiveMailSettings } from "./settings.js";
import type { NotificationEvent } from "../../shared/notifications.js";

export const notificationKind = (kind: string): NotificationEvent | null =>
  kind === "thread.created"
    ? "created"
    : ["threads.reply", "guest.reply"].includes(kind)
      ? "reply"
      : kind === "threads.status"
        ? "status"
        : ["assignment.assigned", "assignments.assign", "assignments.cancel"].includes(
              kind,
            )
          ? "assignment"
          : null;
export async function enqueueNotifications(
  db: Database,
  projectId: string,
  threadId: string,
  kind: string,
  revision: number,
  actor: any,
  eventKey?: string,
  replyId?: string,
) {
  const event = notificationKind(kind);
  if (!event) return;
  if (!(await effectiveMailSettings(db, projectId)).enabled) return;
  const thread = await db.one("SELECT data FROM threads WHERE id=$1 AND project_id=$2", [
    threadId,
    projectId,
  ]);
  if (!thread) return;
  const reply =
    event === "reply" && replyId
      ? await db.one("SELECT id,data FROM replies WHERE thread_id=$1 AND id=$2", [
          threadId,
          replyId,
        ])
      : null;
  if (event === "reply" && !reply) return;
  const subscribers = await db.query(
    `SELECT s.*,u.name FROM notification_subscriptions s JOIN users u ON u.id=s.user_id
    WHERE s.project_id=$1 AND u.active=true AND u.must_change_password=false
    AND (u.owner=true OR EXISTS(SELECT 1 FROM grants g WHERE g.project_id=$1 AND g.user_id=u.id))`,
    [projectId],
  );
  for (const sub of subscribers) {
    if (!sub.include_self && sub.user_id === actor.userId) continue;
    const mentioned =
      event === "reply" && (reply?.data.mentions ?? []).includes(sub.user_id);
    const selected = mentioned && sub.events.includes("mention") ? "mention" : event;
    if (!sub.events.includes(selected)) continue;
    await db.query(
      `INSERT INTO notification_deliveries(id,project_id,thread_id,user_id,event,event_revision,event_key,payload,status)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,'pending') ON CONFLICT(event_key,user_id,event) DO NOTHING`,
      [
        randomUUID(),
        projectId,
        threadId,
        sub.user_id,
        selected,
        revision,
        eventKey ?? `${kind}:${threadId}:${revision}`,
        JSON.stringify({
          actor: actor.name ?? "Member",
          actorUserId: actor.userId,
          replyId: reply?.id ?? null,
          title: thread.data.body.slice(0, 500),
          comment: (reply?.data.body ?? "").slice(0, 4000),
          status: thread.data.work?.state ?? "open",
        }),
      ],
    );
  }
}
