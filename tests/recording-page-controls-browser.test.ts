import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { chromium, type Page } from "playwright";

// Exercise the actual content script and CSS. Only Chrome's extension transport
// is replaced: these tests isolate page controls from MediaRecorder lifecycle.
async function message(page: Page, input: Record<string, unknown>) {
  return page.evaluate((input) => (window as any).deliver(input), input);
}

test(
  "active video keeps compact controls visible, hides review tools and restores them after stop",
  { skip: process.env.FEEDBACKS_RECORDING_BROWSER_SMOKE !== "1" },
  async () => {
    const browser = await chromium.launch({ headless: true, channel: "chromium" });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      await page.route("https://example.test/**", (route) =>
        route.fulfill({
          contentType: "text/html",
          body: '<h1>Recording fixture</h1><a href="/next">Next page</a><input aria-label="Notes">',
        }),
      );
      await page.goto("https://example.test/review");
      await page.addScriptTag({ content: "globalThis.__name = (value) => value;" });
      await page.evaluate(() => {
        const attach = Element.prototype.attachShadow;
        Element.prototype.attachShadow = function (options) {
          return attach.call(this, { ...options, mode: "open" });
        };
        (window as any).sent = [];
        (window as any).chrome = {
          runtime: {
            id: "fixture",
            sendMessage: async (input: any) => {
              (window as any).sent.push(input);
              if ((window as any).controlError && input.type === "recordingControl")
                return { ok: false, error: "Recorder connection lost. Try again." };
              if (input.type === "threads")
                return { ok: true, data: { items: [], nextOffset: null } };
              return { ok: true, data: { active: false } };
            },
            onMessage: {
              addListener: (listener: any) => {
                (window as any).deliver = (input: any) =>
                  new Promise((resolve) => listener(input, { id: "fixture" }, resolve));
              },
            },
          },
        };
      });
      for (const file of ["utils.js", "frame-dom.js", "content.js"])
        await page.addScriptTag({ path: `extension/${file}` });
      const css = await readFile("extension/content.css", "utf8");
      await message(page, {
        type: "activate",
        project: { id: "fixture", name: "Fixture" },
        reviewId: "fixture",
        css,
      });
      const dock = page.locator(".review-dock");
      const drawer = page.locator(".bar");
      const handle = page.locator(".drawer-handle");
      await handle.hover();
      assert.equal(
        await page.getByRole("button", { name: "Screenshot", exact: true }).isVisible(),
        true,
      );
      await message(page, { type: "recordingState", state: "starting" });
      assert.equal(await drawer.isVisible(), false);
      assert.match(await dock.innerText(), /Starting video/);
      await message(page, {
        type: "recordingState",
        state: "recording",
        elapsedMs: 65000,
      });
      assert.equal(
        await drawer.isVisible(),
        false,
        "ordinary review tools must close when recording starts",
      );
      assert.equal(
        await dock.getByRole("button", { name: "Pause video" }).isVisible(),
        true,
      );
      assert.equal(
        await dock.getByRole("button", { name: "Stop video" }).isVisible(),
        true,
      );
      assert.match(await dock.innerText(), /Recording.*01:05/s);
      await handle.hover();
      await handle.click();
      await message(page, { type: "popupControls", action: "show-controls" });
      assert.equal(
        await drawer.isVisible(),
        false,
        "hover, click and popup cannot reopen stale tools",
      );
      assert.equal((await dock.boundingBox())!.height <= 64, true);
      await dock.getByRole("button", { name: "Pause video" }).focus();
      await message(page, {
        type: "recordingState",
        state: "recording",
        elapsedMs: 66000,
      });
      assert.equal(
        await dock
          .getByRole("button", { name: "Pause video" })
          .evaluate((button) => button.matches(":focus")),
        true,
        "heartbeat must preserve keyboard focus",
      );
      await page.evaluate(() => {
        (window as any).controlError = true;
      });
      await page.keyboard.press("Enter");
      await dock
        .getByRole("alert")
        .filter({ hasText: "Recorder connection lost" })
        .waitFor();
      assert.equal(
        await drawer.isVisible(),
        false,
        "control failures stay visible in the compact dock",
      );
      await page.evaluate(() => {
        (window as any).controlError = false;
      });
      await dock.getByRole("button", { name: "Pause video" }).click();
      assert.deepEqual(await page.evaluate(() => (window as any).sent.at(-1)), {
        type: "recordingControl",
        action: "pause",
      });
      await message(page, { type: "recordingState", state: "paused", elapsedMs: 67200 });
      assert.equal(
        await dock
          .getByRole("button", { name: "Resume video" })
          .evaluate((button) => button.matches(":focus")),
        true,
        "pause transition keeps keyboard control available",
      );
      await page.waitForTimeout(1100);
      assert.match(await dock.innerText(), /Paused.*01:07/s);
      await dock.getByRole("button", { name: "Resume video" }).focus();
      await page.keyboard.press("Enter");
      assert.deepEqual(await page.evaluate(() => (window as any).sent.at(-1)), {
        type: "recordingControl",
        action: "resume",
      });
      await message(page, {
        type: "recordingState",
        state: "recording",
        elapsedMs: 67200,
      });
      const behavior = await page.evaluate(() => {
        (window as any).sent = [];
        const shortcut = new KeyboardEvent("keydown", {
          key: "s",
          bubbles: true,
          cancelable: true,
        });
        document.body.dispatchEvent(shortcut);
        const context = new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
        });
        document.body.dispatchEvent(context);
        const link = document.querySelector("a")!;
        let navigationBlocked = false;
        link.addEventListener(
          "click",
          (event) => {
            navigationBlocked = event.defaultPrevented;
            event.preventDefault();
          },
          { once: true },
        );
        link.click();
        return {
          shortcutBlocked: shortcut.defaultPrevented,
          contextBlocked: context.defaultPrevented,
          navigationBlocked,
          sent: (window as any).sent,
        };
      });
      assert.deepEqual(behavior, {
        shortcutBlocked: false,
        contextBlocked: false,
        navigationBlocked: false,
        sent: [],
      });
      await page.setViewportSize({ width: 375, height: 740 });
      await page.emulateMedia({ colorScheme: "dark" });
      const mobile = (await dock.boundingBox())!;
      assert.ok(mobile.x >= 0 && mobile.x + mobile.width <= 375 && mobile.height <= 64);
      await mkdir("output/playwright/recording-page-controls", { recursive: true });
      await page.screenshot({
        path: "output/playwright/recording-page-controls/mobile-dark.png",
      });
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.emulateMedia({ colorScheme: "light" });
      await page.screenshot({
        path: "output/playwright/recording-page-controls/desktop-light.png",
      });
      await dock.getByRole("button", { name: "Stop video" }).click();
      assert.deepEqual(await page.evaluate(() => (window as any).sent.at(-1)), {
        type: "recordingControl",
        action: "stop",
      });
      await message(page, {
        type: "recordingState",
        state: "stopping",
        elapsedMs: 69000,
      });
      assert.equal(await drawer.isVisible(), false);
      assert.match(await dock.innerText(), /Saving video/);
      await message(page, { type: "recordingState", state: "ready" });
      await handle.hover();
      assert.equal(
        await page.getByRole("button", { name: "Review video", exact: true }).isVisible(),
        true,
      );
      assert.equal(
        await page.getByRole("button", { name: "Screenshot", exact: true }).isVisible(),
        true,
      );
      assert.equal(
        await page
          .getByRole("button", { name: "Navigation locked", exact: true })
          .getAttribute("aria-pressed"),
        "true",
      );
      assert.equal(
        await page
          .getByRole("button", { name: "Highlight on", exact: true })
          .getAttribute("aria-pressed"),
        "true",
      );
      await message(page, {
        type: "recordingState",
        state: "recording",
        mode: "session",
        elapsedMs: 12000,
      });
      assert.equal(await drawer.isVisible(), false);
      assert.equal(
        await dock.getByRole("button", { name: /Pause|Resume/ }).count(),
        0,
        "session capture cannot pause",
      );
      assert.equal(
        await dock.getByRole("button", { name: "Stop session" }).isVisible(),
        true,
      );
      assert.match(await dock.innerText(), /00:12/);
      await dock.getByRole("button", { name: "Stop session" }).click();
      assert.deepEqual(await page.evaluate(() => (window as any).sent.at(-1)), {
        type: "recordingControl",
        action: "stop",
      });
      await message(page, { type: "recordingState", state: "ready", mode: "session" });
      await handle.hover();
      assert.equal(
        await page
          .getByRole("button", { name: "Review session", exact: true })
          .isVisible(),
        true,
      );
      await page.getByRole("button", { name: "Review session", exact: true }).click();
      assert.deepEqual(await page.evaluate(() => (window as any).sent.at(-1)), {
        type: "openSessionReview",
      });
      // Old native messages without mode still expose their supported Pause action.
      await message(page, {
        type: "recordingState",
        state: "recording",
        elapsedMs: 1000,
      });
      assert.equal(
        await dock.getByRole("button", { name: "Pause video" }).isVisible(),
        true,
      );
    } finally {
      await browser.close();
    }
  },
);
