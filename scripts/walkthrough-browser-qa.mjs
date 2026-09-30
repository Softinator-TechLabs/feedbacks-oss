import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { once } from "node:events";
import { chromium } from "playwright";

const server = createServer(async (request, response) => {
  try {
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'self'; script-src 'self'; img-src 'self'; font-src 'self'; base-uri 'none'; frame-ancestors 'none'",
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
    } else if (path === "/landing" || /^\/(assets|fonts)\/[a-zA-Z0-9_.-]+$/.test(path)) {
      const file = path === "/landing" ? "/index.html" : path;
      response.setHeader(
        "Content-Type",
        file.endsWith(".html")
          ? "text/html"
          : file.endsWith(".js")
            ? "text/javascript"
            : file.endsWith(".css")
              ? "text/css"
              : "font/ttf",
      );
      response.end(await readFile(new URL(`../dist/site${file}`, import.meta.url)));
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
    "github",
    "install",
    "pin",
    "connect",
    "project",
    "capture",
    "send",
    "agent",
  ]) {
    await demo.evaluate((element, value) => element.setAttribute("step", value), step);
    await demo.locator(".frame > *").waitFor();
    if (step === "github")
      assert.match(await demo.locator(".caption").innerText(), /GitHub/);
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
  await demo.evaluate((element) => element.setAttribute("step", "pin"));
  await demo.locator(".pin-browser").waitFor({ timeout: 2000 });
  // Reduced motion and manually selected frames must show each action's outcome.
  await demo.locator(".step").nth(1).click();
  assert(await demo.locator(".pinned-icon").isVisible());
  assert.equal(await demo.locator(".pin").getAttribute("data-pinned"), "true");
  await demo.locator(".step").nth(2).click();
  assert(await demo.locator(".review-started").isVisible());
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await demo.locator(".step").nth(1).click();
  await demo.locator(".play").click();
  await page.waitForFunction(
    () =>
      document.querySelector("feedbacks-demo").shadowRoot.querySelector(".pin")?.dataset
        .pinned === "false",
  );
  assert.equal(await demo.locator(".pinned-icon").isVisible(), false);
  await page.waitForFunction(
    () =>
      document.querySelector("feedbacks-demo").shadowRoot.querySelector(".pin")?.dataset
        .pinned === "true",
  );
  assert(await demo.locator(".pinned-icon").isVisible());
  await demo.locator(".play").click();
  const pinCursor = await demo.locator(".action-cursor").getAttribute("transform");
  await page.waitForTimeout(250);
  assert.equal(await demo.locator(".action-cursor").getAttribute("transform"), pinCursor);
  await demo.locator(".play").click();
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
  await demo.evaluate((element) => (element.hidden = false));
  await page.evaluate(() => {
    const second = document.createElement("feedbacks-demo");
    second.setAttribute("step", "capture");
    document.querySelector("main").append(second);
  });
  const allDemos = page.locator("feedbacks-demo");
  assert.equal(await page.locator("feedbacks-motion-control").count(), 0);
  await allDemos.first().locator(".play").click();
  assert.deepEqual(await allDemos.locator(".play").allTextContents(), ["Play", "Play"]);
  // Playing either player resumes only that one; pausing either stops everyone.
  await allDemos.nth(1).locator(".play").click();
  assert.deepEqual(await allDemos.locator(".play").allTextContents(), ["Play", "Pause"]);
  await allDemos.nth(1).evaluate((element) => element.setAttribute("step", "connect"));
  assert.equal(await allDemos.nth(1).locator(".play").innerText(), "Pause");
  await allDemos.first().locator(".play").click();
  assert.deepEqual(await allDemos.locator(".play").allTextContents(), ["Pause", "Play"]);
  await allDemos.first().locator(".screen-hit").click();
  assert.deepEqual(await allDemos.locator(".play").allTextContents(), ["Play", "Play"]);
  await allDemos.nth(1).evaluate((element) => element.setAttribute("step", "connect"));
  assert.equal(await allDemos.nth(1).locator(".play").innerText(), "Play");
  await page.reload();
  assert.equal(await page.locator("feedbacks-demo .play").innerText(), "Play");
  await page.locator("feedbacks-demo .play").click();
  assert.equal(await page.locator("feedbacks-demo .play").innerText(), "Pause");
  for (const [width, height] of [
    [1280, 640],
    [1280, 720],
    [1366, 768],
    [1512, 850],
    [1024, 768],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto(`http://127.0.0.1:${server.address().port}/landing`);
    await page.locator("feedbacks-demo .frame > *").waitFor();
    await page.evaluate(() => document.fonts.ready);
    for (const button of await page.locator("[data-scene]").all()) {
      await button.click();
      const bounds = await page.evaluate(() => ({
        heroBottom:
          document.querySelector(".hero").getBoundingClientRect().bottom + scrollY,
        overflow: document.documentElement.scrollWidth > innerWidth,
      }));
      assert.equal(bounds.overflow, false, `${width}: no horizontal overflow`);
      if (width > 900)
        assert(
          bounds.heroBottom <= height,
          `${width}x${height}: complete hero must fit, got ${bounds.heroBottom}`,
        );
    }
    assert.equal(await page.locator("#comparisons a").count(), 16);
    assert.equal(
      await page.locator("#comparisons").evaluate((e) => !!e.closest("details")),
      false,
    );
  }
  assert.deepEqual(errors, []);
  console.log(
    "Walkthroughs passed: nine scenes including GitHub setup and pinning, cursor/click/typing cues, exact pause/resume, play-one/pause-all and navigation persistence, reduced motion, keyboard focus, mobile bounds and complete laptop hero.",
  );
} finally {
  await browser.close();
  server.close();
}
