import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { build } from "esbuild";
import { chromium } from "playwright";
import sharp from "sharp";

test(
  "thread frame annotation creates one point, preserves its time, and lets members redraw screenshot marks",
  { skip: process.env.FEEDBACKS_RECORDING_BROWSER_SMOKE !== "1" },
  async () => {
    const imageBytes = await sharp({
      create: { width: 320, height: 180, channels: 3, background: "#dde6eb" },
    })
      .png()
      .toBuffer();
    const imageBase64 = `data:image/png;base64,${imageBytes.toString("base64")}`;
    const entry = `
      import "./src/web/styles.css";
      import "./src/web/theme.css";
      import React from "react";
      import { createRoot } from "react-dom/client";
      import { ScreenshotMarkup } from "./src/web/screenshot-markup.tsx";
      window.savedThreads = [];
      function Fixture() {
        const [target, setTarget] = React.useState({
          kind: "frame",
          imageBase64: ${JSON.stringify(imageBase64)},
          recordingFrame: { recordingId: "11111111-1111-4111-8111-111111111111", atMs: 1200, videoTimeMs: 900 }
        });
        return target ? React.createElement(ScreenshotMarkup, {
          thread: { id: "22222222-2222-4222-8222-222222222222", revision: 1 },
          target,
          onSaved: (thread) => { window.savedThreads.push(thread); },
          onClose: () => setTarget(null)
        }) : React.createElement("button", {
          onClick: () => setTarget({kind:"asset", asset: {
            id:"44444444-4444-4444-8444-444444444444", url:"/annotated.webp",
            baseAssetId:"33333333-3333-4333-8333-333333333333",
            contentType:"image/webp", rendition:"annotated", markup: window.firstMarkup,
            markings:[{tool:"point", endpoints:[{x:0.4,y:0.6}], annotationId:"55555555-5555-4555-8555-555555555555"}]
          }})
        }, "Revise saved screenshot");
      }
      createRoot(document.getElementById("root")).render(React.createElement(Fixture));
    `;
    const result = await build({
      stdin: { contents: entry, loader: "js", resolveDir: process.cwd() },
      bundle: true,
      format: "iife",
      platform: "browser",
      write: false,
      outdir: "out",
    });
    const script = result.outputFiles.find((file) => file.path.endsWith(".js"))!.text;
    const css = result.outputFiles.find((file) => file.path.endsWith(".css"))!.text;
    const uploads: any[] = [];
    const server = createServer(async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      if (req.url === "/bundle.js") {
        res.setHeader("Content-Type", "text/javascript");
        res.end(script);
      } else if (req.url === "/bundle.css") {
        res.setHeader("Content-Type", "text/css");
        res.end(css);
      } else if (req.url === "/api/threads.get") {
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            ok: true,
            data: { id: "thread", revision: uploads.length + 1 },
          }),
        );
      } else if (req.url === "/api/assets.upload") {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        uploads.push(input);
        const asset = {
          id:
            uploads.length === 1
              ? "33333333-3333-4333-8333-333333333333"
              : "44444444-4444-4444-8444-444444444444",
          url: "/frame.webp",
          contentType: "image/webp",
          rendition: uploads.length === 1 ? "screenshot" : "annotated",
          recordingFrame: input.recordingFrame,
        };
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            ok: true,
            data: { asset, thread: { id: "thread", revision: uploads.length + 1 } },
          }),
        );
      } else if (req.url === "/api/assets/33333333-3333-4333-8333-333333333333") {
        res.setHeader("Content-Type", "image/png");
        res.end(imageBytes);
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
      const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
      await page.goto(`http://127.0.0.1:${address.port}`);
      const dialog = page.getByRole("dialog", { name: "Annotate video frame" });
      await dialog.waitFor();
      const canvas = page.locator(".screenshot-markup-surface canvas");
      await page.waitForFunction(
        () =>
          document.querySelector<HTMLCanvasElement>(".screenshot-markup-surface canvas")
            ?.width === 320,
      );
      await page.screenshot({ path: ".local/frame-markup-light.png", fullPage: true });
      await page.evaluate(() => {
        document.documentElement.dataset.theme = "dark";
      });
      await page.screenshot({ path: ".local/frame-markup-dark.png", fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      await page.screenshot({ path: ".local/frame-markup-mobile.png", fullPage: true });
      await page.setViewportSize({ width: 1200, height: 900 });
      const box = (await canvas.boundingBox())!;
      await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.6);
      await dialog.getByRole("button", { name: "Pencil" }).click();
      await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.65, {
        steps: 8,
      });
      await page.mouse.up();
      await dialog
        .getByRole("textbox", { name: "Comment for this point" })
        .fill("Make this target larger");
      await dialog.getByRole("button", { name: "Save point and frame" }).click();
      await page.getByRole("button", { name: "Revise saved screenshot" }).waitFor();
      assert.equal(uploads.length, 2);
      assert.deepEqual(uploads[0].recordingFrame, {
        recordingId: "11111111-1111-4111-8111-111111111111",
        atMs: 1200,
        videoTimeMs: 900,
      });
      assert.equal(uploads[1].replacesAssetId, "33333333-3333-4333-8333-333333333333");
      assert.equal(uploads[1].point.body, "Make this target larger");
      assert.ok(Math.abs(uploads[1].point.x - 0.4) < 0.02);
      assert.ok(Math.abs(uploads[1].point.y - 0.6) < 0.02);
      assert.equal(uploads[1].markup[0].tool, "pencil");
      assert.equal(uploads[1].revision, 2);
      assert.equal(await page.evaluate(() => (window as any).savedThreads.length), 2);
      await page.evaluate((markup) => {
        (window as any).firstMarkup = markup;
      }, uploads[1].markup);
      await page.getByRole("button", { name: "Revise saved screenshot" }).click();
      const revise = page.getByRole("dialog", { name: "Mark screenshot" });
      await revise.waitFor();
      await page.waitForFunction(
        () =>
          document.querySelector<HTMLCanvasElement>(".screenshot-markup-surface canvas")
            ?.width === 320,
      );
      await revise.getByRole("button", { name: "Clear marks" }).click();
      await revise.getByRole("button", { name: "Circle" }).click();
      const secondBox = (await page
        .locator(".screenshot-markup-surface canvas")
        .boundingBox())!;
      await page.mouse.move(
        secondBox.x + secondBox.width * 0.1,
        secondBox.y + secondBox.height * 0.1,
      );
      await page.mouse.down();
      await page.mouse.move(
        secondBox.x + secondBox.width * 0.8,
        secondBox.y + secondBox.height * 0.8,
        { steps: 6 },
      );
      await page.mouse.up();
      await revise.getByRole("button", { name: "Save marked screenshot" }).click();
      await page.getByRole("button", { name: "Revise saved screenshot" }).waitFor();
      assert.equal(uploads.length, 3);
      assert.equal(uploads[2].replacesAssetId, "44444444-4444-4444-8444-444444444444");
      assert.equal(uploads[2].markup.length, 1);
      assert.equal(uploads[2].markup[0].tool, "ellipse");
      assert.equal(uploads[2].point, undefined);
    } finally {
      await browser.close();
      server.close();
      await once(server, "close");
    }
  },
);
