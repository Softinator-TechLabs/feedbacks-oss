import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { readFile, mkdir } from "node:fs/promises";
import { chromium } from "playwright";

test(
  "video review stacks a large preview, timeline, evidence, and Send across widths",
  { skip: process.env.FEEDBACKS_RECORDING_BROWSER_SMOKE !== "1" },
  async () => {
    const html = (await readFile("extension/video.html", "utf8")).replace(
      /<script[^>]*><\/script>/g,
      "",
    );
    const server = createServer(async (req, res) => {
      if (req.url === "/") return res.end(html);
      const css = await readFile(`extension/${req.url?.slice(1)}`, "utf8");
      res.setHeader("Content-Type", "text/css");
      res.end(css);
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await page.goto(`http://127.0.0.1:${address.port}`);
      await page.evaluate(() => {
        document.body.classList.add("has-recording");
        for (const id of [
          "preview",
          "capture-inspector",
          "editing",
          "review",
          "saved-frames",
        ])
          document.getElementById(id)!.hidden = false;
        document.getElementById("capture-inspector")!.innerHTML =
          '<h2>Recorded moments</h2><div class="review-toolbar">Play <input type="range" /></div><div class="review-timeline-events">Click · Console · Network</div><div class="review-events">Activity · Console · Network</div>';
        document.getElementById("capture-inspector")!.classList.add("session-review");
      });
      const video = (await page.locator("#preview").boundingBox())!;
      const inspector = (await page.locator("#capture-inspector").boundingBox())!;
      const editor = (await page.locator("#editing").boundingBox())!;
      const review = (await page.locator("#review").boundingBox())!;
      assert.ok(video.width >= 1050 && inspector.width >= 1050);
      assert.ok(video.y < inspector.y && inspector.y < editor.y && editor.y < review.y);
      const marks = (await page.locator(".review-timeline-events").boundingBox())!;
      const events = (await page.locator(".review-events").boundingBox())!;
      assert.ok(video.y < marks.y && marks.y < events.y);
      await mkdir("output/playwright/video-review-layout", { recursive: true });
      await page.screenshot({
        path: "output/playwright/video-review-layout/desktop.png",
        fullPage: true,
      });
      await page.emulateMedia({ colorScheme: "dark" });
      await page.screenshot({
        path: "output/playwright/video-review-layout/desktop-dark.png",
        fullPage: true,
      });
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      const mobileVideo = (await page.locator("#preview").boundingBox())!;
      const mobileInspector = (await page.locator("#capture-inspector").boundingBox())!;
      const mobileEditor = (await page.locator("#editing").boundingBox())!;
      const mobileReview = (await page.locator("#review").boundingBox())!;
      assert.ok(mobileVideo.width <= 390 && mobileReview.width <= 390);
      assert.ok(
        mobileVideo.y < mobileInspector.y &&
          mobileInspector.y < mobileEditor.y &&
          mobileEditor.y < mobileReview.y,
      );
      await page.screenshot({
        path: "output/playwright/video-review-layout/mobile.png",
        fullPage: true,
      });
    } finally {
      await browser.close();
      server.close();
      await once(server, "close");
    }
  },
);
