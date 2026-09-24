const MAX_TILES = 8;
const MAX_PIXELS = 20_000_000;

export function fullPagePlan({
  viewportWidth,
  viewportHeight,
  documentWidth,
  documentHeight,
}) {
  if (
    ![viewportWidth, viewportHeight, documentWidth, documentHeight].every(
      (value) => Number.isSafeInteger(value) && value > 0,
    )
  )
    throw Error("This page's dimensions cannot be captured safely.");
  if (documentWidth > viewportWidth + 2)
    throw Error("This page scrolls sideways. Use the visible-area capture instead.");
  const height = Math.max(documentHeight, viewportHeight);
  if (height * viewportWidth > MAX_PIXELS)
    throw Error(
      "This page is too large for full-page capture. Use the visible-area capture.",
    );
  const last = Math.max(0, documentHeight - viewportHeight);
  const positions = [];
  for (let y = 0; y < last; y += viewportHeight) positions.push(y);
  positions.push(last);
  const unique = [...new Set(positions)];
  if (unique.length > MAX_TILES)
    throw Error("This page needs too many screenshots. Use the visible-area capture.");
  return { positions: unique, width: viewportWidth, height };
}

export function verifyFullPageStep(expected, actual, y) {
  if (
    !actual ||
    actual.url !== expected.url ||
    actual.viewportWidth !== expected.viewportWidth ||
    actual.viewportHeight !== expected.viewportHeight ||
    actual.documentWidth !== expected.documentWidth ||
    actual.documentHeight !== expected.documentHeight ||
    actual.x !== 0 ||
    Math.abs(actual.y - y) > 1 ||
    actual.captureEpoch !== 0
  )
    throw Error("The page changed during full-page capture. Retry the visible area.");
}
