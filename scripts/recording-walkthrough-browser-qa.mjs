import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { access, readFile } from "node:fs/promises";
import { chromium } from "playwright";

await assert.doesNotReject(
  access(new URL("../public/learn/recording-runtime.js", import.meta.url)),
  "prepare-walkthroughs must build the actual recording runtime",
);
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, "http://localhost").pathname;
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; base-uri 'none'",
    );
    if (pathname === "/") {
      res.setHeader("Content-Type", "text/html");
      res.end(
        '<!doctype html><meta name="viewport" content="width=device-width"><div id="screen"></div><script type="module" src="/fixture.js"></script>',
      );
    } else if (pathname === "/fixture.js") {
      res.setHeader("Content-Type", "text/javascript");
      res.end(`import { mountRecording } from '/learn/recording-runtime.js';
        window.seeks = []; window.pauses = 0;
        window.player = mountRecording(document.querySelector('#screen'), {
          base: '/learn/', onSeek: ms => seeks.push(ms), onPause: () => pauses++,
        });`);
    } else if (/^\/learn\/[a-z0-9-]+\.(js|css|webp)$/.test(pathname)) {
      res.setHeader(
        "Content-Type",
        pathname.endsWith(".js")
          ? "text/javascript"
          : pathname.endsWith(".css")
            ? "text/css"
            : "image/webp",
      );
      res.end(await readFile(new URL(`../public${pathname}`, import.meta.url)));
    } else {
      res.writeHead(404);
      res.end();
    }
  } catch {
    res.writeHead(500);
    res.end();
  }
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => !!window.player);
  await page.waitForFunction(() =>
    getComputedStyle(document.querySelector(".recording-demo")).fontFamily.includes(
      "system",
    ),
  );
  assert.equal(await page.locator("iframe").count(), 0);
  assert.ok((await page.locator(".review-event").count()) >= 19);
  assert.equal(
    await page.getByRole("tab", { name: /^Everything/ }).getAttribute("aria-selected"),
    "true",
  );
  assert.equal(await page.locator(".review-toolbar > button:visible").count(), 0);
  const canvasHash = () =>
    page.locator("canvas").evaluate((canvas) => canvas.toDataURL());
  await page.waitForTimeout(200);
  await page.evaluate(() => player.paint(0.1, false));
  const before = await canvasHash();
  await page.evaluate(() => player.paint(0.3, false));
  assert.notEqual(
    await canvasHash(),
    before,
    "shared clock changes the rendered page and cursor",
  );
  const paused = await canvasHash();
  await page.waitForTimeout(200);
  assert.equal(await canvasHash(), paused, "paused paint has no independent animation");
  assert.deepEqual(
    await page.evaluate(() => seeks),
    [],
    "parent paint cannot invoke user seek",
  );
  await page
    .locator('.review-timeline-mark[data-channel="network"][data-error="true"]')
    .click();
  assert.equal(await page.evaluate(() => seeks.at(-1)), 4000);
  const seeksAtError = await page.evaluate(() => seeks.length);
  await page
    .locator('.review-timeline-mark[data-channel="network"][data-error="true"]')
    .click();
  assert.equal(
    await page.evaluate(() => seeks.length),
    seeksAtError + 1,
    "selecting the current event still routes through the shared clock",
  );
  assert.match(await page.locator(".review-detail").textContent(), /503/);
  await page.getByRole("tab", { name: /^Everything/ }).click();
  await page.evaluate(() => player.paint(0, true));
  await page.waitForTimeout(400);
  const samples = await page.evaluate(async () => {
    const list = document.querySelector(".review-events");
    const samples = [];
    const start = performance.now();
    while (performance.now() - start < 1000) {
      player.paint(0.7 + Math.min(0.02, (performance.now() - start) / 50000), true);
      samples.push(list.scrollTop);
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    player.paint(0.72, false);
    return samples;
  });
  assert.ok(
    samples.at(-1) > samples[0] + 20,
    "Following playback moves the real event scroller",
  );
  assert.ok(
    new Set(samples.map(Math.round)).size > 3,
    "Following playback scrolls smoothly through intermediate positions",
  );
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
  );
  // Playback must follow the selected category instead of undoing each click.
  const playerHeight = await page
    .locator(".recording-demo")
    .evaluate((el) => el.offsetHeight);
  await page.evaluate(() => player.paint(0.75, true));
  for (const channel of [
    "Activity",
    "Network",
    "Console",
    "Performance",
    "Environment",
  ]) {
    const tab = page.getByRole("tab", { name: new RegExp("^" + channel) });
    await tab.click();
    await page.evaluate(() => player.paint(0.8, true));
    assert.equal(
      await tab.getAttribute("aria-selected"),
      "true",
      `${channel} stays selected during playback`,
    );
    const height = await page
      .locator(".recording-demo")
      .evaluate((el) => el.offsetHeight);
    assert.ok(
      Math.abs(height - playerHeight) <= 1,
      `${channel} must not move the page below the player (${playerHeight} → ${height})`,
    );
  }
  await page.getByRole("tab", { name: /^Everything/ }).click();
  // Different OS fonts can put a wrapping tab row right on its width boundary.
  // Selecting a tab must not add/remove a row by changing the label's weight.
  const unstableWidths = await page.locator(".recording-demo").evaluate((root) => {
    const originalStyle = root.getAttribute("style");
    const failures = [];
    root.style.fontFamily = "Arial, sans-serif";
    for (let width = 280; width <= 640; width += 2) {
      root.style.width = `${width}px`;
      const heights = [...root.querySelectorAll('[role="tab"]')].map((tab) => {
        tab.click();
        return root.offsetHeight;
      });
      if (Math.max(...heights) - Math.min(...heights) > 1)
        failures.push({ width, heights });
    }
    if (originalStyle === null) root.removeAttribute("style");
    else root.setAttribute("style", originalStyle);
    return failures;
  });
  assert.deepEqual(
    unstableWidths,
    [],
    "tab selection keeps wrapping stable across font metrics and widths",
  );
  await page.getByRole("tab", { name: /^Everything/ }).click();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => player.paint(0.98, true));
  await page.waitForTimeout(150);
  assert.ok(
    (await page.locator(".review-events").evaluate((list) => list.scrollTop)) >
      samples.at(-1),
  );
  const calls = await page.evaluate(() => ({ seeks: seeks.length, pauses }));
  await page.evaluate(() => {
    player.dispose();
    player.paint(0.5, true);
    player.seek(1000);
  });
  assert.deepEqual(
    await page.evaluate(() => ({ seeks: seeks.length, pauses })),
    calls,
    "dispose detaches callbacks",
  );
  assert.equal(await page.locator("canvas").count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    "Recording walkthrough: actual review, synchronized canvas, seeks, smooth Follow, reduced motion, mobile, disposal passed.",
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
