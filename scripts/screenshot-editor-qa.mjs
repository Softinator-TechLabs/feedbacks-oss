// Synthetic editor-only browser QA. No external pages, accounts or permissions are changed.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";
import sharp from "sharp";
const root = process.cwd();
const backgroundSource = await readFile(join(root, "extension/background.js"), "utf8");
const redactionFunction = backgroundSource.slice(
  backgroundSource.indexOf("async function redactDraft("),
  backgroundSource.indexOf("async function redactDiagnostic("),
);
const redactionFixture = `import {getPage,putPage,deletePage,deleteDraftPages} from "/extension/capture/page-store.js";
import {redactInsertedImages} from "/extension/capture/screenshot-redaction.js";
const get = async () => ({draft:window.qaDraft});
const set = async value => { Object.assign(window.qaDraft,value.draft); window.qaPersist(); };
${redactionFunction}
export {redactDraft};`;
const server = createServer(async (req, res) => {
  const path = new URL(req.url, "http://localhost").pathname;
  if (path === "/fixture-redaction.js") {
    res.setHeader("Content-Type", "application/javascript");
    res.end(redactionFixture);
    return;
  }
  if (path === "/fixture") {
    res.end("<!doctype html><title>Synthetic capture</title>");
    return;
  }
  try {
    const name = path.slice(1);
    if (
      !/^extension\/(?:[a-z-]+\.(?:js|css|html)|(?:capture|diagnostics)\/[a-z0-9-]+\.js)$/.test(
        name,
      )
    )
      throw Error();
    res.setHeader(
      "Content-Type",
      name.endsWith("js")
        ? "application/javascript"
        : name.endsWith("css")
          ? "text/css"
          : "text/html",
    );
    res.end(await readFile(join(root, name)));
  } catch {
    res.statusCode = 404;
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: "chromium", headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    permissions: ["clipboard-read", "clipboard-write"],
  });
  await context.addInitScript(() => {
    const draft = {
      id: "synthetic-editor",
      projectId: "qa",
      body: "Synthetic screenshot QA",
      context: { url: "https://example.test", viewport: { width: 433, height: 1000 } },
      captureScope: "fullPage",
      imageRevision: 0,
      capturePages: Array.from({ length: 26 }, (_, i) => ({
        name: `Section ${i + 1}`,
        startY: i * 1000,
        endY: (i + 1) * 1000,
      })),
      pageToolStates: Array.from({ length: 26 }, () => []),
    };
    Object.assign(draft, JSON.parse(localStorage.getItem("qaDraft") || "{}"));
    if (!draft.pageToolStates[0].some((shape) => shape.tool === "point"))
      draft.pageToolStates[0].push({
        tool: "point",
        number: 1,
        points: [{ x: 35, y: 35 }],
      });
    window.qaDraft = draft;
    window.qaPersist = () => localStorage.setItem("qaDraft", JSON.stringify(draft));
    window.qaApproved = [];
    window.chrome = {
      runtime: {
        onMessage: { addListener() {} },
        async sendMessage(message) {
          const store = await import("/extension/capture/page-store.js");
          if (message.type === "draft") return { ok: true, data: structuredClone(draft) };
          if (message.type === "draftProjects")
            return {
              ok: true,
              data: {
                items: [
                  {
                    id: "qa",
                    name: "Synthetic QA",
                    origins: ["https://example.test"],
                    permissions: { canWrite: true },
                  },
                ],
              },
            };
          if (message.type === "capturePage" || message.type === "captureThumbnail")
            return {
              ok: true,
              data: {
                image: await store.pageDataUrl(
                  await store.getPage(draft.id, message.index),
                ),
              },
            };
          if (message.type === "saveDraft") {
            draft.pageToolStates[message.pageIndex] = structuredClone(message.toolState);
            draft.toolState = structuredClone(message.toolState);
            window.qaPersist();
            return { ok: true, data: { saved: true } };
          }
          if (message.type === "redactDraft") {
            const { redactDraft } = await import("/fixture-redaction.js");
            return { ok: true, data: structuredClone(await redactDraft(message)) };
          }
          if (message.type === "approveCapturePage") {
            window.qaApproved.push(message);
            return { ok: true, data: {} };
          }
          if (message.type === "submit")
            return { ok: true, data: { url: "https://example.test/thread" } };
          throw Error(`Unexpected fixture message ${message.type}`);
        },
      },
      storage: {
        onChanged: { addListener() {} },
        local: {
          async remove() {
            localStorage.removeItem("qaDraft");
          },
        },
      },
    };
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${origin}/fixture`);
  await page.evaluate(async () => {
    const { putPage } = await import("/extension/capture/page-store.js");
    const canvas = new OffscreenCanvas(433, 1000),
      ctx = canvas.getContext("2d");
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, 433, 1000);
    ctx.fillStyle = "black";
    for (let x = 10; x < 100; x += 2) ctx.fillRect(x, 10, 1, 80);
    ctx.font = "24px system-ui";
    ctx.fillText("Original resolution", 20, 150);
    // Permanent redaction is part of the saved source. It must stay opaque in every export.
    ctx.fillStyle = "#202c37";
    ctx.fillRect(300, 200, 80, 80);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    for (let i = 0; i < 26; i++) await putPage("synthetic-editor", i, "source", blob);
  });
  await page.goto(`${origin}/extension/editor.html`);
  await page.waitForFunction(
    () =>
      document.querySelector("#canvas").width === 433 &&
      !document.querySelector('[data-tool="highlighter"]').disabled,
  );
  // The wide review workspace has two control rows, and opening menus keeps
  // the capture anchored at the same position.
  await page.setViewportSize({ width: 1979, height: 1280 });
  const controlLayout = () =>
    page.evaluate(() => {
      const rect = (selector) => document.querySelector(selector).getBoundingClientRect();
      const tools = rect("#tools");
      const actions = rect(".control-row");
      const capture = rect("#image-review");
      return {
        toolsTop: tools.top,
        toolsBottom: tools.bottom,
        actionsTop: actions.top,
        actionsBottom: actions.bottom,
        captureTop: capture.top,
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
  const compact = await controlLayout();
  await mkdir(join(root, ".local/screenshot-editor-qa"), { recursive: true });
  await page.screenshot({
    path: join(root, ".local/screenshot-editor-qa/compact-header.png"),
  });
  assert.ok(
    compact.toolsBottom <= compact.actionsTop,
    "annotation and capture actions occupy separate rows",
  );
  assert.ok(
    compact.actionsBottom < compact.captureTop,
    "capture starts after the second row",
  );
  assert.equal(compact.overflow, false, "controls stay within the review workspace");
  await page.locator(".more-tools summary").click();
  const open = await controlLayout();
  await page.screenshot({
    path: join(root, ".local/screenshot-editor-qa/compact-header-more-tools.png"),
  });
  assert.equal(
    open.captureTop,
    compact.captureTop,
    "More tools does not move the capture",
  );
  await page.locator(".more-tools summary").click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  const drag = async (x, y, x2, y2) => {
    const r = await page.locator("#canvas").boundingBox();
    const scale = r.width / 433;
    await page.mouse.move(r.x + x * scale, r.y + y * scale);
    await page.mouse.down();
    await page.mouse.move(r.x + x2 * scale, r.y + y2 * scale, { steps: 5 });
    await page.mouse.up();
  };
  await page.locator('[data-tool="highlighter"]').click();
  await drag(20, 110, 220, 160);
  await page.locator('[data-tool="steps"]').click();
  await drag(150, 220, 150, 220);
  await drag(210, 220, 210, 220);
  await page.locator(".more-tools summary").click();
  await page.locator('[data-tool="sticker"]').click();
  await drag(250, 150, 250, 150);
  await page.locator(".more-tools summary").click();
  await page.locator('[data-tool="blur"]').click();
  await drag(10, 10, 100, 90);
  await page.locator(".more-tools summary").click();
  await page.locator('[data-tool="image"]').click();
  const insert = await sharp({
    create: { width: 80, height: 50, channels: 3, background: "#19ad63" },
  })
    .png()
    .toBuffer();
  await page
    .locator("#image-file")
    .setInputFiles({ name: "synthetic.png", mimeType: "image/png", buffer: insert });
  await page.waitForFunction(() =>
    document.querySelector("#status").textContent.startsWith("Image inserted"),
  );
  await drag(60, 120, 100, 160); // move inserted image
  await drag(163, 190, 203, 215); // resize its corner
  await page.waitForTimeout(350);
  const marks = await page.evaluate(() => window.qaDraft.pageToolStates[0]);
  assert.deepEqual(
    marks.filter((s) => s.tool === "steps").map((s) => s.number),
    [1, 2],
  );
  const placed = marks.find((s) => s.tool === "image");
  assert.ok(placed.points[0].x > 70, "inserted image moved");
  assert.ok(placed.points[1].x - placed.points[0].x > 100, "inserted image resized");
  const download = async (format) => {
    await page.locator(".download-menu summary").click();
    const event = page.waitForEvent("download");
    await page.locator(`[data-export="${format}"]`).click();
    const result = await event;
    await page.locator(".download-menu summary").click();
    return readFile(await result.path());
  };
  for (const format of ["png", "jpeg", "webp"]) {
    const bytes = await download(format);
    const meta = await sharp(bytes).metadata();
    assert.equal(meta.width, 433);
    assert.equal(meta.height, 1000);
  }
  // Hold encoding open to verify edits/submission cannot race the exported snapshot.
  await page.evaluate(() => {
    const original = OffscreenCanvas.prototype.convertToBlob;
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    window.qaReleaseExport = () => {
      OffscreenCanvas.prototype.convertToBlob = original;
      release();
    };
    OffscreenCanvas.prototype.convertToBlob = async function (options) {
      const blob = await original.call(this, options);
      await gate;
      return blob;
    };
  });
  await page.locator(".download-menu summary").click();
  const lockedDownload = page.waitForEvent("download");
  await page.locator('[data-export="png"]').click();
  for (const id of [
    "undo",
    "reset",
    "send-header",
    "send",
    "discard",
    "add-image",
    "remove-image",
    "export-scope",
  ])
    assert.equal(
      await page.locator(`#${id}`).isDisabled(),
      true,
      `${id} is locked during export`,
    );
  await page.locator(".page-thumbnail button").nth(1).click();
  assert.equal(
    await page.locator("#page-select").inputValue(),
    "0",
    "thumbnail cannot change source during export",
  );
  await page.evaluate(() => window.qaReleaseExport());
  await lockedDownload;
  await page.locator(".download-menu summary").click();
  assert.equal(await page.locator("#undo").isDisabled(), false);
  await page.locator('[data-export="copy"]').click();
  await page.waitForFunction(() =>
    document.querySelector("#status").textContent.includes("copied to the clipboard"),
  );
  const clipboard = await page.evaluate(async () => {
    const [item] = await navigator.clipboard.read();
    const bitmap = await createImageBitmap(await item.getType("image/png"));
    return { width: bitmap.width, height: bitmap.height };
  });
  assert.deepEqual(clipboard, { width: 433, height: 1000 });
  await page.locator(".more-tools summary").click();
  await page.locator('[data-tool="crop"]').click();
  await drag(30, 100, 230, 300);
  const cropped = await sharp(await download("png")).metadata();
  assert.equal(cropped.width, 200);
  assert.equal(cropped.height, 200);
  await page.locator("#clear-crop").click();
  await page.locator("#full-page-toggle").click();
  await page.waitForFunction(
    () =>
      document.querySelectorAll(".full-page-section").length === 26 &&
      !document.querySelector("#preview-slot").hidden,
  );
  const dimensions = await page
    .locator(".full-page-section")
    .evaluateAll((images) => images.map((i) => [i.naturalWidth, i.naturalHeight]));
  assert.ok(dimensions.every(([w, h]) => w === 433 && h === 1000));
  // Unmarked section is pixel-identical after the preview encode, including fine stripes.
  const previewPixels = await page
    .locator(".full-page-section")
    .nth(1)
    .evaluate(async (image) => {
      const blob = await (await fetch(image.src)).blob();
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    });
  const raw = await sharp(Buffer.from(previewPixels))
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.equal(raw.data[(10 * 433 + 10) * raw.info.channels], 0);
  assert.equal(raw.data[(10 * 433 + 11) * raw.info.channels], 255);
  const whole = await sharp(await download("png")).metadata();
  assert.equal(whole.width, 433);
  assert.equal(whole.height, 26000);
  await page.locator(".download-menu summary").click();
  await page.locator('[data-export="webp"]').click();
  await page.waitForFunction(() =>
    document.querySelector("#status").textContent.includes("too large for WebP"),
  );
  await page.locator(".download-menu summary").click();
  const pdf = await download("pdf");
  assert.equal(pdf.subarray(0, 8).toString(), "%PDF-1.4");
  assert.ok(pdf.includes(Buffer.from("/Count 26")));
  await page.selectOption("#zoom", "1");
  assert.equal(
    (await page.locator(".full-page-section").first().boundingBox()).width,
    433,
  );
  await mkdir(join(root, ".local/screenshot-editor-qa"), { recursive: true });
  await page.screenshot({ path: join(root, ".local/screenshot-editor-qa/desktop.png") });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.selectOption("#zoom", "fit");
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
    "mobile page fits viewport",
  );
  await page.screenshot({
    path: join(root, ".local/screenshot-editor-qa/mobile-dark.png"),
  });
  await page.locator("#full-page-toggle").click();
  await page.screenshot({
    path: join(root, ".local/screenshot-editor-qa/mobile-tools.png"),
  });
  await page.locator("#send-header").click();
  await page.waitForFunction(
    () => document.querySelector("#completion").hidden === false,
  );
  const approved = await page.evaluate(() => window.qaApproved);
  assert.equal(approved.length, 26);
  assert.ok(approved[0].imageWithoutPins, "point capture has a pin-free approved image");
  const first = await sharp(Buffer.from(approved[0].image.split(",")[1], "base64"))
    .raw()
    .toBuffer({ resolveWithObject: true });
  const withoutPins = await sharp(
    Buffer.from(approved[0].imageWithoutPins.split(",")[1], "base64"),
  )
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pinCenter = (35 * 433 + 35) * first.info.channels;
  assert.notDeepEqual(
    first.data.subarray(pinCenter, pinCenter + 3),
    withoutPins.data.subarray(pinCenter, pinCenter + 3),
    "the hideable image removes the drawn pin",
  );
  const markerPixels = await page.evaluate(async () => {
    const { drawShape } = await import("/extension/capture/screenshot-render.js");
    const result = {};
    for (const style of ["none", "ring", "dot", "arrow", "pin"]) {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 100;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, 100, 100);
      drawShape(
        {
          tool: "point",
          number: 1,
          markerStyle: style,
          markerSize: "small",
          points: [{ x: 50, y: 50 }],
        },
        ctx,
        100,
      );
      const data = ctx.getImageData(0, 0, 100, 100).data;
      let changed = 0;
      for (let i = 0; i < data.length; i += 4)
        if (data[i] < 250 || data[i + 1] < 250 || data[i + 2] < 250) changed++;
      result[style] = changed;
    }
    return result;
  });
  assert.equal(markerPixels.none, 0, "No marker leaves every pixel unchanged");
  for (const style of ["ring", "dot", "arrow", "pin"])
    assert.ok(markerPixels[style] > 0, `${style} visibly marks the click location`);
  assert.equal(first.info.width, 433);
  assert.equal(first.info.height, 1000);
  const redaction = (220 * 433 + 320) * first.info.channels;
  assert.ok(
    first.data[redaction] < 60 && first.data[redaction + 1] < 60,
    "saved redaction remains dark after rendering and upload approval",
  );
  // Run the actual background redaction operation, then exercise persisted UI state.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.reload();
  await page.waitForFunction(
    () => !document.querySelector('[data-tool="redact"]').disabled,
  );
  const originalImage = await page.evaluate(() =>
    window.qaDraft.pageToolStates[0].find((s) => s.tool === "image"),
  );
  const a = originalImage.points[0],
    b = originalImage.points[1];
  const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  await page.locator('[data-tool="redact"]').click();
  await drag(center.x - 12, center.y - 10, center.x + 12, center.y + 10);
  await page.waitForFunction(() =>
    document
      .querySelector("#status")
      .textContent.startsWith("Redaction permanently saved"),
  );
  const sanitized = await page.evaluate(() =>
    window.qaDraft.pageToolStates[0].find((s) => s.tool === "image"),
  );
  assert.notEqual(sanitized.source, originalImage.source);
  assert.equal(
    await page.evaluate(
      (source) => JSON.stringify(window.qaDraft).includes(source),
      originalImage.source,
    ),
    false,
    "no unsanitized source retained in redundant toolState",
  );
  const sourcePixels = await sharp(Buffer.from(sanitized.source.split(",")[1], "base64"))
    .raw()
    .toBuffer({ resolveWithObject: true });
  const sourceCenter = (25 * 80 + 40) * sourcePixels.info.channels;
  assert.deepEqual(
    [...sourcePixels.data.subarray(sourceCenter, sourceCenter + 3)],
    [32, 44, 55],
    "private inserted pixels permanently replaced",
  );
  assert.ok(sourcePixels.data[1] > 150, "uncovered inserted pixels are preserved");
  await page.reload();
  await page.waitForFunction(
    () => !document.querySelector('[data-tool="redact"]').disabled,
  );
  await page.locator(".more-tools summary").click();
  await page.locator('[data-tool="image"]').click();
  await drag(center.x, center.y, center.x + 40, center.y + 70);
  await drag(b.x + 40, b.y + 70, b.x + 80, b.y + 95);
  await page.waitForTimeout(350);
  const moved = await page.evaluate(() =>
    window.qaDraft.pageToolStates[0].find((s) => s.tool === "image"),
  );
  assert.equal(moved.source, sanitized.source, "move/resize use sanitized source");
  const movedCenter = {
    x: Math.floor((moved.points[0].x + moved.points[1].x) / 2),
    y: Math.floor((moved.points[0].y + moved.points[1].y) / 2),
  };
  const movedPixels = await sharp(await download("png"))
    .raw()
    .toBuffer({ resolveWithObject: true });
  const movedOffset = (movedCenter.y * 433 + movedCenter.x) * movedPixels.info.channels;
  assert.deepEqual(
    [...movedPixels.data.subarray(movedOffset, movedOffset + 3)],
    [32, 44, 55],
    "export after move/resize remains masked",
  );
  await page.locator("#reset").click();
  const resetPixels = await sharp(await download("png"))
    .raw()
    .toBuffer({ resolveWithObject: true });
  const resetOffset =
    (Math.floor(center.y) * 433 + Math.floor(center.x)) * resetPixels.info.channels;
  assert.ok(
    resetPixels.data[resetOffset] < 60 && resetPixels.data[resetOffset + 1] < 60,
    "Reset cannot restore base pixels under inserted image",
  );
  await page.waitForTimeout(350);
  // The viewport (non-series) path must replace its persisted source as well.
  const viewportSource = await page.evaluate(async (originalImage) => {
    const store = await import("/extension/capture/page-store.js");
    Object.assign(window.qaDraft, {
      capturePages: [],
      image: await store.pageDataUrl(await store.getPage("synthetic-editor", 0)),
      toolState: [originalImage],
    });
    const { redactDraft } = await import("/fixture-redaction.js");
    const a = originalImage.points[0],
      b = originalImage.points[1];
    const result = await redactDraft({
      id: window.qaDraft.id,
      rectangles: [{ x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y }],
    });
    return result.toolState[0].source;
  }, originalImage);
  assert.notEqual(viewportSource, originalImage.source);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: 26 full-resolution preview sections, fine pixels, PNG/JPEG/WebP, clipboard, PDF, export crop, marks, image move/resize, dark mobile, upload flattening, inserted-image permanent redaction across reload/move/resize/reset/export, and viewport redaction.",
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
