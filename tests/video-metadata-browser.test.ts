import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { chromium } from "playwright";

test(
  "native static and moving recordings support repeated short trimmed exports",
  {
    skip: process.env.FEEDBACKS_RECORDING_BROWSER_SMOKE !== "1",
  },
  async () => {
    const metadataScript = readFileSync(
      "dist/extension/unpacked/webm-duration.js",
      "utf8",
    );
    const helperBundle = await build({
      stdin: {
        contents:
          'import {finalizeWebmMetadata} from "./extension/video/video-metadata.js"; import {exportVideo} from "./extension/video/video-media.js"; globalThis.finalizeWebmMetadata=finalizeWebmMetadata;globalThis.exportVideo=exportVideo;',
        resolveDir: process.cwd(),
      },
      bundle: true,
      platform: "browser",
      format: "iife",
      write: false,
    });
    const browser = await chromium.launch({
      headless: true,
      args: ["--autoplay-policy=no-user-gesture-required"],
    });
    try {
      const page = await browser.newPage();
      await page.setContent("<body></body>");
      // tsx names nested evaluated functions; expose its inert naming helper in the page.
      await page.addScriptTag({ content: "window.__name = (target) => target;" });
      await page.addScriptTag({ content: metadataScript });
      await page.addScriptTag({ content: helperBundle.outputFiles[0].text });
      for (const animated of [false, true]) {
        const result = await page.evaluate(async (animated) => {
          const canvas = document.createElement("canvas");
          canvas.width = 320;
          canvas.height = 180;
          const ctx = canvas.getContext("2d")!;
          let frameNumber = 0;
          const draw = () => {
            ctx.fillStyle = "#365979";
            ctx.fillRect(0, 0, 320, 180);
            if (animated) {
              ctx.fillStyle = "white";
              ctx.font = "24px sans-serif";
              ctx.fillText(`Frame ${frameNumber++}`, 20, 80);
            }
          };
          draw();
          const stream = canvas.captureStream(20);
          const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
          const chunks: Blob[] = [];
          recorder.ondataavailable = (event) => {
            if (event.data.size) chunks.push(event.data);
          };
          const finished = new Promise<void>((resolve) => {
            recorder.onstop = () => resolve();
          });
          const started = performance.now();
          const tick = animated ? window.setInterval(draw, 50) : undefined;
          recorder.start(100);
          await new Promise((resolve) => window.setTimeout(resolve, 800));
          recorder.stop();
          await finished;
          window.clearInterval(tick);
          stream.getTracks().forEach((track) => track.stop());
          const measuredMs = Math.round(performance.now() - started);
          const raw = new Blob(chunks, { type: "video/webm" });
          const fixed = await (window as any).finalizeWebmMetadata(raw, measuredMs);
          const observation = async (value: Blob) => {
            const video = document.createElement("video");
            video.src = URL.createObjectURL(value);
            document.body.append(video);
            await new Promise<void>((resolve, reject) => {
              video.onloadeddata = () => resolve();
              video.onerror = () => reject(Error("Recorded video could not decode"));
            });
            const first = document.createElement("canvas");
            first.width = video.videoWidth;
            first.height = video.videoHeight;
            first.getContext("2d")!.drawImage(video, 0, 0);
            return {
              video,
              first: first.toDataURL("image/png"),
              duration: video.duration,
            };
          };
          const original = await observation(raw);
          const repaired = await observation(fixed);
          await new Promise<void>((resolve) => {
            repaired.video.onseeked = () => resolve();
            repaired.video.currentTime = measuredMs / 2000;
          });
          const edits = [];
          for (let attempt = 0; attempt < 3; attempt++) {
            let editedRaw: Blob;
            try {
              editedRaw = await (window as any).exportVideo({
                url: URL.createObjectURL(fixed),
                start: 0.1,
                end: 0.5,
                crop: [0, 0, 100, 100],
                signal: new AbortController().signal,
                onProgress: () => {},
              });
            } catch (error) {
              throw Error(
                `${animated ? "moving" : "static"} export ${attempt + 1}: ${(error as Error).message}`,
              );
            }
            const edited = await (window as any).finalizeWebmMetadata(editedRaw, 400);
            const editedVideo = await observation(edited);
            await new Promise<void>((resolve) => {
              editedVideo.video.onseeked = () => resolve();
              editedVideo.video.currentTime = 0.25;
            });
            edits.push({
              rawSize: editedRaw.size,
              size: edited.size,
              duration: editedVideo.duration,
              seek: editedVideo.video.currentTime,
            });
          }
          const cancelled = new AbortController();
          let cancellation = "";
          try {
            await (window as any).exportVideo({
              url: URL.createObjectURL(fixed),
              start: 0.1,
              end: 0.5,
              crop: [0, 0, 100, 100],
              signal: cancelled.signal,
              onProgress: () => cancelled.abort(),
            });
          } catch (error) {
            cancellation = (error as Error).message;
          }
          return {
            rawDuration: original.duration,
            fixedDuration: repaired.duration,
            measuredMs,
            sizeDelta: fixed.size - raw.size,
            sameFirstFrame: original.first === repaired.first,
            seek: repaired.video.currentTime,
            edits,
            cancellation,
          };
        }, animated);
        assert.equal(Number.isFinite(result.rawDuration), false);
        assert.ok(Math.abs(result.fixedDuration * 1000 - result.measuredMs) < 1);
        assert.ok(result.sizeDelta > 0 && result.sizeDelta < 200);
        assert.equal(result.sameFirstFrame, true);
        assert.ok(Math.abs(result.seek * 1000 - result.measuredMs / 2) < 100);
        assert.equal(result.edits.length, 3);
        assert.match(result.cancellation, /cancelled/i);
        for (const edited of result.edits) {
          assert.ok(edited.rawSize > 0);
          assert.ok(edited.size > edited.rawSize);
          assert.equal(edited.duration, 0.4);
          assert.ok(Math.abs(edited.seek - 0.25) < 0.05);
        }
      }
    } finally {
      await browser.close();
    }
  },
);
