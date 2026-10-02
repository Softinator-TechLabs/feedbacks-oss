import assert from "node:assert/strict";
import { previewDimensions } from "../setup/fixture.mjs";

export async function verifyPublicCapture({
  context,
  page,
  publicCaptureUrl,
  tabId,
  send,
  draft,
  extensionId,
  post,
  auth,
  results,
}) {
  if (process.env.FEEDBACKS_QA_PUBLIC_CAPTURE === "1") {
    await page.setViewportSize({ width: 1920, height: 1064 });
    await page.bringToFront();
    await page.goto(publicCaptureUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(2500);
    const publicTab = await tabId();
    const full = await send({
      type: "popupAction",
      tabId: publicTab,
      action: "capture-full",
    });
    const captured = await draft();
    results.publicSite = {
      url: publicCaptureUrl,
      fullCaptured: full.captured,
      fullPages: captured?.capturePages?.length || 0,
      fullError: captured?.captureError,
    };
    assert.equal(
      results.publicSite.fullCaptured,
      true,
      JSON.stringify(results.publicSite),
    );
    assert.ok(results.publicSite.fullPages > 1);
    if (process.env.FEEDBACKS_QA_PUBLIC_SEND === "1") {
      const review = await context.newPage();
      await review.goto(`chrome-extension://${extensionId}/editor.html`);
      await review.locator("#page-select option").last().waitFor({ state: "attached" });
      await review.locator("#full-page-toggle:not([disabled])").waitFor();
      await review.getByRole("button", { name: "Full page preview" }).click();
      results.publicSite.previewHeight = (await previewDimensions(review)).height;
      assert.ok(results.publicSite.previewHeight > 1064);
      await review.getByRole("button", { name: "Edit section" }).click();
      await review.locator("#include-combined").check();
      await review.locator("#body").fill("Synthetic local full-page upload QA.");
      await review.locator("#send").click();
      await Promise.race([
        review.waitForURL("**/threads/*", { timeout: 180000 }),
        review.locator("#send:has-text('Retry Send')").waitFor({ timeout: 180000 }),
      ]);
      results.publicSite.sent = review.url().includes("/threads/");
      results.publicSite.sendStatus = results.publicSite.sent
        ? "Thread opened"
        : await review.locator("#status").textContent();
      results.publicSite.uploadIndex = (await draft())?.uploadIndex;
      results.publicSite.frozen = (await draft())?.frozen;
      if (results.publicSite.sent) {
        const threadUrl = review.url();
        const threadId = threadUrl?.match(/[0-9a-f-]{36}/)?.[0];
        if (!threadId) throw Error("Public capture QA lacks a thread link");
        const thread = (await post("threads.get", { threadId }, auth)).data;
        results.publicSite.assets = thread.assets.map(({ filename, width, height }) => ({
          filename,
          width,
          height,
        }));
      }
      console.log(JSON.stringify({ publicSite: results.publicSite }));
      assert.equal(results.publicSite.sent, true, results.publicSite.sendStatus);
      assert.equal(results.publicSite.assets.length, captured.capturePages.length + 1);
      const combined = results.publicSite.assets.at(-1);
      assert.equal(combined.filename, "full-page-combined.webp");
      assert.ok(combined.width * combined.height <= 40000000);
      assert.ok(combined.height <= 12000);
      await review.close();
    }
    await send({ type: "discard" });
    await page.bringToFront();
    const visible = await send({
      type: "popupAction",
      tabId: publicTab,
      action: "capture",
    });
    const visibleDraft = await draft();
    results.publicSite.visibleCaptured = visible.captured;
    results.publicSite.visibleImage = !!visibleDraft?.image;
    assert.equal(results.publicSite.visibleCaptured, true);
    assert.equal(results.publicSite.visibleImage, true);
    await send({ type: "discard" });
    await page.setViewportSize({ width: 900, height: 650 });
  }
}
