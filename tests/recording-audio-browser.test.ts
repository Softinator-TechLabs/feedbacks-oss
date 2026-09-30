import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { build } from "esbuild";
import { chromium } from "playwright";

const skip = process.env.FEEDBACKS_RECORDING_BROWSER_SMOKE !== "1";
test(
  "audio Settings recovers blocked access and releases test tracks",
  { skip },
  async () => {
    const browser = await chromium.launch({ headless: true, channel: "chromium" });
    try {
      const page = await browser.newPage({ viewport: { width: 1100, height: 920 } });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const html = (await readFile("extension/options.html", "utf8")).replace(
        /<script[^>]*>[\s\S]*?<\/script>/g,
        "",
      );
      await page.route("https://extension.test/**", (route) =>
        route.fulfill({ contentType: "text/html", body: html }),
      );
      await page.goto(
        "https://extension.test/options.html?audioIssue=microphone-blocked#recording-audio",
      );
      await page.addScriptTag({ content: "globalThis.__name = value => value;" });
      for (const name of ["appearance.css", "options.css"])
        await page.addStyleTag({ path: `extension/${name}` });
      await page.evaluate(() => {
        const w = window as any;
        w.permission = "denied";
        w.micCalls = 0;
        w.stops = 0;
        w.opened = [];
        w.saved = { microphone: false };
        Object.defineProperty(navigator, "permissions", {
          value: { query: async () => ({ state: w.permission }) },
        });
        navigator.mediaDevices.getUserMedia = async () => {
          w.micCalls++;
          w.permission = "granted";
          const track = { readyState: "live", stop: () => w.stops++ };
          return { getAudioTracks: () => [track], getTracks: () => [track] } as any;
        };
        w.chrome = {
          runtime: {
            id: "test",
            getURL: (path: string) => `chrome-extension://test/${path}`,
            getManifest: () => ({ version: "0.1.51" }),
            sendMessage: async () => ({
              ok: true,
              data: { reviewDefaults: {}, connected: false },
            }),
          },
          storage: {
            local: {
              get: async () => ({ videoRecordingOptions: w.saved }),
              set: async (v: any) => {
                if (v.videoRecordingOptions) w.saved = v.videoRecordingOptions;
              },
            },
            sync: { get: async () => ({}) },
          },
          permissions: { contains: async () => false },
          commands: { getAll: async () => [] },
          tabs: { create: async (v: any) => w.opened.push(v) },
        };
      });
      const bundle = await build({
        entryPoints: ["extension/options.js"],
        bundle: true,
        write: false,
        format: "iife",
      });
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      await page.waitForFunction(() =>
        document.getElementById("microphone-state")!.textContent!.includes("blocked"),
      );
      assert.equal(await page.evaluate(() => (window as any).micCalls), 0);
      assert.equal(
        await page.locator('[data-video-default="tabAudio"]').isChecked(),
        true,
      );
      assert.equal(
        await page.locator('[data-video-default="microphone"]').isChecked(),
        false,
      );
      await page.locator("#microphone-settings").click();
      assert.deepEqual(await page.evaluate(() => (window as any).opened), [
        { url: "chrome://settings/content/microphone" },
      ]);
      await page.evaluate(() => ((window as any).permission = "prompt"));
      await page.locator("#microphone-test").click();
      await page.waitForFunction(() =>
        document
          .getElementById("audio-message")!
          .textContent!.includes("Microphone is available"),
      );
      assert.deepEqual(
        await page.evaluate(() => [(window as any).micCalls, (window as any).stops]),
        [1, 1],
      );
      assert.equal(
        await page.locator("#microphone-test").textContent(),
        "Test microphone",
      );
      for (const theme of ["light", "dark"]) {
        await page.evaluate(
          (theme) => (document.documentElement.dataset.feedbacksTheme = theme),
          theme,
        );
        for (const width of [1100, 390]) {
          await page.setViewportSize({ width, height: 920 });
          assert.equal(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
            true,
            `${theme} ${width}px does not overflow`,
          );
        }
      }
      await page.setViewportSize({ width: 1100, height: 920 });
      await mkdir(".local/recording-audio", { recursive: true });
      await page
        .locator("#recording-audio")
        .screenshot({ path: ".local/recording-audio/settings-dark.png" });
      await page.evaluate(() => {
        (window as any).permission = "prompt";
        (window as any).micCalls = 0;
      });
      const setup = await build({
        stdin: {
          contents:
            'import { createAudioSettings } from "./extension/recordings/audio-settings.js"; globalThis.audioSetup = createAudioSettings({document, chrome, url: "https://extension.test/options.html?audioIssue=microphone-permission"});',
          resolveDir: process.cwd(),
        },
        bundle: true,
        write: false,
        format: "iife",
      });
      await page.addScriptTag({ content: setup.outputFiles[0].text });
      await page.evaluate(() => (window as any).audioSetup.ready);
      assert.equal(await page.evaluate(() => (window as any).micCalls), 1);
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  },
);

test(
  "offscreen recorder mixes default tab and mic audio; first grant captures nothing",
  { skip },
  async () => {
    const browser = await chromium.launch({ headless: true, channel: "chromium" });
    try {
      const page = await browser.newPage();
      await page.route("https://audio.test/**", (route) =>
        route.fulfill({ contentType: "text/html", body: "<html></html>" }),
      );
      await page.goto("https://audio.test/");
      await page.addScriptTag({ content: "globalThis.__name = value => value;" });
      await page.evaluate(() => {
        const w = window as any;
        w.permission = "prompt";
        w.states = [];
        w.calls = [];
        w.tracks = [];
        w.mixCounts = [];
        Object.defineProperty(navigator, "permissions", {
          value: { query: async () => ({ state: w.permission }) },
        });
        w.chrome = {
          runtime: {
            connect: () => ({
              postMessage: (m: any) => w.states.push(m),
              onMessage: { addListener: (fn: any) => (w.control = fn) },
              onDisconnect: { addListener() {} },
            }),
            sendMessage: async (m: any) => ({
              ok: true,
              data: m.type === "sessionStop" ? { recording: { id: "recording" } } : {},
            }),
          },
        };
        const canvas = document.createElement("canvas");
        canvas.width = 320;
        canvas.height = 180;
        const drawing = canvas.getContext("2d")!;
        setInterval(() => {
          drawing.fillStyle = "#17324d";
          drawing.fillRect(0, 0, 320, 180);
          drawing.fillStyle = "white";
          drawing.fillText(String(Date.now()), 20, 20);
        }, 50);
        const audio = new AudioContext();
        const oscillator = audio.createOscillator();
        const destination = audio.createMediaStreamDestination();
        oscillator.connect(destination);
        oscillator.start();
        navigator.mediaDevices.getUserMedia = async (options) => {
          w.calls.push(options);
          const tracks = [destination.stream.getAudioTracks()[0].clone()];
          if (options.video) tracks.push(canvas.captureStream(10).getVideoTracks()[0]);
          w.tracks.push(...tracks);
          return new MediaStream(tracks);
        };
        const NativeRecorder = MediaRecorder;
        w.MediaRecorder = class extends NativeRecorder {
          constructor(stream: MediaStream, options?: MediaRecorderOptions) {
            super(stream, options);
            w.mixCounts.push(stream.getAudioTracks().length);
          }
        };
      });
      const bundle = await build({
        entryPoints: ["extension/offscreen-video.js"],
        bundle: true,
        write: false,
        format: "iife",
      });
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      const start = () =>
        page.evaluate(() =>
          (window as any).control({
            action: "start",
            sourceTabId: 10,
            reviewId: "review",
            debugStarted: Date.now(),
            streamId: "fake",
            options: {},
          }),
        );
      await start();
      await page.waitForFunction(() =>
        (window as any).states.some((s: any) => s.audioCode === "microphone-permission"),
      );
      assert.equal(await page.evaluate(() => (window as any).calls.length), 0);
      await page.evaluate(() => ((window as any).permission = "granted"));
      await start();
      await page
        .waitForFunction(
          () => (window as any).states.some((s: any) => s.state === "recording"),
          undefined,
          { timeout: 5000 },
        )
        .catch(async (error) => {
          throw Error(
            `${error.message}; capture state: ${JSON.stringify(await page.evaluate(() => ({ states: (window as any).states, calls: (window as any).calls })))}`,
          );
        });
      assert.equal(
        await page.evaluate(() => Boolean((window as any).calls[0].audio.mandatory)),
        true,
      );
      assert.equal(await page.evaluate(() => (window as any).calls.length), 2);
      assert.deepEqual(await page.evaluate(() => (window as any).mixCounts), [1]);
      await page.waitForTimeout(300);
      await page.evaluate(() => (window as any).control({ action: "stop" }));
      await page
        .waitForFunction(
          () => (window as any).states.some((s: any) => s.state === "ready"),
          undefined,
          { timeout: 5000 },
        )
        .catch(async (error) => {
          throw Error(
            `${error.message}; finalize state: ${JSON.stringify(await page.evaluate(() => (window as any).states))}`,
          );
        });
      assert.equal(
        await page.evaluate(() =>
          (window as any).tracks.every(
            (track: MediaStreamTrack) => track.readyState === "ended",
          ),
        ),
        true,
      );
    } finally {
      await browser.close();
    }
  },
);
