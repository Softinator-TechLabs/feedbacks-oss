import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { Database } from "../src/server/db.js";
import { migrate } from "../src/server/migrations.js";
import { Operations } from "../src/server/operations.js";
import { guestProjectInspect } from "../src/server/guest-project-links.js";
import { createApp } from "../src/server/app.js";
import { readFileSync } from "node:fs";
import { verifyGuestTurnstile } from "../src/server/turnstile.js";

const config: any = {
  appOrigin: "https://feedback.example.test",
  production: false,
  turnstileSiteKey: "1x00000000000000000000AA",
  turnstileSecretKey: "1x0000000000000000000000000000000AA",
};

test("widget links are opt-in, origin-scoped, bounded and separate from guest pages", async () => {
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
      name: "Website",
      origins: ["https://site.example.test"],
    });
    const widget = await ops.executeOperation(owner, "guestProjectLinks.create", {
      projectId: project.id,
      label: "Website launcher",
      widget: true,
      maxSubmissions: 2,
    });
    assert.match(widget.widgetSnippet, /widget\.js/);
    assert.match(widget.widgetSnippet, /data-link=/);
    assert.match(widget.widgetSnippet, /data-token=/);
    await assert.rejects(guestProjectInspect(db, widget.token, config), {
      code: "INVALID_LINK",
    });
    const row = await db.one(
      "SELECT widget_enabled FROM guest_project_links WHERE id=$1",
      [widget.id],
    );
    assert.equal(row.widget_enabled, true);
    const objects = new Map<string, Buffer>();
    const store = {
      put: async (key: string, bytes: Buffer) => {
        objects.set(key, bytes);
      },
      get: async (key: string) => objects.get(key)!,
      remove: async (key: string) => {
        objects.delete(key);
      },
    };
    server = createApp(config, db, store).listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server!.once("listening", resolve));
    const endpoint = `http://127.0.0.1:${(server.address() as any).port}/api/widget.inspect?linkId=${widget.id}`;
    const inspect = (origin: string) =>
      fetch(endpoint, {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: JSON.stringify({ linkId: widget.id, token: widget.token }),
      });
    const allowed = await inspect("https://site.example.test");
    assert.equal(allowed.status, 200);
    assert.equal(
      allowed.headers.get("Access-Control-Allow-Origin"),
      "https://site.example.test",
    );
    assert.deepEqual(Object.keys((await allowed.json()).data).sort(), [
      "projectName",
      "turnstileSiteKey",
    ]);
    assert.equal((await inspect("https://other.example.test")).status, 403);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((url: Parameters<typeof fetch>[0], init?: RequestInit) =>
      String(url).includes("challenges.cloudflare.com/turnstile")
        ? Promise.resolve(new Response(JSON.stringify({ success: true })))
        : originalFetch(url, init)) as typeof fetch;
    try {
      const submit = (url: string, screenshot?: string) =>
        originalFetch(endpoint.replace("widget.inspect", "widget.submit"), {
          method: "POST",
          headers: {
            Origin: "https://site.example.test",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            linkId: widget.id,
            token: widget.token,
            name: "Visitor",
            body: "A clear report",
            url,
            viewport: { width: 390, height: 844 },
            turnstileToken: "test-challenge",
            screenshot,
          }),
        });
      assert.equal((await submit("https://other.example.test/page")).status, 403);
      assert.equal((await submit("https://site.example.test/page")).status, 200);
      assert.equal(
        (await submit("https://site.example.test/page", "data:image/png;base64,Zm9v"))
          .status,
        200,
      );
      assert.equal((await submit("https://site.example.test/page")).status, 410);
      const threads = await db.query("SELECT data FROM threads WHERE project_id=$1", [
        project.id,
      ]);
      assert.equal(threads.length, 2);
      assert.ok(
        threads.every(
          (thread) =>
            thread.data.context.source === "widget" &&
            thread.data.context.viewport.width === 390,
        ),
      );
      const assets = await db.query(
        "SELECT data,object_key FROM assets WHERE project_id=$1",
        [project.id],
      );
      assert.equal(assets.length, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  } finally {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    await pg.close();
  }
});

test("host widget never captures another tab and public preflights have an ingress budget", async () => {
  const script = readFileSync(new URL("../public/widget.js", import.meta.url), "utf8");
  assert.doesNotMatch(script, /getDisplayMedia|toDataURL|screenshot:\s/);
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
      name: "Website",
      origins: ["https://site.example.test"],
    });
    const widget = await ops.executeOperation(owner, "guestProjectLinks.create", {
      projectId: project.id,
      label: "Website launcher",
      widget: true,
    });
    server = createApp(config, db, {} as any).listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server!.once("listening", resolve));
    const endpoint = `http://127.0.0.1:${(server.address() as any).port}/api/widget.inspect?linkId=${widget.id}`;
    let limited = false;
    for (let i = 0; i < 121; i++) {
      const response = await fetch(endpoint, {
        method: "OPTIONS",
        headers: { Origin: "https://site.example.test" },
      });
      if (response.status === 429) {
        limited = true;
        break;
      }
      assert.equal(response.status, 204);
    }
    assert.equal(limited, true);
  } finally {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    await pg.close();
  }
});

test("widget Turnstile verification binds action and approved website hostname", async () => {
  const production = { ...config, production: true };
  const answer = (hostname: string, action: string) =>
    (async () =>
      new Response(JSON.stringify({ success: true, hostname, action }))) as typeof fetch;
  await verifyGuestTurnstile(
    production,
    "synthetic-challenge",
    undefined,
    answer("site.example.test", "widget_submit"),
    "widget_submit",
    "site.example.test",
  );
  await assert.rejects(
    verifyGuestTurnstile(
      production,
      "synthetic-challenge",
      undefined,
      answer("other.example.test", "widget_submit"),
      "widget_submit",
      "site.example.test",
    ),
    { code: "VERIFICATION_FAILED" },
  );
  await assert.rejects(
    verifyGuestTurnstile(
      production,
      "synthetic-challenge",
      undefined,
      answer("site.example.test", "guest_project_submit"),
      "widget_submit",
      "site.example.test",
    ),
    { code: "VERIFICATION_FAILED" },
  );
});
