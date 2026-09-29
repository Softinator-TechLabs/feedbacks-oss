import assert from "node:assert/strict";
import { join } from "node:path";

export async function verifyMultiscrollReview({
  setCaptureMarker,
  page,
  saveInlinePoint,
  worker,
  id,
  send,
  draft,
  results,
  context,
  extensionId,
  root,
  previewDimensions,
  toFixture,
  exposeReviewRoot,
  waitReview,
  inspectReview,
}) {
  await setCaptureMarker("ring", "small");
  // New editor tabs change the native capture area in headless Chromium.
  await page.setViewportSize({ width: 900, height: 563 });
  await page.evaluate(() => scrollTo(0, 0));
  await saveInlinePoint(
    page.getByRole("heading", { name: "Controlled page" }),
    "Top point",
  );
  await page.locator("#lower").scrollIntoViewIfNeeded();
  await saveInlinePoint(page.locator("#lower"), "Bottom point");
  await page.bringToFront();
  await worker.evaluate((tabId) => chrome.tabs.update(tabId, { active: true }), id);
  const multiScroll = await send({
    type: "popupAction",
    tabId: id,
    action: "capture-full",
  });
  const multiScrollDraft = await draft();
  assert.equal(multiScroll.captured, true, JSON.stringify(multiScroll));
  assert.equal(multiScrollDraft.captureScope, "fullPage");
  assert.equal(multiScrollDraft.context.annotations.length, 2);
  const markedPages = multiScrollDraft.pageToolStates.flatMap((states, pageIndex) =>
    states.map((shape) => [pageIndex, shape.number]),
  );
  assert.ok(markedPages.some(([, number]) => number === 1));
  assert.ok(markedPages.some(([, number]) => number === 2));
  assert.notEqual(
    markedPages.find(([, number]) => number === 1)[0],
    markedPages.find(([, number]) => number === 2)[0],
  );
  results.inlineReview.multiScrollPages = markedPages;
  const multiEditor = await context.newPage();
  await multiEditor.goto(`chrome-extension://${extensionId}/editor.html`);
  await multiEditor.locator("#full-page-toggle:not([disabled])").waitFor();
  const editorViewport = multiEditor.viewportSize();
  for (const width of [1280, 390, 320]) {
    await multiEditor.setViewportSize({ width, height: 800 });
    await multiEditor.evaluate(() => scrollTo(0, document.body.scrollHeight));
    const headerState = await multiEditor.evaluate(() => {
      const button = document.getElementById("send-header");
      const rect = button.getBoundingClientRect();
      return {
        visible: rect.top >= 0 && rect.bottom <= innerHeight && rect.right <= innerWidth,
        reachable: button.contains(
          document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2),
        ),
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    assert.deepEqual(headerState, { visible: true, reachable: true, overflow: false });
    const pointHeading = multiEditor.locator(".point-note-heading").first();
    await pointHeading.scrollIntoViewIfNeeded();
    const label = await pointHeading.locator("label").boundingBox();
    const original = await pointHeading.locator("button").boundingBox();
    assert.ok(
      original.x >= label.x + label.width + 11 ||
        original.y >= label.y + label.height + 7,
      "Point label and original-image action need a visible gap, including when wrapped",
    );
    if (width !== 320)
      await multiEditor.screenshot({
        path: join(root, `.local/remaining-todos-qa/editor-actions-${width}.png`),
      });
  }
  await multiEditor.setViewportSize(editorViewport);
  await multiEditor.evaluate(() => scrollTo(0, 0));

  await multiEditor.getByRole("button", { name: "Full page preview" }).click();
  await previewDimensions(multiEditor);
  const continuousHeight = multiScrollDraft.capturePages
    .filter((item) => !item.annotationId)
    .reduce((sum, item) => sum + item.pixelHeight, 0);
  assert.equal((await previewDimensions(multiEditor)).height, continuousHeight);
  results.inlineReview.combinedExcludesOriginals = true;
  await multiEditor.close();
  await send({ type: "discard" });

  await page.setViewportSize({ width: 390, height: 844 });
  await toFixture();
  await exposeReviewRoot();
  await send({ type: "activate", tabId: id });
  await page.getByRole("heading", { name: "Controlled page" }).click({ button: "right" });
  await waitReview((state) => state.ready);
  await page.screenshot({
    path: join(root, ".local/remaining-todos-qa/inline-comment-mobile.png"),
  });
  await page.keyboard.press("Escape");
  assert.equal((await inspectReview()).ready, false);
  assert.equal(await page.locator("#feedbacks-review-root").count(), 1);
  await page.keyboard.press("Escape");
  await page.locator("#feedbacks-review-root").waitFor({ state: "detached" });
  results.escapeClosesEditorBeforeExit = true;
  await page.setViewportSize({ width: 900, height: 650 });
}
