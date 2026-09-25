import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import sharp from "sharp";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { Database } from "../src/server/db.js";
import { migrate } from "../src/server/migrations.js";
import { Operations } from "../src/server/operations.js";
import { LocalAssets } from "../src/server/assets.js";
import { createApp } from "../src/server/app.js";

test("paired native device creates scoped feedback and uploads an explicitly approved screenshot", async () => {
  const pg = new PGlite();
  const dir = await mkdtemp(path.join(tmpdir(), "feedbacks-mobile-"));
  let server: ReturnType<ReturnType<typeof createApp>["listen"]> | undefined;
  try {
    const db = new Database(pg as any);
    await migrate(db);
    const config: any = {
      appOrigin: "http://127.0.0.1:3000",
      production: false,
      organizationId: "00000000-0000-4000-8000-000000000001",
      assetDriver: "local",
    };
    const store = new LocalAssets(dir);
    const ops = new Operations(db, store, config);
    const owner = await ops.auth.bootstrap(
      "owner@example.test",
      "Owner",
      "Correct-Horse-Battery-123",
    );
    const project = await ops.executeOperation(owner, "projects.create", {
      name: "Native app review",
      origins: ["https://app.example.test"],
    });
    server = createApp(config, db, store).listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server!.once("listening", resolve));
    const base = `http://127.0.0.1:${(server.address() as any).port}`;
    const post = async (operation: string, body: object, token?: string) => {
      const response = await fetch(`${base}/api/${operation}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });
      return { status: response.status, result: await response.json() };
    };
    const requested = await post("pairing.request", { name: "Android QA" });
    assert.equal(requested.status, 200);
    const pairing = requested.result.data;
    const pending = await post("pairing.poll", {
      pairingId: pairing.pairingId,
      deviceSecret: pairing.deviceSecret,
    });
    assert.equal(pending.result.data.status, "pending");
    await ops.executeOperation(owner, "pairing.approve", {
      pairingId: pairing.pairingId,
    });
    const approved = await post("pairing.poll", {
      pairingId: pairing.pairingId,
      deviceSecret: pairing.deviceSecret,
    });
    assert.equal(approved.result.data.status, "approved");
    const token = approved.result.data.token as string;
    assert.equal(approved.result.data.kind, "extension");
    const projects = await post("projects.list", {}, token);
    assert.equal(projects.result.data.items[0].id, project.id);
    assert.equal(projects.result.data.items[0].permissions.canWrite, true);
    const denied = await post(
      "threads.create",
      {
        projectId: project.id,
        body: "Wrong app origin",
        context: {
          url: "https://outside.example.test/cart",
          viewport: { width: 390, height: 844 },
        },
        idempotencyKey: "mobile-origin-denied",
      },
      token,
    );
    assert.equal(denied.status, 403);
    assert.equal(denied.result.error.code, "ORIGIN_NOT_ALLOWED");
    const creation = {
      projectId: project.id,
      body: "Cart button is hard to find",
      context: {
        url: "https://app.example.test/cart?session=secret#private",
        title: "Cart",
        viewport: { width: 390, height: 844 },
        devicePixelRatio: 3,
      },
      idempotencyKey: "mobile-create-123",
    };
    const created = await post("threads.create", creation, token);
    assert.equal(created.status, 200);
    assert.equal(created.result.data.context.url, "https://app.example.test/cart");
    assert.equal(
      (await post("threads.create", creation, token)).result.data.id,
      created.result.data.id,
    );
    const png = await sharp({
      create: { width: 8, height: 8, channels: 4, background: "#ffffff" },
    })
      .png()
      .toBuffer();
    const upload = {
      threadId: created.result.data.id,
      revision: created.result.data.revision,
      imageBase64: png.toString("base64"),
      rendition: "screenshot",
      idempotencyKey: "mobile-upload-123",
    };
    const uploaded = await post("assets.upload", upload, token);
    assert.equal(uploaded.status, 200);
    assert.equal(uploaded.result.data.asset.rendition, "screenshot");
    assert.equal(uploaded.result.data.thread.revision, created.result.data.revision + 1);
    assert.equal(
      (await post("assets.upload", upload, token)).result.data.asset.id,
      uploaded.result.data.asset.id,
    );
    const read = await post("threads.get", { threadId: created.result.data.id }, token);
    assert.equal(read.result.data.assets.length, 1);
    await ops.executeOperation(owner, "tokens.revoke", {
      tokenId: approved.result.data.id,
    });
    assert.equal(
      (await post("threads.get", { threadId: created.result.data.id }, token)).status,
      401,
    );
  } finally {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    await pg.close();
    await rm(dir, { recursive: true, force: true });
  }
});
