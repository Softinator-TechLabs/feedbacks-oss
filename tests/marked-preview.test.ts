import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { assetPreview } from "../src/server/assets.js";
import { buildTaskHandoff } from "../src/shared/task-handoff.js";

test("native preview renders pin, element and selected text without changing source; crops preserve alignment", async () => {
  const bytes = await sharp({
    create: { width: 800, height: 600, channels: 3, background: "white" },
  })
    .webp()
    .toBuffer();
  const store = { get: async () => bytes, put: async () => {}, remove: async () => {} };
  const markings = [
    {
      tool: "rectangle",
      origin: "element",
      number: 1,
      bounds: { x: 0.1, y: 0.1, width: 0.3, height: 0.3 },
    },
    {
      tool: "highlighter",
      origin: "text-selection",
      number: 1,
      bounds: { x: 0.15, y: 0.2, width: 0.2, height: 0.04 },
    },
    { tool: "point", number: 1, bounds: { x: 0.3, y: 0.3, width: 0, height: 0 } },
  ];
  const raw = await assetPreview(store, "key", 800);
  const marked = await (assetPreview as any)(store, "key", 800, undefined, markings);
  assert.notEqual(marked.data, raw.data);
  assert.equal(marked.marked, true);
  const pixel = async (image: any, x: number, y: number) => [
    ...(await sharp(Buffer.from(image.data, "base64"))
      .extract({ left: x, top: y, width: 1, height: 1 })
      .raw()
      .toBuffer()),
  ];
  assert.ok((await pixel(marked, 160, 130))[2] < 240, "yellow text highlight is visible");
  const crop = await (assetPreview as any)(
    store,
    "key",
    400,
    { left: 80, top: 60, width: 400, height: 300 },
    markings,
  );
  assert.ok((await pixel(crop, 80, 70))[2] < 240, "crop uses original coordinates");
  assert.equal((await assetPreview(store, "key", 800)).data, raw.data);
});
test("nine-point copy carries every brief comment with marked links, without coordinate JSON", () => {
  const thread: any = {
    id: "task",
    body: "Nine changes",
    context: {
      annotations: Array.from({ length: 9 }, (_, i) => ({
        id: `point-${i}`,
        body: `Comment number ${i + 1}`,
        anchor: {
          selector: "long > selector",
          rect: { x: 1, y: 2, width: 3, height: 4 },
        },
      })),
    },
    assets: [
      {
        id: "asset",
        contentType: "image/webp",
        rendition: "screenshot",
        markings: [
          { tool: "point", number: 1, bounds: { x: 0.1, y: 0.2, width: 0, height: 0 } },
        ],
      },
    ],
  };
  const r = buildTaskHandoff({ thread, origin: "https://feedback.test" });
  for (let i = 1; i <= 9; i++) assert.match(r.text, new RegExp(`Comment number ${i}`));
  assert.match(r.text, /preview=agent/);
  assert.doesNotMatch(r.text, /"bounds"|"selector"|"rect"|"markings"|Incomplete: points/);
  assert.ok(r.text.length < 2800);
});
