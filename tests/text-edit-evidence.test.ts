import test from "node:test";
import assert from "node:assert/strict";
import { contextSchema, screenshotMarkSchema } from "../src/shared/contracts/common.js";
import { pointShapes, summarizeMarkings } from "../extension/capture/markings.js";

const edit = {
  original: "Original copy",
  replacement: "Better copy",
  rects: [{ x: 20, y: 30, width: 80, height: 16 }],
};
const item = {
  id: "a9b5a6a7-1488-4f78-9648-7a3bc31e069d",
  body: "Suggested text edit",
  textEdit: edit,
  anchor: {
    rect: { x: 10, y: 20, width: 160, height: 60 },
    pagePoint: { x: 60, y: 145 },
    screenshotPoint: { x: 60, y: 45 },
  },
};

test("capture contracts retain before/after and bounded selection geometry", () => {
  const context = {
    url: "https://example.test",
    viewport: { width: 800, height: 600 },
    annotations: [item],
  };
  assert.deepEqual(contextSchema.parse(context).annotations?.[0].textEdit, edit);
  assert.equal(
    contextSchema.safeParse({
      ...context,
      annotations: [{ ...item, textEdit: { ...edit, original: " " } }],
    }).success,
    false,
  );
  assert.equal(
    contextSchema.safeParse({
      ...context,
      annotations: [
        { ...item, textEdit: { ...edit, rects: [{ x: 0, y: 0, width: -1, height: 4 }] } },
      ],
    }).success,
    false,
  );
  assert.equal(
    contextSchema.safeParse({
      ...context,
      annotations: [{ ...item, textEdit: { ...edit, replacement: "" } }],
    }).success,
    true,
    "Empty replacement represents deletion",
  );
});

test("point, selected element and multiline text are separate clipped evidence layers", () => {
  const shapes = pointShapes(item, 0, { startY: 100, endY: 200, width: 200 }, 2, 2, {
    style: "none",
  });
  assert.equal(shapes.length, 3);
  assert.equal(shapes[0].tool, "point");
  assert.equal(shapes[0].markerStyle, "none");
  assert.deepEqual(shapes[1], {
    tool: "rectangle",
    origin: "element",
    number: 1,
    points: [
      { x: 20, y: 40 },
      { x: 340, y: 160 },
    ],
  });
  assert.deepEqual(shapes[2], {
    tool: "highlighter",
    origin: "text-selection",
    number: 1,
    points: [
      { x: 40, y: 60 },
      { x: 200, y: 92 },
    ],
  });
  const marks = summarizeMarkings(shapes, 400, 200, [item]);
  assert.equal(marks[2].annotationId, item.id);
  assert.equal(marks[2].origin, "text-selection");
  assert.equal(screenshotMarkSchema.safeParse(marks[2]).success, true);
  const clipped = pointShapes(
    { ...item, textEdit: { ...edit, rects: [{ x: 20, y: -20, width: 80, height: 50 }] } },
    0,
    { startY: 100, endY: 200, width: 200 },
    1,
    1,
  );
  assert.deepEqual(clipped.at(-1)?.points, [
    { x: 20, y: 0 },
    { x: 100, y: 30 },
  ]);
});

test("visibility removes only evidence layers and preserves authored drawings", async () => {
  const { visibleShapes, withoutEvidenceLayers } = await import(
    "../extension/capture/evidence-layers.js"
  );
  const shapes = [
    { tool: "point" },
    { tool: "rectangle", origin: "element" },
    { tool: "highlighter", origin: "text-selection" },
    { tool: "rectangle" },
    { tool: "blur" },
  ];
  assert.deepEqual(visibleShapes(shapes), [shapes[0], shapes[2], shapes[3], shapes[4]]);
  assert.deepEqual(visibleShapes(shapes, new Set(["points", "text"])), [
    shapes[1],
    shapes[3],
    shapes[4],
  ]);
  assert.deepEqual(withoutEvidenceLayers(shapes), [shapes[3], shapes[4]]);
  assert.equal(shapes.length, 5, "view changes must retain evidence metadata");
});

test("issue handoff retains literal before/after text and deletion", async () => {
  const { issueDraft, quickIssueDraft } = await import("../src/server/issue-draft.js");
  const thread = {
    id: item.id,
    projectId: item.id,
    revision: 1,
    body: "Review page copy",
    context: {
      annotations: [
        {
          ...item,
          textEdit: { ...edit, original: "@team <old>", replacement: "**plain text**" },
        },
        { ...item, textEdit: { ...edit, replacement: "" } },
      ],
    },
  };
  for (const draft of [
    issueDraft(thread, null),
    quickIssueDraft(thread, "https://example.test", []),
  ]) {
    assert.match(draft.body, /Original text:\n\n> ＠team &lt;old&gt;/);
    assert.match(draft.body, /Suggested replacement:\n\n> \*\*plain text\*\*/);
    assert.match(draft.body, /Remove selected text/);
  }
});
