import test from "node:test";
import assert from "node:assert/strict";
import { fullPagePlan, verifyFullPageStep } from "../extension/full-page.js";

const page = {
  url: "https://example.test/review",
  viewportWidth: 1200,
  viewportHeight: 800,
  documentWidth: 1200,
  documentHeight: 2100,
};

test("full-page plan covers top, intermediate and bottom without exceeding viewport", () => {
  const plan = fullPagePlan(page);
  assert.deepEqual(plan.positions, [0, 800, 1300]);
  assert.equal(plan.width, 1200);
  assert.equal(plan.height, 2100);
  assert.deepEqual(
    plan.pages.map(({ name, startY, endY, cropY }) => ({ name, startY, endY, cropY })),
    [
      { name: "full-page-001-of-003.webp", startY: 0, endY: 800, cropY: 0 },
      { name: "full-page-002-of-003.webp", startY: 800, endY: 1600, cropY: 0 },
      { name: "full-page-003-of-003.webp", startY: 1600, endY: 2100, cropY: 300 },
    ],
  );
  assert.deepEqual(fullPagePlan({ ...page, documentHeight: 500 }).positions, [0]);
  assert.equal(
    fullPagePlan({ ...page, documentHeight: 500 }).height,
    page.viewportHeight,
  );
});

test("full-page plan accepts long pages without an arbitrary page count cap", () => {
  assert.equal(fullPagePlan({ ...page, documentHeight: 15000 }).positions.length, 19);
  assert.equal(fullPagePlan({ ...page, documentHeight: 200000 }).pages.length, 250);
});

test("full-page plan refuses unsupported dimensions", () => {
  assert.throws(() => fullPagePlan({ ...page, documentWidth: 1300 }), /sideways/);
  assert.throws(() => fullPagePlan({ ...page, documentHeight: NaN }), /dimensions/);
});

test("full-page capture allows height growth but rejects navigation and unintended scroll", () => {
  const step = { ...page, x: 0, y: 800, captureEpoch: 0 };
  assert.doesNotThrow(() => verifyFullPageStep(page, step, 800));
  assert.throws(
    () => verifyFullPageStep(page, { ...step, url: "https://other.test" }, 800),
    /page changed/,
  );
  assert.doesNotThrow(() =>
    verifyFullPageStep(page, { ...step, documentHeight: 2200 }, 800),
  );
  assert.throws(
    () => verifyFullPageStep(page, { ...step, documentHeight: 0 }, 800),
    /page changed/,
  );
  assert.throws(
    () => verifyFullPageStep(page, { ...step, captureEpoch: 1 }, 800),
    /page changed/,
  );
  assert.throws(() => verifyFullPageStep(page, { ...step, y: 798 }, 800), /page changed/);
});
