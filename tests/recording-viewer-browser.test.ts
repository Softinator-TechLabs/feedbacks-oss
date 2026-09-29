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
          import { ThreadRecordings } from "./src/web/recordings/thread-recordings.tsx";
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
      eventCount: 13,
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
          seq: 13,
          atMs: 1100,
          type: "performance",
          data: { name: "Largest contentful paint", durationMs: 287 },
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
        contents: `import React from "react"; import { createRoot } from "react-dom/client"; import { ThreadRecordings } from "./src/web/recordings/thread-recordings.tsx"; createRoot(document.getElementById("root")).render(React.createElement(ThreadRecordings,{thread:{id:"thread",assets:[]}}));`,
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
      assert.equal(
        await page
          .getByRole("button", { name: "Everything", exact: true })
          .getAttribute("aria-pressed"),
        "true",
      );
      assert.deepEqual(
        await page
          .locator(".recording-everything .recording-event-tag")
          .allTextContents(),
        [
          "Environment",
          "console",
          "console",
          "console",
          "network",
          "performance",
          "activity",
          "activity",
          "activity",
          "activity",
          "console",
          "network",
        ],
      );
      assert.match(
        (await page.locator(".recording-everything").textContent()) ?? "",
        /0:01\.0.*POST \/api\/check.*0:01\.1.*Largest contentful paint.*0:01\.2.*Typed in Search/s,
      );
      await page.waitForFunction(
        () =>
          !document.querySelector<HTMLButtonElement>(".recording-timeline button")
            ?.disabled,
      );
      const frame = await page.locator(".recording-stage iframe").elementHandle();
      assert.ok(frame);
      await page.getByRole("button", { name: "Play replay" }).click();
      await page
        .locator(".recording-tabs")
        .getByRole("button", { name: "Console" })
        .click();
      await page.getByRole("button", { name: "At playhead" }).click();
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
        { timeout: 15000 },
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
      await page
        .locator(".recording-tabs")
        .getByRole("button", { name: "Network" })
        .click();
      await page.getByRole("button", { name: "All events" }).click();
      await page
        .locator(".recording-network .recording-events")
        .getByRole("button", { name: /POST.*api\/check/ })
        .click();
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
      await page
        .locator(".recording-tabs")
        .getByRole("button", { name: "Activity" })
        .click();
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
      eventCount: 24,
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
        ...Array.from({ length: 20 }, (_, index) => ({
          seq: 20 + index,
          atMs: 200 + index * 55,
          type: "activity",
          data: { action: "click", label: `Step ${index + 1}` },
        })),
        {
          seq: 1,
          atMs: 2500,
          type: "activity",
          data: { action: "click", label: "Buy", x: 20, y: 30 },
        },
        {
          seq: 44,
          atMs: 2500,
          type: "activity",
          data: { action: "click", label: "Same moment secondary" },
        },
      ],
    };
    const bundle = await build({
      stdin: {
        contents: `import "./src/web/styles.css"; import "./src/web/threads/detail.css"; import "./src/web/theme.css"; import React from "react"; import { createRoot } from "react-dom/client"; import { ThreadRecordings } from "./src/web/recordings/thread-recordings.tsx"; window.frameToAnnotate=null; createRoot(document.getElementById("root")).render(React.createElement(ThreadRecordings,{thread:{id:"thread",assets:[{id:"video",url:"/video.webm",contentType:"video/webm",rendition:"original",durationMs:2000},{id:"annotated",url:"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP1cAAAAASUVORK5CYII=",contentType:"image/webp",rendition:"annotated",recordingFrame:{recordingId:"recording",atMs:2500,videoTimeMs:1500,annotationId:"point-1"}}],context:{annotations:[{id:"point-1",body:"Make this larger"}]}},canWrite:true,onAnnotateFrame:(frame)=>{window.frameToAnnotate=frame}}));`,
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
      assert.equal(await page.locator("#thread-recording-select").count(), 0);
      assert.equal(await page.locator(".recording-media video").count(), 1);
      assert.equal(await page.locator(".recording-media video").isVisible(), true);
      assert.equal(
        await page.locator(".recording-media video").evaluate((video) => video.controls),
        false,
        "video and session must expose one seek bar",
      );
      assert.equal(await page.locator("#thread-recording-timeline").count(), 1);
      assert.equal(await page.getByRole("button", { name: "Mute video" }).count(), 1);
      assert.equal(
        await page.getByRole("button", { name: "Full screen video" }).count(),
        1,
      );
      const playerChrome = await page.evaluate(() => {
        const controls = Array.from(
          document.querySelectorAll<HTMLButtonElement>(
            ".recording-playback-actions > button",
          ),
        );
        const stage = document.querySelector<HTMLElement>(".recording-video-stage")!;
        const timeline = document.querySelector<HTMLElement>(".recording-timeline")!;
        const inspector = document.querySelector<HTMLElement>(".recording-diagnostics")!;
        return {
          heights: controls.map((button) => button.getBoundingClientRect().height),
          borders: [stage, timeline, inspector].map(
            (element) => getComputedStyle(element).borderLeftColor,
          ),
          seams: [
            getComputedStyle(stage).borderBottomWidth,
            getComputedStyle(timeline).borderTopWidth,
          ],
        };
      });
      assert.ok(playerChrome.heights.length >= 4);
      assert.ok(playerChrome.heights.every((height) => height === 44));
      assert.equal(new Set(playerChrome.borders).size, 1);
      assert.deepEqual(playerChrome.seams, ["0px", "0px"]);
      const videoBox = (await page.locator(".recording-media video").boundingBox())!;
      const controlsBox = (await page
        .locator(".recording-playback-actions")
        .boundingBox())!;
      const timelineBox = (await page.locator(".recording-timeline").boundingBox())!;
      const eventsBox = (await page.locator(".recording-diagnostics").boundingBox())!;
      assert.ok(
        controlsBox.y < videoBox.y &&
          videoBox.y < timelineBox.y &&
          timelineBox.y < eventsBox.y,
      );
      assert.ok(eventsBox.y - (timelineBox.y + timelineBox.height) < 2);
      assert.ok(videoBox.width >= timelineBox.width * 0.8);
      await page.getByRole("button", { name: "Larger", exact: true }).click();
      assert.equal(
        await page.locator(".thread-recordings").getAttribute("data-video-size"),
        "large",
      );
      await page.getByRole("button", { name: "Beside", exact: true }).click();
      const besideVideo = (await page.locator(".recording-media video").boundingBox())!;
      const besideEvents = (await page.locator(".recording-diagnostics").boundingBox())!;
      const besideTimeline = (await page.locator(".recording-timeline").boundingBox())!;
      const besideFootnote = (await page.locator(".recording-footnote").boundingBox())!;
      assert.ok(besideEvents.x >= besideVideo.x + besideVideo.width - 2);
      assert.ok(
        Math.abs(besideEvents.y - besideVideo.y) <= 4,
        JSON.stringify({ besideEvents, besideVideo, besideTimeline }),
      );
      assert.ok(Math.abs(besideTimeline.x - besideVideo.x) <= 4);
      assert.ok(Math.abs(besideTimeline.width - besideVideo.width) <= 4);
      assert.ok(
        besideFootnote.y >=
          Math.max(
            besideTimeline.y + besideTimeline.height,
            besideEvents.y + besideEvents.height,
          ),
      );
      assert.ok(besideFootnote.width > besideVideo.width);
      assert.equal(
        await page
          .locator(".recording-tabs")
          .evaluate((tabs) => tabs.scrollWidth <= tabs.clientWidth),
        true,
      );
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      await page.screenshot({
        path: ".local/thread-video-layout-beside.png",
        fullPage: true,
      });
      await page.setViewportSize({ width: 830, height: 720 });
      const narrowVideo = (await page.locator(".recording-media video").boundingBox())!;
      const narrowEvents = (await page.locator(".recording-diagnostics").boundingBox())!;
      assert.ok(narrowEvents.y >= narrowVideo.y + narrowVideo.height);
      assert.equal(
        await page.getByRole("button", { name: "Below", exact: true }).isVisible(),
        false,
      );
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.getByRole("button", { name: "Below", exact: true }).click();
      await page.getByRole("button", { name: "Smaller", exact: true }).click();
      const focusedVideo = page.locator(".recording-media video");
      await focusedVideo.focus();
      await page.keyboard.press("Space");
      assert.equal(
        await focusedVideo.evaluate((video: HTMLVideoElement) => video.paused),
        false,
      );
      await page.keyboard.press("Space");
      assert.equal(
        await focusedVideo.evaluate((video: HTMLVideoElement) => video.paused),
        true,
      );
      await page.screenshot({
        path: ".local/thread-video-layout-light.png",
        fullPage: true,
      });
      await page.evaluate(() => {
        document.documentElement.dataset.theme = "dark";
      });
      const followColors = await page
        .locator('.recording-follow[aria-pressed="true"]')
        .evaluate((button) => {
          const style = getComputedStyle(button);
          return { color: style.color, background: style.backgroundColor };
        });
      assert.deepEqual(
        followColors,
        {
          color: "rgb(20, 36, 54)",
          background: "rgb(203, 221, 235)",
        },
        "active dark-mode playback control must stay legible",
      );
      const darkActivityTab = page.locator(".recording-tabs button", {
        hasText: "Activity",
      });
      await darkActivityTab.hover();
      const darkTabStyle = await darkActivityTab.evaluate((button) => {
        const style = getComputedStyle(button);
        return {
          marginLeft: style.marginLeft,
          marginRight: style.marginRight,
          paddingLeft: style.paddingLeft,
          background: style.backgroundColor,
        };
      });
      assert.equal(darkTabStyle.marginLeft, "2px");
      assert.equal(darkTabStyle.marginRight, "2px");
      assert.equal(darkTabStyle.paddingLeft, "12px");
      assert.notEqual(darkTabStyle.background, "rgba(0, 0, 0, 0)");
      await page.evaluate(() => {
        const tabs = document.createElement("div");
        tabs.className = "account-tabs";
        tabs.innerHTML =
          '<button aria-selected="true">Account</button><button>Settings</button>';
        document.body.append(tabs);
      });
      const accountTab = page.getByRole("button", { name: "Settings", exact: true });
      await accountTab.hover();
      assert.deepEqual(
        await accountTab.evaluate((button) => {
          const style = getComputedStyle(button);
          return [style.marginLeft, style.marginRight, style.paddingLeft];
        }),
        ["2px", "2px", "12px"],
      );
      await page.screenshot({
        path: ".local/thread-video-layout-dark.png",
        fullPage: true,
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({
        path: ".local/thread-video-layout-mobile.png",
        fullPage: true,
      });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      const mobileVideo = (await page.locator(".recording-media video").boundingBox())!;
      const mobileTimeline = (await page.locator(".recording-timeline").boundingBox())!;
      const mobileEvents = (await page.locator(".recording-diagnostics").boundingBox())!;
      assert.ok(mobileVideo.y < mobileTimeline.y && mobileTimeline.y < mobileEvents.y);
      await page.setViewportSize({ width: 1280, height: 720 });
      await replayMode.click();
      await page.locator(".recording-stage iframe").waitFor();
      assert.equal(await replayMode.getAttribute("aria-pressed"), "true");
      await videoMode.click();
      await page.locator(".recording-media video").waitFor();
      await page.getByRole("button", { name: "All events" }).click();
      const pointMark = page.locator('.recording-timeline-mark[data-channel="point"]');
      await pointMark.hover();
      assert.match(
        (await pointMark.locator('[role="tooltip"]').textContent()) || "",
        /Make this larger/,
      );
      await page.waitForFunction(
        () =>
          getComputedStyle(
            document.querySelector(
              '.recording-timeline-mark[data-channel="point"] [role="tooltip"]',
            )!,
          ).opacity === "1",
      );
      assert.equal(
        await pointMark
          .locator('[role="tooltip"]')
          .evaluate((element) => getComputedStyle(element).opacity),
        "1",
      );
      assert.equal(
        await page.getByRole("heading", { name: /Screenshot comments/ }).count(),
        0,
      );
      const buyMark = page.locator('.recording-timeline-mark[aria-label*="Clicked Buy"]');
      await buyMark.hover();
      assert.match(
        (await buyMark.locator('[role="tooltip"]').textContent()) || "",
        /0:02.5.*Clicked Buy/,
      );
      await buyMark.click();
      const outerScrollAfterClick = await page.evaluate(() => window.scrollY);
      await page.waitForTimeout(120);
      assert.equal(
        await page.evaluate(() => window.scrollY),
        outerScrollAfterClick,
        "revealing a selected event must scroll the inner feed, not the page",
      );
      assert.ok(
        await page.locator(".recording-timeline-lane").evaluate((lane) => {
          const mark = lane.querySelector(
            '.recording-timeline-mark[aria-label*="Clicked Buy"]',
          );
          const line = lane.querySelector(".recording-timeline-playhead");
          if (!mark || !line) return false;
          const dot = mark.getBoundingClientRect();
          const head = line.getBoundingClientRect();
          return Math.abs(dot.left + dot.width / 2 - (head.left + head.width / 2)) <= 2;
        }),
        "the playhead line must pass through the selected event mark",
      );
      assert.equal(
        await page
          .locator(".recording-tabs button", { hasText: "Activity" })
          .getAttribute("aria-pressed"),
        "true",
      );
      assert.match(
        (await page
          .locator('.recording-events button[aria-current="true"]')
          .textContent()) || "",
        /Clicked Buy/,
      );
      assert.equal(
        await page.locator('.recording-events button[aria-current="true"]').isVisible(),
        true,
      );
      await page.waitForFunction(
        () =>
          ![...document.querySelectorAll<HTMLButtonElement>("button")].find(
            (button) => button.textContent === "Save frame",
          )?.disabled,
      );
      await page.getByRole("button", { name: "Annotate frame" }).click();
      const selectedFrame = await page.evaluate(() => (window as any).frameToAnnotate);
      assert.match(selectedFrame.imageBase64, /^data:image\/png;base64,/);
      assert.equal(selectedFrame.recordingFrame.recordingId, "recording");
      assert.ok(
        selectedFrame.recordingFrame.atMs >= 2250 &&
          selectedFrame.recordingFrame.atMs <= 2750,
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
      await page.locator(".recording-media video").click();
      await page.waitForFunction(
        () =>
          document.querySelector<HTMLVideoElement>(".recording-media video")!
            .currentTime > 0.1,
      );
      await page.locator(".recording-media video").click();
      assert.equal(
        await page
          .locator(".recording-media video")
          .evaluate((video: HTMLVideoElement) => video.paused),
        true,
      );
      await page.getByRole("button", { name: "Play video" }).click();
      await page.waitForFunction(
        () =>
          document.querySelector<HTMLVideoElement>(".recording-media video")!
            .currentTime > 1.55,
      );
      await page.waitForFunction(() => {
        const video = document.querySelector<HTMLVideoElement>(".recording-media video");
        const timeline = document.querySelector<HTMLInputElement>(
          "#thread-recording-timeline",
        );
        return (
          !!video &&
          !!timeline &&
          Math.abs(Number(timeline.value) - (video.currentTime * 1000 + 1000)) < 350
        );
      });
      await page.waitForFunction(() =>
        document
          .querySelector('.recording-events button[aria-current="true"]')
          ?.textContent?.includes("Clicked Same moment secondary"),
      );
      await page.waitForFunction(() => {
        const list = document.querySelector(".recording-events");
        const active = list?.querySelector('[aria-current="true"]');
        if (!list || !active) return false;
        const container = list.getBoundingClientRect();
        const row = active.getBoundingClientRect();
        return row.top >= container.top && row.bottom <= container.bottom;
      });
      await page
        .locator(".recording-events")
        .getByRole("button", { name: /Clicked Removed/ })
        .click();
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

      // A trimmed capture may start after the session clock begins. Opening it
      // should land on playable media instead of a disabled Play button.
      recording.video.segments = [
        { sourceStartMs: 500, sourceEndMs: 2500, outputStartMs: 0 },
      ];
      await page.reload();
      await page.getByRole("button", { name: "Play video" }).waitFor();
      assert.equal(await page.locator("#thread-recording-timeline").inputValue(), "500");
      assert.equal(
        await page.getByRole("button", { name: "Play video" }).isEnabled(),
        true,
      );
    } finally {
      await browser.close();
      server.close();
      await once(server, "close");
      rmSync(videoDir, { recursive: true, force: true });
    }
  },
);
