import test from "node:test";
import assert from "node:assert/strict";
import { date, relativeDate } from "../src/web/api.js";

test("dates use a consistent 12-hour IST format", () => {
  assert.equal(date("2026-12-24T13:00:00.000Z"), "24th December 2026, 6:30 PM IST");
  assert.equal(date("2026-12-01T18:30:00.000Z"), "2nd December 2026, 12:00 AM IST");
  assert.equal(date("2026-12-11T00:00:00.000Z"), "11th December 2026, 5:30 AM IST");
  assert.equal(date("2026-12-13T00:00:00.000Z"), "13th December 2026, 5:30 AM IST");
});

test("recent dates scan quickly while older dates stay identifiable", () => {
  const now = Date.parse("2026-09-25T06:00:00.000Z");
  assert.equal(relativeDate("2026-09-25T05:59:40.000Z", now), "just now");
  assert.equal(relativeDate("2026-09-25T05:57:00.000Z", now), "3 mins ago");
  assert.equal(relativeDate("2026-09-25T01:00:00.000Z", now), "5 hours ago");
  assert.equal(relativeDate("2026-09-22T06:00:00.000Z", now), "3 days ago");
  assert.equal(relativeDate("2026-09-05T06:00:00.000Z", now), "5th Sept");
  assert.equal(relativeDate("2025-09-01T06:00:00.000Z", now), "last year");
  assert.equal(relativeDate("2024-09-01T06:00:00.000Z", now), "2 years ago");
});

test("future expiry dates read naturally and invalid dates stay explicit", () => {
  const now = Date.parse("2026-09-25T06:00:00.000Z");
  assert.equal(relativeDate("2026-09-25T08:00:00.000Z", now), "in 2 hours");
  assert.equal(relativeDate("2026-09-28T06:00:00.000Z", now), "in 3 days");
  assert.equal(relativeDate("2026-10-05T06:00:00.000Z", now), "5th Oct");
  assert.equal(relativeDate("garbage", now), "Invalid date");
});
