import assert from "node:assert/strict";
import sharp from "sharp";

export async function verifyPageReview({
  fixture,
  toFixture,
  send,
  id,
  draft,
  context,
  extensionId,
  results,
  previewDimensions,
  worker,
  post,
  auth,
  access,
}) {
  fixture.mode = "long";
  await toFixture();
  await send({ type: "popupAction", tabId: id, action: "capture-full" });
  const removableDraft = await draft();
  const removableEditor = await context.newPage();
  await removableEditor.goto(`chrome-extension://${extensionId}/editor.html`);
  await removableEditor.locator(".page-thumbnail").last().waitFor();
  await removableEditor.locator(".page-thumbnail img[src]").first().waitFor();
  results.pageReview = {
    previews: await removableEditor.locator(".page-thumbnail").count(),
  };
  await removableEditor.locator("#page-select").selectOption("1");
  await removableEditor.locator("#remove-current").click();
  await removableEditor.locator(".page-thumbnail").last().waitFor();
  await removableEditor.waitForFunction(
    () => document.querySelectorAll(".page-thumbnail").length === 3,
  );
  const pruned = await draft();
  results.pageReview.remaining = pruned.capturePages.map((page) => page.name);
  results.pageReview.secondImageMatches =
    (await send({ type: "capturePage", id: pruned.id, index: 1 })).page.name ===
    "full-page-003-of-004.webp";
  await removableEditor.locator("#page-select").selectOption("0");
  await removableEditor.locator('[data-tool="rectangle"]').click();
  await removableEditor.waitForFunction(
    () =>
      document.querySelector("#status")?.textContent ===
      "Reviewing full-page-001-of-004.webp.",
  );
  await removableEditor.locator("#canvas").scrollIntoViewIfNeeded();
  const reviewArea = await removableEditor.locator("#canvas").evaluate((canvas) => {
    const image = canvas.getBoundingClientRect();
    const viewport = document.querySelector("#canvas-scroll").getBoundingClientRect();
    return {
      left: Math.max(image.left, viewport.left, 0) + 8,
      top: Math.max(image.top, viewport.top, 0) + 8,
      right: Math.min(image.right, viewport.right, innerWidth) - 8,
      bottom: Math.min(image.bottom, viewport.bottom, innerHeight) - 8,
    };
  });
  assert.ok(reviewArea.right - reviewArea.left > 40, JSON.stringify(reviewArea));
  assert.ok(reviewArea.bottom - reviewArea.top > 40, JSON.stringify(reviewArea));
  const drawingStart = { x: reviewArea.left + 8, y: reviewArea.top + 8 };
  assert.equal(
    await removableEditor.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.id,
      drawingStart,
    ),
    "canvas",
  );
  await removableEditor.mouse.move(drawingStart.x, drawingStart.y);
  await removableEditor.mouse.down();
  await removableEditor.mouse.move(reviewArea.right - 8, reviewArea.bottom - 8, {
    steps: 4,
  });
  await removableEditor.mouse.up();
  await removableEditor.getByRole("button", { name: "Full page preview" }).click();
  await previewDimensions(removableEditor);
  results.pageReview.previewMarkedPixels = await removableEditor
    .locator("#preview-slot img")
    .first()
    .evaluate((image) => {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let marked = 0;
      for (let index = 0; index < pixels.length; index += 4)
        if (pixels[index] > 120 && pixels[index + 1] < 100 && pixels[index + 2] < 120)
          marked++;
      return marked;
    });
  assert.ok(results.pageReview.previewMarkedPixels > 12);
  await removableEditor.getByRole("button", { name: "Back to sections" }).click();
  await removableEditor.locator("#include-combined").check();
  await removableEditor
    .locator("#body")
    .fill("Synthetic capture selection and combined image.");
  await worker.evaluate(() => {
    const original = globalThis.fetch;
    let interrupt = true;
    globalThis.fetch = async (...args) => {
      if (
        interrupt &&
        String(args[0]).endsWith("/api/assets.upload") &&
        JSON.parse(args[1]?.body || "{}").filename === "full-page-combined.webp"
      ) {
        interrupt = false;
        throw Error("Synthetic combined upload interruption");
      }
      return original(...args);
    };
  });
  await removableEditor.locator("#send").click();
  await removableEditor.locator("#send:has-text('Retry Send')").waitFor();
  const interruptedCombined = await draft();
  assert.match(
    await removableEditor.locator("#status").textContent(),
    /thread is already published/i,
  );
  results.pageReview.resumeAtCombined =
    interruptedCombined?.frozen &&
    interruptedCombined.uploadIndex === interruptedCombined.capturePages.length;
  await removableEditor.evaluate(async (draftId) => {
    const { putPage } = await import(chrome.runtime.getURL("capture/page-store.js"));
    const oversized = new OffscreenCanvas(1920, 15000);
    const context = oversized.getContext("2d");
    context.fillStyle = "#f6f7f8";
    context.fillRect(0, 0, oversized.width, oversized.height);
    const blob = await oversized.convertToBlob({ type: "image/webp", quality: 0.7 });
    await putPage(draftId, 0, "combined", blob);
  }, interruptedCombined.id);
  await removableEditor.locator("#send").click();
  await removableEditor.getByText("Feedback sent").waitFor({ timeout: 120000 });
  const combinedThreadUrl = await removableEditor.locator("#thread").getAttribute("href");
  const combinedThreadId = combinedThreadUrl?.match(/[0-9a-f-]{36}/)?.[0];
  if (!combinedThreadId)
    throw Error("Combined screenshot submission lacks a thread link");
  const combinedThread = (await post("threads.get", { threadId: combinedThreadId }, auth))
    .data;
  results.pageReview.assetNames = combinedThread.assets.map((asset) => asset.filename);
  assert.ok(
    combinedThread.assets.at(-1).markings.some((mark) => mark.tool === "rectangle"),
    "Combined image must expose its drawn rectangle to MCP clients",
  );
  assert.deepEqual(
    combinedThread.assets
      .at(-1)
      .captureSections.map(({ startY, endY }) => [startY, endY]),
    pruned.capturePages.map(({ startY, endY }) => [startY, endY]),
  );
  results.pageReview.combinedMarkings = combinedThread.assets
    .at(-1)
    .markings.map((mark) => mark.tool);
  const combinedResponse = await fetch(
    `${access.url}${combinedThread.assets.at(-1).url}`,
    { headers: { Cookie: auth.cookie } },
  );
  assert.equal(combinedResponse.status, 200);
  const composite = await sharp(Buffer.from(await combinedResponse.arrayBuffer()))
    .extract({ left: 0, top: 0, width: 220, height: 250 })
    .removeAlpha()
    .raw()
    .toBuffer();
  let markedPixels = 0;
  for (let pixel = 0; pixel < composite.length; pixel += 3)
    if (
      composite[pixel] > 120 &&
      composite[pixel + 1] < 100 &&
      composite[pixel + 2] < 120
    )
      markedPixels++;
  results.pageReview.combinedMarkedPixels = markedPixels;
  assert.ok(markedPixels > 12, "Combined image is missing the page annotation");
  assert.equal(results.pageReview.previews, removableDraft.capturePages.length);
  assert.equal(results.pageReview.secondImageMatches, true);
  assert.equal(results.pageReview.resumeAtCombined, true);
  assert.deepEqual(results.pageReview.assetNames, [
    "full-page-001-of-004.webp",
    "full-page-003-of-004.webp",
    "full-page-004-of-004.webp",
    "full-page-combined.webp",
  ]);
}
