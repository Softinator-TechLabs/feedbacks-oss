import assert from "node:assert/strict";
import sharp from "sharp";

export async function verifyReviewInteractions({
  page,
  fixture,
  toFixture,
  exposeReviewRoot,
  send,
  id,
  worker,
  draft,
  results,
  waitReview,
  inspectReview,
}) {
  results.qa = await send({ type: "popupAction", tabId: id, action: "qa-scan" });
  const qaDraft = await draft();
  results.qaDraft = {
    hasAltFinding: /alt/i.test(qaDraft?.body || ""),
    hasBrokenLink: /missing/i.test(qaDraft?.body || ""),
    hasImage: Boolean(qaDraft?.image),
  };
  await send({ type: "discard" });

  fixture.mode = "hover";
  await toFixture();
  await exposeReviewRoot();
  await send({ type: "activate", tabId: id });
  const sendFromReview = (message) =>
    worker.evaluate(
      async ({ tabId, message }) =>
        (
          await chrome.scripting.executeScript({
            target: { tabId },
            func: (message) => chrome.runtime.sendMessage(message),
            args: [message],
          })
        )[0].result,
      { tabId: id, message },
    );
  // Default navigation lock leaves menus usable but prevents leaving the page.
  await page.getByRole("link", { name: "Broken same-origin link" }).click();
  assert.equal(new URL(page.url()).pathname, "/review");
  const formBlocked = await page.evaluate(() => {
    const form = document.createElement("form");
    document.body.append(form);
    const event = new Event("submit", { bubbles: true, cancelable: true });
    form.dispatchEvent(event);
    form.remove();
    return event.defaultPrevented;
  });
  assert.equal(formBlocked, true);
  const unlocked = await send({ type: "popupAction", tabId: id, action: "navigation" });
  assert.equal(unlocked.navigationLocked, false);
  const defaultAllowed = await page
    .getByRole("link", { name: "Broken same-origin link" })
    .evaluate((link) => {
      const event = new MouseEvent("click", { bubbles: true, cancelable: true });
      let allowed;
      window.addEventListener(
        "click",
        (e) => {
          allowed = !e.defaultPrevented;
          e.preventDefault();
        },
        { once: true },
      );
      link.dispatchEvent(event);
      return allowed;
    });
  assert.equal(defaultAllowed, true);
  await send({ type: "popupAction", tabId: id, action: "navigation" });

  const dockResult = await worker.evaluate(async (tabId) => {
    const [entry] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const root = globalThis.__feedbacksQaRoot;
        const dock = root.querySelector(".review-dock");
        const grip = root.querySelector(".review-drag");
        const before = dock.getBoundingClientRect().left;
        grip.dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
        );
        const moved = dock.getBoundingClientRect().left < before;
        root.querySelector(".drawer-handle").click();
        const bounds = root.querySelector(".bar").getBoundingClientRect();
        const fits = bounds.top >= 0 && bounds.bottom <= innerHeight;
        [...root.querySelectorAll(".review-bar-heading button")]
          .find((b) => b.textContent === "Hide")
          .click();
        return {
          moved,
          visibleGrip: root.querySelectorAll(".drag-grip circle").length === 6,
          moveHint: root.querySelector(".drag-hint").textContent,
          fits,
          hidden: dock.hidden,
          label: root.querySelector(".drawer-handle").getAttribute("aria-label"),
        };
      },
    });
    return entry.result;
  }, id);
  assert.equal(dockResult.moved, true);
  assert.equal(dockResult.visibleGrip, true);
  assert.match(dockResult.moveHint, /Drag the dotted handle/);
  assert.equal(dockResult.fits, true);
  assert.equal(dockResult.hidden, true);
  assert.doesNotMatch(dockResult.label, /FeedbacksS/);
  await send({ type: "popupAction", tabId: id, action: "show-controls" });
  await worker.evaluate(async (tabId) => {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const root = globalThis.__feedbacksQaRoot;
        if (root.querySelector(".review-dock").hidden)
          throw Error("Dock did not restore");
        root.querySelector(".drawer-handle").click();
      },
    });
  }, id);
  await send({ type: "saveReviewPreferences", reviewShortcuts: false });
  const disabledWidth = await page.evaluate(() => innerWidth);
  await page.keyboard.press("t");
  assert.equal(await page.evaluate(() => innerWidth), disabledWidth);
  await send({ type: "saveReviewPreferences", reviewShortcuts: true });
  await page.locator("#hover-host").hover();
  const liveHover = await worker.evaluate(async (tabId) => {
    const [entry] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () =>
        !globalThis.__feedbacksQaRoot
          .querySelector(".hover-target")
          .classList.contains("hidden"),
    });
    return entry.result;
  }, id);
  assert.equal(
    liveHover,
    true,
    "Review should highlight a hovered element before selection",
  );
  const menuBounds = await page.locator("#hover-menu").boundingBox();
  await worker.evaluate(async (tabId) => {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const send = chrome.runtime.sendMessage.bind(chrome.runtime);
        chrome.runtime.sendMessage = async (message, ...rest) => {
          if (message.type === "freezeView")
            await new Promise((resolve) => setTimeout(resolve, 1200));
          return send(message, ...rest);
        };
      },
    });
  }, id);
  await page.locator("#hover-menu").evaluate((menu) => {
    // A transitioning menu must retain its selected visual state during capture.
    menu.style.transition = "opacity .2s ease, transform .2s ease";
    window.qaMenuMotion = menu.animate(
      [{ transform: "translateY(0px)" }, { transform: "translateY(16px)" }],
      { duration: 1300, iterations: Infinity, direction: "alternate" },
    );
  });
  await page.mouse.click(menuBounds.x + 20, menuBounds.y + 20, { button: "right" });
  await waitReview((state) => state.ready);
  const firstPaint = await worker.evaluate(
    async (tabId) =>
      (
        await chrome.scripting.executeScript({
          target: { tabId },
          func: async () => {
            // The menu is synchronous; its first-paint probe runs next frame.
            // Fast workers can read the visible menu before that frame occurs.
            if (!globalThis.__pointFirstPaint) await new Promise(requestAnimationFrame);
            return globalThis.__pointFirstPaint;
          },
        })
      )[0].result,
    id,
  );
  assert.equal(
    firstPaint.visible,
    true,
    "Comment field must paint before a delayed original capture finishes",
  );
  await page.mouse.move(700, 500);
  await page.keyboard.type("t");
  await waitReview((state) => state.frozen);
  assert.equal(
    (await inspectReview()).frozen,
    true,
    "Capture a menu during its entrance animation",
  );
  await page.evaluate(() => {
    window.qaMenuMotion.cancel();
    document.body.dispatchEvent(new Event("scroll"));
    const video = document.createElement("video");
    document.body.append(video);
    video.dispatchEvent(new Event("resize"));
    video.remove();
  });
  assert.equal(
    (await inspectReview()).ready,
    true,
    "Nested scroll and video resize must not close the comment editor",
  );
  await page.mouse.move(700, 500);
  assert.equal(await page.locator("#hover-menu").isVisible(), false);
  assert.equal(
    (await inspectReview()).frozen,
    true,
    "The selected hover state should stay visible while writing the point",
  );
  const typingWidth = await page.evaluate(() => innerWidth);
  await page.keyboard.type("Keep this menu visible for review");
  assert.equal(
    await page.evaluate(() => innerWidth),
    typingWidth,
    "Typing t in a comment must not switch to tablet size",
  );
  await worker.evaluate(async (tabId) => {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const menu = globalThis.__feedbacksQaRoot.querySelector(".point-menu");
        [...menu.querySelectorAll("button")]
          .find((button) => button.textContent === "Save point")
          .click();
      },
    });
  }, id);
  await waitReview((state) => state.points === 1);
  // Escape exits review without discarding saved points; opening again restores them.
  await page.keyboard.press("Escape");
  await page.locator("#feedbacks-review-root").waitFor({ state: "detached" });
  await send({ type: "activate", tabId: id });
  await waitReview((state) => state.points === 1);
  results.escapePreservesDraft = true;
  // The menu closed: its pin must not float over unrelated page content.
  await page.waitForTimeout(200);
  const hiddenDraft = await worker.evaluate(async (tabId) => {
    const [entry] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const root = globalThis.__feedbacksQaRoot;
        const result = {
          pins: root.querySelectorAll(".saved-draft-pin").length,
          handle: root.querySelector(".drawer-handle").getAttribute("aria-label"),
        };
        root.querySelector(".drawer-handle").click();
        const row = root.querySelector(".draft-section li");
        [...row.querySelectorAll("button")]
          .find((button) => button.textContent === "Edit")
          .click();
        return {
          ...result,
          editing: !!row.querySelector("textarea"),
          visible: !!row.querySelector("textarea")?.getBoundingClientRect().width,
        };
      },
    });
    return entry.result;
  }, id);
  assert.equal(hiddenDraft.pins, 0);
  assert.match(hiddenDraft.handle, /1 outside this view/);
  assert.equal(hiddenDraft.editing, true);
  assert.equal(
    hiddenDraft.visible,
    true,
    "Draft editor must actually be visible, not just exist in hidden DOM",
  );
  await worker.evaluate(async (tabId) => {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const root = globalThis.__feedbacksQaRoot;
        const row = root.querySelector(".draft-section li");
        row.querySelector("textarea").value = "Edited before screenshot";
        [...row.querySelectorAll("button")]
          .find((button) => button.textContent === "Save")
          .click();
      },
    });
  }, id);
  assert.match((await inspectReview()).meta, /not sent/i);
  assert.equal((await inspectReview()).points, 1);
  assert.equal(
    (await inspectReview()).frozen,
    false,
    "The frozen view should clear after saving",
  );
  results.hoverPoint = {
    saved: true,
    frozenWhileWriting: true,
    liveHover,
    draftPinEdited: true,
    typingWidth,
  };
  await send({ type: "popupAction", tabId: id, action: "stop" });
  await send({ type: "activate", tabId: id });
  await waitReview((state) => state.points === 1);
  results.hoverPoint.restoredAfterReviewToggle = true;
  // Preserve the selected menu's original pixels even when a later visible
  // screenshot contains only the closed page.
  await send({ type: "popupAction", tabId: id, action: "capture" });
  const menuDraft = await draft();
  assert.equal(menuDraft.capturePages.length, 2);
  assert.equal(menuDraft.capturePages[1].pointNumber, 1);
  assert.equal(
    menuDraft.pageToolStates[0].filter((shape) => shape.tool === "point").length,
    0,
  );
  assert.equal(
    menuDraft.pageToolStates[1].filter((shape) => shape.tool === "point").length,
    1,
  );
  const originalMenu = await send({ type: "capturePage", id: menuDraft.id, index: 1 });
  const menuPixel = await sharp(Buffer.from(originalMenu.image.split(",")[1], "base64"))
    .extract({
      left: Math.round(menuBounds.x + 8),
      top: Math.round(menuBounds.y + 8),
      width: 1,
      height: 1,
    })
    .raw()
    .toBuffer();
  assert.ok(
    menuPixel[2] > menuPixel[0],
    "Original hover menu background should survive closure",
  );
  results.hoverPoint.originalImageRetained = true;
  await send({ type: "discard" });
  return sendFromReview;
}
