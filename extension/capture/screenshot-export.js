export function exportDimensions(width, height, type = "image/png") {
  const max = type === "image/webp" ? 16383 : 32767;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1
  )
    throw Error("The screenshot dimensions are invalid.");
  if (width > max || height > max || width * height > 40000000)
    throw Error(
      `This full page is too large for ${type === "image/webp" ? "WebP" : "one image"} at original resolution. Download PDF or export individual screenshots instead.`,
    );
  return { width, height };
}
// A small image-only PDF writer. Each full-resolution screenshot becomes one page.
// JPEG streams are embedded unchanged; offsets count bytes rather than JS characters.
export function screenshotsPdf(pages) {
  if (!pages.length) throw Error("There are no screenshots to export.");
  const encoder = new TextEncoder(),
    chunks = [],
    offsets = [0];
  let length = 0;
  const add = (value) => {
    const bytes = typeof value === "string" ? encoder.encode(value) : value;
    chunks.push(bytes);
    length += bytes.length;
  };
  const object = (id, body, bytes) => {
    offsets[id] = length;
    add(`${id} 0 obj\n${body}`);
    if (bytes) {
      add("\nstream\n");
      add(bytes);
      add("\nendstream");
    }
    add("\nendobj\n");
  };
  add("%PDF-1.4\n");
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(
    2,
    `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${3 + i * 3} 0 R`).join(" ")}] >>`,
  );
  pages.forEach((page, i) => {
    const id = 3 + i * 3,
      scale = Math.min(612 / page.width, 14400 / page.height),
      w = Math.max(1, Math.round(page.width * scale)),
      h = Math.max(1, Math.round(page.height * scale));
    const commands = encoder.encode(`q\n${w} 0 0 ${h} 0 0 cm\n/Im0 Do\nQ\n`);
    object(
      id,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${id + 1} 0 R >> >> /Contents ${id + 2} 0 R >>`,
    );
    object(
      id + 1,
      `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.bytes.length} >>`,
      page.bytes,
    );
    object(id + 2, `<< /Length ${commands.length} >>`, commands);
  });
  const xref = length;
  add(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`);
  for (const offset of offsets.slice(1))
    add(`${String(offset).padStart(10, "0")} 00000 n \n`);
  add(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(chunks, { type: "application/pdf" });
}
