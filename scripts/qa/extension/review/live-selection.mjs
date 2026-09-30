import assert from "node:assert/strict";
import { join } from "node:path";

// Explicitly supplied public URLs only; the server remains a disposable sandbox.
export async function verifyLiveSelection({
  page,
  send,
  id,
  worker,
  exposeReviewRoot,
  root,
  results,
}) {
  const urls = (process.env.FEEDBACKS_QA_SELECTION_URLS || "").split(",").filter(Boolean);
  for (const url of urls) {
    assert.equal(new URL(url).protocol, "https:");
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    const index = await page.locator("h1,h2,h3,p").evaluateAll((elements) =>
      elements.findIndex((el) => {
        const r = el.getBoundingClientRect();
        const text = el.textContent.trim();
        return (
          r.width > 100 &&
          r.height > 15 &&
          text.length > 15 &&
          text.length < 160 &&
          getComputedStyle(el).visibility === "visible"
        );
      }),
    );
    assert.ok(index >= 0, `No readable heading on ${url}`);
    const target = await page.locator("h1,h2,h3,p").nth(index).elementHandle();
    const glyphPosition = () =>
      target.evaluate((el) => {
        const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          const start = node.textContent.search(/\S/);
          if (start < 0) continue;
          const range = el.ownerDocument.createRange();
          range.setStart(node, start);
          range.setEnd(node, Math.min(start + 2, node.length));
          const r = [...range.getClientRects()].find((r) => r.width > 2 && r.height > 8);
          if (r) {
            const box = el.getBoundingClientRect();
            return { x: r.x - box.x + r.width / 2, y: r.y - box.y + r.height / 2 };
          }
        }
        throw Error("No visible text glyph");
      });
    await target.scrollIntoViewIfNeeded();
    const before = await target.evaluate((el) => ({
      text: el.textContent.trim(),
      userSelect: getComputedStyle(el).userSelect,
    }));
    await target.dblclick({ position: await glyphPosition() });
    const blockedBefore = !(await page.evaluate(() => String(getSelection()).trim()));
    await exposeReviewRoot();
    await send({ type: "activate", tabId: id });
    assert.equal(await target.evaluate((el) => getComputedStyle(el).userSelect), "text");
    await target.dblclick({ position: await glyphPosition() });
    const selection = await page.evaluate(() => String(getSelection()).trim());
    assert.ok(selection, `Native selection failed on ${url}`);
    assert.ok(
      before.text.includes(selection),
      JSON.stringify({ url, before: before.text, selection }),
    );
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
    for (let n = 0; n < 30 && !(await actionVisible()); n++)
      await page.waitForTimeout(100);
    assert.equal(await actionVisible(), true, `Suggest edit missing on ${url}`);
    await page.screenshot({
      path: join(
        root,
        ".local/remaining-todos-qa",
        `selection-unlocked-${new URL(url).hostname}.png`,
      ),
    });
    await send({ type: "popupAction", tabId: id, action: "stop" });
    assert.equal(
      await target.evaluate((el) => getComputedStyle(el).userSelect),
      before.userSelect,
    );
    results.liveSelection ||= [];
    results.liveSelection.push({
      url,
      blockedBefore,
      selected: selection,
      suggestEdit: true,
      restoredOnExit: true,
    });
  }
}
