import test from "node:test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { evidenceViewerFixture } from "./evidence-viewer-fixture.js";

test(
  "expanded screenshots preserve evidence layers, zoom and keyboard focus on desktop and mobile",
  { skip: process.env.FEEDBACKS_RECORDING_BROWSER_SMOKE !== "1" },
  async () => {
    const f = await evidenceViewerFixture();
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(f.url, { waitUntil: "networkidle" });
      assert.deepEqual(
        await page.locator('[aria-label="Feedback type"]').allTextContents(),
        [
          "Text edit · Screenshot",
          "Full page",
          "Session recording",
          "Video + session",
          "Text",
        ],
      );
      assert.equal(await page.locator(".thread-recordings").count(), 0);
      assert.equal(
        f.recordingRequests(),
        0,
        "known non-recording threads do not request recordings",
      );
      assert.equal(
        await page
          .locator(".thread-row-thumbnail")
          .evaluateAll((images) =>
            images.every(
              (image) =>
                (image as HTMLImageElement).complete &&
                (image as HTMLImageElement).naturalWidth > 0,
            ),
          ),
        true,
      );
      await mkdir(".local/evidence-qa", { recursive: true });
      await page.screenshot({
        path: ".local/evidence-qa/list-desktop.png",
        fullPage: true,
      });
      const expand = page.getByRole("button", { name: "Expand image", exact: true });
      await expand.click();
      const dialog = page.getByRole("dialog");
      await dialog.waitFor();
      assert.equal(await dialog.locator(".review-image-pin").count(), 1);
      assert.equal(await dialog.locator(".review-text-selection").count(), 1);
      assert.equal(await dialog.locator(".review-element-outline").count(), 0);
      await dialog.getByRole("button", { name: "Show element outline" }).click();
      const aligned = async () =>
        assert.equal(
          await dialog.locator(".review-image-frame").evaluate((frame) => {
            const image = frame.querySelector("img")!.getBoundingClientRect();
            const outline = frame
              .querySelector(".review-element-outline")!
              .getBoundingClientRect();
            const text = frame
              .querySelector(".review-text-selection")!
              .getBoundingClientRect();
            return (
              Math.abs((outline.left - image.left) / image.width - 0.15) < 0.002 &&
              Math.abs((text.top - image.top) / image.height - 0.2) < 0.002 &&
              Math.abs(text.width / image.width - 0.54) < 0.002
            );
          }),
          true,
          "overlays stay aligned with the image",
        );
      await aligned();
      assert.ok((await dialog.locator("img").boundingBox())!.width > 800);
      await page.screenshot({ path: ".local/evidence-qa/expanded-desktop.png" });
      await dialog.getByLabel("Image zoom").selectOption("2");
      await aligned();
      assert.equal(Math.round((await dialog.locator("img").boundingBox())!.width), 2400);
      assert.equal(
        await dialog
          .locator(".evidence-image-viewport")
          .evaluate((el) => el.scrollWidth > el.clientWidth),
        true,
      );
      await dialog.getByRole("button", { name: "Hide text selection" }).click();
      await page.keyboard.press("Escape");
      assert.equal(await dialog.isVisible(), false);
      assert.equal(await expand.evaluate((el) => document.activeElement === el), true);
      assert.equal(await page.locator(".review-text-selection").count(), 0);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({
        path: ".local/evidence-qa/list-mobile.png",
        fullPage: true,
      });
      await expand.click();
      await dialog.getByLabel("Image zoom").selectOption("0");
      await dialog.getByRole("button", { name: "Show text selection" }).click();
      await aligned();
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      assert.equal(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth), true);
      await page.screenshot({ path: ".local/evidence-qa/expanded-mobile.png" });
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await page.getByRole("button", { name: "Switch capture example" }).click();
      await page
        .locator(".review-main-capture")
        .getByRole("button", { name: "Expand image: Full page · combined", exact: true })
        .click();
      await page.getByRole("dialog").getByLabel("Image zoom").selectOption("1");
      assert.equal(
        await page
          .getByRole("dialog")
          .locator(".evidence-image-viewport")
          .evaluate((el) => el.scrollHeight > el.clientHeight),
        true,
      );
      await page.keyboard.press("Escape");
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await f.close();
    }
  },
);
