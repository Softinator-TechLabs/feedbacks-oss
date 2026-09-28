import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { build } from "esbuild";
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test(
  "ordinary screenshot thread without recordings stays rendered in Chromium",
  { skip: process.env.FEEDBACKS_RECORDING_BROWSER_SMOKE !== "1" },
  async () => {
    const result = await build({
      stdin: {
        contents: `
          import React from "react";
          import { createRoot } from "react-dom/client";
          import { ThreadRecordings } from "./src/web/thread-recordings.tsx";
          const screenshot = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP1cAAAAASUVORK5CYII=";
          createRoot(document.getElementById("root")).render(
            <main>
              <h1>Ordinary screenshot feedback</h1>
              <img src={screenshot} alt="Original feedback screenshot" />
              <ThreadRecordings thread={{id:"ordinary-thread",assets:[{
                id:"ordinary-screenshot",contentType:"image/png",url:screenshot
              }]}} />
            </main>
          );`,
        loader: "tsx",
        resolveDir: process.cwd(),
      },
      bundle: true,
      format: "iife",
      platform: "browser",
      write: false,
      outdir: "out",
    });
    const script = result.outputFiles.find((file) => file.path.endsWith(".js"))!.text;
    const server = createServer((req, res) => {
      if (req.url === "/api/recordings.list") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: true, data: { items: [] } }));
      } else if (req.url === "/bundle.js") {
        res.setHeader("Content-Type", "text/javascript");
        res.end(script);
      } else {
        res.setHeader("Content-Type", "text/html");
        res.end('<!doctype html><div id="root"></div><script src="/bundle.js"></script>');
      }
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${address.port}`, { waitUntil: "networkidle" });
      assert.deepEqual(
        errors,
        [],
        "an unlinked image must not enter annotation rendering",
      );
      assert.equal(
        await page
          .getByRole("heading", { name: "Ordinary screenshot feedback" })
          .isVisible(),
        true,
      );
      assert.equal(
        await page
          .getByText("No session recording was shared with this thread.")
          .isVisible(),
        true,
      );
      assert.equal(
        await page
          .getByAltText("Original feedback screenshot")
          .evaluate(
            (image: HTMLImageElement) => image.complete && image.naturalWidth > 0,
          ),
        true,
      );
    } finally {
      await browser.close();
      server.close();
      await once(server, "close");
    }
  },
);

test(
  "replay keeps running beside time-filtered diagnostics in Chromium",
  {
    skip: process.env.FEEDBACKS_RECORDING_BROWSER_SMOKE !== "1",
  },
  async () => {
    const startedAt = "2026-01-01T00:00:00.000Z";
    const start = Date.parse(startedAt);
    const snapshot = (id: number) => ({
      type: 0,
      id,
      childNodes: [
        {
          type: 2,
          id: id + 1,
          tagName: "html",
          attributes: {},
          childNodes: [
            { type: 2, id: id + 2, tagName: "head", attributes: {}, childNodes: [] },
            {
              type: 2,
              id: id + 3,
              tagName: "body",
              attributes: {},
              childNodes: [{ type: 3, id: id + 4, textContent: "Recorded page" }],
            },
          ],
        },
      ],
    });
    const recording = {
      schemaVersion: 1,
      id: "recording",
      threadId: "thread",
      startedAt,
      durationMs: 5000,
      mode: "session",
      url: "https://example.test/page",
      eventCount: 12,
      privacy: { maskText: false, maskInputs: true, networkBodies: true },
      coverage: [{ channel: "replay", status: "complete" }],
      environment: { browser: "Synthetic", replayStoppedAtMs: 3500 },
      events: [
        {
          seq: 0,
          atMs: 0,
          type: "replay",
          data: {
            type: 4,
            timestamp: start,
            data: { href: "https://example.test/page", width: 640, height: 360 },
          },
        },
        {
          seq: 1,
          atMs: 100,
          type: "replay",
          data: {
            type: 2,
            timestamp: start + 100,
            data: { node: snapshot(1), initialOffset: { top: 0, left: 0 } },
          },
        },
        {
          seq: 2,
          atMs: 100,
          type: "console",
          data: { level: "log", args: ["old console"] },
        },
        { seq: 3, atMs: 200, type: "console", data: { level: "clear" } },
        {
          seq: 4,
          atMs: 600,
          type: "console",
          data: { level: "warn", args: ["current warning"] },
        },
        {
          seq: 5,
          atMs: 1000,
          type: "network",
          data: {
            phase: "request",
            requestId: "request-1",
            method: "POST",
            url: "/api/check",
            requestBody: "sent",
          },
        },
        {
          seq: 6,
          atMs: 1200,
          type: "activity",
          data: {
            action: "input",
            label: "Search",
            valueMasked: true,
            inputType: "insertText",
          },
        },
        {
          seq: 7,
          atMs: 1300,
          type: "activity",
          data: {
            action: "input",
            label: "Email Address",
            valueMasked: false,
            value: "an.extremely.long.email.address.for.mobile.layout@example.test",
            inputType: "insertText",
          },
        },
        {
          seq: 9,
          atMs: 1400,
          type: "activity",
          data: { action: "click", label: "Submit manuscript" },
        },
        {
          seq: 10,
          atMs: 1500,
          type: "activity",
          data: { action: "navigation", url: "https://example.test/confirmation" },
        },
        {
          seq: 11,
          atMs: 4000,
          type: "console",
          data: { level: "error", args: ["future error"] },
        },
        {
          seq: 12,
          atMs: 4500,
          type: "network",
          data: {
            phase: "response",
            requestId: "request-1",
            status: 200,
            responseBody: "future response",
          },
        },
      ],
    };
    const result = await build({
      stdin: {
        contents: `import React from "react"; import { createRoot } from "react-dom/client"; import { ThreadRecordings } from "./src/web/thread-recordings.tsx"; createRoot(document.getElementById("root")).render(React.createElement(ThreadRecordings,{thread:{id:"thread",assets:[]}}));`,
        loader: "tsx",
        resolveDir: process.cwd(),
      },
      bundle: true,
      format: "iife",
      platform: "browser",
      write: false,
      outdir: "out",
    });
    const script =
      result.outputFiles.find((file) => file.path.endsWith(".js"))?.text ?? "";
    const css = result.outputFiles.find((file) => file.path.endsWith(".css"))?.text ?? "";
    const server = createServer((req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-src https://challenges.cloudflare.com; connect-src 'self'; base-uri 'none'",
      );
      if (req.url === "/api/recordings.list") {
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            ok: true,
            data: {
              items: [{ ...recording, events: undefined, environment: undefined }],
            },
          }),
        );
      } else if (req.url === "/api/recordings.get") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: true, data: { recording } }));
      } else if (req.url === "/bundle.js") {
        res.setHeader("Content-Type", "text/javascript");
        res.end(script);
      } else if (req.url === "/bundle.css") {
        res.setHeader("Content-Type", "text/css");
        res.end(css);
      } else {
        res.setHeader("Content-Type", "text/html");
        res.end(
          '<!doctype html><html><head><link rel="stylesheet" href="/bundle.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>',
        );
      }
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${address.port}`, {
        waitUntil: "domcontentloaded",
      });
      await page.getByRole("button", { name: "Play replay" }).waitFor();
      await page.waitForFunction(
        () =>
          !document.querySelector<HTMLButtonElement>(".recording-timeline button")
            ?.disabled,
      );
      const frame = await page.locator(".recording-stage iframe").elementHandle();
      assert.ok(frame);
      await page.getByRole("button", { name: "Play replay" }).click();
      await page.getByRole("button", { name: "Console" }).click();
      await page.waitForFunction(
        () =>
          Number(
            document.querySelector<HTMLInputElement>("#thread-recording-timeline")?.value,
          ) >= 800,
      );
      assert.equal(
        await frame.evaluate((node) => node.isConnected),
        true,
        "diagnostic switch preserves the player iframe",
      );
      await page.getByRole("button", { name: "Pause replay" }).click();
      const consoleText = await page.locator(".recording-events").textContent();
      assert.match(consoleText ?? "", /current warning/);
      assert.doesNotMatch(consoleText ?? "", /old console|future error/);
      await page.getByRole("button", { name: "Play replay" }).click();
      await page.waitForFunction(
        () =>
          Number(
            document.querySelector<HTMLInputElement>("#thread-recording-timeline")?.value,
          ) >= 4200,
        undefined,
        { timeout: 7000 },
      );
      await page.getByRole("button", { name: "Pause replay" }).click();
      assert.match(
        (await page.locator(".recording-events").textContent()) ?? "",
        /future error/,
        "the recording clock continues after rrweb's final DOM event",
      );
      assert.equal(await page.locator(".recording-stage").isVisible(), false);
      assert.match(
        await page.locator('[role="status"]').innerText(),
        /DOM capture ended at 0:03.5/,
      );
      await page.locator("#thread-recording-timeline").fill("1000");
      assert.equal(await page.locator(".recording-stage").isVisible(), true);
      await page.getByRole("button", { name: "Network" }).click();
      await page.getByRole("button", { name: "All events" }).click();
      await page.getByRole("button", { name: /POST.*api\/check/ }).click();
      assert.match(
        (await page.locator(".recording-network-detail").textContent()) ?? "",
        /Response has not appeared at this point/,
      );
      assert.doesNotMatch(
        (await page.locator(".recording-network-detail").textContent()) ?? "",
        /future response/,
      );
      await page.locator("#thread-recording-timeline").fill("4600");
      assert.match(
        (await page.locator(".recording-network-detail").textContent()) ?? "",
        /future response/,
      );
      await page.getByRole("button", { name: "Activity" }).click();
      await page.getByRole("button", { name: "At playhead" }).click();
      assert.match(
        (await page.locator(".recording-events").textContent()) ?? "",
        /Typed in Search.*Value hidden/,
      );
      const activityText = (await page.locator(".recording-events").textContent()) ?? "";
      assert.match(activityText, /Typed in Email Address.*Value: an\.extremely/);
      assert.match(activityText, /Clicked Submit manuscript/);
      assert.match(activityText, /Visited https:\/\/example\.test\/confirmation/);
      await page.setViewportSize({ width: 390, height: 844 });
      const rowWidths = await page
        .locator(".recording-events button")
        .evaluateAll((rows) =>
          rows.map((row) => ({ client: row.clientWidth, scroll: row.scrollWidth })),
        );
      assert.ok(
        rowWidths.every(({ client, scroll }) => scroll <= client + 1),
        `activity text overflows a mobile row: ${JSON.stringify(rowWidths)}`,
      );
    } finally {
      await browser.close();
      server.close();
      await once(server, "close");
    }
  },
);

