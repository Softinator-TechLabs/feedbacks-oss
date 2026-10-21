import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { chromium } from "playwright";

test(
  "review comments remain interactive above native modal previews",
  { skip: process.env.FEEDBACKS_RECORDING_BROWSER_SMOKE !== "1", timeout: 60000 },
  async () => {
    await mkdir(".local/remaining-todos-qa", { recursive: true });
    const browser = await chromium.launch({ headless: true });
    try {
      for (const modalFirst of [true, false]) {
        const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
        await page.route("https://review.test/**", (route) =>
          route.fulfill({
            contentType: "text/html",
            body: `<style>dialog{width:80vw;height:65vh;transform:scale(.9);overflow:hidden}iframe{width:100%;height:85%}</style>
            <button id="outside">Outside action</button>
            <dialog id="preview"><button id="inside">Site action</button><iframe title="Preview" srcdoc="<h1>Embedded review target</h1><p>Preview copy</p>"></iframe></dialog>
            <script>document.querySelectorAll('button').forEach(b=>b.onclick=()=>b.dataset.clicked='yes')</script>`,
          }),
        );
        await page.goto("https://review.test/");
        await page.addScriptTag({ content: "globalThis.__name = value => value;" });
        await page.evaluate(() => {
          const attach = Element.prototype.attachShadow;
          Element.prototype.attachShadow = function (options) {
            return attach.call(this, { ...options, mode: "open" });
          };
          (window as any).chrome = {
            runtime: {
              id: "fixture",
              sendMessage: async (input: any) => ({
                ok: true,
                data: input.type === "threads" ? { items: [], nextOffset: null } : {},
              }),
              onMessage: {
                addListener: (listener: any) => {
                  (window as any).deliver = (input: any) =>
                    new Promise((resolve) => listener(input, { id: "fixture" }, resolve));
                },
              },
            },
          };
        });
        for (const file of [
          "utils.js",
          "frame-dom.js",
          "review/anchor-evidence.js",
          "review/text-selection.js",
          "content.js",
        ])
          await page.addScriptTag({ path: `extension/${file}` });
        if (modalFirst)
          await page
            .locator("#preview")
            .evaluate((el: HTMLDialogElement) => el.showModal());
        await page.evaluate(
          (css) =>
            (window as any).deliver({
              type: "activate",
              project: { id: "fixture", name: "Fixture" },
              reviewId: "fixture",
              css,
            }),
          await readFile("extension/content.css", "utf8"),
        );
        if (!modalFirst)
          await page
            .locator("#preview")
            .evaluate((el: HTMLDialogElement) => el.showModal());
        for (const width of [1280, 390]) {
          await page.setViewportSize({ width, height: 800 });
          await page
            .frameLocator("iframe")
            .getByRole("heading")
            .click({ button: "right" });
          const comment = page.getByLabel("Comment on selected element", { exact: true });
          await comment.waitFor({ state: "visible" });
          assert.equal(
            await comment.evaluate((el: HTMLTextAreaElement) => {
              el.focus();
              return (el.getRootNode() as ShadowRoot).activeElement === el;
            }),
            true,
            "the comment must escape native dialog inertness",
          );
          await comment.fill("Synthetic modal review", { timeout: 2000 });
          assert.equal(await comment.inputValue(), "Synthetic modal review");
          const drawer = page.locator(".bar");
          const handle = page.locator(".drawer-handle");
          if (await drawer.isVisible()) await handle.click();
          await handle.hover();
          assert.equal(
            await drawer.isVisible(),
            false,
            "Hovering page controls must not cover an active comment",
          );
          assert.equal(await comment.inputValue(), "Synthetic modal review");
          await handle.click();
          assert.equal(
            await drawer.isVisible(),
            true,
            "An explicit click still opens the controls while commenting",
          );
          await handle.click();
          const menu = page.getByRole("dialog", {
            name: "Feedback at this point",
            exact: true,
          });
          const box = await menu.boundingBox();
          assert.ok(box && box.x >= 0 && box.x + box.width <= width + 1);
          if (modalFirst)
            await page.screenshot({
              path: `.local/remaining-todos-qa/modal-comment-${width}.png`,
            });
          await comment.press("Escape");
          assert.equal(
            await page.locator("#preview").evaluate((el) => el.matches(":modal")),
            true,
          );
          await page.locator("#inside").click();
          assert.equal(await page.locator("#inside").getAttribute("data-clicked"), "yes");
        }
        await page.locator("#preview").evaluate((el: HTMLDialogElement) => el.close());
        await page.waitForFunction(
          () =>
            document.querySelector("#feedbacks-review-root")?.parentElement ===
            document.documentElement,
        );
        await page.locator("#outside").click({ timeout: 2000 });
        assert.equal(await page.locator("#outside").getAttribute("data-clicked"), "yes");
        // Opening the same modal again must return controls to its active subtree.
        await page
          .locator("#preview")
          .evaluate((el: HTMLDialogElement) => el.showModal());
        await page.frameLocator("iframe").getByRole("heading").click({ button: "right" });
        await page
          .getByLabel("Comment on selected element", { exact: true })
          .fill("Reopened modal", { timeout: 2000 });
        await page.evaluate(() => (window as any).deliver({ type: "deactivate" }));
        assert.equal(await page.locator("#feedbacks-review-root").count(), 0);
        await page.close();
      }
    } finally {
      await browser.close();
    }
  },
);
