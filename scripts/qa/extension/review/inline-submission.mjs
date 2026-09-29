import assert from "node:assert/strict";
import { join } from "node:path";

export async function verifyInlineSubmission({
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
  saveInlinePoint,
  root,
  context,
  extensionId,
  post,
  auth,
}) {
  fixture.mode = "long";
  await toFixture();
  await exposeReviewRoot();
  await send({ type: "activate", tabId: id });
  await page.getByRole("heading", { name: "Controlled page" }).click({ button: "right" });
  await waitReview((state) => state.ready);
  await page.screenshot({
    path: join(root, ".local/remaining-todos-qa/inline-comment-desktop.png"),
  });
  await worker.evaluate(async (tabId) => {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const menu = globalThis.__feedbacksQaRoot.querySelector(".point-menu");
        menu.querySelector("textarea").value = "Make this heading shorter";
        [...menu.querySelectorAll("button")]
          .find((button) => button.textContent === "Save point")
          .click();
      },
    });
  }, id);
  await waitReview((state) => state.points === 1);
  const pinLocation = () =>
    worker.evaluate(async (tabId) => {
      const [entry] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const root = globalThis.__feedbacksQaRoot;
          const pin = root.querySelector(".saved-draft-pin");
          if (!pin) return null;
          const r = pin.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        },
      });
      return entry.result;
    }, id);
  const desktopPoint = await pinLocation();
  await page.mouse.move(desktopPoint.x, desktopPoint.y);
  await page.waitForTimeout(200);
  const hoverState = await worker.evaluate(async (tabId) => {
    const [entry] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const preview = globalThis.__feedbacksQaRoot.querySelector(".draft-preview");
        return {
          text: preview?.textContent,
          visible: !!preview?.getBoundingClientRect().width,
        };
      },
    });
    return entry.result;
  }, id);
  assert.equal(hoverState.visible, true);
  assert.match(hoverState.text, /Draft, not sent/);
  assert.match(hoverState.text, /Edit point/);
  await page.screenshot({
    path: join(root, ".local/remaining-todos-qa/draft-pin-popover.png"),
  });
  await page.setViewportSize({ width: 390, height: 650 });
  await page.waitForTimeout(300);
  const mobilePoint = await pinLocation();
  assert.ok(
    mobilePoint.x < desktopPoint.x,
    "Point should follow the heading after responsive reflow",
  );
  assert.ok(mobilePoint.x < 390);
  await page.setViewportSize({ width: 900, height: 650 });
  await page.waitForTimeout(200);
  // Bare T works away from fields; T inside a website input must not resize.
  await page.evaluate(() => {
    const input = document.createElement("input");
    input.id = "typing-fixture";
    document.body.append(input);
    input.focus({ preventScroll: true });
  });
  await page.keyboard.type("mtdwspr");
  assert.equal(await page.evaluate(() => innerWidth), 900);
  assert.equal(await page.locator("#typing-fixture").inputValue(), "mtdwspr");
  await page.evaluate(() => document.querySelector("#typing-fixture").remove());
  await page.keyboard.press("r");
  await page.locator("#feedbacks-review-root").waitFor({ state: "detached" });
  await page.keyboard.press("t");
  assert.equal(await page.evaluate(() => innerWidth), 900);
  await send({ type: "activate", tabId: id });
  await waitReview((state) => state.points === 1);
  results.responsiveDraft = {
    desktopPoint,
    mobilePoint,
    hoverPopover: true,
    websiteTypingSafe: true,
    stopKey: true,
  };
  assert.equal(
    await saveInlinePoint(
      page.getByRole("link", { name: "Broken same-origin link" }),
      "Repair this link",
    ),
    2,
  );
  assert.equal(await draft(), undefined, "The editor must not open after each point");
  const setCaptureMarker = async (style, size) =>
    worker.evaluate(
      async ({ tabId, style, size }) => {
        const [entry] = await chrome.scripting.executeScript({
          target: { tabId },
          func: ({ style, size }) => {
            const panel = globalThis.__feedbacksQaRoot;
            const styleSelect = panel.querySelector(
              '[aria-label="Screenshot marker for this review"]',
            );
            const sizeSelect = panel.querySelector(
              '[aria-label="Screenshot marker size for this review"]',
            );
            styleSelect.value = style;
            styleSelect.dispatchEvent(new Event("change", { bubbles: true }));
            sizeSelect.value = size;
            sizeSelect.dispatchEvent(new Event("change", { bubbles: true }));
            return { sizeDisabled: sizeSelect.disabled };
          },
          args: [{ style, size }],
        });
        return {
          ...entry.result,
          marker: (await chrome.tabs.sendMessage(tabId, { type: "captureContext" }))
            .captureMarker,
        };
      },
      { tabId: id, style, size },
    );
  assert.deepEqual(await setCaptureMarker("none", "large"), {
    sizeDisabled: true,
    marker: { style: "none", size: "large" },
  });
  assert.deepEqual(await setCaptureMarker("arrow", "medium"), {
    sizeDisabled: false,
    marker: { style: "arrow", size: "medium" },
  });
  assert.deepEqual(await setCaptureMarker("ring", "small"), {
    sizeDisabled: false,
    marker: { style: "ring", size: "small" },
  });
  const inlineCapture = await send({ type: "popupAction", tabId: id, action: "capture" });
  const inlineDraft = await draft();
  assert.equal(inlineCapture.captured, true);
  assert.deepEqual(
    inlineDraft.context.annotations.map(({ body }) => body),
    ["Make this heading shorter", "Repair this link"],
  );
  assert.notEqual(
    inlineDraft.context.annotations[0].anchor.selector,
    inlineDraft.context.annotations[1].anchor.selector,
  );
  for (const candidate of context
    .pages()
    .filter((candidate) =>
      candidate.url().startsWith(`chrome-extension://${extensionId}/editor.html`),
    ))
    await candidate.close();
  const inlineEditor = await context.newPage();
  await inlineEditor.goto(`chrome-extension://${extensionId}/editor.html`);
  await inlineEditor.locator("#point-notes textarea").first().waitFor();
  assert.deepEqual(
    await inlineEditor
      .locator("#point-notes textarea")
      .evaluateAll((nodes) => nodes.map((node) => node.value)),
    ["Make this heading shorter", "Repair this link"],
  );
  await inlineEditor
    .locator("#point-notes textarea")
    .first()
    .fill("Make this heading **clearer**");
  await inlineEditor.waitForFunction(
    async () =>
      (await chrome.storage.local.get("draft")).draft?.context.annotations?.[0]?.body ===
      "Make this heading **clearer**",
  );
  await inlineEditor.waitForTimeout(600);
  assert.equal(
    (await draft()).context.annotations[0].body,
    "Make this heading **clearer**",
  );
  await inlineEditor.reload();
  await inlineEditor.waitForFunction(() => {
    const canvas = document.getElementById("canvas");
    return canvas?.width > 0 && !document.getElementById("send")?.disabled;
  });
  assert.equal(
    await inlineEditor.locator("#point-notes textarea").first().inputValue(),
    "Make this heading **clearer**",
  );
  assert.equal(await inlineEditor.locator("#body").inputValue(), "");
  await inlineEditor.locator('[data-tool="arrow"]').click();
  await inlineEditor.locator("#canvas").scrollIntoViewIfNeeded();
  const arrowCanvas = await inlineEditor.locator("#canvas").boundingBox();
  assert.ok(arrowCanvas);
  await inlineEditor.mouse.move(
    arrowCanvas.x + arrowCanvas.width * 0.2,
    arrowCanvas.y + arrowCanvas.height * 0.3,
  );
  await inlineEditor.mouse.down();
  await inlineEditor.mouse.move(
    arrowCanvas.x + arrowCanvas.width * 0.4,
    arrowCanvas.y + arrowCanvas.height * 0.4,
  );
  await inlineEditor.mouse.up();
  await inlineEditor.locator('[data-tool="pencil"]').click();
  await inlineEditor.locator("#canvas").scrollIntoViewIfNeeded();
  const pencilCanvas = await inlineEditor.locator("#canvas").boundingBox();
  assert.ok(pencilCanvas);
  await inlineEditor.mouse.move(
    pencilCanvas.x + pencilCanvas.width * 0.5,
    pencilCanvas.y + pencilCanvas.height * 0.5,
  );
  await inlineEditor.mouse.down();
  await inlineEditor.mouse.move(
    pencilCanvas.x + pencilCanvas.width * 0.6,
    pencilCanvas.y + pencilCanvas.height * 0.6,
    { steps: 4 },
  );
  await inlineEditor.mouse.up();
  await inlineEditor.waitForTimeout(500);
  assert.ok(
    (await draft()).toolState.some((mark) => mark.tool === "arrow"),
    `Arrow annotation was not saved: ${JSON.stringify((await draft()).toolState.map((mark) => mark.tool))}`,
  );
  await inlineEditor.locator("#send-header").click();
  await inlineEditor.getByText("Feedback sent").waitFor({ timeout: 120000 });
  const inlineThreadUrl = await inlineEditor.locator("#thread").getAttribute("href");
  const inlineThreadId = inlineThreadUrl?.match(/[0-9a-f-]{36}/)?.[0];
  assert.ok(inlineThreadId);
  const inlineThread = (await post("threads.get", { threadId: inlineThreadId }, auth))
    .data;
  assert.deepEqual(
    inlineThread.context.annotations.map(({ body }) => body),
    ["Make this heading **clearer**", "Repair this link"],
  );
  assert.equal(inlineThread.context.annotations[0].anchor.tagName, "h1");
  assert.ok(inlineThread.context.annotations[0].anchor.rect.width > 0);
  assert.equal(
    typeof inlineThread.context.annotations[0].anchor.styles.borderStyle,
    "string",
  );
  assert.equal(inlineThread.assets.length, 3);
  assert.ok(
    inlineThread.assets.every((asset) => asset.rendition === "screenshot"),
    "approved point captures should keep pins in metadata, outside the image pixels",
  );
  assert.deepEqual(
    inlineThread.assets[0].markings
      .filter((mark) => mark.tool === "point")
      .map((mark) => mark.annotationId),
    inlineThread.context.annotations.map((item) => item.id),
  );
  assert.ok(inlineThread.assets[0].markings.some((mark) => mark.tool === "arrow"));
  assert.ok(inlineThread.assets[0].markings.some((mark) => mark.tool === "pencil"));
  assert.equal(inlineThread.context.captureMarker.style, "ring");
  assert.equal(
    inlineThread.assets[0].markings.some((mark) => mark.origin === "element"),
    false,
  );
  assert.equal(inlineThread.assets[0].captureRegion.pageWidth, 900);
  results.inlineReview = {
    points: inlineThread.context.annotations.length,
    selectorsDistinct: true,
    screenshotSent: true,
    overallNoteOptional: true,
    markings: inlineThread.assets[0].markings.map((mark) => mark.tool),
  };
  await inlineEditor.close();
  await page.bringToFront();
  assert.match((await inspectReview()).notice, /Feedback sent/i);
  await send({ type: "activate", tabId: id });
  return { inlineThreadId, inlineThread, setCaptureMarker };
}
