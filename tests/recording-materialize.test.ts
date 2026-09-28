import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { materializeRecording } from "../src/cli/recording-materialize.js";

const id = "11111111-1111-4111-8111-111111111111";
const assetId = "22222222-2222-4222-8222-222222222222";
function snapshot(video = false): any {
  return {
    recording: {
      schemaVersion: 1,
      id,
      startedAt: "2026-09-28T00:00:00Z",
      durationMs: 100,
      mode: video ? "video" : "session",
      url: "https://example.test/checkout",
      environment: { browser: "Chrome" },
      privacy: { maskText: false, maskInputs: true, networkBodies: false },
      coverage: [
        { channel: "replay", status: "partial", detail: "External images omitted" },
      ],
      events: [
        {
          seq: 0,
          atMs: 0,
          type: "replay",
          data: { type: 2, timestamp: 1790553600000, data: {} },
        },
        {
          seq: 1,
          atMs: 10,
          type: "console",
          data: { level: "error", args: ["Checkout failed"] },
        },
        {
          seq: 2,
          atMs: 20,
          type: "network",
          data: {
            requestId: "req-1",
            phase: "request",
            method: "POST",
            url: "https://example.test/api/checkout?token=private",
            requestHeaders: { Authorization: "private" },
          },
        },
        {
          seq: 3,
          atMs: 80,
          type: "network",
          data: {
            requestId: "req-1",
            phase: "response",
            status: 500,
            durationMs: 60,
            responseBody: "failure",
          },
        },
      ],
      ...(video ? { video: { assetId, offsetMs: 0 } } : {}),
    },
    thread: { id, body: "Please inspect the failed checkout", revision: 3 },
  };
}

