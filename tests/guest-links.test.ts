import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { Database } from "../src/server/db.js";
import { migrate } from "../src/server/migrations.js";
import { Operations } from "../src/server/operations.js";
import { guestInspect, guestReply } from "../src/server/guest-links.js";
import { accountLock } from "../src/server/auth.js";
import { inputSchemas, outputSchemas } from "../src/shared/contracts.js";
import { verifyGuestTurnstile } from "../src/server/turnstile.js";

const turnstileConfig: any = {
  appOrigin: "http://127.0.0.1:3000",
  production: false,
  turnstileSiteKey: "1x00000000000000000000AA",
  turnstileSecretKey: "1x0000000000000000000000000000000AA",
};

test("guest link only exposes one thread and revocation stops replies", async () => {
  const pg = new PGlite();
  const db = new Database(pg as any);
  try {
    await migrate(db);
    const ops = new Operations(db, {} as any, turnstileConfig);
    const owner = await ops.auth.bootstrap(
      "owner@example.test",
      "Owner",
      "Correct-Horse-Battery-123",
    );
    const project = await ops.executeOperation(owner, "projects.create", {
      name: "Private review",
      origins: ["https://example.test"],
    });
    const thread = await ops.executeOperation(owner, "threads.create", {
      projectId: project.id,
      body: "Please review this page",
      context: { url: "https://example.test", viewport: { width: 1000, height: 800 } },
      idempotencyKey: "guest-thread-1",
    });
    await ops.executeOperation(owner, "members.guidance.save", {
      userId: owner.userId,
      body: "Owner-only reviewer guidance",
      revision: 0,
    });
    const link = await ops.executeOperation(owner, "guestLinks.create", {
      threadId: thread.id,
      label: "Client review",
      expiresInDays: 7,
    });
    outputSchemas["guestLinks.create"].parse(link);
    const preview = await guestInspect(db, link.token, turnstileConfig);
    assert.equal(preview.projectName, "Private review");
    assert.equal(preview.threadBody, "Please review this page");
    assert.ok(!JSON.stringify(preview).includes("Owner-only reviewer guidance"));
    outputSchemas["guest.inspect"].parse(preview);
    assert.equal(
      inputSchemas["guest.reply"].safeParse({
        token: link.token,
        name: "Client",
        body: "Looks good",
        turnstileToken: "test-token",
      }).success,
      true,
    );
    const posted = await db.transaction(async (tx) => {
      await accountLock(tx);
      return guestReply(tx, { token: link.token, name: "Client", body: "Looks good" });
    });
    assert.deepEqual(posted, { posted: true });
    const updated = await ops.executeOperation(owner, "threads.get", {
      threadId: thread.id,
    });
    assert.equal(updated.replies.at(-1).body, "Looks good");
    assert.equal(updated.replies.at(-1).author.kind, "guest");
    assert.equal(updated.replies.at(-1).author.name, "Client");
    assert.equal(updated.response.state, "unanswered");
    const listed = await ops.executeOperation(owner, "guestLinks.list", {
      threadId: thread.id,
    });
    outputSchemas["guestLinks.list"].parse(listed);
    assert.equal(listed.items[0].replies, 1);
    assert.ok(!JSON.stringify(listed).includes(link.token));
    const opsWithoutTurnstile = new Operations(db, {} as any, {
      ...turnstileConfig,
      turnstileSiteKey: undefined,
      turnstileSecretKey: undefined,
    });
    assert.equal(
      (
        await opsWithoutTurnstile.executeOperation(owner, "guestLinks.list", {
          threadId: thread.id,
        })
      ).items[0].id,
      link.id,
    );
    await opsWithoutTurnstile.executeOperation(owner, "guestLinks.revoke", {
      linkId: link.id,
    });
    await assert.rejects(guestInspect(db, link.token, turnstileConfig), {
      code: "INVALID_LINK",
    });
    await assert.rejects(
      db.transaction(async (tx) => {
        await accountLock(tx);
        return guestReply(tx, { token: link.token, name: "Client", body: "Again" });
      }),
      { code: "INVALID_LINK" },
    );
  } finally {
    await pg.close();
  }
});

test("guest link issuance requires a signed-in maintainer and respects expiry", async () => {
  const pg = new PGlite();
  const db = new Database(pg as any);
  try {
    await migrate(db);
    const ops = new Operations(db, {} as any, turnstileConfig);
    const owner = await ops.auth.bootstrap(
      "owner@example.test",
      "Owner",
      "Correct-Horse-Battery-123",
    );
    const project = await ops.executeOperation(owner, "projects.create", {
      name: "Review",
      origins: ["https://example.test"],
    });
    const thread = await ops.executeOperation(owner, "threads.create", {
      projectId: project.id,
      body: "One thread",
      context: { url: "https://example.test", viewport: { width: 1000, height: 800 } },
      idempotencyKey: "guest-thread-2",
    });
    const invite = await ops.executeOperation(owner, "members.invite", {
      email: "reviewer@example.test",
      projectId: project.id,
      role: "reviewer",
    });
    await ops.auth.acceptInvite(invite.token, "Reviewer", "Correct-Horse-Battery-123");
    const reviewer = (
      await ops.auth.login("reviewer@example.test", "Correct-Horse-Battery-123")
    ).actor;
    await assert.rejects(
      ops.executeOperation(reviewer, "guestLinks.create", {
        threadId: thread.id,
        label: "No",
        expiresInDays: 7,
      }),
      { code: "FORBIDDEN" },
    );
    const link = await ops.executeOperation(owner, "guestLinks.create", {
      threadId: thread.id,
      label: "Time limited",
      expiresInDays: 1,
    });
    await db.query(
      "UPDATE guest_links SET expires_at=now()-interval '1 second' WHERE id=$1",
      [link.id],
    );
    await assert.rejects(guestInspect(db, link.token, turnstileConfig), {
      code: "INVALID_LINK",
    });
  } finally {
    await pg.close();
  }
});

test("Turnstile verification fails closed and checks production hostname and action", async () => {
  const seen: Array<{ url: string; body: URLSearchParams }> = [];
  const pass = async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), body: init?.body as URLSearchParams });
    return new Response(
      JSON.stringify({
        success: true,
        hostname: "feedback.example.test",
        action: "guest_reply",
      }),
      { status: 200 },
    );
  };
  const production = {
    ...turnstileConfig,
    production: true,
    appOrigin: "https://feedback.example.test",
  };
  await verifyGuestTurnstile(
    production,
    "challenge-token",
    "127.0.0.1",
    pass as typeof fetch,
  );
  assert.equal(seen[0].url, "https://challenges.cloudflare.com/turnstile/v0/siteverify");
  assert.equal(seen[0].body.get("response"), "challenge-token");
  assert.equal(seen[0].body.get("remoteip"), "127.0.0.1");
  await assert.rejects(
    verifyGuestTurnstile(
      production,
      "challenge-token",
      undefined,
      (async () => new Response(JSON.stringify({ success: false }))) as typeof fetch,
    ),
    { code: "VERIFICATION_FAILED" },
  );
  await assert.rejects(
    verifyGuestTurnstile(
      production,
      "challenge-token",
      undefined,
      (async () =>
        new Response(
          JSON.stringify({
            success: true,
            hostname: "other.test",
            action: "guest_reply",
          }),
        )) as typeof fetch,
    ),
    { code: "VERIFICATION_FAILED" },
  );
  await assert.rejects(
    verifyGuestTurnstile(production, "challenge-token", undefined, (async () => {
      throw Error("offline");
    }) as typeof fetch),
    { code: "VERIFICATION_UNAVAILABLE" },
  );
});
