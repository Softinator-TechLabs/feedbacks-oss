import assert from "node:assert/strict";
import test from "node:test";
import {
  exportDimensions,
  screenshotsPdf,
} from "../extension/capture/screenshot-export.js";
import sharp from "sharp";

test("local export retains narrow long screenshots and refuses format limits without shrinking", () => {
  assert.deepEqual(exportDimensions(433, 26000), { width: 433, height: 26000 });
  assert.throws(() => exportDimensions(433, 26000, "image/webp"), /Download PDF/);
  assert.throws(() => exportDimensions(433, 50000), /Download PDF/);
  assert.throws(() => exportDimensions(10000, 10000), /Download PDF/);
  assert.throws(() => exportDimensions(0, 2), /invalid/);
});

test("image PDF has readable pages and full-resolution embedded images", async () => {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const bytes = new Uint8Array(
    await sharp({
      create: { width: 433, height: 1000, channels: 3, background: "white" },
    })
      .jpeg()
      .toBuffer(),
  );
  const pdf = screenshotsPdf(
    Array.from({ length: 26 }, () => ({ width: 433, height: 1000, bytes })),
  );
  assert.equal(pdf.type, "application/pdf");
  const document = await getDocument({
    data: new Uint8Array(await pdf.arrayBuffer()),
    isEvalSupported: false,
  }).promise;
  assert.equal(document.numPages, 26);
  const page = await document.getPage(26);
  assert.equal(page.view[2], 612);
  const operators = await page.getOperatorList();
  assert.ok(operators.fnArray.length > 0);
  await document.destroy();
});
