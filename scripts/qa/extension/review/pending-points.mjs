import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

export async function verifyPendingPoints({
  fixture,
  toFixture,
  exposeReviewRoot,
  send,
  id,
  page,
  root,
  worker,
  context,
  extensionId,
  draft,
  post,
  auth,
  teammateAuth,
  access,
  saveInlinePoint,
  setCaptureMarker,
  results,
}) {
  fixture.mode = "long";
  await toFixture();
  await exposeReviewRoot();
  await send({ type: "activate", tabId: id });
  assert.equal(
    await saveInlinePoint(
      page.getByRole("heading", { name: "Controlled page" }),
      "Top point",
    ),
    1,
  );
  await page.locator("#lower").scrollIntoViewIfNeeded();
  assert.equal(await saveInlinePoint(page.locator("#lower"), "Bottom point"), 2);
  // Finalize from the collapsed dock, using only already saved originals.
  await mkdir(join(root, ".local/finalize-qa"), { recursive: true });
  await page.screenshot({ path: join(root, ".local/finalize-qa/pending-points.png") });
  const finalizeState = await worker.evaluate(async (tabId) => {
    const [entry] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const button = globalThis.__feedbacksQaRoot.querySelector(".finalize-review");
        return { visible: !!button && !button.hidden, label: button?.textContent };
      },
    });
    return entry.result;
  }, id);
  assert.equal(finalizeState.visible, true, "Pending pins need a visible dock action");
  assert.match(finalizeState.label, /2 unsent/);
  assert.deepEqual(await setCaptureMarker("none", "large"), {
    sizeDisabled: true,
    marker: { style: "none", size: "large" },
  });
  await worker.evaluate(() => {
    globalThis.qaNativeCapture = chrome.tabs.captureVisibleTab;
    chrome.tabs.captureVisibleTab = () => {
      throw Error("Finalize must not capture");
    };
  });
  // An old completed/empty editor must not swallow a new review.
  const staleEditor = await context.newPage();
  await staleEditor.goto(`chrome-extension://${extensionId}/editor.html`);
  await page.bringToFront();
  const freshEditor = context.waitForEvent("page");
  await worker.evaluate(async (tabId) => {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        globalThis.__feedbacksQaRoot.querySelector(".finalize-review").click();
      },
    });
  }, id);
  await worker.evaluate(async () => {
    for (let i = 0; i < 100; i++) {
      const { draft } = await chrome.storage.local.get("draft");
      if (draft?.capturePages?.length === 2 && !draft.captureError) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw Error("Finalizing saved points did not prepare the draft");
  });
  await worker.evaluate(() => {
    chrome.tabs.captureVisibleTab = globalThis.qaNativeCapture;
  });
  const multiVisible = await draft();
  assert.equal(multiVisible.captureScope, "points");
  assert.equal(multiVisible.capturePages.length, 2);
  assert.deepEqual(multiVisible.context.captureMarker, { style: "none", size: "large" });
  assert.ok(
    multiVisible.pageToolStates.every((shapes) =>
      shapes.some((shape) => shape.tool === "point" && shape.markerStyle === "none"),
    ),
  );
  assert.deepEqual(
    multiVisible.capturePages.map((item) => item.pointNumber),
    [1, 2],
  );
  for (let i = 0; i < 2; i++)
    assert.ok(
      multiVisible.pageToolStates[i].some(
        (shape) => shape.tool === "point" && shape.number === i + 1,
      ),
    );
  assert.equal(multiVisible.captureError, null);
  results.inlineReview.finalizeWithoutCapture = true;
  assert.equal(multiVisible.context.pointEvidence, undefined);
  assert.equal(multiVisible.context.liveAnnotations, undefined);
  results.inlineReview.offscreenOriginalRetained = true;
  const pointsEditor = await freshEditor;
  await pointsEditor.waitForURL(
    `chrome-extension://${extensionId}/editor.html?draft=${multiVisible.id}`,
  );
  assert.notEqual(pointsEditor, staleEditor);
  await pointsEditor.locator("#send-header:not([disabled])").waitFor();
  await page.bringToFront();
  await send({ type: "resume" });
  const resumedEditors = await worker.evaluate(async (url) => {
    const editors = await chrome.runtime.getContexts({
      contextTypes: ["TAB"],
      documentUrls: [url],
    });
    return Promise.all(editors.map((editor) => chrome.tabs.get(editor.tabId)));
  }, pointsEditor.url());
  assert.equal(resumedEditors.length, 1, "Resume must reuse the matching editor");
  assert.equal(resumedEditors[0].active, true);
  await staleEditor.close();
  assert.equal(await pointsEditor.locator("#point-notes textarea").count(), 2);
  await pointsEditor.locator("#send-header").click();
  await pointsEditor.locator("#thread:not([hidden])").waitFor();
  const pointsThreadId = (await pointsEditor.locator("#thread").getAttribute("href"))
    .split("/")
    .at(-1);
  const pointsThread = (await post("threads.get", { threadId: pointsThreadId }, auth))
    .data;
  assert.equal(pointsThread.assets.length, 2, "Only the two originals should upload");
  assert.equal(pointsThread.context.annotations.length, 2);
  assert.equal(pointsThread.context.captureMarker.style, "none");
  assert.ok(
    pointsThread.assets.every((asset) =>
      asset.markings.some((mark) => mark.tool === "point"),
    ),
  );
  assert.deepEqual(
    pointsThread.assets.map(
      (asset) => asset.markings.find((mark) => mark.tool === "point")?.annotationId,
    ),
    pointsThread.context.annotations.map((item) => item.id),
  );
  const markerCookieSplit = teammateAuth.cookie.indexOf("=");
  await context.addCookies([
    {
      name: teammateAuth.cookie.slice(0, markerCookieSplit),
      value: teammateAuth.cookie.slice(markerCookieSplit + 1),
      url: access.url,
      sameSite: "Strict",
    },
  ]);
  const noMarkerThreadPage = await context.newPage();
  const noMarkerResponse = await noMarkerThreadPage.goto(
    `${access.url}/threads/${pointsThreadId}`,
  );
  await noMarkerThreadPage.waitForTimeout(700);
  if (
    !(await noMarkerThreadPage
      .getByRole("heading", { name: "Review on the page" })
      .count())
  )
    throw Error(
      `No-marker thread did not render: ${JSON.stringify({ status: noMarkerResponse?.status(), url: noMarkerThreadPage.url(), text: (await noMarkerThreadPage.locator("body").innerText()).slice(0, 500) })}`,
    );
  assert.equal(await noMarkerThreadPage.locator(".review-point-figure img").count(), 2);
  assert.equal(await noMarkerThreadPage.locator(".review-image-pin").count(), 0);
  assert.equal(
    await noMarkerThreadPage.getByRole("button", { name: "Hide pins" }).count(),
    0,
  );
  await noMarkerThreadPage.close();
  await context.clearCookies();
  assert.equal(await draft(), undefined);
  await pointsEditor.close();
  await page.bringToFront();
}
