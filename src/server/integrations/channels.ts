import { randomUUID } from "node:crypto";
import { request } from "node:https";
import type { Database } from "../db.js";
import type { Config } from "../config.js";
import type { AssetStore } from "../assets.js";
import type { Actor } from "../../shared/contracts.js";
import { access, event } from "../access.js";
import { Auth, accountLock } from "../auth.js";
import { fail } from "../errors.js";
import { publicAddress, pinnedLookup } from "../webhooks.js";
import { credentialScope, sealCredential, openCredential } from "./credential-vault.js";

export const channelMigrationSql = `CREATE TABLE notification_channels(id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES projects(id),provider text NOT NULL,label text NOT NULL,revision integer NOT NULL DEFAULT 1,enabled boolean NOT NULL DEFAULT true,events jsonb NOT NULL,credential_key text NOT NULL,credential jsonb NOT NULL,created_by uuid NOT NULL REFERENCES users(id),error_code text);
CREATE INDEX notification_channels_project ON notification_channels(project_id);
CREATE TABLE channel_deliveries(id uuid PRIMARY KEY,channel_id uuid NOT NULL REFERENCES notification_channels(id),channel_revision integer NOT NULL,thread_id uuid REFERENCES threads(id),event text NOT NULL,event_key text NOT NULL,status text NOT NULL DEFAULT 'pending',attempts integer NOT NULL DEFAULT 0,next_at timestamptz NOT NULL DEFAULT now(),lease_until timestamptz,error_code text,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(channel_id,event_key));
CREATE INDEX channel_deliveries_due ON channel_deliveries(next_at) WHERE status='pending';`;
const summary = (r: any) => ({
  id: r.id,
  projectId: r.project_id,
  provider: r.provider,
  label: r.label,
  revision: r.revision,
  enabled: r.enabled,
  events: r.events,
  errorCode: r.error_code,
});
export function validateChannelUrl(provider: "slack" | "teams", raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    fail("VALIDATION", "Enter the provider's HTTPS incoming webhook URL");
  }
  if (
    url!.protocol !== "https:" ||
    url!.username ||
    url!.password ||
    url!.hash ||
    url!.port ||
    raw.length > 4000
  )
    fail("VALIDATION", "Enter the provider's HTTPS incoming webhook URL");
  const valid =
    provider === "slack"
      ? url!.hostname === "hooks.slack.com" &&
        /^\/services\/[A-Za-z0-9]+\/[A-Za-z0-9]+\/[A-Za-z0-9]+$/.test(url!.pathname) &&
        !url!.search
      : (/^[a-z0-9-]+\.webhook\.office\.com$/.test(url!.hostname) &&
          /^\/webhookb2\//.test(url!.pathname)) ||
        (/^[a-z0-9.-]+\.environment\.api\.powerplatform\.com$/.test(url!.hostname) &&
          /^\/powerautomate\/automations\/direct\/workflows\/[a-zA-Z0-9-]+\/triggers\/manual\/paths\/invoke$/.test(
            url!.pathname,
          ) &&
          !!url!.searchParams.get("sig")) ||
        (/^[a-z0-9-]+\.[a-z0-9-]+\.logic\.azure\.com$/.test(url!.hostname) &&
          /^\/workflows\/[a-zA-Z0-9-]+\/triggers\/manual\/paths\/invoke$/.test(
            url!.pathname,
          ) &&
          !!url!.searchParams.get("sig"));
  if (!valid)
    fail(
      "VALIDATION",
      "Use a Slack incoming webhook or a Microsoft Teams Workflows incoming webhook URL",
    );
  return url!.toString();
}
async function channel(db: Database, actor: Actor, id: string) {
  const row = await db.one("SELECT * FROM notification_channels WHERE id=$1", [id]);
  if (!row) fail("NOT_FOUND", "Channel connection not found", 404);
  await access(db, actor, row.project_id, "maintain");
  return row;
}
export async function channelOperation(
  db: Database,
  store: AssetStore,
  config: Config,
  actor: Actor,
  name: string,
  input: any,
): Promise<any> {
  if (actor.kind !== "human")
    fail("FORBIDDEN", "A signed-in project maintainer is required", 403);
  if (name === "channels.list" || name === "channels.deliveries") {
    await access(db, actor, input.projectId, "maintain");
    if (name === "channels.list")
      return {
        channels: (
          await db.query(
            "SELECT * FROM notification_channels WHERE project_id=$1 ORDER BY id LIMIT 20",
            [input.projectId],
          )
        ).map(summary),
      };
    return {
      items: (
        await db.query(
          "SELECT d.* FROM channel_deliveries d JOIN notification_channels c ON c.id=d.channel_id WHERE c.project_id=$1 ORDER BY d.created_at DESC,d.id DESC LIMIT 100",
          [input.projectId],
        )
      ).map((r) => ({
        id: r.id,
        channelId: r.channel_id,
        event: r.event,
        status: r.status,
        attempts: r.attempts,
        errorCode: r.error_code,
        createdAt: r.created_at.toISOString(),
      })),
    };
  }
  if (name === "channels.save") {
    await access(db, actor, input.projectId, "maintain");
    const previous = input.channelId ? await channel(db, actor, input.channelId) : null;
    if (
      previous &&
      (previous.project_id !== input.projectId || previous.provider !== input.provider)
    )
      fail("VALIDATION", "Channel project and provider cannot change");
    if (previous && previous.revision !== input.revision)
      fail("CONFLICT", "Channel settings changed; reload before saving", 409);
    if (!previous && !input.webhookUrl)
      fail("VALIDATION", "An incoming webhook URL is required");
    if (
      !previous &&
      (
        await db.one(
          "SELECT count(*)::int n FROM notification_channels WHERE project_id=$1",
          [input.projectId],
        )
      ).n >= 20
    )
      fail(
        "LIMIT_REACHED",
        "This project has reached its notification channel limit",
        429,
      );
    const id = previous?.id ?? randomUUID(),
      sealed = input.webhookUrl
        ? await sealCredential(
            store,
            credentialScope(config, "channels", id),
            validateChannelUrl(input.provider, input.webhookUrl),
          )
        : { objectKey: previous.credential_key, envelope: previous.credential };
    const row = await db.one(
      `INSERT INTO notification_channels(id,project_id,provider,label,events,credential_key,credential,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET label=excluded.label,events=excluded.events,credential_key=excluded.credential_key,credential=excluded.credential,revision=notification_channels.revision+1,enabled=true,error_code=NULL RETURNING *`,
      [
        id,
        input.projectId,
        input.provider,
        input.label,
        JSON.stringify([...new Set(input.events)]),
        sealed.objectKey,
        JSON.stringify(sealed.envelope),
        actor.userId,
      ],
    );
    await event(db, actor, input.projectId, id, "channel.configured", {
      provider: input.provider,
    });
    return summary(row);
  }
  if (name === "channels.reconcile") {
    const delivery = await db.one(
      "SELECT * FROM channel_deliveries WHERE id=$1 FOR UPDATE",
      [input.deliveryId],
    );
    if (!delivery) fail("NOT_FOUND", "Delivery not found", 404);
    const c = await channel(db, actor, delivery.channel_id);
    if (delivery.status !== "uncertain")
      fail("CONFLICT", "This delivery does not need reconciliation", 409);
    await db.query(
      "UPDATE channel_deliveries SET status=$2,error_code=NULL WHERE id=$1",
      [delivery.id, input.delivered ? "delivered" : "abandoned"],
    );
    await event(db, actor, c.project_id, c.id, "channel.reconciled", {
      deliveryId: delivery.id,
      delivered: input.delivered,
    });
    return { reconciled: true };
  }
  const c = await channel(db, actor, input.channelId);
  if (name === "channels.disable") {
    if (c.revision !== input.revision)
      fail("CONFLICT", "Channel settings changed; reload before disabling", 409);
    await db.query(
      "UPDATE channel_deliveries SET status='cancelled',error_code='CHANNEL_DISABLED' WHERE channel_id=$1 AND status='pending'",
      [c.id],
    );
    return summary(
      await db.one(
        "UPDATE notification_channels SET enabled=false,revision=revision+1 WHERE id=$1 RETURNING *",
        [c.id],
      ),
    );
  }
  if (!c.enabled) fail("CHANNEL_DISABLED", "Save this connection to enable it", 409);
  if (name !== "channels.test") fail("NOT_FOUND", "Unknown channel operation", 404);
  const recent = await db.one(
    "SELECT count(*)::int n FROM channel_deliveries WHERE channel_id=$1 AND event='test' AND created_at>now()-interval '1 minute'",
    [c.id],
  );
  if (recent.n >= 5)
    fail("RATE_LIMITED", "Wait one minute before sending more test messages", 429);
  const id = randomUUID();
  await db.query(
    "INSERT INTO channel_deliveries(id,channel_id,channel_revision,event,event_key) VALUES($1,$2,$3,'test',$4) ON CONFLICT(channel_id,event_key) DO NOTHING",
    [id, c.id, c.revision, "test:" + input.idempotencyKey],
  );
  return {
    deliveryId: (
      await db.one(
        "SELECT id FROM channel_deliveries WHERE channel_id=$1 AND event_key=$2",
        [c.id, "test:" + input.idempotencyKey],
      )
    ).id,
  };
}
function eventType(kind: string) {
  return kind === "thread.created"
    ? "created"
    : ["threads.reply", "guest.reply"].includes(kind)
      ? "discussion"
      : kind === "threads.status"
        ? "status"
        : ["assignments.assign", "assignments.cancel"].includes(kind)
          ? "assignment"
          : null;
}
export async function enqueueChannels(
  db: Database,
  projectId: string,
  threadId: string,
  kind: string,
  revision: number,
  eventKey?: string,
) {
  const type = eventType(kind);
  if (!type) return;
  await db.query(
    `INSERT INTO channel_deliveries(id,channel_id,channel_revision,thread_id,event,event_key)
    SELECT gen_random_uuid(),id,revision,$2,$3,$4 FROM notification_channels WHERE project_id=$1 AND enabled=true AND events ? $3
    ON CONFLICT(channel_id,event_key) DO NOTHING`,
    [projectId, threadId, type, eventKey ?? `${threadId}:${kind}:${revision}`],
  );
}
export type ChannelSender = (url: string, body: string) => Promise<number>;
export const sendChannel: ChannelSender = async (url, body) => {
  const destination = new URL(url),
    address = await publicAddress(destination.hostname);
  return new Promise((resolve, reject) => {
    const req = request(
      destination,
      {
        method: "POST",
        timeout: 10000,
        lookup: pinnedLookup(address),
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        res.destroy();
        resolve(status);
      },
    );
    req.on("timeout", () => req.destroy(Error("Channel delivery timed out")));
    req.on("error", reject);
    req.end(body);
  });
};
export async function processChannelDeliveries(
  db: Database,
  store: AssetStore,
  config: Config,
  send: ChannelSender = sendChannel,
) {
  await db.query(
    "UPDATE channel_deliveries SET status='uncertain',error_code='CHANNEL_INTERRUPTED',lease_until=NULL WHERE status='processing' AND lease_until<now()",
  );
  for (let count = 0; count < 10; count++) {
    const delivery = await db.transaction(async (tx) => {
      const row = await tx.one(
        "SELECT * FROM channel_deliveries WHERE status='pending' AND next_at<=now() ORDER BY next_at,id LIMIT 1 FOR UPDATE SKIP LOCKED",
      );
      if (!row) return null;
      return tx.one(
        "UPDATE channel_deliveries SET status='processing',attempts=attempts+1,lease_until=now()+interval '1 minute' WHERE id=$1 RETURNING *",
        [row.id],
      );
    });
    if (!delivery) return;
    let sending = false;
    try {
      const preflight = () =>
        db.transaction(async (tx) => {
          await accountLock(tx);
          const row = await tx.one("SELECT * FROM notification_channels WHERE id=$1", [
            delivery.channel_id,
          ]);
          if (!row?.enabled || row.revision !== delivery.channel_revision)
            fail("CHANNEL_DISABLED", "Channel settings changed", 409);
          const actor = await new Auth(tx).current({
            id: row.created_by,
            userId: row.created_by,
            kind: "human",
            owner: false,
            name: "Channel notifications",
          });
          await access(tx, actor, row.project_id, "maintain");
          if (delivery.thread_id) {
            const thread = await tx.one("SELECT project_id FROM threads WHERE id=$1", [
              delivery.thread_id,
            ]);
            if (thread?.project_id !== row.project_id)
              fail("CHANNEL_THREAD_MOVED", "Feedback moved to another project", 409);
          }
          if (
            !(await tx.one(
              "SELECT id FROM channel_deliveries WHERE id=$1 AND status='processing' AND attempts=$2 AND lease_until>now()",
              [delivery.id, delivery.attempts],
            ))
          )
            fail("CHANNEL_LEASE_EXPIRED", "Channel delivery attempt expired", 409);
          return row;
        });
      const c = await preflight();
      const url = validateChannelUrl(
        c.provider,
        await openCredential(
          store,
          credentialScope(config, "channels", c.id),
          c.credential_key,
          c.credential,
        ),
      );
      const link = `${config.appOrigin}${delivery.thread_id ? `/threads/${delivery.thread_id}` : `/projects/${c.project_id}`}`;
      const text =
        delivery.event === "test"
          ? "Feedbacks notification test. Your channel connection is working."
          : `Feedbacks: ${delivery.event === "created" ? "new feedback" : delivery.event === "discussion" ? "discussion updated" : delivery.event === "status" ? "work status changed" : "assignment changed"}.`;
      const payload =
        c.provider === "slack"
          ? {
              text: `${text}\n${link}`,
              mrkdwn: false,
              unfurl_links: false,
              unfurl_media: false,
            }
          : {
              type: "message",
              attachments: [
                {
                  contentType: "application/vnd.microsoft.card.adaptive",
                  content: {
                    type: "AdaptiveCard",
                    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
                    version: "1.2",
                    body: [{ type: "TextBlock", text, wrap: true }],
                    actions: [
                      { type: "Action.OpenUrl", title: "Open in Feedbacks", url: link },
                    ],
                  },
                },
              ],
            };
      await preflight();
      sending = true;
      const status = await send(url, JSON.stringify(payload));
      if (status >= 200 && status < 300) {
        await db.query(
          "UPDATE channel_deliveries SET status='delivered',lease_until=NULL,error_code=NULL WHERE id=$1 AND status='processing' AND attempts=$2",
          [delivery.id, delivery.attempts],
        );
        await db.query(
          "UPDATE notification_channels SET error_code=NULL WHERE id=$1 AND revision=$2",
          [c.id, c.revision],
        );
      } else {
        const retry = status === 429 && delivery.attempts < 5,
          uncertain = status >= 500;
        const code =
          status === 401 || status === 403 || status === 404 || status === 410
            ? "CHANNEL_REVOKED"
            : `CHANNEL_HTTP_${status}`;
        await db.query(
          "UPDATE channel_deliveries SET status=$2,error_code=$3,lease_until=NULL,next_at=now()+($4::integer*interval '1 second') WHERE id=$1 AND status='processing' AND attempts=$5",
          [
            delivery.id,
            uncertain ? "uncertain" : retry ? "pending" : "failed",
            code,
            Math.min(3600, 30 * 2 ** delivery.attempts),
            delivery.attempts,
          ],
        );
        await db.query(
          "UPDATE notification_channels SET error_code=$2 WHERE id=$1 AND revision=$3",
          [c.id, code, c.revision],
        );
      }
    } catch (error) {
      const code = (error as any)?.code ?? "CHANNEL_NETWORK";
      await db.query(
        "UPDATE channel_deliveries SET status=$2,error_code=$3,lease_until=NULL WHERE id=$1 AND status='processing' AND attempts=$4",
        [
          delivery.id,
          sending ? "uncertain" : "failed",
          typeof code === "string" ? code : "CHANNEL_NETWORK",
          delivery.attempts,
        ],
      );
    }
  }
}
