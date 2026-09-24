import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request } from "node:https";
import type { IncomingMessage } from "node:http";
import { BlockList, isIP } from "node:net";
import type { Database } from "./db.js";
import type { Actor } from "../shared/contracts.js";
import { access, event } from "./access.js";
import { fail } from "./errors.js";

const blocked = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  blocked.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 32],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const)
  blocked.addSubnet(network, prefix, "ipv6");

export function isPublicAddress(address: string) {
  const family = isIP(address);
  return (
    family !== 0 &&
    !(family === 6 && address.toLowerCase().startsWith("::ffff:")) &&
    !blocked.check(address, family === 4 ? "ipv4" : "ipv6")
  );
}

export function validateWebhookDestination(raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    fail("VALIDATION", "Valid HTTPS webhook URL required");
  }
  if (
    url!.protocol !== "https:" ||
    url!.username ||
    url!.password ||
    url!.hash ||
    url!.search ||
    url!.port ||
    raw.length > 2048 ||
    !url!.hostname.includes(".") ||
    isIP(url!.hostname) ||
    /(^|\.)(localhost|local|internal|test|invalid)$/.test(url!.hostname) ||
    url!.hostname.endsWith(".localhost")
  )
    fail("VALIDATION", "Public HTTPS webhook URL required");
  return url!.toString();
}

async function publicAddress(hostname: string) {
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address)))
    throw Error("Destination is not public");
  return addresses[0];
}

export function webhookResponseStatus(response: IncomingMessage) {
  const status = response.statusCode ?? 0;
  response.destroy();
  return status;
}

export async function postWebhook(
  url: string,
  body: string,
  headers: Record<string, string>,
) {
  const destination = validateWebhookDestination(url);
  const host = new URL(destination).hostname;
  const address = await publicAddress(host);
  return new Promise<number>((resolve, reject) => {
    const req = request(
      destination,
      {
        method: "POST",
        headers: {
          ...headers,
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
        timeout: 5000,
        lookup: (_host, _opts, callback) =>
          callback(null, address.address, address.family),
      },
      (res) => {
        resolve(webhookResponseStatus(res));
      },
    );
    req.on("timeout", () => req.destroy(Error("Webhook timeout")));
    req.on("error", reject);
    req.end(body);
  });
}

export async function manageWebhooks(db: Database, actor: Actor, op: string, input: any) {
  await access(db, actor, input.projectId, "maintain");
  if (op === "webhooks.get") {
    const row = await db.one(
      "SELECT url,created_at,updated_at FROM webhook_configs WHERE project_id=$1",
      [input.projectId],
    );
    return {
      configured: !!row,
      url: row?.url ?? null,
      createdAt: row?.created_at?.toISOString() ?? null,
      updatedAt: row?.updated_at?.toISOString() ?? null,
    };
  }
  if (op === "webhooks.deliveries") {
    const items = await db.query(
      'SELECT id,status,attempts,last_status AS "lastStatus",created_at AS "createdAt",delivered_at AS "deliveredAt" FROM webhook_deliveries WHERE project_id=$1 ORDER BY created_at DESC,id DESC LIMIT 50',
      [input.projectId],
    );
    return {
      items: items.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
        deliveredAt: r.deliveredAt?.toISOString() ?? null,
      })),
    };
  }
  if (op === "webhooks.disable") {
    await db.query("DELETE FROM webhook_configs WHERE project_id=$1", [input.projectId]);
    await db.query(
      "DELETE FROM webhook_deliveries WHERE project_id=$1 AND status='pending'",
      [input.projectId],
    );
    await event(db, actor, input.projectId, input.projectId, "webhook.disabled", {});
    return { disabled: true };
  }
  if (
    op === "webhooks.rotate" &&
    !(await db.one("SELECT project_id FROM webhook_configs WHERE project_id=$1", [
      input.projectId,
    ]))
  )
    fail("NOT_FOUND", "Webhook not configured", 404);
  const url =
    op === "webhooks.save"
      ? validateWebhookDestination(input.url)
      : (
          await db.one("SELECT url FROM webhook_configs WHERE project_id=$1", [
            input.projectId,
          ])
        ).url;
  const secret = randomBytes(32).toString("hex");
  await db.query(
    "INSERT INTO webhook_configs(project_id,url,secret) VALUES($1,$2,$3) ON CONFLICT(project_id) DO UPDATE SET url=excluded.url,secret=excluded.secret,updated_at=now()",
    [input.projectId, url, secret],
  );
  await event(
    db,
    actor,
    input.projectId,
    input.projectId,
    op === "webhooks.save" ? "webhook.configured" : "webhook.rotated",
    {},
  );
  return { configured: true, url, secret };
}

