import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { build } from "esbuild";
import { chromium } from "playwright";

test(
  "native recorder publishes its clock and shows bounded diagnostics health independently",
  { skip: process.env.FEEDBACKS_RECORDING_BROWSER_SMOKE !== "1" },
  async () => {
    const browser = await chromium.launch({ headless: true, channel: "chromium" });
    try {
      const page = await browser.newPage();
      const html = (await readFile("extension/video.html", "utf8")).replace(
        /<script[^>]*>[\s\S]*?<\/script>/g,
        "",
      );
      await page.route("https://recorder.test/**", (route) =>
        route.fulfill({ contentType: "text/html", body: html }),
      );
      await page.goto("https://recorder.test/video.html?sourceTabId=10");
      await page.addScriptTag({ content: "globalThis.__name = value => value;" });
      for (const name of ["appearance.css", "video.css", "session-review.css"])
        await page.addStyleTag({ path: `extension/${name}` });
      await page.evaluate(() => {
        const w = window as any;
        w.published = [];
        w.requests = [];
        w.recording = {
          id: "11111111-1111-4111-8111-111111111111",
          startedAt: new Date().toISOString(),
          durationMs: 5000,
          privacy: { maskInputs: true },
          coverage: [],
          events: [],
        };
        w.health = {
          active: true,
          counts: { activity: 7, console: 2, network: 3, replay: 11 },
          coverage: [],
        };
        w.chrome = {
          runtime: {
            connect: () => ({
              postMessage: (message: any) => w.published.push(message),
              onMessage: {
                addListener: (fn: any) => {
                  w.control = fn;
                },
              },
              onDisconnect: { addListener: () => {} },
            }),
            sendMessage: async (message: any) => {
              w.requests.push(message.type);
              const data =
                message.type === "videoContext"
                  ? {
                      sourceTabId: 10,
                      projectId: "project",
                      reviewId: "review",
                      project: { name: "Fixture" },
                      url: "https://page.test",
                      server: "https://server.test",
                      viewport: { width: 1280, height: 720 },
                    }
                  : message.type === "videoCaptureHandle"
                    ? { handle: "fixture", origin: "https://page.test" }
                    : message.type === "sessionStart"
                      ? { started: Date.now() }
                      : message.type === "sessionHealth"
                        ? w.health
                        : message.type === "sessionStop"
                          ? { recording: w.recording }
                          : message.type === "recordingAnnotations"
                            ? { recordingId: w.recording.id, items: [] }
                            : {};
              return { ok: true, data };
            },
          },
        };
        const canvas = document.createElement("canvas");
        canvas.width = 320;
        canvas.height = 180;
        const context = canvas.getContext("2d")!;
        setInterval(() => {
          context.fillStyle = "#17324d";
          context.fillRect(0, 0, 320, 180);
          context.fillStyle = "white";
          context.fillText(String(Date.now()), 20, 20);
        }, 50);
        navigator.mediaDevices.getDisplayMedia = async (options) => {
          w.captureOptions = options;
          const stream = canvas.captureStream(10);
          const track = stream.getVideoTracks()[0];
          track.getSettings = () => ({
            displaySurface: "browser",
            width: 320,
            height: 180,
          });
          (track as any).getCaptureHandle = () => ({
            handle: "fixture",
            origin: "https://page.test",
          });
          w.videoTrack = track;
          return stream;
        };
        w.__feedbacksFixWebmDuration = async (blob: Blob) => {
          await new Promise((resolve) => {
            w.finishMetadata = resolve;
          });
          return blob;
        };
      });
      const bundle = await build({
        entryPoints: ["extension/video.js"],
        bundle: true,
        write: false,
        format: "iife",
      });
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      await page.locator("#start:enabled").waitFor();
      await page.locator("#start").click();
      await page.waitForFunction(() =>
        (window as any).published.some((entry: any) => entry.state === "recording"),
      );
      const start = await page.evaluate(() =>
        (window as any).published.filter((entry: any) => entry.state),
      );
      assert.deepEqual(
        start.map((entry: any) => entry.state),
        ["starting", "recording"],
      );
      assert.ok(start.every((entry: any) => Number.isFinite(entry.elapsedMs)));
      const capture = await page.evaluate(() => ({
        options: (window as any).captureOptions,
        hint: (window as any).videoTrack.contentHint,
      }));
      assert.equal(
        capture.options.video.width,
        undefined,
        "source width must not be forcibly downscaled",
      );
      assert.equal(
        capture.options.video.height,
        undefined,
        "source height must not be forcibly downscaled",
      );
      assert.equal(capture.hint, "detail");
      await page.locator("#capture-health").filter({ hasText: "7 actions" }).waitFor();
      assert.match(
        await page.locator("#capture-health").innerText(),
        /2 console.*3 network.*11 replay/s,
      );
      await page.waitForTimeout(400);
      await page.locator("#pause").click();
      await page.waitForFunction(
        () => (window as any).published.at(-1)?.state === "paused",
      );
      const paused = await page.evaluate(() => (window as any).published.at(-1));
      assert.equal(paused.state, "paused");
      assert.ok(paused.elapsedMs >= 300);
      await page.waitForTimeout(500);
      await page.locator("#pause").click();
      await page.waitForFunction(
        () => (window as any).published.at(-1)?.state === "recording",
      );
      const resumed = await page.evaluate(() => (window as any).published.at(-1));
      assert.ok(resumed.elapsedMs - paused.elapsedMs < 100, "paused time is excluded");
      await page.evaluate(() => {
        (window as any).health = {
          active: true,
          counts: { activity: 20, console: 3, network: 8, replay: 11 },
          coverage: [
            {
              channel: "replay",
              status: "partial",
              detail: "DOM replay reached its event limit.",
            },
          ],
          replayStoppedAtMs: 800,
        };
      });
      await page
        .locator("#capture-health-warning")
        .filter({ hasText: "event limit" })
        .waitFor();
      assert.equal(
        await page.locator("#stop").isVisible(),
        true,
        "partial DOM capture does not stop native video",
      );
      assert.equal(
        await page.evaluate(() => (window as any).requests.includes("sessionStatus")),
        false,
      );
      assert.equal(await page.locator("#debug-options").isVisible(), false);
      assert.equal(await page.locator("#capture-health").isVisible(), true);
      await mkdir("output/playwright/recording-video-state", { recursive: true });
      await page.screenshot({
        path: "output/playwright/recording-video-state/health-desktop.png",
      });
      await page.setViewportSize({ width: 375, height: 740 });
      await page.emulateMedia({ colorScheme: "dark" });
      await page.locator("#capture-health").scrollIntoViewIfNeeded();
      await page.screenshot({
        path: "output/playwright/recording-video-state/health-mobile-dark.png",
      });
      await page.locator("#stop").click();
      await page.waitForFunction(
        () => typeof (window as any).finishMetadata === "function",
      );
      const stopping = await page.evaluate(() => (window as any).published.at(-1));
      assert.equal(stopping.state, "stopping");
      await page.waitForTimeout(350);
      await page.evaluate(() => (window as any).finishMetadata());
      await page.waitForFunction(
        () => (window as any).published.at(-1).state === "ready",
      );
      const ready = await page.evaluate(() => (window as any).published.at(-1));
      assert.equal(
        ready.elapsedMs,
        stopping.elapsedMs,
        "metadata finalization is excluded from video duration",
      );
    } finally {
      await browser.close();
    }
  },
);
