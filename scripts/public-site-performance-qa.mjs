import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { chromium } from "playwright";

// A cold, delayed upgrade must not move the surrounding page. This deliberately
// separates shadow CSS and recording runtime delivery to expose flashes of raw UI.
const root = resolve("dist/site");
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".webp": "image/webp",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};
const server = createServer(async (req, res) => {
  const path = new URL(req.url, "http://local").pathname;
  const file = resolve(root, "." + (path === "/" ? "/index.html" : path));
  if (!file.startsWith(root + "/")) {
    res.writeHead(404).end();
    return;
  }
  try {
    const data = await readFile(file);
    if (path.startsWith("/learn/") && /\.(css|js)$/.test(path))
      await new Promise((r) => setTimeout(r, path.endsWith(".css") ? 650 : 350));
    res.setHeader("Content-Type", types[extname(file)] || "application/octet-stream");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'self'; script-src 'self'; img-src 'self'; font-src 'self'; connect-src 'none'; base-uri 'none'",
    );
    res.end(data);
  } catch {
    res.writeHead(404).end();
  }
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const browser = await chromium.launch();
const failures = [];
try {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1280, height: 720 },
    { width: 390, height: 900 },
  ]) {
    const page = await browser.newPage({ viewport });
    await page.addInitScript(() => {
      window.layoutShifts = [];
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries())
          if (!entry.hadRecentInput) window.layoutShifts.push(entry.value);
      }).observe({ type: "layout-shift", buffered: true });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.locator("feedbacks-demo[step=recording] canvas").waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(2500);
    const cls = await page.evaluate(() => window.layoutShifts.reduce((a, b) => a + b, 0));
    const fonts = await page.evaluate(() =>
      performance
        .getEntriesByType("resource")
        .filter((entry) => /\/fonts\//.test(entry.name))
        .map((entry) => ({ name: entry.name, bytes: entry.encodedBodySize })),
    );
    assert.ok(fonts.length > 0, "measure the actual loaded fonts");
    assert.ok(
      fonts.every((font) => !font.name.endsWith(".ttf")),
      "load compressed font subsets",
    );
    assert.ok(
      fonts.reduce((sum, font) => sum + font.bytes, 0) < 120000,
      "cold-load font payload stays under 120 KB",
    );
    console.log(
      `Cold-load layout shifts ${viewport.width}×${viewport.height}: ${cls.toFixed(4)}`,
    );
    if (cls > 0.1) failures.push(`${viewport.width}: CLS ${cls.toFixed(4)} exceeds 0.1`);
    assert.equal(
      await page
        .locator("feedbacks-demo[step=recording]")
        .getAttribute("data-motion-running"),
      "",
      "autoplay remains enabled",
    );
    const hero = page.locator(".product-hero-demo feedbacks-demo");
    const sectionTop = () =>
      page
        .locator(".capture-section")
        .evaluate((el) => el.getBoundingClientRect().top + scrollY);
    const beforeTabs = await sectionTop();
    for (const channel of [
      "Activity",
      "Network",
      "Console",
      "Performance",
      "Environment",
      "Everything",
    ]) {
      const tab = hero.getByRole("tab", { name: new RegExp("^" + channel) });
      await tab.evaluate((el) =>
        el.scrollIntoView({ block: "nearest", behavior: "instant" }),
      );
      const box = await tab.boundingBox();
      // Approach with the pointer so the authored hover hold can stabilize depth.
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await tab.click();
      await page.waitForTimeout(150);
      assert.equal(
        await tab.getAttribute("aria-selected"),
        "true",
        `${channel} works during playback`,
      );
      assert.ok(
        Math.abs((await sectionTop()) - beforeTabs) <= 1,
        `${channel} keeps following sections in place`,
      );
    }
    await page.close();
  }
  const fallbackPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await fallbackPage.route("**/learn/*.css*", (route) => route.abort());
  await fallbackPage.goto(`http://127.0.0.1:${server.address().port}`);
  const fallback = fallbackPage.locator(".product-hero-demo feedbacks-demo > img");
  assert.ok(
    await fallback.isVisible(),
    "failed styles retain the readable static picture",
  );
  assert.ok(await fallback.evaluate((img) => img.complete && img.naturalWidth > 0));
  assert.equal(
    await fallbackPage.locator(".product-hero-demo .depth-stage").isVisible(),
    false,
    "unstyled controls never replace the fallback",
  );
  await fallbackPage.close();
  assert.deepEqual(failures, []);
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
