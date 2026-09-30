// All drawing coordinates are already normalized against this exact asset.
// Never infer geometry from current DOM or from another capture's viewport.
export function annotationOverlay(
  markings: any[],
  sourceWidth: number,
  sourceHeight: number,
  width: number,
  height: number,
  crop?: { left: number; top: number; width: number; height: number },
) {
  const area = crop ?? { left: 0, top: 0, width: sourceWidth, height: sourceHeight };
  const shapes: string[] = [],
    pins: string[] = [];
  for (const mark of markings) {
    const b = mark.bounds;
    if (!b || ![b.x, b.y, b.width, b.height].every(Number.isFinite)) continue;
    const x = ((b.x * sourceWidth - area.left) * width) / area.width;
    const y = ((b.y * sourceHeight - area.top) * height) / area.height;
    const w = (b.width * sourceWidth * width) / area.width;
    const h = (b.height * sourceHeight * height) / area.height;
    if (mark.tool === "point") {
      if (x < 0 || y < 0 || x > width || y > height) continue;
      const label =
        Number.isInteger(mark.number) && mark.number > 0 && mark.number <= 100
          ? String(mark.number)
          : "";
      const cx = Math.max(13, Math.min(width - 13, x)),
        cy = Math.max(13, Math.min(height - 13, y));
      pins.push(
        `<circle cx="${cx}" cy="${cy}" r="12" fill="#17324d" stroke="white" stroke-width="2"/><text x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="12" font-family="sans-serif" font-weight="bold" fill="white">${label}</text>`,
      );
    } else if (mark.origin === "element") {
      shapes.push(
        `<rect x="${x}" y="${y}" width="${Math.max(0, w)}" height="${Math.max(0, h)}" fill="none" stroke="#2563eb" stroke-width="2"/>`,
      );
    } else if (mark.origin === "text-selection") {
      shapes.push(
        `<rect x="${x}" y="${y}" width="${Math.max(0, w)}" height="${Math.max(0, h)}" fill="#facc15" fill-opacity="0.32"/>`,
      );
    }
  }
  if (!shapes.length && !pins.length) return undefined;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${shapes.join("")}${pins.join("")}</svg>`,
  );
}
