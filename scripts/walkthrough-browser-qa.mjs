import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { once } from "node:events";
import { chromium } from "playwright";

const server = createServer(async (request, response) => {
  try {
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'self'; script-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'",
    );
    const path = new URL(request.url, "http://localhost").pathname;
    if (path === "/") {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(
        '<!doctype html><meta name="viewport" content="width=device-width"><main><feedbacks-demo step="install"></feedbacks-demo></main><script defer src="/learn/demo.js"></script>',
      );
    } else if (/^\/learn\/[a-z0-9-]+\.(js|css|webp)$/.test(path)) {
      response.setHeader(
        "Content-Type",
        path.endsWith("js")
          ? "text/javascript"
          : path.endsWith("css")
            ? "text/css"
            : "image/webp",
      );
      response.end(await readFile(new URL(`../public${path}`, import.meta.url)));
    } else {
      response.writeHead(404);
      response.end();
    }
  } catch {
    response.writeHead(500);
    response.end();
  }
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 390, height: 900 },
    reducedMotion: "reduce",
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const demo = page.locator("feedbacks-demo");
  for (const step of [
    "server",
    "install",
    "connect",
    "project",
    "capture",
    "send",
    "agent",
  ]) {
    await demo.evaluate((element, value) => element.setAttribute("step", value), step);
    await demo.locator(".screen > *").waitFor();
    await page.waitForFunction(
      () =>
        getComputedStyle(
          document.querySelector("feedbacks-demo").shadowRoot.querySelector(".screen"),
        ).position === "relative",
    );
    assert.equal(await demo.locator(".play").innerText(), "Play");
    for (const button of await demo.locator(".step").all()) {
      await button.click();
      const image = demo.locator(".screen img");
      if (await image.count()) await image.evaluate((element) => element.decode());
      const fits = await demo.evaluate((element) => {
        const screen = element.shadowRoot.querySelector(".screen");
        return screen.scrollHeight <= screen.clientHeight + 1;
      });
      assert(fits, `${step}: frame must not clip its controls`);
    }
    assert.doesNotMatch(
      await demo.locator("figure").innerText(),
      /silent walkthrough|demo account|still image/i,
    );
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
  }
  await demo.evaluate((element) => element.setAttribute("step", "capture"));
  await demo.locator(".image").click();
  assert(await demo.locator("dialog").evaluate((element) => element.open));
  await page.keyboard.press("Escape");
  assert.equal(await demo.locator("dialog").evaluate((element) => element.open), false);
  assert(
    await demo
      .locator(".image")
      .evaluate((element) => element === element.getRootNode().activeElement),
  );
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await demo.evaluate((element) => element.setAttribute("step", "install"));
  await demo.locator(".screen > *").waitFor();
  await page.waitForTimeout(3000);
  assert.equal(await demo.locator('.step[aria-pressed="true"]').innerText(), "2");
  await demo.locator(".play").click();
  const caption = await demo.locator(".caption").innerText();
  await page.waitForTimeout(3000);
  assert.equal(await demo.locator(".caption").innerText(), caption);
  await demo.locator(".play").click();
  await demo.evaluate((element) => (element.hidden = true));
  await page.waitForTimeout(3000);
  assert.equal(await demo.locator(".caption").textContent(), caption);
  assert.deepEqual(errors, []);
  console.log(
    "Silent walkthroughs passed: seven scenes, images, unclipped mobile diagrams, reduced motion, playback/pause, hidden pause, zoom and keyboard focus.",
  );
} finally {
  await browser.close();
  server.close();
}
