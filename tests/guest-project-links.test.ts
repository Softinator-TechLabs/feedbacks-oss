import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { Database } from "../src/server/db.js";
import { migrate } from "../src/server/migrations.js";
import { Operations } from "../src/server/operations.js";
import {
  guestProjectInspect,
  guestProjectSubmit,
} from "../src/server/guest-project-links.js";
import { accountLock } from "../src/server/auth.js";
import { verifyGuestTurnstile } from "../src/server/turnstile.js";
import { createApp } from "../src/server/app.js";

const config: any = {
  appOrigin: "http://127.0.0.1:3000",
  production: false,
  turnstileSiteKey: "1x00000000000000000000AA",
  turnstileSecretKey: "1x0000000000000000000000000000000AA",
};

test("a maintainer issues a bounded project guest submission link", async () => {
  const pg = new PGlite();
  let server: ReturnType<ReturnType<typeof createApp>["listen"]> | undefined;
  try {
    const db = new Database(pg as any);
    await migrate(db);
    const ops = new Operations(db, {} as any, config);
    const owner = await ops.auth.bootstrap(
      "owner@example.test",
      "Owner",
      "Correct-Horse-Battery-123",
    );
    const project = await ops.executeOperation(owner, "projects.create", {
      name: "Review",
      origins: ["https://example.test"],
    });
    const existing = await ops.executeOperation(owner, "threads.create", {
      projectId: project.id,
      body: "Private existing feedback",
      context: { url: "https://example.test/", viewport: { width: 1000, height: 800 } },
      idempotencyKey: "private-existing",
    });
    await ops.executeOperation(owner, "members.notes.save", {
      userId: owner.userId,
      body: "Private member note",
      revision: 0,
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
      ops.executeOperation(reviewer, "guestProjectLinks.create", {
        projectId: project.id,
        label: "Not allowed",
      }),
      { code: "FORBIDDEN" },
    );
    const link = await ops.executeOperation(owner, "guestProjectLinks.create", {
      projectId: project.id,
      label: "Client intake",
      expiresInDays: 7,
      maxSubmissions: 2,
    });
    assert.match(link.path, /^\/guest-project#token=/);
    assert.equal(link.token.length > 20, true);
    const preview = await guestProjectInspect(db, link.token, config);
    assert.deepEqual(Object.keys(preview).sort(), [
      "expiresAt",
      "projectName",
      "turnstileSiteKey",
    ]);
    assert.equal(preview.projectName, "Review");
    assert.ok(!JSON.stringify(preview).includes("Private existing feedback"));
    assert.ok(!JSON.stringify(preview).includes("Private member note"));
    assert.ok(!JSON.stringify(preview).includes(existing.id));
    server = createApp(config, db, {} as any).listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server!.once("listening", resolve));
    const endpoint = `http://127.0.0.1:${(server.address() as any).port}/api/guestProject.inspect`;
    const publicInput = {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: config.appOrigin },
      body: JSON.stringify({ token: link.token }),
    };
    const opened = await fetch(endpoint, publicInput);
    assert.equal(opened.status, 200);
    assert.deepEqual((await opened.json()).data, preview);
    const badOrigin = await fetch(endpoint, {
      ...publicInput,
      headers: { ...publicInput.headers, Origin: "https://other.test" },
    });
    assert.equal(badOrigin.status, 403);

    const httpLink = await ops.executeOperation(owner, "guestProjectLinks.create", {
      projectId: project.id,
      label: "Public form",
      maxSubmissions: 1,
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((url: Parameters<typeof fetch>[0], init?: RequestInit) =>
      String(url).includes("challenges.cloudflare.com/turnstile")
        ? Promise.resolve(new Response(JSON.stringify({ success: true })))
        : originalFetch(url, init)) as typeof fetch;
    try {
      const posted = await originalFetch(
        endpoint.replace("guestProject.inspect", "guestProject.submit"),
        {
          method: "POST",
          headers: publicInput.headers,
          body: JSON.stringify({
            token: httpLink.token,
            name: "Public visitor",
            url: "https://example.test/public",
            body: "Public form report",
            turnstileToken: "synthetic-challenge",
          }),
        },
      );
      assert.equal(posted.status, 200);
      assert.deepEqual((await posted.json()).data, { posted: true });
    } finally {
      globalThis.fetch = originalFetch;
    }
    await assert.rejects(guestProjectInspect(db, httpLink.token, config), {
      code: "INVALID_LINK",
    });

    const submit = (url: string, body: string) =>
      db.transaction(async (tx) => {
        await accountLock(tx);
        return guestProjectSubmit(tx, { token: link.token, name: "Client", body, url });
      });
    await assert.rejects(submit("https://other.test/", "Wrong origin"), {
      code: "ORIGIN_NOT_ALLOWED",
    });
    assert.deepEqual(await submit("https://example.test/page", "First report"), {
      posted: true,
    });
    assert.deepEqual(await submit("https://example.test/page", "Second report"), {
      posted: true,
    });
    await assert.rejects(submit("https://example.test/page", "Third report"), {
      code: "INVALID_LINK",
    });
    const rows = await db.query(
      "SELECT data FROM threads WHERE project_id=$1 ORDER BY created_at",
      [project.id],
    );
    assert.equal(rows.length, 4);
    assert.ok(
      rows.some(
        (row) => row.data.body === "First report" && row.data.author.kind === "guest",
      ),
    );
    assert.ok(
      rows.every((row) => !JSON.stringify(row.data).includes("Private member note")),
    );
    const listed = await ops.executeOperation(owner, "guestProjectLinks.list", {
      projectId: project.id,
    });
    assert.equal(listed.items.find((item: any) => item.id === link.id)?.submissions, 2);
    assert.ok(!JSON.stringify(listed).includes(link.token));

    const revocable = await ops.executeOperation(owner, "guestProjectLinks.create", {
      projectId: project.id,
      label: "Revoke",
      maxSubmissions: 1,
    });
    await ops.executeOperation(owner, "guestProjectLinks.revoke", {
      linkId: revocable.id,
    });
    await assert.rejects(guestProjectInspect(db, revocable.token, config), {
      code: "INVALID_LINK",
    });
    const expiring = await ops.executeOperation(owner, "guestProjectLinks.create", {
      projectId: project.id,
      label: "Expire",
      expiresInDays: 1,
    });
    await db.query(
      "UPDATE guest_project_links SET expires_at=now()-interval '1 second' WHERE id=$1",
      [expiring.id],
    );
    await assert.rejects(guestProjectInspect(db, expiring.token, config), {
      code: "INVALID_LINK",
    });
  } finally {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    await pg.close();
  }
});

test("project guest Turnstile action is checked separately from thread replies", async () => {
  const production = {
    ...config,
    production: true,
    appOrigin: "https://feedback.example.test",
  };
  const answer = (action: string) =>
    (async () =>
      new Response(
        JSON.stringify({
          success: true,
          hostname: "feedback.example.test",
          action,
        }),
      )) as typeof fetch;
  await verifyGuestTurnstile(
    production,
    "challenge-token",
    undefined,
    answer("guest_project_submit"),
    "guest_project_submit",
  );
  await assert.rejects(
    verifyGuestTurnstile(
      production,
      "challenge-token",
      undefined,
      answer("guest_reply"),
      "guest_project_submit",
    ),
    { code: "VERIFICATION_FAILED" },
  );
});
