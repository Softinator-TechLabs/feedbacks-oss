// Synthetic browser check for immediate, keyboard-accessible tooltips on both surfaces.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { chromium } from "playwright";

const web = await build({
  entryPoints: ["src/web/instant-tooltip.ts"],
  bundle: true,
  write: false,
  format: "iife",
  globalName: "TooltipQA",
  platform: "browser",
});
const extension = await readFile("extension/instant-tooltip.js", "utf8");
const browser = await chromium.launch({ channel: "chromium", headless: true });
try {
  for (const surface of ["web", "extension"]) {
    const page = await browser.newPage({ viewport: { width: 360, height: 280 } });
    await page.setContent(`
      <style>
        .instant-tooltip { position: fixed; max-width: 220px; padding: 6px 9px;
          background: #17324d; color: white; pointer-events: none; }
        .instant-tooltip[hidden] { display: none; }
      </style>
      <button id="icon" title="Settings" aria-label="Settings" style="position:absolute;right:0;top:0;width:44px;height:44px"><svg width="16" height="16"><circle cx="8" cy="8" r="6"/></svg></button>
      <button id="named" aria-label="Download image" style="position:absolute;left:12px;top:65px;width:44px;height:44px"><svg width="16" height="16"><circle cx="8" cy="8" r="6"/></svg></button>
      <button id="other" style="position:absolute;left:12px;top:145px">Other</button>
    `);
    if (surface === "web") {
      await page.addScriptTag({ content: web.outputFiles[0].text });
      await page.evaluate(() => window.TooltipQA.installInstantTooltips());
    } else {
      await page.addScriptTag({ content: extension });
      await page.evaluate(() => window.FeedbacksTooltips.install(document));
    }
    await page.locator("#icon").hover();
    const tip = page.getByRole("tooltip");
    assert.equal(
      await tip.isVisible(),
      true,
      `${surface}: hover tooltip appears immediately`,
    );
    assert.equal(await tip.textContent(), "Settings");
    assert.equal(await page.locator("#icon").getAttribute("title"), null);
    const box = await tip.boundingBox();
    assert(
      box && box.x >= 0 && box.x + box.width <= 360,
      `${surface}: tooltip stays in view`,
    );
    await page.locator("#other").hover();
    assert.equal(await tip.isVisible(), false);
    assert.equal(await page.locator("#icon").getAttribute("title"), "Settings");
    await page.locator("#named").focus();
    assert.equal(await tip.isVisible(), true, `${surface}: keyboard focus shows tooltip`);
    assert.equal(await tip.textContent(), "Download image");
    await page.keyboard.press("Escape");
    assert.equal(await tip.isVisible(), false);
    if (surface === "extension") {
      await page.evaluate(() => {
        const host = document.createElement("div");
        host.id = "review-host";
        document.body.append(host);
        const root = host.attachShadow({ mode: "open" });
        root.innerHTML =
          '<button title="Page controls" style="position:absolute;left:100px;top:180px">☷</button><button data-no-tooltip aria-label="Draft point 1" style="position:absolute;left:180px;top:180px">1</button>';
        window.FeedbacksTooltips.install(root);
      });
      await page.locator("#review-host button[title]").hover();
      const shadowTip = page.locator("#review-host [role='tooltip']");
      assert.equal(
        await shadowTip.isVisible(),
        true,
        "Page Controls shadow tooltip appears immediately",
      );
      assert.equal(await shadowTip.textContent(), "Page controls");
      await page.locator("#review-host [data-no-tooltip]").hover();
      assert.equal(
        await shadowTip.isVisible(),
        false,
        "Richer point preview has no duplicate tooltip",
      );
    }
    await page.close();
  }
  console.log("Immediate tooltip QA passed for web and extension.");
} finally {
  await browser.close();
}
