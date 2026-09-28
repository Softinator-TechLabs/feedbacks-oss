import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { build } from "esbuild";
import { chromium } from "playwright";

test(
  "sandboxed replay blocks escaped CSS resource URLs on initial render and seek",
  {
    skip: process.env.FEEDBACKS_RECORDING_BROWSER_SMOKE !== "1",
  },
  async () => {
    const bundle = await build({
      stdin: {
        contents: `
import { Replayer } from "@rrweb/replay";
import { prepareReplayEvents } from "./src/web/recording-model.ts";
import { installReplayResourcePolicy } from "./src/web/replay-policy.ts";
const suffix = location.search.includes("protected") ? "protected" : "control";
const ts = Date.now();
const snapshot = (id, probe) => ({
  type: 0, id, childNodes: [{ type: 2, id: id + 1, tagName: "html", attributes: {}, childNodes: [
    { type: 2, id: id + 2, tagName: "head", attributes: {}, childNodes: [
      { type: 2, id: id + 3, tagName: "style", attributes: {}, childNodes: [
        { type: 3, id: id + 4, isStyle: true, textContent: "body { background-image: u\\\\72l('/probe-" + probe + "'); }" }
      ] },
      { type: 2, id: id + 7, tagName: "link", attributes: { rel: "stylesheet", href: "/probe-link", _cssText: "body{font-size:19px}.never-used{background:url('/probe-linked-css')}" }, childNodes: [] }
    ] },
    { type: 2, id: id + 5, tagName: "body", attributes: {}, childNodes: [
      { type: 3, id: id + 6, textContent: "Replay still renders: " + probe },
      { type: 2, id: id + 8, tagName: "video", attributes: { class: "captured-video", rr_mediaState: "played", src: "/probe-video" }, childNodes: [] },
      { type: 2, id: id + 9, tagName: "iframe", attributes: {}, childNodes: [] }
    ] }
  ] }]
});
const captured = [
  { seq: 0, atMs: 0, type: "replay", data: { type: 4, timestamp: ts, data: { href: location.href, width: 640, height: 360 } } },
  { seq: 1, atMs: 20, type: "replay", data: { type: 2, timestamp: ts + 20, data: { node: snapshot(1, suffix + "-initial"), initialOffset: { top: 0, left: 0 } } } },
  { seq: 2, atMs: 50, type: "replay", data: { type: 3, timestamp: ts + 50, data: { source: 0, adds: [{ parentId: 10, nextId: null, node: { type: 0, id: 11, childNodes: [] } }], removes: [], attributes: [], texts: [] } } },
  { seq: 3, atMs: 60, type: "replay", data: { type: 3, timestamp: ts + 60, data: { source: 7, id: 9, type: 0 } } },
  { seq: 4, atMs: 120, type: "replay", data: { type: 2, timestamp: ts + 120, data: { node: snapshot(20, suffix + "-seek"), initialOffset: { top: 0, left: 0 } } } },
];
const events = suffix === "protected" ? prepareReplayEvents(captured as any) : captured.map((entry) => entry.data);
const player = new Replayer(events, { root: document.getElementById("stage"), triggerFocus: false, mouseTail: false });
if (suffix === "protected") {
  const frame = document.querySelector("#stage iframe");
  installReplayResourcePolicy(frame);
  player.on("fullsnapshot-rebuilded", () => installReplayResourcePolicy(frame));
}
player.pause(20);
window.probeState = () => {
  const doc = document.querySelector("#stage iframe")?.contentDocument;
  return { text: doc?.body?.textContent, policy: doc?.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content, fontSize: doc?.defaultView?.getComputedStyle(doc.body).fontSize, media: doc?.querySelector(".captured-video")?.tagName };
};
window.seekMiddle = () => player.pause(80);
window.seekReplay = () => player.pause(150);
window.ready = true;
`,
        resolveDir: process.cwd(),
        loader: "ts",
      },
      bundle: true,
      format: "iife",
      platform: "browser",
      write: false,
    });
    const script = bundle.outputFiles[0]?.text ?? "";
    const fetched: string[] = [];
    const policy =
      "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-src https://challenges.cloudflare.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
    const server = createServer((req, res) => {
      res.setHeader("Content-Security-Policy", policy);
      res.setHeader("Cache-Control", "no-store");
      if (req.url?.startsWith("/probe-")) {
        fetched.push(req.url);
        res.setHeader("Content-Type", "image/png");
        res.end("probe");
      } else if (req.url === "/bundle.js") {
        res.setHeader("Content-Type", "text/javascript");
        res.end(script);
      } else {
        res.setHeader("Content-Type", "text/html");
        res.end(
          '<!doctype html><div id="stage"></div><script src="/bundle.js"></script>',
        );
      }
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const origin = `http://127.0.0.1:${address.port}`;
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.goto(`${origin}/?control`, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => (window as any).ready === true);
      await page.waitForFunction(() =>
        document
          .querySelector("#stage iframe")
          ?.contentDocument?.body?.textContent?.includes("Replay still renders"),
      );
      await page.waitForTimeout(100);
      assert.ok(
        fetched.includes("/probe-control-initial"),
        `control proves the escaped CSS loads without the replay policy: ${fetched.join(", ")}`,
      );
      await page.evaluate(() => (window as any).seekReplay());
      await page.waitForFunction(() =>
        document
          .querySelector("#stage iframe")
          ?.contentDocument?.body?.textContent?.includes("control-seek"),
      );
      assert.ok(
        fetched.includes("/probe-control-seek"),
        "control proves a seek rebuild can load escaped CSS",
      );
      await page.goto(`${origin}/?protected`, { waitUntil: "domcontentloaded" });
      pageErrors.length = 0;
      await page.waitForFunction(() => (window as any).ready === true);
      await page.waitForFunction(() =>
        document
          .querySelector("#stage iframe")
          ?.contentDocument?.body?.textContent?.includes("Replay still renders"),
      );
      await page.evaluate(() => (window as any).seekMiddle());
      await page.waitForFunction(() =>
        document
          .querySelector("#stage iframe")
          ?.contentDocument?.body?.textContent?.includes("protected-initial"),
      );
      await page.evaluate(() => (window as any).seekReplay());
      await page.waitForFunction(() =>
        document
          .querySelector("#stage iframe")
          ?.contentDocument?.body?.textContent?.includes("protected-seek"),
      );
      const rendered = await page.evaluate(() => (window as any).probeState());
      assert.match(rendered.text, /Replay still renders/);
      assert.equal(rendered.fontSize, "19px");
      assert.equal(rendered.media, "DIV");
      assert.deepEqual(pageErrors, []);
      assert.ok(
        !fetched.some((path) => path.startsWith("/probe-protected")),
        `replay leaked requests: ${fetched.join(", ")}`,
      );
    } finally {
      await browser.close();
      server.close();
      await once(server, "close");
    }
  },
);
