import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { PassThrough } from "node:stream";
import { PGlite } from "@electric-sql/pglite";
import { Database } from "../src/server/db.js";
import { migrate } from "../src/server/migrations.js";
import { Operations } from "../src/server/operations.js";
import {
  deliverWebhooks,
  isPublicAddress,
  webhookResponseStatus,
  validateWebhookDestination,
} from "../src/server/webhooks.js";

test("maintainer configures a signed project webhook and thread events queue a bounded payload", async () => {
  const pg = new PGlite();
  const db = new Database(pg as any);
  try {
    await migrate(db);
    const ops = new Operations(
      db,
      {} as any,
      { appOrigin: "http://localhost:3000" } as any,
    );
    const owner = await ops.auth.bootstrap(
      "owner@example.test",
      "Owner",
      "Correct-Horse-Battery-123",
    );
    const project = await ops.executeOperation(owner, "projects.create", {
      name: "Review",
      origins: ["https://example.test"],
    });
    const configured = await ops.executeOperation(owner, "webhooks.save", {
      projectId: project.id,
      url: "https://hooks.example.com/feedback",
    });
    assert.match(configured.secret, /^[a-f0-9]{64}$/);
    const listing = await ops.executeOperation(owner, "webhooks.get", {
      projectId: project.id,
    });
    assert.equal(listing.url, "https://hooks.example.com/feedback");
    assert.ok(!JSON.stringify(listing).includes(configured.secret));
    const thread = await ops.executeOperation(owner, "threads.create", {
      projectId: project.id,
      body: "Public body",
      context: {
        url: "https://example.test/page?secret=private",
        viewport: { width: 1000, height: 800 },
      },
      idempotencyKey: "webhook-1",
    });
    const deliveries = await ops.executeOperation(owner, "webhooks.deliveries", {
      projectId: project.id,
    });
    assert.equal(deliveries.items.length, 1);
    const queued = await db.one("SELECT payload FROM webhook_deliveries WHERE id=$1", [
      deliveries.items[0].id,
    ]);
    assert.deepEqual(queued.payload, {
      id: deliveries.items[0].id,
      type: "thread.created",
      projectId: project.id,
      threadId: thread.id,
      revision: 1,
      occurredAt: queued.payload.occurredAt,
    });
    assert.ok(!JSON.stringify(queued.payload).includes("private"));
    const seen: Array<{ headers: Record<string, string>; body: string }> = [];
    await deliverWebhooks(db, async (_url, body, headers) => {
      seen.push({ headers, body });
      return 204;
    });
    assert.equal(seen.length, 1);
    assert.equal(
      seen[0].headers["x-feedbacks-signature"],
      `sha256=${createHmac("sha256", configured.secret).update(seen[0].body).digest("hex")}`,
    );
    assert.equal(
      (
        await ops.executeOperation(owner, "webhooks.deliveries", {
          projectId: project.id,
        })
      ).items[0].status,
      "delivered",
    );
    await ops.executeOperation(owner, "threads.reply", {
      threadId: thread.id,
      revision: 1,
      body: "Follow-up",
      idempotencyKey: "webhook-reply-1",
    });
    const later = await ops.executeOperation(owner, "webhooks.deliveries", {
      projectId: project.id,
    });
    assert.equal(later.items.length, 2);
    const replyPayload = await db.one(
      "SELECT payload FROM webhook_deliveries WHERE id=$1",
      [later.items[0].id],
    );
    assert.equal(replyPayload.payload.type, "threads.reply");
    assert.equal(replyPayload.payload.revision, 2);
    assert.ok(!JSON.stringify(replyPayload.payload).includes("Follow-up"));
  } finally {
    await pg.close();
  }
});

test("webhook destination rejects non-public and non-HTTPS addresses", () => {
  for (const url of [
    "http://example.com/x",
    "https://localhost/x",
    "https://127.0.0.1/x",
    "https://user:pass@example.com/x",
    "https://example.com:8443/x",
    "https://example.com/#fragment",
    "https://example.com/?token=private",
  ])
    assert.throws(() => validateWebhookDestination(url));
  assert.equal(
    validateWebhookDestination("https://hooks.example.com/path"),
    "https://hooks.example.com/path",
  );
});

