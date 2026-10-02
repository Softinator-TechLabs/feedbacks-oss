import assert from "node:assert/strict";

export async function verifyLargeVisibleCapture({
  context,
  page,
  toFixture,
  tabId,
  send,
  draft,
  extensionId,
  post,
  auth,
  results,
}) {
  await page.setViewportSize({ width: 1920, height: 1064 });
  await toFixture();
  await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = innerWidth;
    canvas.height = innerHeight;
    Object.assign(canvas.style, {
      position: "fixed",
      inset: "0",
      zIndex: "100000",
    });
    const image = canvas.getContext("2d").createImageData(canvas.width, canvas.height);
    let seed = 42;
    for (let offset = 0; offset < image.data.length; offset += 4) {
      seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
      image.data[offset] = seed & 255;
      image.data[offset + 1] = (seed >>> 8) & 255;
      image.data[offset + 2] = (seed >>> 16) & 255;
      image.data[offset + 3] = 255;
    }
    canvas.getContext("2d").putImageData(image, 0, 0);
    document.body.append(canvas);
  });
  const id = await tabId();
  await send({ type: "activate", tabId: id });
  await page.bringToFront();
  const result = await send({ type: "popupAction", tabId: id, action: "capture" });
  const captured = await draft();
  results.largeVisible = {
    captured: result.captured,
    error: captured?.captureError,
    pixels: captured?.context?.captureDimensions,
    pages: captured?.capturePages?.length || 0,
  };
  assert.equal(result.captured, true, JSON.stringify(results.largeVisible));
  assert.equal(captured.captureError, null);
  assert.deepEqual(captured.context.captureDimensions, { width: 1920, height: 1064 });
  const review = await context.newPage();
  try {
    await review.goto(`chrome-extension://${extensionId}/editor.html`);
    await review.locator("#canvas").waitFor({ state: "visible" });
    await review.waitForFunction(() => {
      const canvas = document.querySelector("#canvas");
      return canvas.width === 1920 && canvas.height === 1064;
    });
    assert.equal(await review.locator("#no-image").isChecked(), false);
    await review.locator("#body").fill("Synthetic large visible screenshot QA.");
    await review.locator("#send").click();
    await review.waitForURL("**/threads/*", { timeout: 120000 });
    const threadUrl = review.url();
    const threadId = threadUrl?.match(/[0-9a-f-]{36}/)?.[0];
    assert.ok(threadId, "A sent screenshot must produce a thread link");
    const thread = (await post("threads.get", { threadId }, auth)).data;
    assert.ok(
      thread.assets.some((asset) => asset.width === 1920 && asset.height === 1064),
      "The sent thread must retain the full viewport resolution",
    );
    results.largeVisible.sent = true;
  } finally {
    await review.close();
    await send({ type: "discard" });
    await page.setViewportSize({ width: 900, height: 650 });
  }
}
