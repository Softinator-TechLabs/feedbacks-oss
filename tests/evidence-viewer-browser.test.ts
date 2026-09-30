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
      await page.goto(f.url, { waitUntil: "domcontentloaded" });
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

test(
  "image editing stays in the expanded viewer and preserves drafts on save failure",
  { skip: process.env.FEEDBACKS_RECORDING_BROWSER_SMOKE !== "1" },
  async () => {
    const f = await evidenceViewerFixture({ writable: true, failFirstUpload: true });
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      await page.goto(f.url, { waitUntil: "domcontentloaded" });
      assert.equal(
        await page.getByRole("button", { name: "Add annotations", exact: true }).count(),
        0,
      );
      await page.getByRole("button", { name: "Expand image", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("button", { name: "Edit annotations", exact: true }).click();
      assert.equal(await page.locator("dialog[open]").count(), 1);
      await dialog.getByRole("button", { name: "Circle", exact: true }).click();
      const canvas = dialog.getByLabel("Screenshot marking canvas");
      await page.waitForFunction(
        () => document.querySelector<HTMLCanvasElement>("canvas")?.width === 1200,
      );
      const box = (await canvas.boundingBox())!;
      await page.mouse.move(box.x + box.width * 0.25, box.y + 100);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.4, box.y + 180, { steps: 5 });
      await page.mouse.up();
      await dialog.getByRole("button", { name: "Save annotations", exact: true }).click();
      await dialog.getByRole("alert").waitFor();
      assert.equal(
        await dialog.getByRole("button", { name: "Undo mark" }).isEnabled(),
        true,
      );
      assert.equal(await page.locator("dialog[open]").count(), 1);
      await dialog.getByRole("button", { name: "Save annotations", exact: true }).click();
      await dialog
        .getByRole("button", { name: "Edit annotations", exact: true })
        .waitFor();
      assert.equal(
        await page.locator("dialog[open]").count(),
        1,
        "save returns to the same viewer",
      );
      assert.equal(f.uploads.length, 2);
      assert.equal(f.uploads[0].idempotencyKey, f.uploads[1].idempotencyKey);
      assert.equal(f.uploads[1].replacesAssetId, "capture");
      assert.equal(f.uploads[1].markup[0].tool, "ellipse");
      assert.equal(await dialog.locator("img").getAttribute("src"), "/saved.webp");
      await dialog.getByRole("button", { name: "Edit annotations", exact: true }).click();
      await dialog.getByRole("button", { name: "Clear marks" }).click();
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      assert.equal(f.uploads.length, 2);
      assert.equal(await dialog.isVisible(), true);
      await dialog.getByRole("button", { name: "Edit annotations", exact: true }).click();
      assert.equal(
        await dialog.getByRole("button", { name: "Undo mark" }).isEnabled(),
        true,
        "cancel retains previously saved marks",
      );
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth), true);
      await page.screenshot({ path: ".local/evidence-qa/edit-mobile.png" });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.screenshot({ path: ".local/evidence-qa/edit-desktop.png" });
      await page.keyboard.press("Escape");
      assert.equal(
        await dialog.isVisible(),
        true,
        "Escape cancels editing before closing the viewer",
      );
    } finally {
      await browser.close();
      await f.close();
    }
  },
);

