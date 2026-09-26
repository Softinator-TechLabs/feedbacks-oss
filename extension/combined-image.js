// A combined attachment is an overview. Its numbered source images retain their
// original resolution. Keep the overview inside the server's decoder bounds.
export function combinedImageSize(width, height) {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1
  )
    throw Error("The screenshots have invalid dimensions.");
  const scale = Math.min(
    1,
    12000 / width,
    12000 / height,
    Math.sqrt(40000000 / (width * height)),
  );
  const outputWidth = Math.max(1, Math.floor(width * scale));
  const outputHeight = Math.max(1, Math.floor(height * scale));
  return { width: outputWidth, height: outputHeight, scale };
}

export function combinedImageNeedsResize(width, height) {
  const size = combinedImageSize(width, height);
  return size.width !== width || size.height !== height;
}
