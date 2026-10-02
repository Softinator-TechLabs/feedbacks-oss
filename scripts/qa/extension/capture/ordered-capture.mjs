import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

export async function verifyOrderedCapture({
  fixture,
  page,
  toFixture,
  send,
  id,
  draft,
  context,
  extensionId,
  previewDimensions,
  results,
  root,
  worker,
  access,
  post,
  auth,
}) {
  fixture.mode = "long";
  await page.setViewportSize({ width: 900, height: 650 });
  await toFixture();
  await send({ type: "popupAction", tabId: id, action: "capture-full" });
  const seriesDraft = await draft();
  const seriesEditor = await context.newPage();
  await seriesEditor.goto(`chrome-extension://${extensionId}/editor.html`);
  await seriesEditor.locator("#page-select option").last().waitFor({ state: "attached" });
  await seriesEditor.locator(".page-thumbnail img[src]").first().waitFor();
  await seriesEditor.locator("#full-page-toggle:not([disabled])").waitFor();
  await seriesEditor.getByRole("button", { name: "Full page preview" }).click();
  const seriesDimensions = await previewDimensions(seriesEditor);
  results.seriesReview = {
    previewHeight: seriesDimensions.height,
    previewWidth: seriesDimensions.width,
  };
  assert.ok(results.seriesReview.previewHeight > 650);
  assert.ok(results.seriesReview.previewWidth > 0);
  await seriesEditor.setViewportSize({ width: 1440, height: 900 });
  await seriesEditor.screenshot({
    path: join(root, ".local/remaining-todos-qa/full-page-preview-desktop.png"),
  });
  await seriesEditor.setViewportSize({ width: 390, height: 844 });
  await seriesEditor.screenshot({
    path: join(root, ".local/remaining-todos-qa/full-page-preview-mobile.png"),
  });
  await seriesEditor.getByRole("button", { name: "Edit section" }).click();
  await seriesEditor.setViewportSize({ width: 1440, height: 900 });
  await seriesEditor.screenshot({
    path: join(root, ".local/remaining-todos-qa/ordered-editor.png"),
  });
  await seriesEditor.setViewportSize({ width: 390, height: 844 });
  await seriesEditor.screenshot({
    path: join(root, ".local/remaining-todos-qa/ordered-editor-mobile.png"),
    fullPage: true,
  });
  await seriesEditor.setViewportSize({ width: 1440, height: 900 });
  results.seriesReview = {
    ...results.seriesReview,
    pageOptions: await seriesEditor.locator("#page-select option").count(),
    firstLabel: await seriesEditor.locator("#page-select option").first().textContent(),
  };
  await seriesEditor.locator("#page-next").click();
  await seriesEditor.waitForFunction(
    () => document.querySelector("#page-select")?.value === "1",
  );
  results.seriesReview.secondSelected = await seriesEditor
    .locator("#page-select")
    .inputValue();
  const beforeRedaction = await send({
    type: "capturePage",
    id: seriesDraft.id,
    index: 1,
  });
  await seriesEditor.locator('[data-tool="redact"]').click();
  const area = await seriesEditor.locator("#canvas").boundingBox();
  if (!area) throw Error("The ordered screenshot is not visible in the editor");
  await seriesEditor.mouse.move(area.x + 24, area.y + 24);
  await seriesEditor.mouse.down();
  await seriesEditor.mouse.move(area.x + 90, area.y + 65, { steps: 4 });
  await seriesEditor.mouse.up();
  await seriesEditor
    .getByText("Redaction permanently saved.", { exact: false })
    .waitFor();
  const afterRedaction = await send({
    type: "capturePage",
    id: seriesDraft.id,
    index: 1,
  });
  results.seriesReview.redactionPersisted =
    beforeRedaction.image !== afterRedaction.image &&
    (await draft()).imageRevision > seriesDraft.imageRevision;
  await worker.evaluate(() => {
    const original = globalThis.fetch;
    let interrupt = true;
    globalThis.fetch = async (...args) => {
      if (
        interrupt &&
        String(args[0]).endsWith("/api/assets.upload") &&
        JSON.parse(args[1]?.body || "{}").filename === "full-page-002-of-004.webp"
      ) {
        interrupt = false;
        await new Promise((resolve) => setTimeout(resolve, 1800));
        throw Error("Synthetic upload interruption");
      }
      return original(...args);
    };
  });
  await seriesEditor.locator("#body").fill("Synthetic ordered capture acceptance.");
  await seriesEditor.exposeFunction("reportUploadProgress", (entries) => {
    results.seriesReview.uploadProgress = entries;
  });
  await seriesEditor.evaluate(() => {
    window.qaUploadProgress = [];
    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === "submitProgress" && Number.isInteger(message.completed)) {
        window.qaUploadProgress.push({
          completed: message.completed,
          total: message.total,
          fills: ["send", "send-header"].map((id) => ({
            progress: document
              .getElementById(id)
              .style.getPropertyValue("--send-progress"),
            busy: document.getElementById(id).getAttribute("aria-busy"),
          })),
          actionsLocked: [
            "send",
            "send-header",
            "send-background",
            "send-background-header",
          ].every((id) => document.getElementById(id).disabled),
        });
        void window.reportUploadProgress(window.qaUploadProgress);
      }
    });
  });
  await seriesEditor.locator("#send").click();
  await seriesEditor.locator("#send-header:has-text('Sending 25%')").waitFor();
  await mkdir(join(root, ".local/finalize-qa"), { recursive: true });
  await seriesEditor.evaluate(() => scrollTo(0, 0));
  await seriesEditor.screenshot({
    path: join(root, ".local/finalize-qa/upload-fill.png"),
  });
  await seriesEditor.locator("#send:has-text('Retry Send')").waitFor();
  assert.equal(
    (await seriesEditor.locator("#send-header").textContent()).trim(),
    "Retry Send",
  );
  assert.equal(await seriesEditor.locator("#send-header").isEnabled(), true);
  const progressFills = await seriesEditor.evaluate(() => window.qaUploadProgress);
  assert.ok(progressFills.length > 0);
  for (const sample of progressFills)
    for (const fill of sample.fills) {
      assert.equal(
        fill.progress,
        `${Math.round((sample.completed / sample.total) * 100)}%`,
      );
      assert.equal(fill.busy, "true");
    }
  assert.equal(
    await seriesEditor.locator("#send-header").getAttribute("aria-busy"),
    "false",
  );
  const interrupted = await draft();
  assert.ok(
    interrupted?.thread?.id,
    "The thread was published before image upload stopped",
  );
  assert.match(
    await seriesEditor.locator("#status").textContent(),
    /thread is already published/i,
  );
  assert.equal(
    await seriesEditor.locator("#published-thread").getAttribute("href"),
    `${access.url}/threads/${interrupted.thread.id}`,
  );
  results.seriesReview.resumeIndex = interrupted?.uploadIndex;
  results.seriesReview.frozenAfterInterruption = interrupted?.frozen;
  results.seriesReview.visibleProgress = await seriesEditor
    .locator("#upload-label")
    .textContent();
  results.seriesReview.meter = await seriesEditor
    .locator("#upload-meter")
    .evaluate((meter) => meter.value);
  await seriesEditor.locator("#send-header").click();
  await seriesEditor.waitForURL("**/threads/*", { timeout: 120000 });
  assert.ok(results.seriesReview.uploadProgress.every((entry) => entry.actionsLocked));
  assert.equal(seriesEditor.url().includes("/threads/"), true);
  const seriesThreadUrl = seriesEditor.url();
  const seriesThreadId = seriesThreadUrl?.match(/[0-9a-f-]{36}/)?.[0];
  if (!seriesThreadId) throw Error("Ordered screenshot submission lacks a thread link");
  const seriesThread = (await post("threads.get", { threadId: seriesThreadId }, auth))
    .data;
  results.seriesReview.assetNames = seriesThread.assets.map((asset) => asset.filename);
  results.seriesReview.draftCleared = !(await draft());
  assert.equal(results.seriesReview.pageOptions, seriesDraft.capturePages.length);
  assert.equal(results.seriesReview.secondSelected, "1");
  assert.equal(results.seriesReview.redactionPersisted, true);
  assert.equal(results.seriesReview.resumeIndex, 1);
  assert.equal(results.seriesReview.frozenAfterInterruption, true);
  assert.equal(results.seriesReview.visibleProgress, "1 of 4 images uploaded · 25%");
  assert.equal(results.seriesReview.meter, 25);
  assert.deepEqual(
    results.seriesReview.assetNames,
    seriesDraft.capturePages.map((item) => item.name),
  );
  assert.equal(results.seriesReview.draftCleared, true);
  assert.ok(results.seriesReview.uploadProgress.some((entry) => entry.completed === 1));
  assert.ok(
    results.seriesReview.uploadProgress.some(
      (entry) => entry.completed === seriesDraft.capturePages.length,
    ),
  );
  return { seriesThreadId, seriesThread };
}
