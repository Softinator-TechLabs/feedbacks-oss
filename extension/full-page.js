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
  const last = Math.max(0, documentHeight - viewportHeight);
  const positions = [];
  for (let y = 0; y < last; y += viewportHeight) positions.push(y);
  positions.push(last);
  const unique = [...new Set(positions)];
  const digits = Math.max(3, String(unique.length).length);
  const pages = unique.map((scrollY, index) => {
    const startY = index === 0 ? 0 : Math.min(height, unique[index - 1] + viewportHeight);
    return {
      index,
      scrollY,
      cropY: startY - scrollY,
      startY,
      endY: Math.min(height, scrollY + viewportHeight),
      name: `full-page-${String(index + 1).padStart(digits, "0")}-of-${String(unique.length).padStart(digits, "0")}.webp`,
    };
  });
  return { positions: unique, pages, width: viewportWidth, height };
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