test("materialization produces private, checksum-verifiable structured evidence in a generated directory", async () => {
  const base = await mkdtemp(join(tmpdir(), "feedbacks-bundle-test-"));
  try {
    const calls: string[] = [];
    const result = await materializeRecording(
      async (name) => {
        calls.push(name);
        return snapshot();
      },
      { recordingId: id },
      { baseDirectory: base },
    );
    assert.deepEqual(calls, ["recordings.export"]);
    assert.equal(result.complete, true);
    assert.equal((await stat(result.directory)).mode & 0o777, 0o700);
    const manifest = JSON.parse(
      await readFile(join(result.directory, "manifest.json"), "utf8"),
    );
    assert.equal(manifest.recording.id, id);
    assert.equal(manifest.recording.events, undefined);
    assert.equal(manifest.trust, "untrusted_recorded_evidence");
    const network = JSON.parse(
      await readFile(join(result.directory, "network.har"), "utf8"),
    );
    assert.equal(network.log.entries.length, 1);
    assert.equal(network.log.entries[0].response.status, 500);
    assert.match(network.log.entries[0].request.url, /\/api\/checkout/);
    assert.doesNotMatch(JSON.stringify(network), /private/);
    const checksums = (await readFile(join(result.directory, "checksums.sha256"), "utf8"))
      .trim()
      .split("\n");
    for (const line of checksums) {
      const [digest, file] = line.split("  ");
      assert.equal(
        createHash("sha256")
          .update(await readFile(join(result.directory, file)))
          .digest("hex"),
        digest,
      );
      assert.equal((await stat(join(result.directory, file))).mode & 0o777, 0o600);
    }
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("video export uses asset authorization and records missing media without claiming a complete bundle", async () => {
  const base = await mkdtemp(join(tmpdir(), "feedbacks-video-bundle-"));
  try {
    const calls: string[] = [];
    const execute = async (name: string) => {
      calls.push(name);
      return name === "recordings.export"
        ? snapshot(true)
        : { id: assetId, contentType: "video/webm", threadId: id };
    };
    const result = await materializeRecording(
      execute,
      { recordingId: id },
      {
        baseDirectory: base,
        downloadAsset: async (requested) => {
          assert.equal(requested, assetId);
          return Buffer.from("webm-test");
        },
      },
    );
    assert.deepEqual(calls, ["recordings.export", "assets.get"]);
    assert.equal(
      await readFile(join(result.directory, "video.webm"), "utf8"),
      "webm-test",
    );
    const partial = await materializeRecording(
      execute,
      { recordingId: id },
      {
        baseDirectory: base,
        downloadAsset: async () => {
          throw Error("private-token must not appear");
        },
      },
    );
    assert.equal(partial.complete, false);
    assert.doesNotMatch(JSON.stringify(partial), /private-token/);
    assert.match(
      await readFile(join(partial.directory, "README.md"), "utf8"),
      /unavailable/i,
    );
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("authorization or malformed export fails before creating any local evidence directory", async () => {
  const base = await mkdtemp(join(tmpdir(), "feedbacks-denied-bundle-"));
  try {
    await assert.rejects(
      materializeRecording(
        async () => {
          throw Error("denied");
        },
        { recordingId: id },
        { baseDirectory: base },
      ),
      /denied/,
    );
    await assert.rejects(
      materializeRecording(
        async () => snapshot(),
        { recordingId: "../../escape" },
        { baseDirectory: base },
      ),
    );
    await assert.rejects(
      materializeRecording(
        async () => ({
          ...snapshot(),
          recording: { ...snapshot().recording, id: assetId },
        }),
        { recordingId: id },
        { baseDirectory: base },
      ),
      /identity/i,
    );
    assert.deepEqual(await readdir(base), []);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("saved frames are independently authorized and exported even when video is omitted", async () => {
  const base = await mkdtemp(join(tmpdir(), "feedbacks-frame-bundle-"));
  const frame = {
    id: assetId,
    contentType: "image/webp",
    recordingFrame: { recordingId: id, atMs: 50, videoTimeMs: 50 },
  };
  const calls: string[] = [];
  try {
    const result = await materializeRecording(
      async (name) => {
        calls.push(name);
        if (name === "recordings.export") {
          const data = snapshot(true);
          data.thread.frames = [frame];
          return data;
        }
        return { ...frame, threadId: id };
      },
      { recordingId: id, includeVideo: false },
      {
        baseDirectory: base,
        downloadAsset: async (requested, limit, contentType) => {
          assert.equal(requested, assetId);
          assert.equal(contentType, "image/webp");
          assert.equal(limit, 16 * 1024 * 1024);
          return Buffer.from("saved-frame");
        },
      },
    );
    assert.deepEqual(calls, ["recordings.export", "assets.get"]);
    assert.equal(result.complete, true);
    const frames = JSON.parse(
      await readFile(join(result.directory, "frames/index.json"), "utf8"),
    );
    assert.equal(frames[0].status, "downloaded");
    assert.deepEqual(frames[0].recordingFrame, frame.recordingFrame);
    assert.equal(
      await readFile(join(result.directory, frames[0].path), "utf8"),
      "saved-frame",
    );
    assert.match(
      await readFile(join(result.directory, "checksums.sha256"), "utf8"),
      /frames\/frame-001-50ms.webp/,
    );
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("session comment screenshots export without video and retain exact comment identity", async () => {
  const base = await mkdtemp(join(tmpdir(), "feedbacks-comment-bundle-"));
  const annotationId = "33333333-3333-4333-8333-333333333333";
  const frame = {
    id: assetId,
    contentType: "image/webp",
    recordingFrame: { recordingId: id, atMs: 90, annotationId },
  };
  const data = snapshot();
  data.recording.events.push({
    seq: 4,
    atMs: 90,
    type: "activity",
    data: {
      action: "annotation",
      annotationId,
      body: "Align this heading",
      anchor: { selector: "h1" },
    },
  });
  data.thread.frames = [frame];
  try {
    const result = await materializeRecording(
      async (name) => (name === "recordings.export" ? data : { ...frame, threadId: id }),
      { recordingId: id },
      {
        baseDirectory: base,
        downloadAsset: async () => Buffer.from("comment-screenshot"),
      },
    );
    assert.equal(result.complete, true);
    const frames = JSON.parse(
      await readFile(join(result.directory, "frames/index.json"), "utf8"),
    );
    assert.equal(frames[0].status, "downloaded");
    assert.equal(frames[0].recordingFrame.videoTimeMs, undefined);
    assert.equal(frames[0].annotation.annotationId, annotationId);
    assert.equal(frames[0].annotation.body, "Align this heading");
    assert.equal(frames[0].annotation.anchor.selector, "h1");
    assert.match(
      await readFile(join(result.directory, "README.md"), "utf8"),
      /annotationId/,
    );
    const changed = await materializeRecording(
      async (name) =>
        name === "recordings.export"
          ? data
          : {
              ...frame,
              threadId: id,
              recordingFrame: {
                ...frame.recordingFrame,
                annotationId: "44444444-4444-4444-8444-444444444444",
              },
            },
      { recordingId: id },
      {
        baseDirectory: base,
        downloadAsset: async () => {
          throw Error("Must reject before download");
        },
      },
    );
    assert.equal(changed.complete, false);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("frame identity mismatch, denied download and truncated list produce an honest partial bundle", async () => {
  const base = await mkdtemp(join(tmpdir(), "feedbacks-frame-partial-"));
  const frame = {
    id: assetId,
    contentType: "image/webp",
    recordingFrame: { recordingId: id, atMs: 50, videoTimeMs: 50 },
  };
  try {
    for (const failure of ["identity", "download", "truncated"]) {
      let downloads = 0;
      const result = await materializeRecording(
        async (name) => {
          if (name === "recordings.export") {
            const data = snapshot(true);
            data.thread.frames = [frame];
            data.thread.framesTruncated = failure === "truncated";
            return data;
          }
          return { ...frame, threadId: failure === "identity" ? assetId : id };
        },
        { recordingId: id, includeVideo: false },
        {
          baseDirectory: base,
          downloadAsset: async () => {
            downloads++;
            if (failure === "download") throw Error("private credential");
            return Buffer.from("frame");
          },
        },
      );
      assert.equal(result.complete, false);
      if (failure === "identity") assert.equal(downloads, 0);
      assert.doesNotMatch(JSON.stringify(result), /private credential/);
      assert.ok(result.warnings.length);
    }
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
