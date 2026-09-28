import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
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
          window.mount = (recording, video) => {
            window.inspector?.dispose();
            window.savedFrames = [];
            media.currentTime = 0.3;
            window.inspector = createSessionReview(document.getElementById("root"), {
              recording, video, videoElement: media,
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
        assert.equal(await page.locator(".review-event").count(), 2);
        assert.equal(await page.getByRole("button", { name: /\/future/ }).count(), 0);
        await page.getByRole("button", { name: /\/second/ }).click();
        assert.deepEqual(JSON.parse(await page.locator(".review-detail").innerText()), {
          phase: "timing",
          url: "/second",
          durationMs: 22,
        });
        await page.getByRole("button", { name: /\/first/ }).click();
        assert.deepEqual(JSON.parse(await page.locator(".review-detail").innerText()), {
          phase: "timing",
          url: "/first",
          durationMs: 11,
        });
      },
    );
  },
);
