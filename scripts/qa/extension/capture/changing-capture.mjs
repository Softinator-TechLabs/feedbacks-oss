import assert from "node:assert/strict";

export async function verifyChangingCapture({
  page,
  fixture,
  toFixture,
  exposeReviewRoot,
  send,
  id,
  saveInlinePoint,
  worker,
  draft,
  context,
  extensionId,
  results,
}) {
  await page.setViewportSize({ width: 900, height: 650 });
  fixture.mode = "changing";
  await toFixture();
  await page.evaluate(() => clearInterval(window.qaTimer));
  await exposeReviewRoot();
  await send({ type: "activate", tabId: id });
  await saveInlinePoint(
    page.getByRole("heading", { name: "Controlled page" }),
    "Keep this original through retry",
  );
  // Move the viewport once after the first full-page step is measured. A height
  // timer can return to the same height (or grow forever, which capture supports).
  await worker.evaluate(() => {
    const send = chrome.tabs.sendMessage.bind(chrome.tabs);
    chrome.tabs.sendMessage = async (tabId, message, ...rest) => {
      const response = await send(tabId, message, ...rest);
      if (message.type === "fullPageScroll") {
        chrome.tabs.sendMessage = send;
        await chrome.scripting.executeScript({
          target: { tabId },
          func: () => scrollBy(0, 8),
        });
      }
      return response;
    };
  });
  const beforeChanging = await page.evaluate(() => scrollY);
  const changed = await send({ type: "popupAction", tabId: id, action: "capture-full" });
  const changingDraft = await draft();
  const beforeOriginalIndex = changingDraft.capturePages.findIndex(
    (item) => item.annotationId,
  );
  assert.ok(beforeOriginalIndex >= 0);
  const beforeOriginal = await send({
    type: "capturePage",
    id: changingDraft.id,
    index: beforeOriginalIndex,
  });
  results.changing = {
    captured: changed?.captured,
    hasImage: Boolean(changingDraft?.image),
    scrollRestored: Math.abs((await page.evaluate(() => scrollY)) - beforeChanging) < 2,
    error: changed?.error,
  };
  await page.evaluate(() => clearInterval(window.qaTimer));
  // Headless Chromium's native capture uses a 563px content area after
  // switching from an extension editor. Match that viewport for this test.
  await page.setViewportSize({ width: 900, height: 563 });
  const retainedArrow = {
    tool: "arrow",
    points: [
      { x: 40, y: 60 },
      { x: 140, y: 160 },
    ],
  };
  const editedNote = "Edited original note before retry";
  await send({
    type: "saveDraft",
    id: changingDraft.id,
    imageRevision: changingDraft.imageRevision,
    projectId: changingDraft.projectId,
    body: "Keep editor changes through page retry",
    pageIndex: beforeOriginalIndex,
    toolState: [...changingDraft.pageToolStates[beforeOriginalIndex], retainedArrow],
    annotations: changingDraft.context.annotations.map((item) => ({
      id: item.id,
      body: editedNote,
    })),
  });
  const retryEditor = await context.newPage();
  await retryEditor.goto(`chrome-extension://${extensionId}/editor.html`);
  await retryEditor.getByRole("button", { name: "Retry full-page capture" }).waitFor();
  await retryEditor.getByRole("button", { name: "Retry full-page capture" }).click();
  await retryEditor
    .getByText("Capture ready.", { exact: false })
    .waitFor({ timeout: 120000 });
  results.changing.retryPages = (await draft())?.capturePages?.length;
  assert.ok(results.changing.retryPages > 1);
  const retried = await draft();
  const afterOriginalIndex = retried.capturePages.findIndex((item) => item.annotationId);
  assert.ok(afterOriginalIndex >= 0);
  assert.equal(retried.context.annotations[0].body, editedNote);
  assert.deepEqual(
    retried.pageToolStates[afterOriginalIndex].find((shape) => shape.tool === "arrow"),
    retainedArrow,
  );
  const afterOriginal = await send({
    type: "capturePage",
    id: retried.id,
    index: afterOriginalIndex,
  });
  assert.equal(
    afterOriginal.image,
    beforeOriginal.image,
    "Retry keeps the exact original point pixels",
  );
  assert.equal(retried.capturePages.filter((item) => item.annotationId).length, 1);
  results.changing.originalRetainedThroughRetry = true;
  await send({ type: "discard" });
}