test(
  "twenty points support compact pages, bulk expansion and stable editing",
  { skip: process.env.FEEDBACKS_RECORDING_BROWSER_SMOKE !== "1" },
  async () => {
    const f = await evidenceViewerFixture({ writable: true, pointCount: 20 });
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      await page.goto(f.url, { waitUntil: "domcontentloaded" });
      const list = page.locator(".review-point-list");
      assert.equal(await list.locator(".review-point-details").count(), 5);
      assert.equal(await list.locator(".review-point-details[open]").count(), 0);
      assert.ok(
        (await list.boundingBox())!.height < 450,
        "20 compact rows do not become 20 full editors",
      );
      assert.equal(
        await list.getByRole("button", { name: "Resolve point", exact: true }).count(),
        0,
      );
      await list.locator("summary.review-point-summary").nth(0).click();
      await list.getByRole("button", { name: "Resolve point", exact: true }).waitFor();
      assert.equal(await list.locator(".review-point-details[open]").count(), 1);
      assert.equal(
        await list.getByRole("button", { name: "Resolve point", exact: true }).count(),
        1,
      );
      await page
        .locator(".review-evidence")
        .screenshot({ path: ".local/evidence-qa/point-layout-desktop.png" });
      await page.setViewportSize({ width: 390, height: 844 });
      await page
        .locator(".review-evidence")
        .screenshot({ path: ".local/evidence-qa/point-layout-mobile.png" });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await list.locator("summary.review-point-summary").nth(1).click();
      assert.equal(await list.locator(".review-point-details[open]").count(), 2);
      await page.getByRole("button", { name: "Expand all", exact: true }).click();
      assert.equal(await list.locator(".review-point-details[open]").count(), 5);
      await page.getByRole("button", { name: "Next points" }).click();
      assert.equal(
        await list.locator(".review-point-details[open]").count(),
        5,
        "bulk expansion carries across pages",
      );
      await page.getByRole("button", { name: "Collapse all", exact: true }).click();
      assert.equal(await list.locator(".review-point-details[open]").count(), 0);
      await page.getByRole("button", { name: "Next points" }).click();
      await list.locator("summary.review-point-summary").nth(1).click();
      assert.equal(await list.locator(".review-point-details[open]").count(), 1);
      assert.equal(
        await list.locator(".review-point-details[open]").getAttribute("data-point-id"),
        "point-11",
      );
      await page
        .locator(".review-evidence")
        .screenshot({ path: ".local/evidence-qa/points-desktop.png" });
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      await page
        .locator(".review-evidence")
        .screenshot({ path: ".local/evidence-qa/points-mobile.png" });
      await list.locator("summary.review-point-summary").nth(1).press("Enter");
      assert.equal(await list.locator(".review-point-details[open]").count(), 0);
      await page.getByRole("button", { name: "Next points" }).click();
      await list.locator("summary.review-point-summary").nth(4).press("Enter");
      assert.equal(
        await list.locator(".review-point-details[open]").getAttribute("data-point-id"),
        "point-19",
      );
      await page.getByLabel("Filter points").selectOption("resolved");
      assert.equal(await list.locator(".review-point-details").count(), 0);
      await page.getByText("No points in this view.", { exact: true }).waitFor();
      await page.goto(f.url + "#point-point-11", { waitUntil: "domcontentloaded" });
      await list
        .locator('.review-point-details[open][data-point-id="point-11"]')
        .waitFor();
      assert.equal(await page.getByLabel("Filter points").inputValue(), "all");
      await page.goto(f.url + "#asset-capture-19", { waitUntil: "domcontentloaded" });
      await list
        .locator('.review-point-details[open][data-point-id="point-19"]')
        .waitFor();
      assert.equal(await list.locator(".review-point-number").last().textContent(), "20");
      // A saved thread refresh must not reapply a hash we have already navigated away from.
      for (let i = 0; i < 3; i++)
        await page.getByRole("button", { name: "Previous points" }).click();
      await list.locator("summary.review-point-summary").first().click();
      await list.getByRole("button", { name: "Expand image", exact: true }).click();
      const viewer = page.getByRole("dialog");
      await viewer.getByRole("button", { name: "Edit annotations", exact: true }).click();
      const canvas = viewer.locator("canvas");
      await page.waitForFunction(() => {
        const el = document.querySelector("canvas");
        return el && el.width === 1200;
      });
      const box = (await canvas.boundingBox())!;
      await page.mouse.move(box.x + 30, box.y + 30);
      await page.mouse.down();
      await page.mouse.move(box.x + 60, box.y + 60);
      await page.mouse.up();
      await viewer.getByRole("button", { name: "Save annotations", exact: true }).click();
      await viewer
        .getByRole("button", { name: "Edit annotations", exact: true })
        .waitFor();
      assert.equal(await viewer.isVisible(), true);
      await viewer.getByRole("button", { name: "Close", exact: true }).click();
      await page.emulateMedia({ reducedMotion: "reduce" });
      assert.equal(
        await list
          .locator(".review-point-details")
          .first()
          .evaluate((el) => getComputedStyle(el, "::details-content").transitionDuration),
        "0s",
      );
      await page.getByRole("button", { name: "Expand all", exact: true }).click();
      assert.equal(await list.locator(".review-point-details[open]").count(), 5);
      await page.getByRole("button", { name: "Collapse all", exact: true }).click();
      assert.equal(await list.locator(".review-point-details[open]").count(), 0);
      await list.locator("summary.review-point-summary").first().click();
      assert.equal(
        await list.locator(".review-point-details[open]").getAttribute("data-point-id"),
        "point",
      );
    } finally {
      await browser.close();
      await f.close();
    }
  },
);

test(
  "asset-linked review keeps the selected point while planning and editing",
  { skip: process.env.FEEDBACKS_RECORDING_BROWSER_SMOKE !== "1" },
  async () => {
    const f = await evidenceViewerFixture({ writable: true, pointCount: 20 });
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await page.goto(f.url + "#asset-capture", { waitUntil: "domcontentloaded" });
      await page.locator('.review-point-details[open][data-point-id="point"]').waitFor();
      await page.getByRole("button", { name: "Next points" }).click();
      await page.locator("summary.review-point-summary").first().click();
      const point = page.locator('.review-point-details[data-point-id="point-5"]');
      await point.getByLabel("Point 6 priority").selectOption("high");
      await page.waitForFunction(
        () =>
          document
            .querySelector('.review-point-plan[aria-busy="false"] select')
            ?.getAttribute("disabled") === null,
      );
      assert.equal(await point.getByLabel("Point 6 priority").inputValue(), "high");
      await point.getByLabel("Point 6 timing").selectOption("later");
      await point.getByText("High priority · Later", { exact: true }).waitFor();
      await point.getByRole("button", { name: "Expand image", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("button", { name: "Edit annotations", exact: true }).click();
      await page.waitForFunction(() => document.querySelector("canvas")?.width === 1200);
      const box = (await dialog.locator("canvas").boundingBox())!;
      await page.mouse.move(box.x + 40, box.y + 40);
      await page.mouse.down();
      await page.mouse.move(box.x + 90, box.y + 90);
      await page.mouse.up();
      await dialog.getByRole("button", { name: "Save annotations", exact: true }).click();
      await dialog
        .getByRole("button", { name: "Edit annotations", exact: true })
        .waitFor();
      assert.equal(await dialog.isVisible(), true);
      assert.equal(await point.getAttribute("open"), "");
      assert.equal(f.uploads.length, 1);
    } finally {
      await browser.close();
      await f.close();
    }
  },
);
