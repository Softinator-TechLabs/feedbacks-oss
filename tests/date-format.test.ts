import test from "node:test";
import assert from "node:assert/strict";
import { date } from "../src/web/api.js";

test("dates use a consistent 12-hour IST format", () => {
  assert.equal(date("2026-12-24T13:00:00.000Z"), "24th December 2026, 6:30 PM IST");
  assert.equal(date("2026-12-01T18:30:00.000Z"), "2nd December 2026, 12:00 AM IST");
  assert.equal(date("2026-12-11T00:00:00.000Z"), "11th December 2026, 5:30 AM IST");
  assert.equal(date("2026-12-13T00:00:00.000Z"), "13th December 2026, 5:30 AM IST");
});
