// Defaults are applied when a review starts; page controls remain session overrides.
export const REVIEW_DEFAULTS = Object.freeze({
  navigationLocked: true,
  highlightEnabled: true,
  clickIndicators: true,
  showPins: true,
  showResolved: false,
  recordingNavigationLocked: false,
  recordingHighlightEnabled: false,
  recordingClickIndicators: true,
});
export function reviewDefaults(value = {}) {
  return Object.fromEntries(
    Object.entries(REVIEW_DEFAULTS).map(([key, fallback]) => [
      key,
      typeof value?.[key] === "boolean" ? value[key] : fallback,
    ]),
  );
}
export function updateReviewDefaults(current, patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch))
    throw Error("Choose valid review defaults.");
  const result = reviewDefaults(current);
  for (const key of Object.keys(REVIEW_DEFAULTS)) {
    if (!(key in patch)) continue;
    if (typeof patch[key] !== "boolean") throw Error("Choose valid review defaults.");
    result[key] = patch[key];
  }
  return result;
}
