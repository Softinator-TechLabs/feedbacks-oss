import test from "node:test";
import assert from "node:assert/strict";
import { finalizeWebmMetadata } from "../extension/video-metadata.js";
import { VIDEO_MAX_BYTES } from "../extension/video-media.js";

test("finalization uses measured milliseconds and returns the repaired WebM", async () => {
  const source = new Blob(["webm"], { type: "video/webm" });
  const repaired = new Blob(["webm-fixed"], { type: "video/webm" });
  let args: unknown[] = [];
  const result = await finalizeWebmMetadata(source, 3190, {
    fix: async (...received: unknown[]) => {
      args = received;
      return repaired;
    },
  });
  assert.equal(result, repaired);
  assert.equal(args[0], source);
  assert.equal(args[1], 3190);
  assert.deepEqual(args[2], { logger: false });
});

test("post-repair size is checked before a preview or upload can use it", async () => {
  const source = new Blob(["webm"], { type: "video/webm" });
  const oversized = new Blob([new Uint8Array(VIDEO_MAX_BYTES + 1)], {
    type: "video/webm",
  });
  await assert.rejects(
    finalizeWebmMetadata(source, 3190, { fix: async () => oversized }),
    /40 MiB/,
  );
});

test("an export cancelled during asynchronous metadata repair cannot commit", async () => {
  const controller = new AbortController();
  const source = new Blob(["webm"], { type: "video/webm" });
  await assert.rejects(
    finalizeWebmMetadata(source, 3190, {
      signal: controller.signal,
      fix: async () => {
        controller.abort();
        return source;
      },
    }),
    /cancelled/i,
  );
});
