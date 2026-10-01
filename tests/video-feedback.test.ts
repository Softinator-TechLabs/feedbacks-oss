import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Database } from "../src/server/db.js";
import { migrate } from "../src/server/migrations.js";
import { Operations } from "../src/server/operations.js";
import { LocalAssets, prepareVideoUpload } from "../src/server/assets.js";
import { createApp } from "../src/server/app.js";
import sharp from "sharp";

test("WebM upload accepts grouped frames and still rejects empty or malformed media", async () => {
  const element = (id: string, payload: Buffer) =>
    Buffer.concat([
      Buffer.from(id, "hex"),
      Buffer.from([0x80 | payload.length]),
      payload,
    ]);
  const recording = (frame: Buffer, trackType = 1) =>
    Buffer.concat([
      element("1a45dfa3", element("4282", Buffer.from("webm"))),
      Buffer.from("18538067ff", "hex"),
      element("1654ae6b", element("ae", element("83", Buffer.from([trackType])))),
      element("1f43b675", Buffer.concat([element("e7", Buffer.from([0])), frame])),
    ]);
  const config = {
    production: false,
    organizationId: "00000000-0000-4000-8000-000000000001",
  } as any;
  const prepare = (bytes: Buffer) =>
    prepareVideoUpload(
      {
        threadId: "00000000-0000-4000-8000-000000000002",
        videoBase64: bytes.toString("base64"),
        durationMs: 1000,
      },
      config,
      "00000000-0000-4000-8000-000000000003",
    );
  const frame = Buffer.from([0x81, 0, 0, 0x80, 1, 2, 3]);
  await prepare(recording(element("a3", frame)));
  await prepare(recording(element("a0", element("a1", frame))));
  for (const bytes of [
    recording(element("a0", Buffer.alloc(0))),
    recording(element("a0", element("a1", Buffer.alloc(0)))),
    recording(element("a0", Buffer.from("a1ff00", "hex"))),
    recording(element("a0", element("a1", frame)), 2),
  ])
    await assert.rejects(prepare(bytes), { code: "INVALID_VIDEO" });
});

