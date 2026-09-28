// Defaults are applied when a review starts; page controls remain session overrides.
export const REVIEW_DEFAULTS = Object.freeze({
  navigationLocked: true,
  highlightEnabled: true,
  clickIndicators: true,
  showPins: true,
  showResolved: false,
  captureMarkerStyle: "ring",
  captureMarkerSize: "small",
  recordingNavigationLocked: false,
  recordingHighlightEnabled: false,
  recordingClickIndicators: true,
});
export function reviewDefaults(value = {}) {
  return Object.fromEntries(
    Object.entries(REVIEW_DEFAULTS).map(([key, fallback]) => [
      key,
      validDefault(key, value?.[key]) ? value[key] : fallback,
    ]),
  );
}
const markerStyles = ["none", "pin", "arrow", "dot", "ring"];
const markerSizes = ["small", "medium", "large"];
function validDefault(key, value) {
  if (key === "captureMarkerStyle") return markerStyles.includes(value);
  if (key === "captureMarkerSize") return markerSizes.includes(value);
  return typeof value === "boolean";
}
export function updateReviewDefaults(current, patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch))
    throw Error("Choose valid review defaults.");
  const result = reviewDefaults(current);
  for (const key of Object.keys(REVIEW_DEFAULTS)) {
    if (!(key in patch)) continue;
    if (!validDefault(key, patch[key])) throw Error("Choose valid review defaults.");
    result[key] = patch[key];
  }
  return result;
}