export async function enqueueWebhook(
  db: Database,
  projectId: string,
  threadId: string,
  kind: string,
  revision: number,
) {
  const configured = await db.one(
    "SELECT project_id FROM webhook_configs WHERE project_id=$1",
    [projectId],
  );
  if (!configured) return;
  const id = randomUUID();
  const payload = {
    id,
    type: kind,
    projectId,
    threadId,
    revision,
    occurredAt: new Date().toISOString(),
  };
  await db.query(
    "INSERT INTO webhook_deliveries(id,project_id,payload,status) VALUES($1,$2,$3,'pending')",
    [id, projectId, JSON.stringify(payload)],
  );
}

export async function deliverWebhooks(db: Database, sender = postWebhook) {
  const rows = await db.transaction(async (tx) => {
    const due = await tx.query(
      "SELECT id FROM webhook_deliveries WHERE status='pending' AND next_at<=now() AND (lease_until IS NULL OR lease_until<now()) ORDER BY next_at,id LIMIT 10 FOR UPDATE SKIP LOCKED",
    );
    if (!due.length) return [];
    const ids = due.map((r) => r.id);
    await tx.query(
      "UPDATE webhook_deliveries SET lease_until=now()+interval '30 seconds' WHERE id=ANY($1::uuid[])",
      [ids],
    );
    return ids;
  });
  for (const id of rows) {
    const row = await db.one(
      "SELECT d.payload,d.attempts,c.url,c.secret FROM webhook_deliveries d LEFT JOIN webhook_configs c ON c.project_id=d.project_id WHERE d.id=$1 AND d.status='pending'",
      [id],
    );
    if (!row) continue;
    if (!row.url) {
      await db.query("DELETE FROM webhook_deliveries WHERE id=$1", [id]);
      continue;
    }
    const body = JSON.stringify(row.payload);
    const signature = createHmac("sha256", row.secret).update(body).digest("hex");
    let status: number | null = null;
    try {
      status = await sender(row.url, body, {
        "x-feedbacks-event-id": id,
        "x-feedbacks-signature": `sha256=${signature}`,
      });
    } catch {
      /* Only an outcome code is retained. Never log destination or body. */
    }
    const attempts = row.attempts + 1;
    if (status !== null && status >= 200 && status < 300)
      await db.query(
        "UPDATE webhook_deliveries SET status='delivered',attempts=$2,last_status=$3,delivered_at=now(),lease_until=NULL WHERE id=$1 AND status='pending'",
        [id, attempts, status],
      );
    else if (attempts >= 8)
      await db.query(
        "UPDATE webhook_deliveries SET status='failed',attempts=$2,last_status=$3,lease_until=NULL WHERE id=$1 AND status='pending'",
        [id, attempts, status],
      );
    else
      await db.query(
        "UPDATE webhook_deliveries SET attempts=$2,last_status=$3,next_at=now()+($4::integer * interval '1 second'),lease_until=NULL WHERE id=$1 AND status='pending'",
        [id, attempts, status, Math.min(3600, 30 * 2 ** (attempts - 1))],
      );
  }
}
