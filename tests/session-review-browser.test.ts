import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdir } from "node:fs/promises";
import { build } from "esbuild";
import { chromium } from "playwright";

test(
  "pre-send inspector preserves video gaps and identifies resource details in Chromium",
  { skip: process.env.FEEDBACKS_RECORDING_BROWSER_SMOKE !== "1" },
  async (t) => {
    const result = await build({
      stdin: {
        contents: `
          import { createSessionReview } from "./extension/session-review.js";
          window.savedFrames = [];
          // Controlled media events reproduce a queued timeupdate after selecting a
          // gap. Decoding and actual video seeks are covered by viewer browser tests.
          const media = new EventTarget();
          Object.assign(media, {
            currentTime: 0.3,
            paused: true,
            pause() { this.paused = true; this.dispatchEvent(new Event("pause")); },
            async play() { this.paused = false; this.dispatchEvent(new Event("play")); },
          });
          window.media = media;
          window.mount = (recording, video, annotations = [], timeline = {}) => {
            window.inspector?.dispose();
            window.savedFrames = [];
            media.currentTime = 0.3;
            window.inspector = createSessionReview(document.getElementById("root"), {
              recording, video, annotations, videoElement: media, ...timeline,
              onFrame: (atMs, videoTimeMs) => window.savedFrames.push({ atMs, videoTimeMs }),
            });
          };
        `,
        loader: "js",
        resolveDir: process.cwd(),
      },
      bundle: true,
      format: "iife",
      platform: "browser",
      write: false,
    });
    const server = createServer((req, res) => {
      if (req.url === "/bundle.js") {
        res.setHeader("Content-Type", "text/javascript");
        res.end(result.outputFiles[0].text);
      } else {
        res.setHeader("Content-Type", "text/html");
        res.end('<div id="root"></div><script src="/bundle.js"></script>');
      }
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
    const browser = await chromium.launch({ headless: true });
    t.after(() => browser.close());
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${address.port}`);
    for (const name of ["appearance.css", "video.css", "session-review.css"])
      await page.addStyleTag({ path: `extension/${name}` });

    await t.test(
      "clicks, console and network failures have seekable video timeline marks",
      async () => {
        await page.evaluate(() =>
          (window as any).mount(
            {
              durationMs: 3000,
              environment: { browser: "Chrome", viewport: { width: 1280, height: 720 } },
              events: [
                {
                  seq: 0,
                  atMs: 300,
                  type: "activity",
                  data: { action: "click", label: "Submit" },
                },
                {
                  seq: 1,
                  atMs: 1100,
                  type: "console",
                  data: { level: "warn", message: "Late warning" },
                },
                {
                  seq: 2,
                  atMs: 2400,
                  type: "network",
                  data: { phase: "response", status: 500, url: "/api" },
                },
                {
                  seq: 3,
                  atMs: 1800,
                  type: "performance",
                  data: { name: "Largest contentful paint", durationMs: 480 },
                },
              ],
            },
            { offsetMs: 0 },
          ),
        );
        const marks = page.locator(".review-timeline-mark");
        assert.equal(await marks.count(), 4);
        assert.equal(
          await page
            .getByRole("tab", { name: /^Everything/ })
            .getAttribute("aria-selected"),
          "true",
        );
        assert.deepEqual(
          await page.locator(".review-events .review-event-tag").allTextContents(),
          ["environment", "activity", "console", "performance", "network"],
        );
        await page.locator('.review-timeline-mark[data-channel="performance"]').hover();
        assert.match(
          (await page
            .locator('.review-timeline-mark[data-channel="performance"] [role="tooltip"]')
            .textContent()) ?? "",
          /Largest contentful paint/,
        );
        await page.getByRole("button", { name: /Console warning at 0:01.1/ }).click();
        assert.equal(await page.getByRole("slider").inputValue(), "1100");
        assert.equal(await page.evaluate(() => (window as any).media.currentTime), 1.1);
        await page.getByRole("button", { name: /Network failure at 0:02.4/ }).click();
        assert.equal(await page.getByRole("slider").inputValue(), "2400");
      },
    );

    await t.test(
      "screenshot comments show literal authored text and seek their source moment",
      async () => {
        await page.evaluate(() =>
          (window as any).mount({ durationMs: 3000, events: [] }, { offsetMs: -500 }, [
            {
              id: "comment",
              atMs: 1500,
              body: "<b>Align this heading</b>",
              imageBase64:
                "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lZsAAAAASUVORK5CYII=",
            },
          ]),
        );
        const notes = page.getByRole("region", { name: "Screenshot comments" });
        assert.equal(await notes.locator("p").innerText(), "<b>Align this heading</b>");
        assert.equal(await notes.locator("b").count(), 0);
        assert.equal(await notes.getByRole("img").count(), 1);
        await notes.getByRole("button", { name: "View comment at 0:01.5" }).click();
        const dialog = page.getByRole("dialog", { name: "Screenshot comment at 0:01.5" });
        assert.equal(await dialog.isVisible(), true);
        assert.equal(await dialog.getByRole("img").count(), 1);
        assert.equal(await dialog.locator("p").innerText(), "<b>Align this heading</b>");
        await dialog.getByRole("button", { name: "Close screenshot" }).click();
        await page.waitForFunction(() => !document.querySelector("dialog"));
        assert.equal(await page.locator("dialog").count(), 0);
        await notes.getByRole("button", { name: "View comment at 0:01.5" }).click();
        await page.keyboard.press("Escape");
        await page.waitForFunction(() => !document.querySelector("dialog"));
        await notes.getByRole("button", { name: "Jump to 0:01.5" }).click();
        assert.equal(await page.getByRole("slider").inputValue(), "1500");
        assert.equal(await page.evaluate(() => (window as any).media.currentTime), 1);
        await mkdir("output/playwright/recording-comments", { recursive: true });
        for (const [name, width, height] of [
          ["desktop", 1280, 900],
          ["mobile", 390, 844],
        ] as const) {
          await page.setViewportSize({ width, height });
          assert.equal(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
            true,
          );
          await page.screenshot({
            path: `output/playwright/recording-comments/${name}.png`,
            fullPage: true,
          });
          await notes.getByRole("button", { name: "View comment at 0:01.5" }).click();
          assert.equal(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
            true,
          );
          await page.screenshot({
            path: `output/playwright/recording-comments/${name}-dialog.png`,
            fullPage: true,
          });
          await page.keyboard.press("Escape");
          await page.waitForFunction(() => !document.querySelector("dialog"));
        }
        await page.setViewportSize({ width: 1280, height: 900 });
      },
    );

    await t.test(
      "capture gaps are visible before sending even when channels are empty",
      async () => {
        await page.evaluate(() =>
          (window as any).mount({
            durationMs: 1000,
            events: [],
            coverage: [
              {
                channel: "replay",
                status: "unavailable",
                detail: "DOM replay limit reached. Diagnostics continue.",
              },
              { channel: "capture", status: "partial", detail: "Source tab closed." },
            ],
          }),
        );
        assert.match(await page.locator("#root").innerText(), /Capture coverage/);
        await page.getByText("Capture coverage", { exact: false }).click();
        assert.match(await page.locator("#root").innerText(), /DOM replay limit reached/);
        assert.match(await page.locator("#root").innerText(), /Source tab closed/);
      },
    );

    await t.test(
      "a selected gap cannot save the previous frame or follow stale media updates",
      async () => {
        await page.evaluate(() => {
          (window as any).mount(
            { durationMs: 3000, events: [] },
            {
              segments: [
                { sourceStartMs: 0, sourceEndMs: 1000, outputStartMs: 0 },
                { sourceStartMs: 2000, sourceEndMs: 3000, outputStartMs: 1000 },
              ],
            },
          );
        });
        await page.getByRole("button", { name: "Play", exact: true }).click();
        await page.getByRole("slider").evaluate((element: HTMLInputElement) => {
          element.value = "1500";
          element.dispatchEvent(new Event("input", { bubbles: true }));
        });
        // A disabled Save button and an enabled button with a guarded callback are
        // both valid; DOM click exercises the actual handler without waiting on it.
        await page
          .getByRole("button", { name: "Save this frame" })
          .evaluate((button: HTMLButtonElement) => button.click());
        assert.deepEqual(await page.evaluate(() => (window as any).savedFrames), []);
        await page.evaluate(() => {
          (window as any).media.dispatchEvent(new Event("timeupdate"));
          (window as any).media.dispatchEvent(new Event("pause"));
        });
        assert.equal(await page.getByRole("slider").inputValue(), "1500");
        assert.equal(await page.evaluate(() => (window as any).media.paused), true);

        // Returning to a retained moment must clear the gap and restore saving.
        await page.getByRole("slider").evaluate((element: HTMLInputElement) => {
          element.value = "2500";
          element.dispatchEvent(new Event("input", { bubbles: true }));
        });
        await page.evaluate(() =>
          (window as any).media.dispatchEvent(new Event("seeked")),
        );
        await page.getByRole("button", { name: "Save this frame" }).click();
        assert.deepEqual(await page.evaluate(() => (window as any).savedFrames), [
          { atMs: 2500, videoTimeMs: 1500 },
        ]);
      },
    );

    await t.test(
      "resource details use event identity when requestId is absent",
      async () => {
        await page.evaluate(() => {
          (window as any).mount(
            {
              durationMs: 1000,
              events: [
                {
                  seq: 1,
                  atMs: 100,
                  type: "network",
                  data: { phase: "timing", url: "/first", durationMs: 11 },
                },
                {
                  seq: 2,
                  atMs: 200,
                  type: "network",
                  data: { phase: "timing", url: "/second", durationMs: 22 },
                },
                {
                  seq: 3,
                  atMs: 900,
                  type: "network",
                  data: { phase: "timing", url: "/future", durationMs: 33 },
                },
              ],
            },
            {},
          );
          (window as any).inspector.seek(200);
          (window as any).media.dispatchEvent(new Event("seeked"));
        });
        await page.getByRole("tab", { name: /^Network/ }).click();
        await page.getByLabel(/Browse all events/).uncheck();
        assert.equal(await page.locator(".review-event").count(), 2);
        assert.equal(await page.getByRole("button", { name: /\/future/ }).count(), 0);
        await page.getByRole("button", { name: /\/second/ }).click();
        assert.equal(
          await page
            .locator(".review-detail")
            .evaluate((node: HTMLDetailsElement) => node.open),
          false,
        );
        await page.locator(".review-detail summary").click();
        assert.deepEqual(
          JSON.parse(await page.locator(".review-detail pre").innerText()),
          {
            phase: "timing",
            url: "/second",
            durationMs: 22,
          },
        );
        await page.getByRole("button", { name: /\/first/ }).click();
        assert.deepEqual(
          JSON.parse(await page.locator(".review-detail pre").innerText()),
          {
            phase: "timing",
            url: "/first",
            durationMs: 11,
          },
        );
      },
    );
    await t.test(
      "video review uses the editor seek bar and maps event marks to retained video time",
      async () => {
        await page.evaluate(() => {
          document.body.insertAdjacentHTML(
            "beforeend",
            '<section id="editing"><div class="timeline"><input id="trim-seek" type="range" /><div class="timeline-playback"></div></div></section>',
          );
          (window as any).mount(
            {
              durationMs: 3000,
              events: [
                {
                  seq: 1,
                  atMs: 500,
                  type: "activity",
                  data: { action: "click", label: "First" },
                },
                {
                  seq: 2,
                  atMs: 2500,
                  type: "activity",
                  data: { action: "click", label: "Second" },
                },
                {
                  seq: 3,
                  atMs: 1500,
                  type: "console",
                  data: { level: "warn", args: ["Gap"] },
                },
              ],
            },
            {
              segments: [
                { sourceStartMs: 0, sourceEndMs: 1000, outputStartMs: 0 },
                { sourceStartMs: 2000, sourceEndMs: 3000, outputStartMs: 1000 },
              ],
            },
          );
        });
        assert.equal(await page.locator("#root .review-toolbar input").count(), 0);
        assert.equal(await page.locator("#editing .review-timeline-mark").count(), 2);
        assert.deepEqual(
          await page
            .locator("#editing .review-timeline-mark")
            .evaluateAll((marks) =>
              marks.map((mark) => (mark as HTMLElement).style.left),
            ),
          ["25%", "75%"],
        );
        await page.getByRole("button", { name: /Click at 0:02.5/ }).click();
        assert.equal(await page.evaluate(() => (window as any).media.currentTime), 1.5);
        await page.evaluate(() =>
          (window as any).mount(
            {
              durationMs: 3000,
              events: [
                {
                  seq: 4,
                  atMs: 2500,
                  type: "activity",
                  data: { action: "click", label: "Trimmed" },
                },
              ],
            },
            {
              segments: [{ sourceStartMs: 2000, sourceEndMs: 3000, outputStartMs: 0 }],
            },
            [],
            { timelineStartMs: 1000, timelineDurationMs: 2000 },
          ),
        );
        assert.equal(
          await page
            .locator("#editing .review-timeline-mark")
            .evaluate((mark) => (mark as HTMLElement).style.left),
          "75%",
          "a trimmed clip keeps marks at their original editor-track positions",
        );
      },
    );
  },
);
