import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
// @ts-expect-error Operator script is native JavaScript.
import {
  allowedVisualRequest,
  captureScreenshot,
  compareScreenshots,
  validateVisualTarget,
} from "../scripts/visual-qa.mjs";

test("visual target must be an explicit public HTTPS page on its approved origin", () => {
  assert.equal(
    validateVisualTarget("https://example.com/docs", "https://example.com"),
    "https://example.com/docs",
  );
  for (const url of [
    "http://example.com/docs",
    "https://example.com/docs?token=secret",
    "https://example.com/docs#private",
    "https://elsewhere.com/docs",
    "https://127.0.0.1/docs",
    "https://example.com:8443/docs",
  ])
    assert.throws(() => validateVisualTarget(url, "https://example.com"));
});

test(
  "Chromium renders synthetic same-origin content while blocking foreign requests",
  { skip: process.env.FEEDBACKS_VISUAL_BROWSER_SMOKE !== "1" },
  async () => {
    const fetched: string[] = [];
    const capture = await captureScreenshot({
      url: "https://example.com/page",
      approvedOrigin: "https://example.com",
      launchOptions: { channel: "chrome" },
      fetchResource: async (url: string) => {
        fetched.push(url);
        return {
          status: 200,
          contentType: "text/html",
          body: Buffer.from(
            '<!doctype html><title>Fixture</title><p>Stable fixture</p><img src="https://tracker.example/collect"><script>fetch("/script-request")</script>',
          ),
        };
      },
    });
    assert.deepEqual(fetched, ["https://example.com/page"]);
    assert.ok(capture.blockedRequests >= 1);
    assert.equal((await sharp(capture.image).metadata()).width, 1280);
    assert.equal(
      (await compareScreenshots(capture.image, capture.image)).changedPercent,
      0,
    );
  },
);

test(
  "explicit script mode renders an unauthenticated SPA without releasing browser requests",
  { skip: process.env.FEEDBACKS_VISUAL_BROWSER_SMOKE !== "1" },
  async () => {
    const fetched: string[] = [];
    const capture = await captureScreenshot({
      url: "https://example.com/app",
      approvedOrigin: "https://example.com",
      scripts: true,
      launchOptions: { channel: "chrome" },
      fetchResource: async (url: string) => {
        fetched.push(url);
        return url.endsWith("/app.js")
          ? {
              status: 200,
              contentType: "text/javascript",
              body: Buffer.from(
                'document.body.style.margin="0";document.body.innerHTML="<main style=\\"background:#ff00ff;width:100vw;height:100vh\\">SPA rendered</main>";fetch("https://tracker.example/collect");fetch("/submit",{method:"POST"});if(typeof RTCPeerConnection!=="undefined"||typeof WebTransport!=="undefined")fetch("/peer-transport-exposed");',
              ),
            }
          : {
              status: 200,
              contentType: "text/html",
              body: Buffer.from(
                '<!doctype html><div id="root"></div><script type="module" src="/app.js"></script>',
              ),
            };
      },
    });
    assert.deepEqual(fetched, ["https://example.com/app", "https://example.com/app.js"]);
    assert.ok(capture.blockedRequests >= 2);
    const pixel = await sharp(capture.image)
      .extract({ left: 100, top: 100, width: 1, height: 1 })
      .raw()
      .toBuffer();
    assert.deepEqual([...pixel.subarray(0, 3)], [255, 0, 255]);
  },
);

test(
  "script mode renders the built public Feedbacks privacy route from local assets",
  { skip: process.env.FEEDBACKS_VISUAL_BROWSER_SMOKE !== "1" },
  async () => {
    const fetched: string[] = [];
    const fetchResource = async (url: string) => {
      const path = new URL(url).pathname;
      fetched.push(path);
      const file = path === "/privacy" ? "/index.html" : path;
      return {
        status: 200,
        contentType: file.endsWith(".js")
          ? "text/javascript"
          : file.endsWith(".css")
            ? "text/css"
            : "text/html",
        body: await readFile(new URL(`../dist/web${file}`, import.meta.url)),
      };
    };
    const input = {
      url: "https://example.com/privacy",
      approvedOrigin: "https://example.com",
      launchOptions: { channel: "chrome" },
      fetchResource,
    };
    const blank = await captureScreenshot(input);
    const rendered = await captureScreenshot({ ...input, scripts: true });
    assert.ok(
      fetched.some((path: string) => path.startsWith("/assets/") && path.endsWith(".js")),
    );
    assert.ok((await compareScreenshots(blank.image, rendered.image)).changedPercent > 1);
  },
);

test("browser resource policy permits only same-origin GETs without queries", () => {
  const origin = "https://example.com";
  assert.equal(allowedVisualRequest("https://example.com/site.css", "GET", origin), true);
  assert.equal(
    allowedVisualRequest("https://example.com/api?key=secret", "GET", origin),
    false,
  );
  assert.equal(allowedVisualRequest("https://elsewhere.com/track", "GET", origin), false);
  assert.equal(allowedVisualRequest("https://example.com/save", "POST", origin), false);
  assert.equal(allowedVisualRequest("file:///etc/passwd", "GET", origin), false);
});

test("image comparison rejects incompatible dimensions and measures changed pixels", async () => {
  const white = await sharp({
    create: { width: 2, height: 1, channels: 4, background: "white" },
  })
    .png()
    .toBuffer();
  const changed = await sharp({
    create: { width: 2, height: 1, channels: 4, background: "white" },
  })
    .composite([
      {
        input: await sharp({
          create: { width: 1, height: 1, channels: 4, background: "black" },
        })
          .png()
          .toBuffer(),
        left: 0,
        top: 0,
      },
    ])
    .png()
    .toBuffer();
  assert.equal((await compareScreenshots(white, changed)).changedPercent, 50);
  const tall = await sharp({
    create: { width: 2, height: 2, channels: 4, background: "white" },
  })
    .png()
    .toBuffer();
  await assert.rejects(compareScreenshots(white, tall), /matching dimensions/);
});
