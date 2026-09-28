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
    await demo.locator(".frame > *").waitFor();
    await page.waitForFunction(
      () =>
        getComputedStyle(
          document.querySelector("feedbacks-demo").shadowRoot.querySelector(".screen"),
        ).position === "relative",
    );
    assert.equal(await demo.locator(".play").innerText(), "Play");
    for (const button of await demo.locator(".step").all()) {
      await button.click();
      const image = demo.locator(".capture-image image");
      if (await image.count()) {
        const dimensions = await image.evaluate(async (element) => {
          const img = new Image();
          img.src = element.getAttribute("href");
          await img.decode();
          return {
            width: img.naturalWidth,
            height: img.naturalHeight,
            declaredWidth: Number(element.getAttribute("width")),
            declaredHeight: Number(element.getAttribute("height")),
          };
        });
        assert.equal(
          dimensions.width,
          dimensions.declaredWidth,
          `${step}: overlay must use the original image width`,
        );
        assert.equal(
          dimensions.height,
          dimensions.declaredHeight,
          `${step}: overlay must use the original image height`,
        );
        assert.equal(
          await demo.locator(".capture-image").getAttribute("viewBox"),
          await demo.locator(".motion-layer").getAttribute("viewBox"),
        );
      }
      const fits = await demo.evaluate((element) => {
        const screen = element.shadowRoot.querySelector(".screen");
        const figure = element.shadowRoot.querySelector("figure");
        return (
          screen.scrollHeight <= screen.clientHeight + 1 &&
          screen.getBoundingClientRect().right <= figure.getBoundingClientRect().right + 1
        );
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
  await demo.locator(".zoom").click();
  assert(await demo.locator("dialog").evaluate((element) => element.open));
  await page.keyboard.press("Escape");
  assert.equal(await demo.locator("dialog").evaluate((element) => element.open), false);
  assert(
    await demo
      .locator(".zoom")
      .evaluate((element) => element === element.getRootNode().activeElement),
  );
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await demo.evaluate((element) => element.setAttribute("step", "capture"));
  await demo.locator(".motion-layer").waitFor();
  const start = await demo.locator(".action-cursor").getAttribute("transform");
  await page.waitForTimeout(500);
  assert.notEqual(await demo.locator(".action-cursor").getAttribute("transform"), start);
  await page.waitForFunction(
    () =>
      Number(
        document
          .querySelector("feedbacks-demo")
          .shadowRoot.querySelector(".mouse-click")
          .getAttribute("opacity"),
      ) > 0,
  );
  await demo.locator(".screen-hit").click();
  assert.equal(await demo.locator(".play").innerText(), "Play");
  const pausedCursor = await demo.locator(".action-cursor").getAttribute("transform");
  await page.waitForTimeout(400);
  assert.equal(
    await demo.locator(".action-cursor").getAttribute("transform"),
    pausedCursor,
  );
  await demo.locator(".screen-hit").press("Space");
  assert.equal(await demo.locator(".play").innerText(), "Pause");
  await demo.locator(".step").nth(1).click();
  await demo.locator(".play").click();
  await page.waitForFunction(() => {
    const text = document
      .querySelector("feedbacks-demo")
      .shadowRoot.querySelector(".typed-text")?.textContent;
    return text?.length > 5 && text.length < 35;
  });
  await demo.locator(".screen-hit").click();
  const partial = await demo.locator(".typed-text").textContent();
  await page.waitForTimeout(500);
  assert.equal(await demo.locator(".typed-text").textContent(), partial);
  await demo.locator(".play").click();
  await page.waitForFunction(() =>
    document
      .querySelector("feedbacks-demo")
      .shadowRoot.querySelector(".typed-text")
      ?.textContent.endsWith("find."),
  );
  await demo.evaluate((element) => element.setAttribute("step", "install"));
  await demo.locator(".frame > *").waitFor();
  await page.waitForTimeout(3900);
  assert.equal(await demo.locator('.step[aria-pressed="true"]').innerText(), "2");
  await demo.locator(".play").click();
  const caption = await demo.locator(".caption").innerText();
  await page.waitForTimeout(3900);
  assert.equal(await demo.locator(".caption").innerText(), caption);
  await demo.locator(".play").click();
  await demo.evaluate((element) => (element.hidden = true));
  await page.waitForTimeout(3900);
  assert.equal(await demo.locator(".caption").textContent(), caption);
  assert.deepEqual(errors, []);
  console.log(
    "Silent walkthroughs passed: seven scenes, images, unclipped mobile diagrams, cursor movement, right-click cue, progressive typing, exact pause/resume, reduced motion, hidden pause, zoom and keyboard focus.",
  );
} finally {
  await browser.close();
  server.close();
}
