import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import sharp from "sharp";
import { Database } from "../src/server/db.js";
import { migrate } from "../src/server/migrations.js";
import { Operations } from "../src/server/operations.js";
import { LocalAssets } from "../src/server/assets.js";
import { configFromEnv } from "../src/server/config.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
test("private image grants, one-use invite/pairing, scoped resolution and snapshot policy", async () => {
  const pg = new PGlite(),
    dir = await mkdtemp(path.join(tmpdir(), "feedbacks-security-"));
  try {
    const db = new Database(pg as any);
    await migrate(db);
    const ops = new Operations(db, new LocalAssets(dir), {
      appOrigin: "http://localhost:3000",
      production: false,
      organizationId: "00000000-0000-4000-8000-000000000001",
    } as any);
    const owner = await ops.auth.bootstrap(
      "owner@example.test",
      "Owner",
      "Correct-Horse-Battery-123",
    );
    await assert.rejects(
      ops.auth.bootstrap("other@example.test", "Other", "Correct-Horse-Battery-123"),
      { code: "BOOTSTRAP_DISABLED" },
    );
    const p = await ops.executeOperation(owner, "projects.create", {
      name: "Site",
      origins: ["https://example.test"],
    });
    const other = await ops.executeOperation(owner, "projects.create", {
      name: "Other",
      origins: ["https://other.test"],
    });
    const invite = await ops.executeOperation(owner, "members.invite", {
      email: "member@example.test",
      projectId: p.id,
      role: "reviewer",
    });
    await ops.auth.acceptInvite(invite.token, "Member", "Correct-Horse-Battery-123");
    await assert.rejects(
      ops.auth.acceptInvite(invite.token, "Again", "Correct-Horse-Battery-123"),
      { code: "INVALID_INVITE" },
    );
    const member = (
      await ops.auth.login("member@example.test", "Correct-Horse-Battery-123")
    ).actor;
    const context = {
      url: "https://example.test/",
      viewport: { width: 1440, height: 900 },
    };
    const thread = await ops.executeOperation(owner, "threads.create", {
      projectId: p.id,
      body: "One",
      context,
      idempotencyKey: "security-one",
    });
    const hidden = await ops.executeOperation(owner, "threads.create", {
      projectId: other.id,
      body: "Private",
      context: { ...context, url: "https://other.test/" },
      idempotencyKey: "security-other",
    });
    const pixel = await sharp({
      create: { width: 4, height: 4, channels: 3, background: "#ffffff" },
    })
      .png()
      .toBuffer();
    const upload = await ops.executeOperation(owner, "assets.upload", {
      threadId: hidden.id,
      revision: hidden.revision,
      imageBase64: pixel.toString("base64"),
      idempotencyKey: "private-image",
    });
    assert.equal(upload.asset.contentType, "image/webp");
    assert.equal(upload.asset.width, 4);
    await assert.rejects(
      ops.executeOperation(member, "assets.get", { assetId: upload.asset.id }),
      { code: "FORBIDDEN" },
    );
    await assert.rejects(
      ops.executeOperation(member, "assets.upload", {
        threadId: thread.id,
        revision: 1,
        imageBase64: Buffer.from("not an image").toString("base64"),
        idempotencyKey: "invalid-image",
      }),
      { code: "INVALID_IMAGE" },
    );
    assert.equal(
      (await db.one("SELECT count(*)::integer AS count FROM assets")).count,
      1,
    );
    const pairing = await ops.auth.requestPairing("Browser");
    assert.equal(
      (await ops.auth.pollPairing(pairing.pairingId, pairing.deviceSecret)).status,
      "pending",
    );
    await ops.executeOperation(member, "pairing.approve", {
      pairingId: pairing.pairingId,
    });
    const paired = await ops.auth.pollPairing(pairing.pairingId, pairing.deviceSecret);
    assert.equal(paired.status, "approved");
    await assert.rejects(ops.auth.pollPairing(pairing.pairingId, pairing.deviceSecret), {
      code: "PAIRING_EXPIRED",
    });
    const extension = await ops.auth.authenticate(paired.token);
    assert.equal(extension.kind, "extension");
    assert.equal(
      (await ops.executeOperation(extension, "projects.list", {})).items.length,
      1,
    );
    await ops.executeOperation(owner, "members.grant", {
      projectId: p.id,
      userId: member.id,
      role: "reviewer",
      remove: true,
    });
    await assert.rejects(
      ops.executeOperation(extension, "threads.get", { threadId: thread.id }),
      { code: "FORBIDDEN" },
    );
    const issued = await ops.executeOperation(owner, "tokens.create", {
      name: "Agent",
      projectIds: [p.id],
      scopes: ["threads.get", "threads.status", "context.export"],
    });
    const agent = await ops.auth.authenticate(issued.token);
    assert.equal(
      (await ops.executeOperation(agent, "threads.get", { threadId: thread.id }))
        .importance,
      undefined,
    );
    await assert.rejects(
      ops.executeOperation(agent, "threads.status", {
        threadId: thread.id,
        revision: 1,
        state: "resolved",
        note: "Claim",
      }),
      { code: "FORBIDDEN" },
    );
    await assert.rejects(
      ops.executeOperation(agent, "tokens.create", {
        name: "Escalate",
        projectIds: [p.id],
        scopes: ["threads.get"],
      }),
      { code: "FORBIDDEN" },
    );
    const exported = await ops.executeOperation(agent, "context.export", {
      projectId: p.id,
      limit: 1,
    });
    assert.equal(exported.items[0].importance, undefined);
    assert.equal(exported.discussionTrust, "untrusted_discussion");
    const updated = await ops.executeOperation(owner, "threads.reply", {
      threadId: thread.id,
      revision: 1,
      body: "New comment",
      idempotencyKey: "snapshot-change",
    });
    const stable = await ops.executeOperation(agent, "context.export", {
      projectId: p.id,
      snapshotId: exported.snapshotId,
      limit: 1,
    });
    assert.equal(stable.items[0].revision, 1);
    assert.equal(updated.revision, 2);
    await ops.executeOperation(owner, "tokens.revoke", { tokenId: issued.id });
    await assert.rejects(
      ops.executeOperation(agent, "threads.get", { threadId: thread.id }),
      { code: "UNAUTHENTICATED" },
    );
    assert.throws(
      () =>
        configFromEnv({
          NODE_ENV: "production",
          APP_ORIGIN: "https://feedback.example.com",
          ASSET_DRIVER: "local",
          DATABASE_URL: "postgres://localhost/feedbacks",
        }),
      /Production requires/,
    );
  } finally {
    await pg.close();
    await rm(dir, { recursive: true, force: true });
  }
});