test("resolved private, documentation and mapped addresses are not delivery targets", () => {
  for (const address of [
    "127.0.0.1",
    "10.1.2.3",
    "169.254.169.254",
    "192.0.2.1",
    "198.51.100.1",
    "203.0.113.1",
    "::1",
    "fc00::1",
    "2001:db8::1",
    "::ffff:127.0.0.1",
  ])
    assert.equal(isPublicAddress(address), false, address);
  assert.equal(isPublicAddress("8.8.8.8"), true);
  assert.equal(isPublicAddress("2606:4700:4700::1111"), true);
});

test("webhook delivery accepts response headers without waiting for an unbounded body", () => {
  const response = new PassThrough() as PassThrough & { statusCode: number };
  response.statusCode = 204;
  assert.equal(webhookResponseStatus(response as any), 204);
  assert.equal(response.destroyed, true);
});

test("reviewers cannot configure webhooks and failed delivery stays visible without leaking secrets", async () => {
  const pg = new PGlite();
  const db = new Database(pg as any);
  try {
    await migrate(db);
    const ops = new Operations(
      db,
      {} as any,
      { appOrigin: "http://localhost:3000" } as any,
    );
    const owner = await ops.auth.bootstrap(
      "owner@example.test",
      "Owner",
      "Correct-Horse-Battery-123",
    );
    const project = await ops.executeOperation(owner, "projects.create", {
      name: "Review",
      origins: ["https://example.test"],
    });
    const invitation = await ops.executeOperation(owner, "members.invite", {
      email: "reviewer@example.test",
      projectId: project.id,
      role: "reviewer",
    });
    await ops.auth.acceptInvite(
      invitation.token,
      "Reviewer",
      "Correct-Horse-Battery-123",
    );
    const reviewer = (
      await ops.auth.login("reviewer@example.test", "Correct-Horse-Battery-123")
    ).actor;
    await assert.rejects(
      ops.executeOperation(reviewer, "webhooks.save", {
        projectId: project.id,
        url: "https://hooks.example.com/feedback",
      }),
      { code: "FORBIDDEN" },
    );
    const created = await ops.executeOperation(owner, "webhooks.save", {
      projectId: project.id,
      url: "https://hooks.example.com/feedback",
    });
    const updated = await ops.executeOperation(owner, "webhooks.save", {
      projectId: project.id,
      url: "https://events.example.com/feedback",
    });
    assert.equal(updated.secret, undefined);
    assert.equal(updated.url, "https://events.example.com/feedback");
    assert.equal(
      (
        await db.one("SELECT secret FROM webhook_configs WHERE project_id=$1", [
          project.id,
        ])
      ).secret,
      created.secret,
    );
    await ops.executeOperation(owner, "threads.create", {
      projectId: project.id,
      body: "Public body",
      context: { url: "https://example.test", viewport: { width: 1000, height: 800 } },
      idempotencyKey: "webhook-retry",
    });
    await deliverWebhooks(db, async () => 503);
    let item = (
      await ops.executeOperation(owner, "webhooks.deliveries", { projectId: project.id })
    ).items[0];
    assert.equal(item.status, "pending");
    assert.equal(item.attempts, 1);
    assert.equal(item.lastStatus, 503);
    assert.ok(!JSON.stringify(item).includes(created.secret));
    await db.query(
      "UPDATE webhook_deliveries SET attempts=7,next_at=now()-interval '1 second' WHERE id=$1",
      [item.id],
    );
    await deliverWebhooks(db, async () => {
      throw Error("secret details must be discarded");
    });
    item = (
      await ops.executeOperation(owner, "webhooks.deliveries", { projectId: project.id })
    ).items[0];
    assert.equal(item.status, "failed");
    assert.equal(item.attempts, 8);
    assert.equal(item.lastStatus, null);
    assert.ok(!JSON.stringify(item).includes("secret details"));
    const rotated = await ops.executeOperation(owner, "webhooks.rotate", {
      projectId: project.id,
    });
    assert.notEqual(rotated.secret, created.secret);
    assert.ok(
      !JSON.stringify(
        await ops.executeOperation(owner, "webhooks.get", { projectId: project.id }),
      ).includes(rotated.secret),
    );
    await ops.executeOperation(owner, "webhooks.disable", { projectId: project.id });
    assert.equal(
      (await ops.executeOperation(owner, "webhooks.get", { projectId: project.id }))
        .configured,
      false,
    );
  } finally {
    await pg.close();
  }
});
