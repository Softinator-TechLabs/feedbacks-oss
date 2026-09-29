import { pageDataUrl } from "./page-store.js";

// Remove covered pixels from the movable source itself, not only from the base
// screenshot beneath it. Moving, resizing or reloading cannot reveal them again.
export async function redactInsertedImages(shapes, rectangles) {
  const sanitized = [];
  for (const shape of shapes || []) {
    if (shape.tool !== "image") {
      if (shape.tool !== "redact") sanitized.push(shape);
      continue;
    }
    const a = shape.points?.[0],
      b = shape.points?.at(-1);
    if (!a || !b || ![a.x, a.y, b.x, b.y].every(Number.isFinite))
      throw Error("An inserted image has invalid coordinates.");
    const left = Math.min(a.x, b.x),
      top = Math.min(a.y, b.y);
    const width = Math.max(2, Math.abs(b.x - a.x)),
      height = Math.max(2, Math.abs(b.y - a.y));
    const overlaps = rectangles
      .map((r) => {
        const x = Math.max(left, Math.floor(r.x)),
          y = Math.max(top, Math.floor(r.y));
        const right = Math.min(left + width, Math.floor(r.x) + Math.ceil(r.width) + 1);
        const bottom = Math.min(top + height, Math.floor(r.y) + Math.ceil(r.height) + 1);
        return { x, y, right, bottom };
      })
      .filter((r) => r.right > r.x && r.bottom > r.y);
    if (!overlaps.length) {
      sanitized.push(shape);
      continue;
    }
    if (!/^data:image\/(png|jpeg|webp);base64,/.test(shape.source || ""))
      throw Error("An inserted image has invalid source pixels.");
    const bitmap = await createImageBitmap(await (await fetch(shape.source)).blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    try {
      const ctx = canvas.getContext("2d");
      ctx.drawImage(bitmap, 0, 0);
      ctx.fillStyle = "#202c37";
      for (const r of overlaps) {
        // Expand to source pixel edges (plus an interpolation guard pixel), so
        // later resampling cannot blend private boundary pixels back into view.
        const x = Math.floor(((r.x - left) / width) * bitmap.width) - 1;
        const y = Math.floor(((r.y - top) / height) * bitmap.height) - 1;
        const right = Math.ceil(((r.right - left) / width) * bitmap.width) + 1;
        const bottom = Math.ceil(((r.bottom - top) / height) * bitmap.height) + 1;
        ctx.fillRect(x, y, right - x, bottom - y);
      }
      const blob = await canvas.convertToBlob({ type: "image/png" });
      sanitized.push({ ...shape, source: await pageDataUrl(blob) });
    } finally {
      bitmap.close();
      canvas.width = canvas.height = 0;
    }
  }
  return sanitized;
}
