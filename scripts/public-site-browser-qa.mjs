import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { readFile, stat, mkdir } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { chromium } from "playwright";
const root = resolve("dist/site");
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ttf": "font/ttf",
  ".json": "application/json",
  ".xml": "application/xml",
};
async function localFile(url) {
  const name = resolve(
    root,
    "." + decodeURIComponent(new URL(url, "http://local").pathname),
  );
  if (name !== root && !name.startsWith(root + sep)) return null;
  for (const path of [name, resolve(name, "index.html"), name + ".html"]) {
    if ((await stat(path).catch(() => null))?.isFile()) return path;
  }
  return null;
}
const server = createServer(async (req, res) => {
  const path = await localFile(req.url);
  if (!path) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  res.setHeader("Content-Type", types[extname(path)] || "text/plain");
  res.setHeader(
    "Content-Security-Policy",
    req.url.startsWith("/docs/")
      ? "default-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; worker-src 'self' blob:; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'"
      : "default-src 'none'; style-src 'self'; script-src 'self'; img-src 'self'; font-src 'self'; connect-src 'none'; base-uri 'none'",
  );
  res.end(await readFile(path));
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const failures = [];
try {
  await mkdir(".impeccable/review", { recursive: true });
  const pages = [
    "/",
    "/docs/",
    "/docs/guide/session-replay",
    "/docs/guide/debug-bundles",
    "/docs/guide/text-suggestions",
    "/docs/guide/agent-context",
    "/docs/guide/more-ways-to-review",
    "/docs/guide/github",
    "/compare/",
    "/compare/openreplay.html",
  ];
  for (const width of [1440, 390]) {
    const page = await browser.newPage({
      viewport: { width, height: 900 },
      reducedMotion: "reduce",
    });
    page.on("pageerror", (e) => failures.push(e.message));
    page.on("response", (r) => {
      if (r.status() >= 400) failures.push(`${r.status()} ${r.url()}`);
    });
    for (const path of pages) {
      await page.goto(origin + path, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      // Exercise lazy/offscreen loading before inspecting full-page artifacts.
      await page.evaluate(async () => {
        for (let y = 0; y < document.documentElement.scrollHeight; y += 700) {
          window.scrollTo(0, y);
          await new Promise((resolve) => setTimeout(resolve, 40));
        }
        window.scrollTo(0, 0);
        await Promise.all(
          [...document.querySelectorAll("img[src]")]
            .filter((img) => img.getAttribute("src"))
            .map((img) => {
              img.loading = "eager";
              return img.decode().catch(() => {});
            }),
        );
      });
      assert.equal(await page.locator("h1").count(), 1, path);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      );
      if (overflow > 1) failures.push(`${path} at ${width}: overflow ${overflow}`);
      const broken = await page
        .locator("img")
        .evaluateAll((imgs) =>
          imgs
            .filter((i) => i.getAttribute("src") && (!i.complete || i.naturalWidth === 0))
            .map((i) => i.src),
        );
      failures.push(...broken.map((src) => `broken image: ${src}`));
      const links = await page
        .locator("a[href]")
        .evaluateAll((links) =>
          links
            .map((a) => a.getAttribute("href"))
            .filter((h) => h?.startsWith("/") && !h.startsWith("//")),
        );
      for (const link of new Set(links))
        if (!(await localFile(link))) failures.push(`broken link ${path} → ${link}`);
      const canonical = await page.locator("link[rel=canonical]").getAttribute("href");
      assert.ok(canonical.startsWith("https://feedbacks.softinator.ai/"), path);
      if (path.startsWith("/compare/") && width === 390) {
        for (const section of await page.locator(".compare-matrix").all()) {
          const scroller = section.locator(".matrix-scroll");
          assert.ok(
            await scroller.evaluate((el) => el.scrollWidth > el.clientWidth + 100),
            "Feature columns must remain readable under CSP",
          );
          await section.locator(".matrix-next").click();
          await page.waitForTimeout(200);
          assert.ok(
            await scroller.evaluate((el) => el.scrollLeft > 0),
            "Next must reveal the next columns",
          );
          await scroller.evaluate((el) => {
            el.scrollLeft = 0;
          });
        }
        await page.evaluate(() => window.scrollTo(0, 0));
      }
      if (path === "/docs/" || path === "/docs/guide/session-replay") {
        assert.equal(
          await page.locator("feedbacks-evidence .evidence-play").count(),
          1,
          "Docs hydration must preserve the interactive example",
        );
      }
      if (path === "/") {
        const demo = page.locator("feedbacks-evidence");
        assert.equal(
          await demo.getByRole("button", { name: "Play example", exact: true }).count(),
          1,
        );
        await demo.getByRole("button", { name: "00:04 Request fails" }).click();
        assert.match(await demo.locator(".evidence-event").innerText(), /500/);
        await demo.getByRole("button", { name: "00:05 Console error" }).focus();
        await page.keyboard.press("Enter");
        assert.match(await demo.locator(".evidence-event").innerText(), /Console/);
        await demo.getByRole("button", { name: "00:02 Click", exact: true }).click();
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({
          path: `.impeccable/review/${width === 1440 ? "desktop" : "mobile"}.png`,
          fullPage: true,
        });
        await page.screenshot({ path: `.impeccable/review/hero-${width}.png` });
        await demo.getByRole("button", { name: "Play example", exact: true }).click();
        await page.waitForTimeout(2500);
        assert.match(await demo.locator(".evidence-event").innerText(), /500/);
        await page.locator("#features").scrollIntoViewIfNeeded();
        await page.waitForTimeout(100);
        assert.equal(
          await demo.getByRole("button", { name: "Play example", exact: true }).count(),
          1,
        );
      }
      if (path === "/docs/guide/session-replay" || path === "/compare/openreplay.html")
        await page.screenshot({
          path: `.impeccable/review/${path.includes("docs") ? "docs" : "compare"}-${width}.png`,
          fullPage: true,
        });
    }
    await page.close();
  }
  const nojs = await browser.newPage({
    javaScriptEnabled: false,
    viewport: { width: 390, height: 844 },
  });
  await nojs.goto(origin);
  assert.match(await nojs.locator("main").innerText(), /Apache-2.0/);
  assert.equal(await nojs.locator("feedbacks-evidence img").count(), 1);
  assert.ok(await nojs.locator("#recordings").isVisible());
  await nojs.close();
  assert.deepEqual([...new Set(failures)], []);
  console.log(
    "Public site browser QA passed: 10 routes at desktop/mobile, same-origin links/assets, timeline mouse/keyboard/playback/offscreen, reduced-motion start and no-JavaScript fallback.",
  );
} finally {
  await browser.close();
  server.close();
  await once(server, "close");
}
