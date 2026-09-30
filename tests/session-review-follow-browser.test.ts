import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { build } from "esbuild";
import { chromium } from "playwright";

test(
  "session review follows playback without interrupting native scrolling",
  { skip: process.env.FEEDBACKS_RECORDING_BROWSER_SMOKE !== "1" },
  async (t) => {
    const result = await build({
      stdin: {
        contents: `
      import { createSessionReview } from "./extension/session-review.js";
      const media = new EventTarget();
      Object.assign(media, { currentTime: 0, paused: true,
        pause() { this.paused = true; this.dispatchEvent(new Event("pause")); },
        async play() { this.paused = false; this.dispatchEvent(new Event("play")); },
      });
      window.media = media;
      window.mount = (events = Array.from({ length: 225 }, (_, seq) => ({
        seq, atMs: (seq + 1) * 1000, type: "activity", data: { action: "click", label: "Step " + seq },
      }))) => {
        window.inspector?.dispose();
        media.currentTime = 0;
        window.inspector = createSessionReview(document.getElementById("root"), {
          recording: { durationMs: 240000, environment: { browser: "Synthetic" }, events },
          videoElement: media,
        });
      };
      window.updateTime = time => { media.currentTime = time; media.dispatchEvent(new Event("timeupdate")); };
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
      res.setHeader(
        "Content-Type",
        req.url === "/bundle.js" ? "text/javascript" : "text/html",
      );
      res.end(
        req.url === "/bundle.js"
          ? result.outputFiles[0].text
          : '<div id="root"></div><script src="/bundle.js"></script>',
      );
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
    const browser = await chromium.launch({ headless: true });
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(`http://127.0.0.1:${address.port}`);
    for (const name of ["appearance.css", "video.css", "session-review.css"])
      await page.addStyleTag({ path: `extension/${name}` });

    await t.test(
      "100ms media updates allow a distant active event to scroll smoothly into view",
      async () => {
        await page.emulateMedia({ reducedMotion: "no-preference" });
        const progress = await page.evaluate(async () => {
          const w = window as any;
          w.mount();
          await w.media.play();
          w.updateTime(81);
          const content = document.querySelector<HTMLElement>(".review-events")!;
          const samples: number[] = [];
          let updates = 0;
          const timer = setInterval(
            () => w.updateTime(81 + Math.min(++updates, 9) / 10),
            100,
          );
          const start = performance.now();
          while (performance.now() - start < 1400) {
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
            samples.push(content.scrollTop);
          }
          clearInterval(timer);
          const row = content.querySelector('[aria-current="true"]')!;
          const viewRect = content.getBoundingClientRect(),
            rowRect = row.getBoundingClientRect();
          w.media.pause();
          return {
            samples,
            updates,
            seq: (row as HTMLElement).dataset.seq,
            centerDelta:
              rowRect.top + rowRect.height / 2 - viewRect.top - viewRect.height / 2,
            future: content.querySelector<HTMLElement>('[data-seq="81"]')!.dataset.future,
          };
        });
        assert.ok(progress.updates >= 10);
        assert.equal(progress.seq, "80");
        assert.equal(progress.future, "true");
        assert.ok(
          new Set(progress.samples.map(Math.round)).size > 4,
          "scroll must visibly advance through intermediate positions",
        );
        assert.ok(
          Math.abs(progress.centerDelta) <= 3,
          `active event must reach center despite timeupdates: ${JSON.stringify(progress)}`,
        );
      },
    );

    await t.test(
      "reduced motion centers instantly and manual selection, tabs and pagination remain usable",
      async () => {
        await page.emulateMedia({ reducedMotion: "reduce" });
        const delta = await page.evaluate(async () => {
          const w = window as any;
          w.mount();
          await w.media.play();
          w.updateTime(81);
          const view = document.querySelector(".review-events")!.getBoundingClientRect();
          const row = document
            .querySelector('.review-event[aria-current="true"]')!
            .getBoundingClientRect();
          w.media.pause();
          return row.top + row.height / 2 - view.top - view.height / 2;
        });
        assert.ok(
          Math.abs(delta) <= 3,
          "reduced motion must not wait for animated scrolling",
        );
        await page.getByRole("button", { name: "Following playback" }).click();
        await page.getByRole("tab", { name: /^Activity/ }).click();
        await page.getByRole("button", { name: "Later events" }).click();
        assert.equal(await page.locator('.review-event[data-seq="224"]').count(), 1);
        await page.locator('.review-event[data-seq="224"]').click();
        assert.equal(
          await page
            .locator('.review-event[aria-current="true"]')
            .getAttribute("data-seq"),
          "224",
        );
        assert.equal(await page.evaluate(() => (window as any).media.currentTime), 225);
        assert.match(
          (await page.locator(".review-detail pre").textContent()) || "",
          /Step 224/,
        );
        // Clear the focused event through a tab switch before browsing the earlier page.
        await page.getByRole("tab", { name: /^Console/ }).click();
        assert.equal(await page.locator(".review-event").count(), 0);
        await page.getByRole("tab", { name: /^Activity/ }).click();
        await page.getByRole("button", { name: "Later events" }).click();
        await page.getByRole("button", { name: "Earlier events" }).click();
        assert.equal(await page.locator('.review-event[data-seq="0"]').count(), 1);
      },
    );

    await t.test(
      "retained network rows update merged labels and their selected details",
      async () => {
        await page.evaluate(() =>
          (window as any).mount([
            {
              seq: 1,
              atMs: 100,
              type: "network",
              data: {
                requestId: "request-1",
                phase: "request",
                method: "POST",
                url: "/submit",
              },
            },
            {
              seq: 2,
              atMs: 900,
              type: "network",
              data: { requestId: "request-1", phase: "response", status: 500 },
            },
          ]),
        );
        await page.getByRole("button", { name: "Following playback" }).click();
        await page.getByRole("tab", { name: /^Network/ }).click();
        await page.getByLabel(/Browse all events/).uncheck();
        await page.evaluate(() => (window as any).updateTime(0.2));
        assert.match(
          (await page.locator(".review-event-label").textContent()) || "",
          /POST \/submit · request/,
        );
        await page.evaluate(() => (window as any).updateTime(0.95));
        assert.equal(await page.locator(".review-event").count(), 1);
        assert.match(
          (await page.locator(".review-event-label").textContent()) || "",
          /POST \/submit · 500/,
        );
        assert.equal(await page.locator(".review-event.review-error").count(), 1);
        await page.locator(".review-event").click();
        await page.evaluate(() => {
          (window as any).media.dispatchEvent(new Event("seeked"));
          (window as any).updateTime(0.95);
        });
        assert.equal(
          await page
            .locator('.review-event[aria-current="true"]')
            .getAttribute("data-seq"),
          "2",
          "the retained row must select its latest merged event",
        );
        const details = JSON.parse(
          (await page.locator(".review-detail pre").textContent()) || "{}",
        );
        assert.equal(details.status, 500);
        assert.equal(details.method, "POST");
        assert.equal(details.url, "/submit");
      },
    );
  },
);
