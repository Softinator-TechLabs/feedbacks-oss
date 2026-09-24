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
  assert.deepEqual(fullPagePlan(page), {
    positions: [0, 800, 1300],
    width: 1200,
    height: 2100,
  });
  assert.deepEqual(fullPagePlan({ ...page, documentHeight: 500 }).positions, [0]);
  assert.equal(
    fullPagePlan({ ...page, documentHeight: 500 }).height,
    page.viewportHeight,
  );
});

test("full-page plan refuses unsafe dimensions and tile counts", () => {
  assert.throws(() => fullPagePlan({ ...page, documentWidth: 1300 }), /sideways/);
  assert.throws(() => fullPagePlan({ ...page, documentHeight: 9000 }), /too many/);
  assert.throws(
    () =>
      fullPagePlan({
        ...page,
        viewportWidth: 4000,
        documentWidth: 4000,
        documentHeight: 6000,
      }),
    /too large/,
  );
  assert.throws(() => fullPagePlan({ ...page, documentHeight: NaN }), /dimensions/);
});

test("full-page capture rejects page mutation and unintended scroll", () => {
  const step = { ...page, x: 0, y: 800, captureEpoch: 0 };
  assert.doesNotThrow(() => verifyFullPageStep(page, step, 800));
  assert.throws(
    () => verifyFullPageStep(page, { ...step, url: "https://other.test" }, 800),
    /page changed/,
  );
  assert.throws(
    () => verifyFullPageStep(page, { ...step, documentHeight: 2200 }, 800),
    /page changed/,
  );
  assert.throws(
    () => verifyFullPageStep(page, { ...step, captureEpoch: 1 }, 800),
    /page changed/,
  );
  assert.throws(() => verifyFullPageStep(page, { ...step, y: 798 }, 800), /page changed/);
});
