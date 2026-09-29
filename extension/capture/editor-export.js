import { getPage } from "./page-store.js";
import { paintScreenshot, prepareShapes } from "./screenshot-render.js";
import { exportDimensions, screenshotsPdf } from "./screenshot-export.js";

export async function screenshotSurface(
  fresh,
  index,
  kind = fresh.frozen ? "approved" : "source",
) {
  const blob = await getPage(fresh.id, index, kind);
  if (!blob) throw Error(`Screenshot ${index + 1} is missing from this browser.`);
  const bitmap = await createImageBitmap(blob);
  try {
    const output = new OffscreenCanvas(bitmap.width, bitmap.height);
    const marks = fresh.frozen ? [] : fresh.pageToolStates?.[index] || [];
    await prepareShapes(marks);
    paintScreenshot(output.getContext("2d"), bitmap, marks, bitmap.width, bitmap.height);
    return output;
  } finally {
    bitmap.close();
  }
}
export async function buildExportBlob(plan, type) {
  if (!plan.length)
    throw Error("There are no full-page sections. Choose Current screenshot.");
  if (type === "application/pdf") {
    const pages = [];
    for (const page of plan) {
      const surface = await page.render();
      try {
        const blob = await surface.convertToBlob({ type: "image/jpeg", quality: 0.98 });
        pages.push({
          width: surface.width,
          height: surface.height,
          bytes: new Uint8Array(await blob.arrayBuffer()),
        });
      } finally {
        surface.width = surface.height = 0;
      }
    }
    return screenshotsPdf(pages);
  }
  const width = plan[0].width;
  if (plan.some((page) => page.width !== width))
    throw Error("Screenshot widths differ. Download PDF or individual screenshots.");
  const height = plan.reduce((sum, page) => sum + page.height, 0);
  exportDimensions(width, height, type);
  const output = new OffscreenCanvas(width, height),
    surface = output.getContext("2d");
  try {
    surface.fillStyle = "white";
    surface.fillRect(0, 0, width, height);
    let top = 0;
    for (const page of plan) {
      const image = await page.render();
      surface.drawImage(image, 0, top);
      top += image.height;
      image.width = image.height = 0;
    }
    const blob = await output.convertToBlob({ type, quality: 0.98 });
    if (blob.type !== type)
      throw Error("This browser cannot export that format. Choose PNG.");
    return blob;
  } finally {
    output.width = output.height = 0;
  }
}
