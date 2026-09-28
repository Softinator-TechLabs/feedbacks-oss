import assert from "node:assert/strict";
import test from "node:test";
import { reviewDefaults, updateReviewDefaults } from "../extension/review-preferences.js";

test("review and recording defaults remain distinct and ignore unknown stored values", () => {
  const defaults = reviewDefaults();
  assert.equal(defaults.navigationLocked, true);
  assert.equal(defaults.highlightEnabled, true);
  assert.equal(defaults.recordingNavigationLocked, false);
  assert.equal(defaults.recordingHighlightEnabled, false);
  assert.equal(defaults.showResolved, false);
  assert.equal(defaults.captureMarkerStyle, "ring");
  assert.equal(defaults.captureMarkerSize, "small");
  assert.deepEqual(reviewDefaults(null), defaults);
  assert.deepEqual(reviewDefaults({ navigationLocked: "false", extra: true }), defaults);
  const updated = updateReviewDefaults(
    { showPins: false },
    { recordingClickIndicators: false },
  );
  assert.equal(updated.showPins, false);
  assert.equal(updated.recordingClickIndicators, false);
  assert.equal(updated.clickIndicators, true);
  assert.throws(() => updateReviewDefaults({}, { showPins: "yes" }));
  assert.throws(() => updateReviewDefaults({}, []));
  assert.deepEqual(updateReviewDefaults({}, { untrusted: true }), defaults);
  assert.equal(
    updateReviewDefaults({}, { captureMarkerStyle: "none", captureMarkerSize: "large" })
      .captureMarkerStyle,
    "none",
  );
  assert.equal(
    reviewDefaults({ captureMarkerStyle: "unknown" }).captureMarkerStyle,
    "ring",
  );
  assert.throws(() => updateReviewDefaults({}, { captureMarkerSize: "huge" }));
});
