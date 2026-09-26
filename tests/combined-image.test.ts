import assert from "node:assert/strict";
import test from "node:test";
import {
  combinedImageNeedsResize,
  combinedImageSize,
} from "../extension/combined-image.js";

test("combined overview stays inside upload decoder limits on long and Retina pages", () => {
  for (const [width, height] of [
    [1920, 20216], // 19 browser captures at ordinary pixel density
    [3840, 19152], // nine captures on a Retina display
    [3840, 40432], // a longer Retina page
  ]) {
    const output = combinedImageSize(width, height);
    assert.ok(output.width <= 12000);
    assert.ok(output.height <= 12000);
    assert.ok(output.width * output.height <= 40000000);
    assert.ok(output.width <= width && output.height <= height);
    assert.equal(combinedImageNeedsResize(width, height), true);
  }
  assert.deepEqual(combinedImageSize(1920, 3192), {
    width: 1920,
    height: 3192,
    scale: 1,
  });
  assert.equal(combinedImageNeedsResize(1920, 3192), false);
});
