import assert from "node:assert/strict";

export async function verifySelectionBlockers({
  page,
  fixture,
  toFixture,
  exposeReviewRoot,
  send,
  id,
  worker,
  results,
}) {
  fixture.mode = "selection-blocked";
  await toFixture();
  await page.locator("h1").dblclick({ position: { x: 40, y: 15 } });
  assert.equal(await page.evaluate(() => String(getSelection())), "");
  await exposeReviewRoot();
  await send({ type: "activate", tabId: id });
  await page.locator("h1").dblclick({ position: { x: 40, y: 15 } });
  assert.match(await page.evaluate(() => String(getSelection())), /Controlled/);
  const actionVisible = () =>
    worker.evaluate(
      async (tabId) =>
        (
          await chrome.scripting.executeScript({
            target: { tabId },
            func: () =>
              !globalThis.__feedbacksQaRoot
                .querySelector(".text-selection-action")
                .classList.contains("hidden"),
          })
        )[0].result,
      id,
    );
  for (let n = 0; n < 30 && !(await actionVisible()); n++) await page.waitForTimeout(100);
  assert.equal(await actionVisible(), true);
  await page.evaluate(() => {
    const frame = document.createElement("iframe");
    frame.id = "blocked-frame";
    frame.srcdoc = `<style>p{user-select:none!important}</style><p>Embedded blocked text</p><script>document.addEventListener('selectstart',e=>e.preventDefault(),true)</script>`;
    document.querySelector("main").append(frame);
  });
  const frameCopy = page.frameLocator("#blocked-frame").locator("p");
  for (
    let n = 0;
    n < 30 &&
    (await frameCopy.evaluate((el) => getComputedStyle(el).userSelect)) !== "text";
    n++
  )
    await page.waitForTimeout(100);
  await frameCopy.dblclick({ position: { x: 30, y: 8 } });
  assert.match(
    await frameCopy.evaluate((el) => String(el.ownerDocument.getSelection())),
    /Embedded/,
  );
  await page.locator("#inline-blocked").dblclick({ position: { x: 25, y: 8 } });
  assert.match(await page.evaluate(() => String(getSelection())), /Selection/);
  // Dismiss the previous floating action before selecting the adjacent line.
  await page.mouse.click(800, 600);
  for (let n = 0; n < 30 && (await actionVisible()); n++) await page.waitForTimeout(100);
  assert.equal(await actionVisible(), false);
  const boxless = page.locator("#boxless-blocked");
  const glyph = await boxless.evaluate((el) => {
    const range = el.ownerDocument.createRange();
    range.setStart(el.firstChild, 1);
    range.setEnd(el.firstChild, 2);
    const rect = range.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  });
  await page.mouse.dblclick(glyph.x, glyph.y);
  assert.match(await page.evaluate(() => String(getSelection())), /Boxless/);
  await page.getByRole("textbox", { name: "Editable control" }).fill("Still editable");
  await page.locator("#normal-control").click();
  assert.equal(await page.locator("#normal-control").getAttribute("data-clicked"), "yes");
  const recordingState = (state) =>
    worker.evaluate(
      ({ tabId, state }) =>
        chrome.tabs.sendMessage(tabId, {
          type: "recordingState",
          state,
          mode: "session",
          elapsedMs: 0,
        }),
      { tabId: id, state },
    );
  await recordingState("recording");
  assert.equal(
    await page.locator("h1").evaluate((el) => getComputedStyle(el).userSelect),
    "none",
  );
  await recordingState("idle");
  assert.equal(
    await page.locator("h1").evaluate((el) => getComputedStyle(el).userSelect),
    "text",
  );
  await send({ type: "popupAction", tabId: id, action: "stop" });
  assert.equal(
    await page.locator("h1").evaluate((el) => getComputedStyle(el).userSelect),
    "none",
  );
  await page.mouse.click(800, 600);
  await page.locator("h1").dblclick({ position: { x: 40, y: 15 } });
  assert.equal(await page.evaluate(() => String(getSelection())), "");
  results.selectionBlockers = {
    nativeMouseSelection: true,
    inlineImportant: true,
    boxlessText: true,
    siteControls: true,
    restoredOnExit: true,
    dynamicFrame: true,
    recordingRestored: true,
  };
}
