import test from "node:test";
import assert from "node:assert/strict";
import { pointFromClient, percentPoint } from "../src/web/document-coordinates.js";

test("document click coordinates remain stable when the viewer is resized", () => {
  assert.deepEqual(
    pointFromClient({ left: 100, top: 50, width: 400, height: 200 }, 200, 200),
    { x: 0.25, y: 0.75 },
  );
  assert.deepEqual(
    pointFromClient({ left: 10, top: 10, width: 100, height: 100 }, -30, 210),
    { x: 0, y: 1 },
  );
  assert.deepEqual(percentPoint("25", "75"), { x: 0.25, y: 0.75 });
  assert.throws(() => percentPoint("", "75"), /between 0 and 100/);
  assert.throws(() => percentPoint("101", "75"), /between 0 and 100/);
});
