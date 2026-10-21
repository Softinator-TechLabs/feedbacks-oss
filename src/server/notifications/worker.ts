import type { Database } from "../db.js";
import type { Config } from "../config.js";
import type { AssetStore } from "../assets.js";
import { accountLock } from "../auth.js";
import { renderMailTemplate } from "../../shared/notifications.js";
import { effectiveMailSettings, loadMailTransport } from "./settings.js";
import { MailSendError, sendMail } from "./transport.js";

const eventNames: Record<string, string> = {
  created: "New feedback",
  reply: "Discussion reply",
  mention: "You were mentioned",
  status: "Status changed",
  assignment: "Assignment changed",
  test: "Email connection test",
};

async function currentDelivery(db: Database, row: any) {
  const user = await db.one(
    "SELECT * FROM users WHERE id=$1 AND active=true AND must_change_password=false",
    [row.user_id],
  );
  const project = row.project_id
    ? await db.one("SELECT * FROM projects WHERE id=$1", [row.project_id])
    : null;
  const grant = project
    ? await db.one("SELECT user_id FROM grants WHERE project_id=$1 AND user_id=$2", [
        row.project_id,
        row.user_id,
      ])
    : null;
  const sub = project
    ? await db.one(
        "SELECT * FROM notification_subscriptions WHERE project_id=$1 AND user_id=$2",
        [row.project_id, row.user_id],
      )
    : null;
  const thread = row.thread_id
    ? await db.one("SELECT project_id,data FROM threads WHERE id=$1", [row.thread_id])
    : null;
  const effective = await effectiveMailSettings(db, row.project_id ?? undefined);
  const reply = row.payload.replyId
    ? await db.one("SELECT id FROM replies WHERE id=$1 AND thread_id=$2", [
        row.payload.replyId,
        row.thread_id,
      ])
    : null;
  const allowed =
    !!user &&
    effective.enabled &&
    (!row.project_id || (!!project && (user.owner || grant))) &&
    (row.event === "test" ||
      (!!sub?.events.includes(row.event) &&
        (sub.include_self || row.payload.actorUserId !== row.user_id) &&
        (!row.payload.replyId || !!reply) &&
        !!thread &&
        thread.project_id === row.project_id &&
        !thread.data.archived));
  return { allowed, user, project, sub, effective };
}

export async function deliverNotifications(
  db: Database,
  config: Config,
  store: AssetStore,
  sender: typeof sendMail = sendMail,
) {
  // A send lease can outlive a paused process. Never automatically resend an
  // unknown outcome, and fence every completion against its original attempt.
  await db.query(
    "UPDATE notification_deliveries SET status='uncertain',error_code='SEND_INTERRUPTED',revision=revision+1 WHERE status='sending' AND lease_until<now()",
  );
  for (let n = 0; n < 10; n++) {
    const row = await db.transaction(async (tx) => {
      await accountLock(tx);
      const pending = await tx.one(
        "SELECT * FROM notification_deliveries WHERE status='pending' AND next_at<=now() ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1",
      );
      if (!pending) return null;
      if (!(await currentDelivery(tx, pending)).allowed) {
        await tx.query(
          "UPDATE notification_deliveries SET status='suppressed',revision=revision+1 WHERE id=$1",
          [pending.id],
        );
        return { suppressed: true } as const;
      }
      return tx.one(
        "UPDATE notification_deliveries SET status='sending',attempts=attempts+1,lease_until=now()+interval '2 minutes',revision=revision+1 WHERE id=$1 RETURNING *",
        [pending.id],
      );
    });
    if (!row) break;
    if (row.suppressed) continue;
    try {
      // Private storage may be slow. Open credentials before the final access
      // checkpoint so a revoke/unsubscribe committed during that read wins.
      const connection = await loadMailTransport(
        db,
        config,
        store,
        row.project_id ?? undefined,
      );
      const ready = await db.transaction(async (tx) => {
        await accountLock(tx);
        const lease = await tx.one(
          "SELECT id FROM notification_deliveries WHERE id=$1 AND status='sending' AND attempts=$2 AND lease_until>now() FOR UPDATE",
          [row.id, row.attempts],
        );
        if (!lease) return null;
        const current = await currentDelivery(tx, row);
        if (!current.allowed || !connection) {
          await tx.query(
            "UPDATE notification_deliveries SET status='suppressed',revision=revision+1 WHERE id=$1 AND status='sending' AND attempts=$2",
            [row.id, row.attempts],
          );
          return null;
        }
        if (connection.settingsVersion !== current.effective.version) {
          // No provider call has happened: retry preparation with the new settings.
          await tx.query(
            "UPDATE notification_deliveries SET status='pending',next_at=now(),error_code=NULL,revision=revision+1 WHERE id=$1 AND status='sending' AND attempts=$2",
            [row.id, row.attempts],
          );
          return null;
        }
        return current;
      });
      if (!ready || !connection) continue;
      const { user, project, sub, effective } = ready;
      const kind = row.event === "test" ? "created" : row.event;
      const template =
        row.event === "test"
          ? {
              subject: "Feedbacks email connection test",
              text: "{{comment}}\n\n{{preferencesUrl}}",
            }
          : effective.templates[kind as keyof typeof effective.templates];
      const settingsUrl = row.project_id
        ? `${config.appOrigin}/projects/${row.project_id}?notifications=1`
        : `${config.appOrigin}/email`;
      const variables = {
        project: project?.data.name ?? "Feedbacks",
        event: eventNames[row.event],
        actor: row.payload.actor,
        title: sub?.include_content || row.event === "test" ? row.payload.title : "",
        comment: sub?.include_content || row.event === "test" ? row.payload.comment : "",
        status: row.payload.status,
        threadUrl: row.thread_id
          ? `${config.appOrigin}/threads/${row.thread_id}`
          : config.appOrigin,
        preferencesUrl: sub
          ? `${config.appOrigin}/notifications/unsubscribe?token=${sub.unsubscribe_token}`
          : settingsUrl,
      };
      await sender(connection.transport, connection.identity, {
        ...renderMailTemplate(template, variables),
        to: user.email,
        messageId: `<feedbacks-${row.id}@${new URL(config.appOrigin).hostname}>`,
      });
      await db.query(
        "UPDATE notification_deliveries SET status='accepted',accepted_at=now(),error_code=NULL,revision=revision+1 WHERE id=$1 AND status='sending' AND attempts=$2",
        [row.id, row.attempts],
      );
    } catch (error) {
      const failure =
        error instanceof MailSendError
          ? error
          : new MailSendError("EMAIL_CONFIGURATION_UNAVAILABLE", "failed");
      const retry = failure.disposition === "retry" && row.attempts < 5;
      await db.query(
        "UPDATE notification_deliveries SET status=$2,error_code=$3,next_at=now()+($4::integer*interval '1 second'),revision=revision+1 WHERE id=$1 AND status='sending' AND attempts=$5",
        [
          row.id,
          retry
            ? "pending"
            : failure.disposition === "uncertain"
              ? "uncertain"
              : "failed",
          failure.code,
          Math.min(3600, 60 * 2 ** (row.attempts - 1)),
          row.attempts,
        ],
      );
    }
  }
}
