import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Database } from "../src/server/db.js";
import { migrate } from "../src/server/migrations.js";
import { Operations } from "../src/server/operations.js";
import { LocalAssets } from "../src/server/assets.js";
import { createApp } from "../src/server/app.js";

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
      context: { url: "https://other.test/", viewport: { width: 1280, height: 720 } },
      idempotencyKey: "video-thread",
    });
    const webm = Buffer.from(
      "GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAHmEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHWTbuMU6uEElTDZ1OsggEjTbuMU6uEHFO7a1OsggHQ7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsCrXsYMPQkBNgIxMYXZmNjEuNy4xMDBXQYxMYXZmNjEuNy4xMDBEiYhAj0AAAAAAABZUrmvIrgEAAAAAAAA/14EBc8WIb6rqfHTPUF6cgQAitZyDdW5kiIEAhoVWX1ZQOIOBASPjg4Q7msoA4JCwgRC6gRCagQJVsIRVuYEBElTDZ/tzc59jwIBnyJlFo4dFTkNPREVSRIeMTGF2ZjYxLjcuMTAwc3PWY8CLY8WIb6rqfHTPUF5nyKFFo4dFTkNPREVSRIeUTGF2YzYxLjE5LjEwMSBsaWJ2cHhnyKFFo4hEVVJBVElPTkSHkzAwOjAwOjAxLjAwMDAwMDAwMAAfQ7Z1qOeBAKOjgQAAgBACAJ0BKhAAEAAARwiFhYiZhIgCAgAMDWAA/v+rUIAcU7trkbuPs4EAt4r3gQHxggGj8IED",
      "base64",
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
      durationMs: 1000,
      idempotencyKey: "valid-video",
    });
    assert.equal(upload.asset.contentType, "video/webm");
    assert.equal(upload.asset.rendition, "tabVideo");
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
      durationMs: 1000,
      idempotencyKey: "valid-video",
    });
    assert.equal(replay.asset.id, upload.asset.id);
    const token = await ops.executeOperation(owner, "tokens.create", {
      name: "Asset reader",
      projectIds: [other.id],
      scopes: ["assets.get"],
    });
    server = createApp(ops.config, db, store).listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server!.once("listening", resolve));
    const url = `http://127.0.0.1:${(server.address() as any).port}${upload.asset.url}`;
    const denied = await fetch(url);
    assert.equal(denied.status, 401);
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token.token}` },
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") || "", /^video\/webm/);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), webm);
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
