import { randomUUID, randomBytes } from "node:crypto";
import type { Database } from "../db.js";
import type { Config } from "../config.js";
import type { AssetStore } from "../assets.js";
import type { Actor } from "../../shared/contracts.js";
import { access } from "../access.js";
import { fail } from "../errors.js";
import {
  configureMail,
  notificationAccess,
  readMailSettings,
  previewMail,
} from "./settings.js";

export async function notificationOperation(
  db: Database,
  store: AssetStore,
  config: Config,
  a: Actor,
  op: string,
  i: any,
) {
  if (a.kind !== "human")
    fail("FORBIDDEN", "Email preferences require a signed-in human", 403);
  if (op === "notifications.subscription" || op === "notifications.subscribe") {
    await access(db, a, i.projectId);
    const current = await db.one(
      "SELECT * FROM notification_subscriptions WHERE project_id=$1 AND user_id=$2",
      [i.projectId, a.userId],
    );
    if (op === "notifications.subscribe") {
      if ((current?.revision ?? 0) !== i.revision)
        fail("CONFLICT", "Subscription changed; reload preferences", 409);
      await db.query(
        `INSERT INTO notification_subscriptions(project_id,user_id,events,include_self,include_content,revision,unsubscribe_token)
        VALUES($1,$2,$3,$4,$5,1,$6) ON CONFLICT(project_id,user_id) DO UPDATE SET events=$3,include_self=$4,include_content=$5,revision=notification_subscriptions.revision+1`,
        [
          i.projectId,
          a.userId,
          JSON.stringify([...new Set(i.events)]),
          i.includeSelf,
          i.includeContent,
          randomBytes(32).toString("hex"),
        ],
      );
      return {
        events: [...new Set(i.events)],
        includeSelf: i.includeSelf,
        includeContent: i.includeContent,
        revision: (current?.revision ?? 0) + 1,
      };
    }
    return {
      events: current?.events ?? [],
      includeSelf: current?.include_self ?? false,
      includeContent: current?.include_content ?? false,
      revision: current?.revision ?? 0,
    };
  }
  await notificationAccess(db, a, i.projectId);
  if (op === "notifications.settings") return readMailSettings(db, i.projectId);
  if (op === "notifications.configure") return configureMail(db, config, store, a, i);
  if (op === "notifications.preview") return previewMail(config, i.template, i.event);
  if (op === "notifications.deliveries") {
    const rows = await db.query(
      `SELECT d.*,u.name AS recipient FROM notification_deliveries d JOIN users u ON u.id=d.user_id
      WHERE ${i.projectId ? "d.project_id=$1" : "true"} ORDER BY d.created_at DESC,d.id DESC LIMIT $${i.projectId ? 2 : 1} OFFSET $${i.projectId ? 3 : 2}`,
      [...(i.projectId ? [i.projectId] : []), i.limit + 1, i.offset],
    );
    return {
      items: rows.slice(0, i.limit).map((r) => ({
        id: r.id,
        projectId: r.project_id,
        event: r.event,
        recipient: r.recipient,
        status: r.status,
        attempts: r.attempts,
        revision: r.revision,
        createdAt: r.created_at.toISOString(),
        acceptedAt: r.accepted_at?.toISOString() ?? null,
        errorCode: r.error_code,
      })),
      nextOffset: rows.length > i.limit ? i.offset + i.limit : null,
    };
  }
  if (op === "notifications.test") {
    const row = await db.one(
      "SELECT id,project_id FROM notification_deliveries WHERE test_key=$1 AND user_id=$2",
      [i.idempotencyKey, a.userId],
    );
    if (row) {
      if (row.project_id !== (i.projectId ?? null))
        fail("IDEMPOTENCY_CONFLICT", "This test key was used in another scope", 409);
      return { queued: true, deliveryId: row.id };
    }
    const settings = await readMailSettings(db, i.projectId);
    if (!settings.configured || !settings.enabled)
      fail("VALIDATION", "Enable a configured provider first");
    const id = randomUUID();
    const recent = await db.one(
      "SELECT count(*)::integer AS total FROM notification_deliveries WHERE user_id=$1 AND event='test' AND created_at>now()-interval '1 hour'",
      [a.userId],
    );
    if (recent.total >= 5)
      fail("RATE_LIMITED", "Wait before sending another test email", 429);
    await db.query(
      "INSERT INTO notification_deliveries(id,project_id,user_id,event,payload,status,test_key,event_key) VALUES($1,$2,$3,'test',$4,'pending',$5,$5)",
      [
        id,
        i.projectId ?? null,
        a.userId,
        JSON.stringify({
          actor: a.name,
          title: "Email connection test",
          comment: "This test was requested from your own Feedbacks account.",
          status: "",
        }),
        i.idempotencyKey,
      ],
    );
    return { queued: true, deliveryId: id };
  }
  const row = await db.one(
    "SELECT * FROM notification_deliveries WHERE id=$1 FOR UPDATE",
    [i.deliveryId],
  );
  if (!row || (i.projectId && row.project_id !== i.projectId))
    fail("NOT_FOUND", "Email delivery not found", 404);
  if (row.revision !== i.revision)
    fail("CONFLICT", "Delivery changed; reload before reconciling", 409);
  if (!["failed", "uncertain"].includes(row.status))
    fail("VALIDATION", "Only failed or uncertain sends need reconciliation");
  if (i.decision === "retry" && !i.confirmedNotAccepted)
    fail(
      "VALIDATION",
      "Confirm in your provider that the email was not accepted before retrying",
    );
  await db.query(
    "UPDATE notification_deliveries SET status=$2,next_at=now(),revision=revision+1,error_code=NULL,accepted_at=CASE WHEN $2='accepted' THEN now() ELSE NULL END WHERE id=$1",
    [
      row.id,
      i.decision === "retry"
        ? "pending"
        : i.decision === "accepted"
          ? "accepted"
          : "suppressed",
    ],
  );
  return { updated: true };
}