test(
  "video frame saves as a thread asset with aligned recording time",
  {
    skip: process.env.FEEDBACKS_RECORDING_BROWSER_SMOKE !== "1",
  },
  async () => {
    const videoDir = mkdtempSync(join(tmpdir(), "feedbacks-recording-video-"));
    const videoPath = join(videoDir, "capture.webm");
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=320x180:r=2",
      "-t",
      "2",
      "-c:v",
      "libvpx",
      "-an",
      "-y",
      videoPath,
    ]);
    const videoBytes = readFileSync(videoPath);
    const videoAsset = {
      id: "video",
      url: "/video.webm",
      contentType: "video/webm",
      rendition: "original",
      durationMs: 2000,
    };
    const replayStart = Date.parse("2026-01-01T00:00:00.000Z");
    const recording = {
      schemaVersion: 1,
      id: "recording",
      threadId: "thread",
      startedAt: "2026-01-01T00:00:00.000Z",
      durationMs: 3000,
      mode: "video",
      url: "https://example.test/page",
      eventCount: 4,
      privacy: { maskText: false, maskInputs: true, networkBodies: false },
      coverage: [
        { channel: "video", status: "complete" },
        { channel: "replay", status: "complete" },
      ],
      environment: {},
      video: {
        assetId: "video",
        offsetMs: 0,
        segments: [
          { sourceStartMs: 0, sourceEndMs: 1000, outputStartMs: 0 },
          { sourceStartMs: 2000, sourceEndMs: 3000, outputStartMs: 1000 },
        ],
      },
      events: [
        {
          seq: 2,
          atMs: 0,
          type: "replay",
          data: {
            type: 4,
            timestamp: replayStart,
            data: { href: "https://example.test/page", width: 320, height: 180 },
          },
        },
        {
          seq: 3,
          atMs: 100,
          type: "replay",
          data: {
            type: 2,
            timestamp: replayStart + 100,
            data: {
              node: {
                type: 0,
                id: 1,
                childNodes: [
                  {
                    type: 2,
                    id: 2,
                    tagName: "html",
                    attributes: {},
                    childNodes: [
                      { type: 2, id: 3, tagName: "head", attributes: {}, childNodes: [] },
                      {
                        type: 2,
                        id: 4,
                        tagName: "body",
                        attributes: {},
                        childNodes: [{ type: 3, id: 5, textContent: "Recorded page" }],
                      },
                    ],
                  },
                ],
              },
              initialOffset: { top: 0, left: 0 },
            },
          },
        },
        {
          seq: 0,
          atMs: 1500,
          type: "activity",
          data: { action: "click", label: "Removed", x: 10, y: 10 },
        },
        {
          seq: 1,
          atMs: 2500,
          type: "activity",
          data: { action: "click", label: "Buy", x: 20, y: 30 },
        },
      ],
    };
    const bundle = await build({
      stdin: {
        contents: `import React from "react"; import { createRoot } from "react-dom/client"; import { ThreadRecordings } from "./src/web/thread-recordings.tsx"; createRoot(document.getElementById("root")).render(React.createElement(ThreadRecordings,{thread:{id:"thread",assets:[{id:"video",url:"/video.webm",contentType:"video/webm",rendition:"original",durationMs:2000}]},canWrite:true}));`,
        loader: "tsx",
        resolveDir: process.cwd(),
      },
      bundle: true,
      format: "iife",
      platform: "browser",
      write: false,
      outdir: "out",
    });
    const script =
      bundle.outputFiles.find((file) => file.path.endsWith(".js"))?.text ?? "";
    const css = bundle.outputFiles.find((file) => file.path.endsWith(".css"))?.text ?? "";
    let upload: any;
    const server = createServer(async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; img-src 'self' data: blob:; media-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'",
      );
      if (req.url === "/video.webm") {
        res.setHeader("Content-Type", "video/webm");
        res.setHeader("Accept-Ranges", "bytes");
        const range = /^bytes=(\d+)-(\d*)$/.exec(String(req.headers.range ?? ""));
        if (range) {
          const start = Number(range[1]);
          const end = range[2]
            ? Math.min(Number(range[2]), videoBytes.length - 1)
            : videoBytes.length - 1;
          res.statusCode = 206;
          res.setHeader("Content-Range", `bytes ${start}-${end}/${videoBytes.length}`);
          res.setHeader("Content-Length", String(end - start + 1));
          res.end(videoBytes.subarray(start, end + 1));
        } else {
          res.setHeader("Content-Length", String(videoBytes.length));
          res.end(videoBytes);
        }
      } else if (req.url === "/api/recordings.list") {
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            ok: true,
            data: {
              items: [{ ...recording, events: undefined, environment: undefined }],
            },
          }),
        );
      } else if (req.url === "/api/recordings.get") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: true, data: { recording } }));
      } else if (req.url === "/api/threads.get") {
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            ok: true,
            data: { id: "thread", revision: 1, assets: [videoAsset] },
          }),
        );
      } else if (req.url === "/api/assets.upload") {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        upload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        const asset = {
          id: "frame",
          url: "/frame.webp",
          contentType: "image/webp",
          recordingFrame: upload.recordingFrame,
        };
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            ok: true,
            data: {
              asset,
              thread: { id: "thread", revision: 2, assets: [videoAsset, asset] },
            },
          }),
        );
      } else if (req.url === "/bundle.js") {
        res.setHeader("Content-Type", "text/javascript");
        res.end(script);
      } else if (req.url === "/bundle.css") {
        res.setHeader("Content-Type", "text/css");
        res.end(css);
      } else {
        res.setHeader("Content-Type", "text/html");
        res.end(
          '<!doctype html><html><head><link rel="stylesheet" href="/bundle.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>',
        );
      }
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${address.port}`, {
        waitUntil: "domcontentloaded",
      });
      await page.getByRole("button", { name: "Save frame" }).waitFor();
      const videoMode = page.getByRole("button", { name: "Video", exact: true });
      const replayMode = page.getByRole("button", { name: "Replay", exact: true });
      assert.equal(await videoMode.getAttribute("aria-pressed"), "true");
      assert.equal(await page.locator(".recording-media video").isVisible(), true);
      await replayMode.click();
      await page.locator(".recording-stage iframe").waitFor();
      assert.equal(await replayMode.getAttribute("aria-pressed"), "true");
      await videoMode.click();
      await page.locator(".recording-media video").waitFor();
      await page.getByRole("button", { name: "All events" }).click();
      await page.getByRole("button", { name: /Clicked Buy/ }).click();
      await page.waitForFunction(
        () =>
          ![...document.querySelectorAll<HTMLButtonElement>("button")].find(
            (button) => button.textContent === "Save frame",
          )?.disabled,
      );
      await page.getByRole("button", { name: "Save frame" }).click();
      await page.getByRole("link", { name: /Saved frame at/ }).waitFor();
      assert.equal(upload?.recordingFrame?.recordingId, "recording");
      assert.ok(upload.recordingFrame.atMs >= 2250 && upload.recordingFrame.atMs <= 2750);
      assert.ok(
        Math.abs(upload.recordingFrame.atMs - upload.recordingFrame.videoTimeMs - 1000) <=
          250,
      );
      assert.match(upload.imageBase64, /^data:image\/png;base64,/);
      assert.equal(upload.revision, 1);
      assert.ok(
        typeof upload.idempotencyKey === "string" && upload.idempotencyKey.length >= 8,
      );
      await page.locator("#thread-recording-timeline").fill("0");
      await page.getByRole("button", { name: "Play video" }).click();
      await page.waitForFunction(
        () =>
          document.querySelector<HTMLVideoElement>(".recording-media video")!
            .currentTime > 0.15,
      );
      await page.getByRole("button", { name: /Clicked Removed/ }).click();
      await page.waitForTimeout(150);
      assert.equal(
        await page.locator("#thread-recording-timeline").inputValue(),
        "1500",
        "removed gap remains selected after video pause events",
      );
      assert.equal(
        await page.getByRole("button", { name: "Save frame" }).isDisabled(),
        true,
      );
      assert.match(
        (await page.locator(".recording-footnote").last().textContent()) ?? "",
        /No video frame matches this moment/,
      );
    } finally {
      await browser.close();
      server.close();
      await once(server, "close");
      rmSync(videoDir, { recursive: true, force: true });
    }
  },
);
