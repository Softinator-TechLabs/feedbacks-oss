import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { PGlite } from "@electric-sql/pglite";
import { Database } from "../src/server/db.js";
import { migrate } from "../src/server/migrations.js";
import { Operations } from "../src/server/operations.js";
import { LocalAssets } from "../src/server/assets.js";
import { inputSchemas } from "../src/shared/contracts.js";
import { appCaptureSchema } from "../src/shared/app-capture.js";

const capture = {
  appName: "Synthetic desktop app",
  platform: "windows",
  method: "image_import",
  width: 640,
  height: 400,
  points: [{ id: randomUUID(), body: "Move this button", x: 0.4, y: 0.6 }],
};

test("app capture rejects mixed browser evidence, invalid geometry and fabricated extra fields", () => {
  const base = {
    projectId: randomUUID(),
    body: "Fix Save",
    appCapture: capture,
    idempotencyKey: "native-contract",
  };
  assert.equal(inputSchemas["threads.create"].safeParse(base).success, true);
  for (const addition of [
    { pageUrl: "https://example.test" },
    { context: { url: "https://example.test", viewport: { width: 1000, height: 800 } } },
    { document: { documentId: randomUUID(), page: 1, x: 0.5, y: 0.5 } },
    {
      diagnostics: {
        approved: true,
        source: "browser_opt_in",
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        console: [],
        network: [],
      },
    },
  ])
    assert.equal(
      inputSchemas["threads.create"].safeParse({ ...base, ...addition }).success,
      false,
    );
  for (const invalid of [
    { ...capture, appName: " " },
    { ...capture, width: 12000, height: 12000 },
    { ...capture, url: "https://fake.test" },
    { ...capture, platform: "invented" },
    { ...capture, points: [capture.points[0], capture.points[0]] },
    { ...capture, points: [{ ...capture.points[0], x: 1.01 }] },
  ])
    assert.equal(appCaptureSchema.safeParse(invalid).success, false);
});

test("native feedback preserves provenance, private images, project grants and idempotent recovery", async () => {
  const pg = new PGlite(),
    dir = await mkdtemp(join(tmpdir(), "feedbacks-app-capture-"));
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
    const call = (operation: string, input: any) =>
      ops.executeOperation(owner, operation, input);
    const project = await call("projects.create", {
      name: "Desktop review",
      origins: ["https://approved.example.test"],
    });
    const other = await call("projects.create", {
      name: "Unrelated project",
      origins: ["https://other.test"],
    });
    const input = {
      projectId: project.id,
      body: "Save does not work",
      appCapture: capture,
      idempotencyKey: "native-thread-key",
    };
    const thread = await call("threads.create", input);
    assert.equal(thread.context.source, "app_capture");
    assert.equal(thread.context.appCapture.trust, "reviewer_supplied");
    assert.equal(thread.context.appCapture.appName, capture.appName);
    assert.equal(thread.context.annotations[0].id, capture.points[0].id);
    assert.equal(thread.context.annotations[0].anchor.confidence, "coordinate-only");
    assert.equal(thread.context.url, undefined);
    assert.equal(thread.context.origin, undefined);
    assert.equal(thread.context.viewport, undefined);
    assert.equal((await call("threads.create", input)).id, thread.id);
    await assert.rejects(
      call("threads.create", {
        ...input,
        appCapture: { ...capture, appName: "Changed" },
      }),
      { code: "IDEMPOTENCY_CONFLICT" },
    );
    await assert.rejects(
      call("threads.create", {
        ...input,
        appCapture: undefined,
        context: {
          url: "https://unapproved.test",
          viewport: { width: 1000, height: 800 },
        },
        idempotencyKey: "website-still-restricted",
      }),
      { code: "ORIGIN_NOT_ALLOWED" },
    );
    const image = await sharp({
      create: { width: 640, height: 400, channels: 3, background: "#17324d" },
    })
      .png()
      .toBuffer();
    const upload = {
      threadId: thread.id,
      revision: thread.revision,
      rendition: "screenshot",
      filename: "app-capture.webp",
      imageBase64: image.toString("base64"),
      idempotencyKey: "native-image-key",
    };
    const sent = await call("assets.upload", upload);
    assert.equal((await call("assets.upload", upload)).asset.id, sent.asset.id);
    assert.equal((await call("threads.get", { threadId: thread.id })).assets.length, 1);
    const token = await ops.auth.issueToken(
      db,
      owner,
      {
        name: "Other project",
        projectIds: [other.id],
        scopes: ["threads.create", "threads.get", "assets.get"],
        expiresInDays: 1,
      },
      "agent",
    );
    const outsider = await ops.auth.authenticate(token.token);
    for (const [op, value] of [
      ["threads.get", { threadId: thread.id }],
      ["assets.get", { assetId: sent.asset.id }],
      ["threads.create", { ...input, idempotencyKey: "denied-native" }],
    ] as const)
      await assert.rejects(ops.executeOperation(outsider, op, value), {
        code: "FORBIDDEN",
      });
    await assert.rejects(
      call("recordings.upload", {
        threadId: thread.id,
        revision: sent.thread.revision,
        idempotencyKey: "no-browser-on-native",
        recording: {
          schemaVersion: 1,
          id: randomUUID(),
          startedAt: new Date().toISOString(),
          durationMs: 10,
          mode: "session",
          url: "https://approved.example.test",
          environment: {},
          privacy: { maskText: false, maskInputs: false, networkBodies: false },
          coverage: [],
          events: [],
        },
      }),
      /Recording origin must match/,
    );
  } finally {
    await pg.close();
    await rm(dir, { recursive: true, force: true });
  }
});
