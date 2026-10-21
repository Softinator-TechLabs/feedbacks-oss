import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { Database } from "../src/server/db.js";
import { migrate } from "../src/server/migrations.js";
import { Operations } from "../src/server/operations.js";
import { createApp } from "../src/server/app.js";
import { intakeBudget, intakeInstallation } from "../src/server/public-intake.js";

const config: any = {
  appOrigin: "https://feedback.example.test",
  production: false,
  turnstileSiteKey: "1x00000000000000000000AA",
  turnstileSecretKey: "1x0000000000000000000000000000000AA",
};
test("permanent public intake is opt-in, current-origin scoped, anonymous-only and durable without expiring guest links", async () => {
  const pg = new PGlite(),
    db = new Database(pg as any);
  let server: ReturnType<ReturnType<typeof createApp>["listen"]> | undefined;
  try {
    await migrate(db);
    const ops = new Operations(db, {} as any, config);
    const owner = await ops.auth.bootstrap(
      "owner@example.test",
      "Owner",
      "Correct-Horse-Battery-123",
    );
    const project = await ops.executeOperation(owner, "projects.create", {
      name: "PRIVATE PROJECT NAME",
      origins: ["https://site.example.test"],
    });
    assert.equal(
      (await ops.executeOperation(owner, "intake.settings", { projectId: project.id }))
        .configured,
      false,
    );
    await assert.rejects(
      ops.executeOperation(owner, "intake.save", {
        projectId: project.id,
        revision: 0,
        enabled: true,
        config: { origins: ["https://unapproved.example.test"] },
      }),
      { code: "VALIDATION" },
    );
    const setting = await ops.executeOperation(owner, "intake.save", {
      projectId: project.id,
      revision: 0,
      enabled: true,
      config: {
        origins: ["https://site.example.test"],
        collectContact: true,
        dailyLimit: 100,
      },
    });
    assert.match(setting.snippet, /data-intake=/);
    assert.ok(!setting.snippet.includes("data-token"));
    assert.ok(!JSON.stringify(setting).includes("expires"));
    await assert.rejects(
      ops.executeOperation(owner, "intake.save", {
        projectId: project.id,
        revision: 0,
        enabled: false,
        config: setting.config,
      }),
      { code: "CONFLICT" },
    );
    const invite = await ops.executeOperation(owner, "members.invite", {
      email: "reviewer@example.test",
      projectId: project.id,
      role: "reviewer",
    });
    await ops.auth.acceptInvite(invite.token, "Reviewer", "Correct-Horse-Battery-123");
    const viewer = (
      await ops.auth.login("reviewer@example.test", "Correct-Horse-Battery-123")
    ).actor;
    await assert.rejects(
      ops.executeOperation(viewer, "intake.settings", { projectId: project.id }),
      { code: "FORBIDDEN" },
    );
    server = createApp(config, db, {} as any).listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server!.once("listening", resolve));
    const service = `http://127.0.0.1:${(server.address() as any).port}`;
    const originalFetch = globalThis.fetch;
    const call = (
      operation: string,
      input: unknown,
      origin = "https://site.example.test",
    ) =>
      originalFetch(`${service}/api/intake.${operation}?intakeId=${setting.id}`, {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
    const inspect = await call("inspect", { intakeId: setting.id });
    assert.equal(inspect.status, 200);
    assert.equal(
      inspect.headers.get("Access-Control-Allow-Origin"),
      "https://site.example.test",
    );
    const details = (await inspect.json()).data;
    for (const forbidden of [project.id, project.name, "thread", "member"])
      assert.ok(!JSON.stringify(details).includes(forbidden));
    assert.equal(
      (await call("inspect", { intakeId: setting.id }, "https://other.example.test"))
        .status,
      403,
    );
    assert.equal(
      (
        await originalFetch(`${service}/api/intake.inspect?intakeId=${setting.id}`, {
          method: "OPTIONS",
          headers: { Origin: "https://site.example.test" },
        })
      ).status,
      204,
    );
    globalThis.fetch = ((url: any, init: any) =>
      String(url).includes("challenges.cloudflare.com/turnstile")
        ? Promise.resolve(new Response(JSON.stringify({ success: true })))
        : originalFetch(url, init)) as typeof fetch;
    try {
      const submission = {
        intakeId: setting.id,
        requestId: randomUUID(),
        name: "",
        body: "Untrusted <script> text",
        url: "https://site.example.test/path?token=private#private",
        viewport: { width: 390, height: 844 },
        element: { tag: "button", x: 0.5, y: 0.2 },
        contact: { email: "visitor@example.test", consent: true },
        turnstileToken: "synthetic",
      };
      assert.equal(
        (await call("submit", { ...submission, screenshot: "private-image" })).status,
        400,
      );
      assert.equal(
        (
          await call("submit", {
            ...submission,
            element: { ...submission.element, text: "PRIVATE DOM" },
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await call("submit", {
            ...submission,
            contact: { email: "visitor@example.test", consent: false },
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await call("submit", {
            ...submission,
            url: "https://other.example.test/private",
          })
        ).status,
        403,
      );
      const sent = await call("submit", submission);
      assert.equal(sent.status, 200);
      assert.deepEqual((await sent.json()).data, { posted: true });
      assert.equal((await call("submit", submission)).status, 200);
      assert.equal(
        (await call("submit", { ...submission, body: "Changed retry" })).status,
        409,
      );
      const rows = await db.query("SELECT data FROM threads WHERE project_id=$1", [
        project.id,
      ]);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].data.context.source, "public_intake");
      assert.equal(rows[0].data.context.url, "https://site.example.test/path");
      assert.equal(rows[0].data.context.intake.kind, "element");
      assert.equal(rows[0].data.context.intake.contact.email, "visitor@example.test");
      assert.equal(rows[0].data.author.name, "Website visitor");
      assert.equal(
        (
          await db.one("SELECT count(*)::integer AS n FROM assets WHERE project_id=$1", [
            project.id,
          ])
        ).n,
        0,
      );
      const storedBudgets = JSON.stringify(
        await db.query("SELECT key FROM public_intake_budgets"),
      );
      assert.ok(!storedBudgets.includes("127.0.0.1"));
      assert.ok(!storedBudgets.includes("visitor@example.test"));
      // Current project origin removal immediately withdraws the public grant.
      await db.query(
        "UPDATE projects SET data=jsonb_set(data,'{origins}','[]') WHERE id=$1",
        [project.id],
      );
      assert.equal((await call("inspect", { intakeId: setting.id })).status, 403);
      await db.query(
        "UPDATE projects SET data=jsonb_set(data,'{origins}',$2::jsonb) WHERE id=$1",
        [project.id, JSON.stringify(["https://site.example.test"])],
      );
      await ops.executeOperation(owner, "intake.save", {
        projectId: project.id,
        revision: setting.revision,
        enabled: false,
        config: setting.config,
      });
      assert.equal((await call("inspect", { intakeId: setting.id })).status, 410);
      assert.equal(
        (
          await db.one("SELECT count(*)::integer AS n FROM threads WHERE project_id=$1", [
            project.id,
          ])
        ).n,
        1,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
    const row = await db.one("SELECT * FROM public_intake WHERE id=$1", [setting.id]);
    row.data.dailyLimit = 1;
    await intakeBudget(
      db,
      config,
      row,
      "198.51.100.23",
      "submit",
      Date.parse("2026-10-22T00:00:00Z"),
    );
    const counterCount = (
      await db.one("SELECT count(*)::integer AS n FROM public_intake_budgets")
    ).n;
    await assert.rejects(
      intakeBudget(
        db,
        config,
        row,
        "198.51.100.24",
        "submit",
        Date.parse("2026-10-22T00:00:01Z"),
      ),
      { code: "RATE_LIMITED" },
    );
    assert.equal(
      (await db.one("SELECT count(*)::integer AS n FROM public_intake_budgets")).n,
      counterCount,
      "exhausted installation budget must reject rotating addresses before allocating new IP counters",
    );
    await assert.rejects(
      intakeInstallation(
        db,
        "------------------------------------",
        "https://site.example.test",
      ),
      { code: "INVALID_INTAKE" },
    );
  } finally {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    await pg.close();
  }
});
