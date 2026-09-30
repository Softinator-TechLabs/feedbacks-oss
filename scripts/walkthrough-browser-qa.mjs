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
    } else if (
      path === "/landing" ||
      /^\/(assets|fonts|media)\/(?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+$/.test(path)
    ) {
      const file = path === "/landing" ? "/index.html" : path;
      response.setHeader(
        "Content-Type",
        file.endsWith(".html")
          ? "text/html"
          : file.endsWith(".js")
            ? "text/javascript"
            : file.endsWith(".css")
              ? "text/css"
              : file.endsWith(".svg")
                ? "image/svg+xml"
                : file.endsWith(".webp")
                  ? "image/webp"
                  : file.endsWith(".png")
                    ? "image/png"
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
  // Pause explicitly for stable frame inspections; reduced motion changes cues,
  // while the visitor's playback preference controls autoplay.
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(() => localStorage.setItem("feedbacks-motion", "paused"));
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
    "discussion",
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
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await demo.locator(".step").first().click();
  await demo.locator(".play").click();
  const initialCamera = await demo.locator(".capture-image").getAttribute("viewBox");
  await page.waitForFunction((before) => {
    const art = document
      .querySelector("feedbacks-demo")
      .shadowRoot.querySelector(".capture-image");
    return art && art.getAttribute("viewBox") !== before;
  }, initialCamera);
  await demo.locator(".handoff-paste").waitFor({ state: "visible", timeout: 6500 });
  assert.match(
    await demo.locator(".handoff-paste").innerText(),
    /Fix this Feedbacks task and verify it\./,
    "Paste arrives as a complete prompt, without slow typing",
  );
  await demo.locator(".play").click();
  await page.emulateMedia({ reducedMotion: "reduce" });
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
  await page.waitForFunction(() => {
    const root = document.querySelector("feedbacks-demo").shadowRoot;
    return root.querySelector(".zoom") === root.activeElement;
  });
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
    await page.locator('feedbacks-demo[step="recording"] .play').first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    const heroBottom = await page
      .locator(".product-hero")
      .evaluate((el) => el.getBoundingClientRect().bottom + scrollY);
    if (width > 900)
      assert(
        heroBottom <= height,
        `${width}x${height}: complete product hero must fit, got ${heroBottom}`,
      );
    await page.locator("#story-demo").scrollIntoViewIfNeeded();
    await page.locator("feedbacks-demo .frame > *").waitFor();
    for (const button of await page.locator("[data-scene]").all()) {
      await button.click();
      await page.waitForFunction(
        () =>
          getComputedStyle(
            document.querySelector("feedbacks-demo").shadowRoot.querySelector(".screen"),
          ).position === "relative",
      );

      const bounds = await page.evaluate(() => ({
        walkthroughHeight: document.querySelector(".story").getBoundingClientRect()
          .height,
        overflow: document.documentElement.scrollWidth > innerWidth,
      }));
      assert.equal(bounds.overflow, false, `${width}: no horizontal overflow`);
      if (width > 900)
        assert(
          bounds.walkthroughHeight <= height,
          `${width}x${height}: walkthrough choices and controls must fit together, got ${bounds.walkthroughHeight}`,
        );
    }
    assert.equal(await page.locator("#comparisons a").count(), 16);
    assert.equal(
      await page.locator("#comparisons").evaluate((e) => !!e.closest("details")),
      false,
    );
  }
  const preferenceContext = await browser.newContext({
    viewport: { width: 1024, height: 768 },
  });
  const firstTab = await preferenceContext.newPage(),
    secondTab = await preferenceContext.newPage();
  await firstTab.goto(`http://127.0.0.1:${server.address().port}`);
  await secondTab.goto(`http://127.0.0.1:${server.address().port}`);
  assert.equal(
    await firstTab.locator("feedbacks-demo .play").innerText(),
    "Pause",
    "New visitors autoplay",
  );
  await firstTab.locator("feedbacks-demo .play").click();
  await secondTab.waitForFunction(() => document.querySelector("feedbacks-demo").paused);
  await firstTab.goto(`http://127.0.0.1:${server.address().port}/landing`);
  assert.ok(
    (await firstTab.locator("feedbacks-demo .play").allTextContents()).every(
      (text) => text === "Play",
    ),
    "Pause persists across pages and players",
  );
  await firstTab.reload();
  assert.ok(
    (await firstTab.locator("feedbacks-demo .play").allTextContents()).every(
      (text) => text === "Play",
    ),
    "Pause survives reload",
  );
  await firstTab.locator("feedbacks-demo .play").first().click();
  await secondTab.waitForFunction(() => !document.querySelector("feedbacks-demo").paused);
  const depth = firstTab.locator(".product-hero-demo feedbacks-demo");
  await firstTab.mouse.move(0, 0);
  await depth.evaluate((el) => el.shadowRoot.activeElement?.blur());
  const depthStyle = () =>
    depth.locator(".depth-stage > figure").evaluate((figure) => {
      const style = getComputedStyle(figure);
      return {
        transform: style.transform,
        animation: style.animationName,
        state: style.animationPlayState,
        reflection: style.webkitBoxReflect,
        shadow: style.boxShadow,
      };
    });
  await firstTab.waitForFunction(() =>
    document
      .querySelector(".product-hero-demo feedbacks-demo")
      .hasAttribute("data-motion-running"),
  );
  assert.equal((await depthStyle()).state, "running");
  assert.match((await depthStyle()).reflection, /^below /);
  assert.equal((await depthStyle()).shadow, "none", "Shadow belongs on the ground");
  const moving = (await depthStyle()).transform;
  await firstTab.waitForFunction((before) => {
    const figure = document
      .querySelector(".product-hero-demo feedbacks-demo")
      .shadowRoot.querySelector(".depth-stage > figure");
    return getComputedStyle(figure).transform !== before;
  }, moving);
  await depth.locator(".play").press("Enter");
  await depth.evaluate((el) => el.shadowRoot.activeElement?.blur());
  assert.equal((await depthStyle()).state, "paused");
  // CSS pauses settle at the compositor's next frame. Inspect the held
  // transform after the animation is ready, not during its pending pause.
  await depth.locator(".depth-stage > figure").evaluate(async (figure) => {
    await Promise.all(figure.getAnimations().map((animation) => animation.ready));
  });
  const held = (await depthStyle()).transform;
  await firstTab.waitForTimeout(250);
  assert.equal((await depthStyle()).transform, held, "Pause holds perspective too");
  await depth.locator(".play").press("Enter");
  await depth.evaluate((el) => el.shadowRoot.activeElement?.blur());
  // A real pointer approaches the surface before clicking. Its perspective
  // holds on hover so controls never require clicking a moving target.
  const plane = await depth.boundingBox();
  await firstTab.mouse.move(plane.x + 20, plane.y + 30);
  assert.equal((await depthStyle()).state, "paused");
  assert.equal(await depth.locator(".play").innerText(), "Pause");
  const animationTime = () =>
    depth.locator(".depth-stage > figure").evaluate(async (figure) => {
      const animation = figure.getAnimations()[0];
      await animation.ready;
      return animation.currentTime;
    });
  const hoverTime = await animationTime();
  await firstTab.waitForTimeout(250);
  assert.equal(
    await animationTime(),
    hoverTime,
    "Hover holds the same perspective clock",
  );
  const interactiveStyle = () =>
    depth.locator(".depth-stage").evaluate((stage) => {
      const figure = getComputedStyle(stage.querySelector("figure"));
      return {
        rotate: figure.rotate,
        translate: figure.translate,
        light: stage.style.getPropertyValue("--depth-light-x"),
        shadow: getComputedStyle(stage, "::after").transform,
      };
    });
  // Pointer steers the held plane, light and ground shadow as one material.
  await firstTab.mouse.move(plane.x + plane.width * 0.25, plane.y + 60);
  await firstTab.waitForTimeout(350);
  const leftTilt = await interactiveStyle();
  await firstTab.mouse.move(plane.x + plane.width * 0.75, plane.y + 60);
  await firstTab.waitForTimeout(350);
  const rightTilt = await interactiveStyle();
  assert.notEqual(leftTilt.rotate, rightTilt.rotate, "Pointer changes tilt");
  assert.notEqual(leftTilt.light, rightTilt.light, "Glass light follows pointer");
  assert.notEqual(leftTilt.shadow, rightTilt.shadow, "Ground shadow follows pointer");
  await depth.locator(".play").hover();
  const controlHold = await interactiveStyle();
  await firstTab.waitForTimeout(200);
  assert.deepEqual(
    await interactiveStyle(),
    controlHold,
    "Controls hold all depth effects",
  );
  await depth.locator(".play").click();
  await depth.evaluate((el) => el.shadowRoot.activeElement?.blur());
  const pausedDepth = await interactiveStyle();
  await firstTab.mouse.move(plane.x + 20, plane.y + 60);
  await firstTab.waitForTimeout(200);
  assert.deepEqual(
    await interactiveStyle(),
    pausedDepth,
    "Global Pause holds pointer effects",
  );
  await depth.locator(".play").press("Enter");
  const keyboardHold = await interactiveStyle();
  await firstTab.mouse.move(plane.x + plane.width * 0.7, plane.y + 60);
  await firstTab.waitForTimeout(200);
  assert.deepEqual(await interactiveStyle(), keyboardHold, "Keyboard focus holds depth");
  await depth.evaluate((el) => el.shadowRoot.activeElement?.blur());
  await firstTab.mouse.move(0, 0);
  await firstTab.waitForFunction((held) => {
    const figure = document
      .querySelector(".product-hero-demo feedbacks-demo")
      .shadowRoot.querySelector(".depth-stage > figure");
    return figure.getAnimations()[0].currentTime > held;
  }, hoverTime);
  const beforeScroll = (await interactiveStyle()).translate;
  await firstTab.evaluate(() => scrollTo(0, 120));
  await firstTab.waitForTimeout(400);
  assert.notEqual(
    (await interactiveStyle()).translate,
    beforeScroll,
    "Scroll changes depth gently",
  );
  await firstTab.evaluate(() => scrollTo(0, 0));
  await firstTab.mouse.move(plane.x + 20, plane.y + 30);
  await depth.locator(".zoom").click();
  assert.equal(
    await depth.locator("dialog figure").evaluate((el) => getComputedStyle(el).transform),
    "none",
    "Expanded inspection stays flat",
  );
  await firstTab.keyboard.press("Escape");
  await firstTab.locator("#features").scrollIntoViewIfNeeded();
  await firstTab.waitForFunction(
    () =>
      !document
        .querySelector(".product-hero-demo feedbacks-demo")
        .hasAttribute("data-motion-running"),
  );
  assert.equal((await depthStyle()).state, "paused", "Offscreen depth stops");
  await firstTab.evaluate(() => scrollTo(0, 0));
  await firstTab.emulateMedia({ reducedMotion: "reduce" });
  assert.equal((await depthStyle()).animation, "none");
  assert.equal((await depthStyle()).transform, "none");
  assert.equal((await interactiveStyle()).rotate, "none");
  assert.equal((await interactiveStyle()).translate, "none");
  assert.equal(await depth.locator(".play").innerText(), "Pause");
  await firstTab.emulateMedia({ reducedMotion: "no-preference" });
  await firstTab.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    (await interactiveStyle()).rotate,
    "none",
    "Small screens omit pointer tilt",
  );
  assert.equal(
    (await interactiveStyle()).translate,
    "none",
    "Small screens omit scroll depth",
  );
  assert.equal(
    await depth.evaluate((el) =>
      getComputedStyle(el).getPropertyValue("--depth-scale").trim(),
    ),
    "0.35",
    "Mobile uses a gentler perspective",
  );
  await firstTab.goto(`http://127.0.0.1:${server.address().port}`);
  assert.equal(
    await firstTab.locator("feedbacks-demo .play").innerText(),
    "Pause",
    "Play restores autoplay for future pages",
  );
  await preferenceContext.close();
  assert.deepEqual(errors, []);
  console.log(
    "Walkthroughs passed: ten scenes including GitHub setup and pinning, cursor/click/typing cues, exact pause/resume, play-one/pause-all and navigation persistence, reduced motion, keyboard focus, mobile bounds, complete laptop product hero and scroll-activated capture walkthrough.",
  );
} finally {
  await browser.close();
  server.close();
}
