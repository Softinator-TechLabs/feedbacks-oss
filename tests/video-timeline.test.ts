import test from "node:test";
import assert from "node:assert/strict";
import { trimBoundary, formatTime } from "../extension/video/video-timeline.js";

test("trim handles cannot cross or leave the recording, including short clips", () => {
  assert.equal(trimBoundary("start", 12, 0, 10, 20), 9.9);
  assert.equal(trimBoundary("end", -2, 4, 10, 20), 4.1);
  assert.equal(trimBoundary("end", 25, 4, 10, 20), 20);
  assert.equal(trimBoundary("start", -3, 4, 10, 20), 0);
  assert.equal(trimBoundary("start", 1, 0, 0.05, 0.05), 0);
});
test("timeline labels include minutes and tenths without overflowing seconds", () => {
  assert.equal(formatTime(65.34), "1:05.3");
  assert.equal(formatTime(59.99), "1:00.0");
  assert.equal(formatTime(NaN), "0:00.0");
});
