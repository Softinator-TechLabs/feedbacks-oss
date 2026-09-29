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
      res.setHeader(
        "Content-Type",
        req.url?.endsWith(".js") ? "text/javascript" : "text/css",
      );
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
          "video-edit-tools",
          "review",
          "saved-frames",
        ])
          document.getElementById(id)!.hidden = false;
        document.querySelector<HTMLElement>(".timeline-playback")!.hidden = false;
        document.getElementById("capture-inspector")!.innerHTML =
          '<div class="review-tabs"><button aria-selected="true">Everything (490)</button><button>Activity (24)</button><button>Console (4)</button><button>Network (457)</button><button>Performance (3)</button><button>Environment (2)</button></div><button class="review-follow" aria-pressed="true">Following playback</button><div class="review-events"><button class="review-event"><time>0:01.2</time><span class="review-event-tag">Activity</span>Clicked Submit</button><button class="review-event"><time>0:02.1</time><span class="review-event-tag">Console</span>Warning in form</button><button class="review-event"><time>0:02.4</time><span class="review-event-tag">Network</span>POST /submit · 500</button></div>';
        document.getElementById("capture-inspector")!.classList.add("session-review");
        document
          .querySelector("#editing .timeline-rail")!
          .insertAdjacentHTML(
            "beforeend",
            '<div class="review-timeline-events"><button class="review-timeline-mark" data-channel="activity" style="left:20%"></button><button class="review-timeline-mark" data-channel="console" style="left:55%"></button><button class="review-timeline-mark" data-channel="network" style="left:70%"></button></div><div class="review-timeline-playhead" style="left:55%"></div>',
          );
      });
      const video = (await page.locator("#preview").boundingBox())!;
      const controls = (await page.locator(".timeline-playback").boundingBox())!;
      const inspector = (await page.locator("#capture-inspector").boundingBox())!;
      const editor = (await page.locator("#editing").boundingBox())!;
      const tools = (await page.locator("#video-edit-tools").boundingBox())!;
      const review = (await page.locator("#review").boundingBox())!;
      assert.ok(video.width >= 1050 && inspector.width >= 1050);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      assert.equal(
        await page
          .locator(".review-tabs")
          .evaluate((tabs) => tabs.scrollWidth <= tabs.clientWidth),
        true,
      );
      assert.ok(controls.y < video.y);
      assert.equal(
        await page
          .locator("#trim-seek")
          .evaluate((seek) => seek.getBoundingClientRect().width),
        1,
        "the keyboard seek input must not draw a second visible ruler",
      );
      assert.ok(
        video.y < editor.y &&
          editor.y < inspector.y &&
          inspector.y < tools.y &&
          tools.y < review.y,
      );
      assert.ok(inspector.y - (editor.y + editor.height) <= 8);
      const marks = (await page.locator(".review-timeline-events").boundingBox())!;
      const events = (await page.locator(".review-events").boundingBox())!;
      assert.ok(video.y < marks.y && marks.y < events.y);
      await page.locator("#preview").evaluate((element: HTMLVideoElement) => {
        element.style.height = "700px";
      });
      assert.ok((await page.locator("#preview").boundingBox())!.height <= 360);
      await page.locator(".review-workspace").evaluate((element: HTMLElement) => {
        element.dataset.layout = "side";
      });
      const sideVideo = (await page.locator("#preview").boundingBox())!;
      const sideInspector = (await page.locator("#capture-inspector").boundingBox())!;
      const sideTimeline = (await page.locator("#editing").boundingBox())!;
      const sideTools = (await page.locator("#video-edit-tools").boundingBox())!;
      const sideReview = (await page.locator("#review").boundingBox())!;
      assert.ok(sideInspector.x >= sideVideo.x + sideVideo.width - 2);
      assert.ok(Math.abs(sideInspector.y - sideVideo.y) <= 4);
      assert.ok(Math.abs(sideTimeline.x - sideVideo.x) <= 4);
      assert.ok(Math.abs(sideTimeline.width - sideVideo.width) <= 4);
      assert.ok(
        sideTools.y >=
          Math.max(
            sideTimeline.y + sideTimeline.height,
            sideInspector.y + sideInspector.height,
          ),
      );
      assert.ok(sideReview.y >= sideTools.y + sideTools.height);
      assert.ok(sideTools.width > sideVideo.width);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      assert.equal(
        await page
          .locator(".review-tabs")
          .evaluate((tabs) => tabs.scrollWidth <= tabs.clientWidth),
        true,
      );
      await page.locator(".review-workspace").evaluate((element: HTMLElement) => {
        element.dataset.layout = "stack";
      });
      await page.evaluate(`(async () => {
        const video = document.getElementById("preview");
        let paused = true;
        Object.defineProperty(video, "paused", { get: function () { return paused; } });
        video.play = async function () {
          paused = false;
          video.dispatchEvent(new Event("play"));
        };
        video.pause = function () {
          paused = true;
          video.dispatchEvent(new Event("pause"));
        };
        const { createVideoTimeline } = await import("/video/video-timeline.js");
        createVideoTimeline({ onChange: function () {}, onError: function () {} }).load("", 10);
      })()`);
      await page.locator("#preview").click();
      assert.equal(
        await page
          .locator("#preview")
          .evaluate((video: HTMLVideoElement) => video.paused),
        false,
      );
      await page.keyboard.press("Space");
      assert.equal(
        await page
          .locator("#preview")
          .evaluate((video: HTMLVideoElement) => video.paused),
        true,
      );
      await mkdir("output/playwright/video-review-layout", { recursive: true });
      await page.screenshot({
        path: "output/playwright/video-review-layout/desktop.png",
        fullPage: true,
      });
      await page.emulateMedia({ colorScheme: "dark" });
      const followColors = await page
        .locator('.review-follow[aria-pressed="true"]')
        .evaluate((button) => {
          const style = getComputedStyle(button);
          return { color: style.color, background: style.backgroundColor };
        });
      assert.deepEqual(followColors, {
        color: "rgb(20, 36, 54)",
        background: "rgb(203, 221, 235)",
      });
      const reviewTab = page.locator(".review-tabs button", { hasText: "Activity" });
      await reviewTab.hover();
      const tabStyle = await reviewTab.evaluate((button) => {
        const style = getComputedStyle(button);
        return [
          style.marginLeft,
          style.marginRight,
          style.paddingLeft,
          style.backgroundColor,
        ];
      });
      assert.deepEqual(tabStyle.slice(0, 3), ["2px", "2px", "12px"]);
      assert.notEqual(tabStyle[3], "rgba(0, 0, 0, 0)");
      await page.screenshot({
        path: "output/playwright/video-review-layout/desktop-dark.png",
        fullPage: true,
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.locator(".review-workspace").evaluate((element: HTMLElement) => {
        element.dataset.layout = "side";
      });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      assert.equal(
        await page
          .locator(".review-tabs")
          .evaluate((tabs) => tabs.scrollWidth <= tabs.clientWidth),
        true,
      );
      const mobileVideo = (await page.locator("#preview").boundingBox())!;
      const mobileInspector = (await page.locator("#capture-inspector").boundingBox())!;
      const mobileEditor = (await page.locator("#editing").boundingBox())!;
      const mobileTools = (await page.locator("#video-edit-tools").boundingBox())!;
      const mobileReview = (await page.locator("#review").boundingBox())!;
      assert.ok(mobileInspector.y >= mobileVideo.y + mobileVideo.height);
      assert.equal(await page.locator("#review-layout").isVisible(), false);
      assert.ok(mobileVideo.width <= 390 && mobileReview.width <= 390);
      assert.ok(
        mobileVideo.y < mobileEditor.y &&
          mobileEditor.y < mobileInspector.y &&
          mobileInspector.y < mobileTools.y &&
          mobileTools.y < mobileReview.y,
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
