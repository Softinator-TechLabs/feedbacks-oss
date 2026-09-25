import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { PGlite } from "@electric-sql/pglite";
import { createApp } from "../src/server/app.js";
import { LocalAssets } from "../src/server/assets.js";
import { Database } from "../src/server/db.js";
import { migrate } from "../src/server/migrations.js";
import { Operations } from "../src/server/operations.js";

test("list screenshot previews stay small and use the original asset authorization", async () => {
  const pg = new PGlite();
  const directory = await mkdtemp(path.join(tmpdir(), "feedbacks-list-preview-"));
  let server: ReturnType<ReturnType<typeof createApp>["listen"]> | undefined;
  try {
    const db = new Database(pg as any);
    await migrate(db);
    const store = new LocalAssets(directory);
    const config = {
      appOrigin: "http://localhost:3000",
      production: false,
      organizationId: "00000000-0000-4000-8000-000000000001",
    } as any;
    const ops = new Operations(db, store, config);
    const owner = await ops.auth.bootstrap(
      "owner@example.test",
      "Owner",
      "Correct-Horse-Battery-123",
    );
    const project = await ops.executeOperation(owner, "projects.create", {
      name: "Site",
      origins: ["https://example.test"],
    });
    const thread = await ops.executeOperation(owner, "threads.create", {
      projectId: project.id,
      body: "Screenshot preview",
      context: { url: "https://example.test/", viewport: { width: 1200, height: 800 } },
      idempotencyKey: "preview-thread",
    });
    const image = await sharp({
      create: { width: 1200, height: 800, channels: 3, background: "#234567" },
    })
      .png()
      .toBuffer();
    const upload = await ops.executeOperation(owner, "assets.upload", {
      threadId: thread.id,
      revision: thread.revision,
      imageBase64: image.toString("base64"),
      idempotencyKey: "preview-image",
    });
    server = createApp(config, db, store).listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server!.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const route = `${base}${upload.asset.url}?preview=list`;
    assert.equal((await fetch(route)).status, 401);
    const login = await fetch(`${base}/api/auth.login`, {
      method: "POST",
      headers: { Origin: config.appOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "owner@example.test",
        password: "Correct-Horse-Battery-123",
      }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const result = await fetch(route, { headers: { Cookie: cookie } });
    assert.equal(result.status, 200);
    assert.equal(result.headers.get("content-type"), "image/webp");
    assert.equal(result.headers.get("cache-control"), "no-store");
    const bytes = Buffer.from(await result.arrayBuffer());
    assert.ok(bytes.length < 100_000);
    const metadata = await sharp(bytes).metadata();
    assert.equal(metadata.width, 160);
    assert.equal(metadata.height, 100);
  } finally {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    await pg.close();
    await rm(directory, { recursive: true, force: true });
  }
});
