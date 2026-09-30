import assert from "node:assert/strict";
import { test } from "node:test";
import { threadEvidenceLabels } from "../src/web/threads/evidence-types.js";

const labels = (assets: any[] = [], context = {}, recordingModes: string[] = []) =>
  threadEvidenceLabels({ assets, context, recordingModes } as any);
test("thread types distinguish text, text edits, screenshots and full pages", () => {
  assert.deepEqual(labels(), ["Text"]);
  assert.deepEqual(
    labels([], {
      annotations: [{ id: "p", textEdit: { original: "Before", replacement: "After" } }],
    }),
    ["Text edit"],
  );
  assert.deepEqual(
    labels([
      {
        contentType: "image/webp",
        rendition: "screenshot",
        filename: "page-visible.webp",
      },
    ]),
    ["Screenshot"],
  );
  assert.deepEqual(
    labels([
      {
        contentType: "image/webp",
        rendition: "screenshot",
        filename: "full-page-combined.webp",
      },
      { contentType: "image/webp", filename: "full-page-001-of-002.webp" },
    ]),
    ["Full page"],
  );
  assert.deepEqual(
    labels([
      {
        contentType: "image/webp",
        rendition: "screenshot",
        captureRegion: { startY: 400, endY: 1200, pageWidth: 800 },
      },
    ]),
    ["Screenshot"],
  );
});
test("session-only and mixed evidence remain distinguishable without treating frames as captures", () => {
  assert.deepEqual(labels([], {}, ["session"]), ["Session recording"]);
  assert.deepEqual(
    labels(
      [
        { contentType: "video/webm" },
        { contentType: "image/webp", recordingFrame: { recordingId: "r" } },
      ],
      {},
      ["video"],
    ),
    ["Video + session"],
  );
  assert.deepEqual(labels([{ contentType: "video/webm" }]), ["Video"]);
  assert.deepEqual(
    labels([{ contentType: "image/webp", rendition: "screenshot" }], {}, ["session"]),
    ["Screenshot", "Session recording"],
  );
  assert.deepEqual(
    labels([{ contentType: "image/webp", rendition: "thumbnail" }], {
      document: { id: "doc" },
    }),
    ["Document"],
  );
});
