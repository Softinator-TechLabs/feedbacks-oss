import assert from "node:assert/strict";
import test from "node:test";
import { contextSchema, inputSchemas } from "../src/shared/contracts.js";
import { viewContext } from "../src/server/views.js";

const first = {
  id: "e680945e-56e1-47ef-a3e9-28bb1a9969cf",
  body: "Shorten the heading",
  anchor: {
    selector: "main > h1",
    confidence: "element" as const,
    fingerprint: "heading-v1:abc",
    pagePoint: { x: 120, y: 75 },
    screenshotPoint: { x: 120, y: 75 },
  },
};
const second = {
  id: "21d7ef0b-855f-4ea6-91c5-662c8eb62e60",
  body: "Repair this link",
  anchor: {
    selector: "main > a",
    confidence: "coordinate-only" as const,
    pagePoint: { x: 140, y: 1350 },
    screenshotPoint: { x: 140, y: 250 },
  },
};
const context = {
  url: "https://example.com/page",
  viewport: { width: 900, height: 650 },
  devicePixelRatio: 1,
  anchor: first.anchor,
  annotations: [first, second],
};

test("website context preserves ordered comments with distinct element anchors", () => {
  const input = inputSchemas["threads.create"].parse({
    projectId: "169910c7-bfed-4b28-a79c-a7b19992e1e9",
    body: "2 annotated points: Shorten the heading",
    context,
    idempotencyKey: "inline-review-test",
  });
  const saved = viewContext(input.context, {
    captureMode: "origins",
    origins: ["https://example.com"],
  });
  assert.deepEqual(
    saved.annotations.map((item: typeof first) => item.body),
    [first.body, second.body],
  );
  assert.notEqual(
    saved.annotations[0].anchor.selector,
    saved.annotations[1].anchor.selector,
  );
  assert.deepEqual(saved.anchor, saved.annotations[0].anchor);
});

test("blank point comments are rejected before storage", () => {
  assert.throws(() =>
    contextSchema.parse({
      ...context,
      annotations: [{ ...first, body: "   " }],
    }),
  );
});

test("screenshot asset metadata links numbered comments and drawing locations", () => {
  const upload = {
    threadId: first.id,
    revision: 1,
    imageBase64: "data:image/webp;base64,AA==",
    rendition: "annotated",
    filename: "full-page-001-of-002.webp",
    idempotencyKey: "inline-review-page-1",
    captureRegion: { startY: 0, endY: 650, pageWidth: 900 },
    captureSections: [
      { startY: 0, endY: 650, pageWidth: 900, imageTop: 0, imageBottom: 1 },
    ],
    markings: [
      {
        tool: "point",
        annotationId: first.id,
        number: 1,
        bounds: { x: 0.2, y: 0.1, width: 0, height: 0 },
        endpoints: [{ x: 0.2, y: 0.1 }],
      },
      {
        tool: "arrow",
        bounds: { x: 0.3, y: 0.4, width: 0.2, height: 0.1 },
        endpoints: [
          { x: 0.3, y: 0.4 },
          { x: 0.5, y: 0.5 },
        ],
      },
    ],
  };
  assert.deepEqual(inputSchemas["assets.upload"].parse(upload).markings, upload.markings);
  assert.deepEqual(
    inputSchemas["assets.upload"].parse(upload).captureSections,
    upload.captureSections,
  );
  assert.throws(() =>
    inputSchemas["assets.upload"].parse({
      ...upload,
      markings: [{ ...upload.markings[0], endpoints: [{ x: 1.1, y: 0.1 }] }],
    }),
  );
});