test("video feedback stays in the authorized project and rejects invalid media", async () => {
  const pg = new PGlite();
  const directory = await mkdtemp(path.join(tmpdir(), "feedbacks-video-"));
  let server: ReturnType<ReturnType<typeof createApp>["listen"]> | undefined;
  try {
    const db = new Database(pg as any);
    await migrate(db);
    const store = new LocalAssets(directory);
    const ops = new Operations(db, store, {
      appOrigin: "http://localhost:3000",
      production: false,
      organizationId: "00000000-0000-4000-8000-000000000001",
    } as any);
    const owner = await ops.auth.bootstrap(
      "owner@example.test",
      "Owner",
      "Correct-Horse-Battery-123",
    );
    const project = await ops.executeOperation(owner, "projects.create", {
      name: "Site",
      origins: ["https://example.test"],
    });
    const other = await ops.executeOperation(owner, "projects.create", {
      name: "Other",
      origins: ["https://other.test"],
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
    const thread = await ops.executeOperation(owner, "threads.create", {
      projectId: other.id,
      body: "Watch the menu transition",
      context: {
        url: "https://other.test/",
        viewport: { width: 1280, height: 720 },
        reproduction: { source: "app", objectId: "demo-42", file: "chapters/demo.tex" },
      },
      idempotencyKey: "video-thread",
    });
    assert.equal(thread.context.reproduction.objectId, "demo-42");
    let webm = Buffer.from(
      "GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAHmEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHWTbuMU6uEElTDZ1OsggEjTbuMU6uEHFO7a1OsggHQ7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsCrXsYMPQkBNgIxMYXZmNjEuNy4xMDBXQYxMYXZmNjEuNy4xMDBEiYhAj0AAAAAAABZUrmvIrgEAAAAAAAA/14EBc8WIb6rqfHTPUF6cgQAitZyDdW5kiIEAhoVWX1ZQOIOBASPjg4Q7msoA4JCwgRC6gRCagQJVsIRVuYEBElTDZ/tzc59jwIBnyJlFo4dFTkNPREVSRIeMTGF2ZjYxLjcuMTAwc3PWY8CLY8WIb6rqfHTPUF5nyKFFo4dFTkNPREVSRIeUTGF2YzYxLjE5LjEwMSBsaWJ2cHhnyKFFo4hEVVJBVElPTkSHkzAwOjAwOjAxLjAwMDAwMDAwMAAfQ7Z1qOeBAKOjgQAAgBACAJ0BKhAAEAAARwiFhYiZhIgCAgAMDWAA/v+rUIAcU7trkbuPs4EAt4r3gQHxggGj8IED",
      "base64",
    );
    // Valid EBML Void padding exercises the previous 8 MiB media and 14 MiB
    // HTTP limits without introducing a binary fixture into the repository.
    const voidSize = Buffer.alloc(4);
    voidSize.writeUInt32BE(0x10000000 | (12 * 1024 * 1024));
    webm = Buffer.concat([
      webm,
      Buffer.from([0xec]),
      voidSize,
      Buffer.alloc(12 * 1024 * 1024),
    ]);
    await assert.rejects(
      ops.executeOperation(owner, "assets.uploadVideo", {
        threadId: thread.id,
        revision: thread.revision,
        videoBase64: "invalid",
        durationMs: 300001,
        idempotencyKey: "over-duration",
      }),
      { code: "VALIDATION" },
    );
    await assert.rejects(
      ops.executeOperation(owner, "assets.uploadVideo", {
        threadId: thread.id,
        revision: thread.revision,
        videoBase64: Buffer.from("not video").toString("base64"),
        durationMs: 1000,
        idempotencyKey: "invalid-video",
      }),
      { code: "INVALID_VIDEO" },
    );
    await assert.rejects(
      ops.executeOperation(owner, "assets.uploadVideo", {
        threadId: thread.id,
        revision: thread.revision,
        videoBase64: Buffer.from(
          "1a45dfa3000000007765626d0000000018538067",
          "hex",
        ).toString("base64"),
        durationMs: 1000,
        idempotencyKey: "forged-video",
      }),
      { code: "INVALID_VIDEO" },
    );
    const pairing = await ops.auth.requestPairing("Browser");
    await ops.executeOperation(owner, "pairing.approve", {
      pairingId: pairing.pairingId,
    });
    const paired = await ops.auth.pollPairing(pairing.pairingId, pairing.deviceSecret);
    assert.equal(paired.status, "approved");
    const uploader = await ops.auth.authenticate(paired.token);
    const upload = await ops.executeOperation(uploader, "assets.uploadVideo", {
      threadId: thread.id,
      revision: thread.revision,
      videoBase64: webm.toString("base64"),
      durationMs: 300000,
      idempotencyKey: "valid-video",
    });
    assert.equal(upload.asset.contentType, "video/webm");
    assert.equal(upload.asset.rendition, "tabVideo");
    const preview = await ops.executeOperation(owner, "assets.get", {
      assetId: upload.asset.id,
      includeImage: true,
    });
    assert.ok(preview.image, JSON.stringify(preview.videoPreview));
    assert.equal(preview.videoPreview.state, "sampled");
    assert.equal(preview.videoPreview.playbackVerified, false);
    assert.ok(preview.videoPreview.frames.length > 0);
    // Uploaded duration is an untrusted hint: this synthetic video is only 1 s.
    assert.ok(preview.videoPreview.frames.every((f: any) => f.videoTimeMs < 1100));
    await assert.rejects(
      ops.executeOperation(reviewer, "assets.get", {
        assetId: upload.asset.id,
        includeImage: true,
      }),
      { code: "FORBIDDEN" },
    );
    assert.deepEqual(
      await store.get(
        (await db.one("SELECT object_key FROM assets WHERE id=$1", [upload.asset.id]))
          .object_key,
      ),
      webm,
    );
    const replay = await ops.executeOperation(uploader, "assets.uploadVideo", {
      threadId: thread.id,
      revision: thread.revision,
      videoBase64: webm.toString("base64"),
      durationMs: 300000,
      idempotencyKey: "valid-video",
    });
    assert.equal(replay.asset.id, upload.asset.id);
    const token = await ops.executeOperation(owner, "tokens.create", {
      name: "Asset reader",
      projectIds: [other.id],
      scopes: ["assets.get"],
    });
    let storageReads = 0;
    const readObject = store.get.bind(store);
    store.get = async (key) => {
      storageReads++;
      return readObject(key);
    };
    server = createApp(ops.config, db, store).listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server!.once("listening", resolve));
    const origin = `http://127.0.0.1:${(server.address() as any).port}`;
    const uploadedOverHttp = await fetch(`${origin}/api/assets.uploadVideo`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${paired.token}`,
      },
      body: JSON.stringify({
        threadId: thread.id,
        revision: thread.revision,
        videoBase64: webm.toString("base64"),
        durationMs: 300000,
        idempotencyKey: "valid-video",
      }),
    });
    assert.equal(uploadedOverHttp.status, 200, await uploadedOverHttp.text());
    const url = `${origin}${upload.asset.url}`;
    const previewResponse = await fetch(`${url}?preview=agent`, {
      headers: { Authorization: `Bearer ${token.token}` },
    });
    assert.equal(previewResponse.status, 200);
    assert.match(previewResponse.headers.get("content-type") || "", /^image\/webp/);
    assert.equal(previewResponse.headers.get("cache-control"), "private, no-store");
    assert.ok((await previewResponse.arrayBuffer()).byteLength > 0);
    const beforePreviewDenial = storageReads;
    assert.equal((await fetch(`${url}?preview=agent`)).status, 401);
    assert.equal(storageReads, beforePreviewDenial);
    const denied = await fetch(url);
    assert.equal(denied.status, 401);
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token.token}` },
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") || "", /^video\/webm/);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), webm);
    assert.equal(response.headers.get("accept-ranges"), "bytes");
    const head = await fetch(url, {
      method: "HEAD",
      headers: { Authorization: `Bearer ${token.token}`, Range: "bytes=0-15" },
    });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get("content-length"), String(webm.length));
    assert.equal((await head.arrayBuffer()).byteLength, 0);
    const changed = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token.token}`,
        Range: "bytes=0-15",
        "If-Range": '"different-representation"',
      },
    });
    assert.equal(changed.status, 200);
    assert.deepEqual(Buffer.from(await changed.arrayBuffer()), webm);
    for (const [range, from, to] of [
      ["bytes=0-15", 0, 15],
      [`bytes=${webm.length - 16}-`, webm.length - 16, webm.length - 1],
      ["bytes=-16", webm.length - 16, webm.length - 1],
      [
        `bytes=${webm.length - 16}-${webm.length + 20}`,
        webm.length - 16,
        webm.length - 1,
      ],
    ] as const) {
      const partial = await fetch(url, {
        headers: { Authorization: `Bearer ${token.token}`, Range: range },
      });
      assert.equal(partial.status, 206);
      assert.equal(
        partial.headers.get("content-range"),
        `bytes ${from}-${to}/${webm.length}`,
      );
      assert.equal(partial.headers.get("content-length"), String(to - from + 1));
      assert.equal(partial.headers.get("accept-ranges"), "bytes");
      assert.match(partial.headers.get("content-type") || "", /^video\/webm/);
      assert.deepEqual(
        Buffer.from(await partial.arrayBuffer()),
        webm.subarray(from, to + 1),
      );
    }
    for (const range of [
      `bytes=${webm.length}-`,
      "bytes=10-5",
      "bytes=-0",
      "bytes=-",
      "bytes=garbage-5",
      "bytes=0-1,4-5",
      "items=0-1",
      "bytes=9007199254740993-",
    ]) {
      const invalid = await fetch(url, {
        headers: { Authorization: `Bearer ${token.token}`, Range: range },
      });
      assert.equal(invalid.status, 416, range);
      assert.equal(invalid.headers.get("content-range"), `bytes */${webm.length}`);
      assert.equal((await invalid.arrayBuffer()).byteLength, 0);
    }
    const wrongProject = await ops.executeOperation(owner, "tokens.create", {
      name: "Other project reader",
      projectIds: [project.id],
      scopes: ["assets.get"],
    });
    const noAssets = await ops.executeOperation(owner, "tokens.create", {
      name: "Thread-only reader",
      projectIds: [other.id],
      scopes: ["threads.get"],
    });
    const beforeDenied = storageReads;
    for (const deniedKey of [wrongProject.token, noAssets.token]) {
      assert.equal(
        (
          await fetch(`${url}?preview=agent`, {
            headers: { Authorization: `Bearer ${deniedKey}` },
          })
        ).status,
        403,
      );
    }
    assert.equal(
      storageReads,
      beforeDenied,
      "denied previews never read private storage",
    );
    assert.equal((await fetch(url, { headers: { Range: "bytes=0-15" } })).status, 401);
    assert.equal(
      (
        await fetch(url, {
          headers: { Authorization: `Bearer ${wrongProject.token}`, Range: "bytes=0-15" },
        })
      ).status,
      403,
    );
    assert.equal(storageReads, beforeDenied, "denied ranges never read private storage");
    const image = await ops.executeOperation(owner, "assets.upload", {
      threadId: thread.id,
      revision: upload.thread.revision,
      imageBase64: (
        await sharp({ create: { width: 2, height: 2, channels: 3, background: "blue" } })
          .png()
          .toBuffer()
      ).toString("base64"),
      idempotencyKey: "ordinary-image-range",
    });
    const fullImage = await fetch(`${origin}${image.asset.url}`, {
      headers: { Authorization: `Bearer ${token.token}`, Range: "bytes=0-1" },
    });
    assert.equal(fullImage.status, 200, "image responses preserve full-byte behavior");
    assert.equal(fullImage.headers.get("content-range"), null);
    assert.equal((await fullImage.arrayBuffer()).byteLength, image.asset.bytes);
    const expiring = await ops.executeOperation(owner, "tokens.create", {
      name: "Revoked while decoding",
      projectIds: [other.id],
      scopes: ["assets.get"],
    });
    const expiringActor = await ops.auth.authenticate(expiring.token);
    const originalGet = store.get.bind(store);
    store.get = async (key) => {
      await ops.executeOperation(owner, "tokens.revoke", { tokenId: expiring.id });
      return originalGet(key);
    };
    try {
      await assert.rejects(
        ops.executeOperation(expiringActor, "assets.get", {
          assetId: upload.asset.id,
          includeImage: true,
        }),
        { code: "UNAUTHENTICATED" },
      );
    } finally {
      store.get = originalGet;
    }
    await assert.rejects(
      ops.executeOperation(reviewer, "assets.get", { assetId: upload.asset.id }),
      { code: "FORBIDDEN" },
    );
  } finally {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    await pg.close();
    await rm(directory, { recursive: true, force: true });
  }
});
