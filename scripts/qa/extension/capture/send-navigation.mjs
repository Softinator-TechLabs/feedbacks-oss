import assert from "node:assert/strict";

export async function verifySendNavigation({
  page,
  toFixture,
  send,
  id,
  draft,
  worker,
  context,
  extensionId,
  results,
  post,
  auth,
}) {
  await page.setViewportSize({ width: 900, height: 650 });
  await toFixture();
  await send({ type: "activate", tabId: id });
  await page.bringToFront();
  await page.evaluate(() => {
    const link = document.createElement("a");
    link.id = "qa-normal-link";
    link.href = "#normal";
    link.textContent = "Normal website navigation";
    document.querySelector("header").append(link);
  });
  await send({ type: "popupAction", tabId: id, action: "capture" });
  const review = await context.newPage();
  await review.goto(`chrome-extension://${extensionId}/editor.html`);
  await review.locator("#send-background:not([disabled])").waitFor();
  await review.locator("#body").fill("Synthetic background navigation acceptance");
  const reviewId = await worker.evaluate(
    async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id,
  );
  await worker.evaluate(() => {
    globalThis.qaNavigationFetch = globalThis.fetch;
    globalThis.qaNavigationBlocked = false;
    globalThis.fetch = async (...args) => {
      if (String(args[0]).endsWith("/api/assets.upload")) {
        globalThis.qaNavigationBlocked = true;
        await new Promise((resolve) => (globalThis.qaNavigationRelease = resolve));
        globalThis.fetch = globalThis.qaNavigationFetch;
      }
      return globalThis.qaNavigationFetch(...args);
    };
  });
  try {
    await review.locator("#send-background").click();
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await worker.evaluate(() => globalThis.qaNavigationBlocked)) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(
      await worker.evaluate(() => globalThis.qaNavigationBlocked),
      true,
      "upload reached its delayed gate",
    );
    assert.equal(review.isClosed(), false, "review remains alive during upload");
    assert.equal(
      await worker.evaluate(
        async () =>
          (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id,
      ),
      id,
      "website became active before upload completion",
    );
    const pending = await draft();
    assert.ok(pending.thread, "thread created while approved image is pending");
    assert.equal(pending.uploadIndex || 0, 0);
    assert.equal(
      await worker.evaluate(
        async (tabId) =>
          (
            await chrome.scripting.executeScript({
              target: { tabId },
              func: () => globalThis.feedbacksReviewActive,
            })
          )[0].result,
        id,
      ),
      false,
      "page review is off while the approved image is still uploading",
    );
    assert.equal(await page.locator("#feedbacks-review-root").count(), 0);
    assert.equal(
      await page.evaluate(() =>
        document.documentElement.hasAttribute("data-feedbacks-text-selection"),
      ),
      false,
    );
    assert.equal(
      await worker.evaluate(async (tabId) => {
        const { sessions } = await chrome.storage.local.get("sessions");
        return sessions?.[tabId];
      }, id),
      undefined,
    );
    assert.equal(
      await worker.evaluate((tabId) => chrome.action.getBadgeText({ tabId }), id),
      "",
    );
    await page.locator("#qa-normal-link").click();
    assert.ok(
      page.url().endsWith("#normal"),
      "normal website navigation works during upload",
    );
    await send({ type: "activate", tabId: id });
    const replacement = await worker.evaluate(async (tabId) => {
      const { sessions } = await chrome.storage.local.get("sessions");
      return sessions[tabId].reviewId;
    }, id);
    assert.notEqual(replacement, pending.reviewId);
    const closed = review.waitForEvent("close");
    await worker.evaluate(() => globalThis.qaNavigationRelease());
    await closed;
    assert.equal(
      await worker.evaluate(
        async (tabId) => !!(await chrome.tabs.get(tabId).catch(() => null)),
        reviewId,
      ),
      false,
    );
    const thread = (await post("threads.get", { threadId: pending.thread.id }, auth))
      .data;
    assert.equal(thread.assets.length, 1);
    assert.equal(await draft(), undefined);
    await worker.evaluate(
      async ({ tabId, reviewId }) => {
        for (const type of [
          "feedbackSaved",
          "feedbackThreadCreated",
          "feedbackSubmissionIncomplete",
        ])
          await chrome.tabs.sendMessage(tabId, { type, reviewId });
      },
      { tabId: id, reviewId: pending.reviewId },
    );
    assert.equal(
      await worker.evaluate(
        async (tabId) =>
          (
            await chrome.scripting.executeScript({
              target: { tabId },
              func: () => globalThis.feedbacksReviewActive,
            })
          )[0].result,
        id,
      ),
      true,
    );
    assert.doesNotMatch(
      await page
        .locator("#feedbacks-review-root")
        .evaluate((node) => node.shadowRoot.querySelector(".notice").textContent),
      /Feedback sent|Thread published/,
      "older upload notifications do not alter the replacement review",
    );
    results.sendNavigation = {
      websiteFocusedBeforeUpload: true,
      websiteUsableBeforeUpload: true,
      reviewOffBeforeUpload: true,
      replacementReviewPreserved: true,
      captureTabKeptUntilComplete: true,
      captureTabClosed: true,
      imageReadback: true,
    };
  } finally {
    await worker.evaluate(() => {
      globalThis.qaNavigationRelease?.();
      globalThis.fetch = globalThis.qaNavigationFetch;
    });
    if (!review.isClosed()) await review.close();
  }
}
