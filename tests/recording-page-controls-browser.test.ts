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
      for (const file of [
        "utils.js",
        "frame-dom.js",
        "review/anchor-evidence.js",
        "content.js",
      ])
        await page.addScriptTag({ path: `extension/${file}` });
      const css = await readFile("extension/content.css", "utf8");
      await message(page, {
        type: "activate",
        project: { id: "fixture", name: "Fixture" },
        reviewId: "fixture",
        reviewDefaults: { highlightEnabled: true, recordingHighlightEnabled: true },
        css,
      });
      const dock = page.locator(".review-dock");
      const drawer = page.locator(".bar");
      const handle = page.locator(".drawer-handle");
      await handle.hover();
      await mkdir(".local/review-controls-qa", { recursive: true });
      await drawer.screenshot({
        path: ".local/review-controls-qa/page-controls-light.png",
      });
      await page.emulateMedia({ colorScheme: "dark" });
      await drawer.screenshot({
        path: ".local/review-controls-qa/page-controls-dark.png",
      });
      await page.emulateMedia({ colorScheme: "light" });
      assert.equal(
        await drawer.getByText("Review tools", { exact: true }).isVisible(),
        true,
      );
      assert.equal(
        await drawer.getByRole("button", { name: "Navigation locked" }).isVisible(),
        false,
      );
      assert.equal(await drawer.getByText("1280 × 800").count(), 0);
      await drawer.getByText("Review tools", { exact: true }).click();
      assert.equal(
        await drawer.getByRole("button", { name: "Navigation locked" }).isVisible(),
        true,
      );
      await drawer.getByText("Review tools", { exact: true }).click();
      assert.equal(
        await page.getByRole("button", { name: "Screenshot", exact: true }).isVisible(),
        true,
      );
      assert.equal(
        await page.getByRole("button", { name: "Record video + session" }).count(),
        1,
      );
      assert.equal(await page.getByRole("button", { name: "Record session" }).count(), 0);
      await page.getByText("Options", { exact: true }).click();
      await page.getByLabel("Recording mode").selectOption("session");
      await page.getByRole("button", { name: "Record session" }).click();
      assert.deepEqual(await page.evaluate(() => (window as any).sent.at(-1)), {
        type: "startRecording",
        mode: "session",
      });
      await message(page, { type: "recordingState", state: "idle", mode: "session" });
      await handle.hover();
      await page.getByText("Options", { exact: true }).click();
      await page.getByLabel("Recording mode").selectOption("video");
      await page.getByRole("button", { name: "Record video + session" }).click();
      assert.deepEqual(await page.evaluate(() => (window as any).sent.at(-1)), {
        type: "startRecording",
        mode: "video",
      });
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
      const videoSettings: any = await message(page, { type: "popupControls" });
      assert.equal(
        videoSettings.highlightEnabled,
        false,
        "recording never outlines page elements even with a saved highlight preference",
      );
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
          navigationBlocked,
          sent: (window as any).sent,
        };
      });
      assert.deepEqual(behavior, {
        shortcutBlocked: false,
        navigationBlocked: false,
        sent: [],
      });
      await page.setViewportSize({ width: 375, height: 740 });
      await page.emulateMedia({ colorScheme: "dark" });
      for (const width of [375, 320]) {
        await page.setViewportSize({ width, height: 740 });
        for (const font of ["system-ui", "Verdana"]) {
          await dock.evaluate((node, font) => {
            (node as HTMLElement).style.fontFamily = font;
          }, font);
          const mobile = (await dock.boundingBox())!;
          assert.ok(
            mobile.x >= 0 && mobile.x + mobile.width <= width && mobile.height <= 64,
            `${font} at ${width}px: ${JSON.stringify(mobile)}`,
          );
        }
      }
      await dock.evaluate((node) => {
        (node as HTMLElement).style.fontFamily = "";
      });
      await page.setViewportSize({ width: 375, height: 740 });
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
      await drawer.getByText("Review tools", { exact: true }).click();
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
      const sessionSettings: any = await message(page, { type: "popupControls" });
      assert.equal(sessionSettings.highlightEnabled, false);
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
      // Simulate reinjection after an approved redirect into a fresh page review host.
      await message(page, { type: "deactivate" });
      await page.evaluate(() => {
        (window as any).sent = [];
      });
      await message(page, {
        type: "activate",
        recordingOnly: true,
        project: { id: "fixture", name: "Original project" },
        reviewId: "fixture",
        css,
      });
      await message(page, {
        type: "recordingState",
        state: "recording",
        mode: "video",
        elapsedMs: 43000,
      });
      assert.equal(
        await dock.getByRole("button", { name: "Pause video" }).isVisible(),
        true,
      );
      assert.match(await dock.innerText(), /00:43/);
      await message(page, {
        type: "recordingState",
        state: "paused",
        mode: "video",
        elapsedMs: 43500,
      });
      assert.equal(
        await dock.getByRole("button", { name: "Resume video" }).isVisible(),
        true,
      );
      await message(page, {
        type: "recordingState",
        state: "ready",
        mode: "video",
        elapsedMs: 43500,
      });
      assert.equal(
        await dock.getByRole("button", { name: "Review video" }).isVisible(),
        true,
        "redirect keeps review access in compact dock after stop",
      );
      assert.match((await dock.getAttribute("aria-label")) || "", /Original project/);
      assert.match(await dock.innerText(), /00:43/);
      await page.screenshot({
        path: "output/playwright/recording-page-controls/redirect-ready-desktop.png",
      });
      await page.setViewportSize({ width: 375, height: 740 });
      const redirectDock = (await dock.boundingBox())!;
      assert.ok(
        redirectDock.x >= 0 &&
          redirectDock.x + redirectDock.width <= 375 &&
          redirectDock.height <= 64,
      );
      await page.screenshot({
        path: "output/playwright/recording-page-controls/redirect-ready-mobile.png",
      });
      await page.setViewportSize({ width: 1280, height: 800 });
      await handle.hover();
      await handle.click();
      assert.equal(await drawer.isVisible(), false);
      const redirected = await page.evaluate(() => {
        const events = [
          new KeyboardEvent("keydown", {
            key: "Escape",
            bubbles: true,
            cancelable: true,
          }),
          new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
        ];
        events.forEach((event) => document.body.dispatchEvent(event));
        let navigationBlocked = false;
        const link = document.querySelector("a")!;
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
          intercepted: events.some((event) => event.defaultPrevented),
          navigationBlocked,
          threadRequests: (window as any).sent.filter(
            (entry: any) => entry.type === "threads",
          ).length,
        };
      });
      assert.deepEqual(redirected, {
        intercepted: false,
        navigationBlocked: false,
        threadRequests: 0,
      });
      await dock.getByRole("button", { name: "Review video" }).click();
      assert.deepEqual(await page.evaluate(() => (window as any).sent.at(-1)), {
        type: "openRecorder",
      });
      await message(page, {
        type: "recordingState",
        state: "ready",
        mode: "session",
        elapsedMs: 90000,
      });
      await dock.getByRole("button", { name: "Review session" }).click();
      assert.deepEqual(await page.evaluate(() => (window as any).sent.at(-1)), {
        type: "openSessionReview",
      });
      assert.match(await dock.innerText(), /01:30/);
      // Returning to the original origin restores the regular review surface.
      await message(page, {
        type: "activate",
        recordingOnly: false,
        project: { id: "fixture", name: "Original project" },
        reviewId: "fixture",
        css,
      });
      await handle.hover();
      assert.equal(
        await page.getByRole("button", { name: "Screenshot", exact: true }).isVisible(),
        true,
      );
    } finally {
      await browser.close();
    }
  },
);

test(
  "recording point pauses before opening, retries failed snapshots and saves without ordinary drafts",
  { skip: process.env.FEEDBACKS_RECORDING_BROWSER_SMOKE !== "1" },
  async () => {
    const browser = await chromium.launch({ headless: true, channel: "chromium" });
    try {
      const page = await browser.newPage({ viewport: { width: 1000, height: 720 } });
      await page.route("https://example.test/**", (route) =>
        route.fulfill({ contentType: "text/html", body: "<html><body></body></html>" }),
      );
      await page.goto("https://example.test");
      await page.setContent(
        '<h1 id="target">Original element</h1><p>Record this page.</p>',
      );
      await page.addScriptTag({ content: "globalThis.__name=value=>value;" });
      await page.evaluate(() => {
        const w = window as any;
        const attach = Element.prototype.attachShadow;
        Element.prototype.attachShadow = function (options) {
          return attach.call(this, { ...options, mode: "open" });
        };
        w.sent = [];
        w.snapshotFails = true;
        w.failSave = true;
        w.chrome = {
          runtime: {
            id: "fixture",
            onMessage: {
              addListener: (listener: any) => {
                w.deliver = (input: any) =>
                  new Promise((resolve) => listener(input, { id: "fixture" }, resolve));
              },
            },
            sendMessage: async (input: any) => {
              w.sent.push(input);
              if (input.type === "recordingAnnotationBegin")
                return new Promise((resolve) => {
                  w.confirmPause = async () => {
                    await w.deliver({
                      type: "recordingState",
                      state: "paused",
                      mode: "video",
                      elapsedMs: 4200,
                    });
                    resolve({
                      ok: true,
                      data: {
                        annotationId: "annotation",
                        atMs: 4200,
                        videoTimeMs: 4200,
                        resumeAfter: !w.manuallyPaused,
                      },
                    });
                  };
                });
              if (input.type === "recordingFreezeView")
                return w.snapshotFails
                  ? { ok: false, error: "Temporary screenshot failure" }
                  : {
                      ok: true,
                      data: {
                        snapshot: {
                          key: "point-image",
                          viewport: { width: 1000, height: 720 },
                        },
                      },
                    };
              if (input.type === "recordingAnnotationSave" && w.failSave)
                return { ok: false, error: "Temporary save failure" };
              if (
                ["recordingAnnotationSave", "recordingAnnotationCancel"].includes(
                  input.type,
                )
              ) {
                const prepared = await w.deliver({
                  type: "prepareRecordingResume",
                  annotationId: "annotation",
                });
                if (prepared.error) throw Error(prepared.error);
                const editor = document
                  .querySelector("#feedbacks-review-root")!
                  .shadowRoot!.querySelector(".point-menu")!;
                w.hiddenBeforeResume = getComputedStyle(editor).display === "none";
                if (!w.manuallyPaused)
                  await w.deliver({
                    type: "recordingState",
                    state: "recording",
                    mode: "video",
                    elapsedMs: 4200,
                  });
                return { ok: true, data: {} };
              }
              if (input.type === "threads")
                return { ok: true, data: { items: [], nextOffset: null } };
              return { ok: true, data: {} };
            },
          },
        };
      });
      for (const file of [
        "utils.js",
        "frame-dom.js",
        "review/anchor-evidence.js",
        "content.js",
      ])
        await page.addScriptTag({ path: `extension/${file}` });
      await message(page, {
        type: "activate",
        recordingOnly: true,
        project: { id: "project", name: "Original project" },
        reviewId: "review",
        css: await readFile("extension/content.css", "utf8"),
      });
      await message(page, {
        type: "recordingState",
        state: "recording",
        mode: "video",
        elapsedMs: 4000,
      });
      const editor = page.getByRole("dialog", { name: "Feedback at this point" });
      await page.locator("#target").click({ button: "right" });
      await page.waitForFunction(
        () => typeof (window as any).confirmPause === "function",
      );
      assert.equal(
        await editor.isVisible(),
        false,
        "editor cannot appear before pause acknowledgment",
      );
      assert.equal(
        await page.evaluate(() =>
          (window as any).sent.some((entry: any) => entry.type === "recordingFreezeView"),
        ),
        false,
      );
      await page.evaluate(() => (window as any).confirmPause());
      await editor.waitFor();
      await editor
        .getByRole("status")
        .filter({ hasText: "Temporary screenshot failure" })
        .waitFor();
      assert.equal(
        await page.getByRole("button", { name: "Stop video" }).isDisabled(),
        true,
      );
      const captureCheck = await page.evaluate(async () => {
        const w = window as any;
        const freeze = w.sent.find((entry: any) => entry.type === "recordingFreezeView");
        return w.deliver({ type: "captureCheck", pointToken: freeze.key });
      });
      assert.equal(
        captureCheck.error,
        undefined,
        "redirect annotation permits capture validation",
      );
      assert.equal(typeof captureCheck.signature, "string");
      const staleCaptureCheck = await message(page, {
        type: "captureCheck",
        pointToken: "stale",
      });
      assert.ok(
        staleCaptureCheck.error,
        "capture validation still requires the selected point",
      );
      await editor.getByRole("textbox").fill("Keep this exact point");
      await editor.getByRole("button", { name: "Save point", exact: true }).click();
      assert.equal(
        await page.evaluate(() =>
          (window as any).sent.some(
            (entry: any) => entry.type === "recordingAnnotationSave",
          ),
        ),
        false,
        "missing snapshot cannot save an annotation",
      );
      await page.evaluate(() => {
        (window as any).snapshotFails = false;
      });
      await editor.getByRole("button", { name: "Save point", exact: true }).click();
      await editor
        .getByRole("status")
        .filter({ hasText: "Temporary save failure" })
        .waitFor();
      assert.equal(
        await editor.getByRole("textbox").inputValue(),
        "Keep this exact point",
      );
      assert.equal(
        await page.getByRole("button", { name: "Stop video" }).isDisabled(),
        true,
      );
      await mkdir("output/playwright/recording-annotations", { recursive: true });
      await page.screenshot({
        path: "output/playwright/recording-annotations/paused-desktop.png",
      });
      await page.setViewportSize({ width: 375, height: 740 });
      // Chromium dispatches resize on the next frame; let the editor's resize
      // handler clamp its stored position before measuring the resulting layout.
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      const mobileEditor = (await editor.boundingBox())!;
      assert.ok(mobileEditor.x >= 0 && mobileEditor.x + mobileEditor.width <= 375);
      await page.screenshot({
        path: "output/playwright/recording-annotations/paused-mobile.png",
      });
      await page.setViewportSize({ width: 1000, height: 720 });
      await page.evaluate(() => {
        (window as any).failSave = false;
      });
      await editor.getByRole("button", { name: "Save point", exact: true }).click();
      await editor.waitFor({ state: "hidden" });
      await page.waitForFunction(() => (window as any).hiddenBeforeResume === true);
      assert.equal(
        await page.evaluate(() => (window as any).hiddenBeforeResume),
        true,
        "annotation UI must disappear before capture resumes",
      );
      const saved = await page.evaluate(() =>
        (window as any).sent
          .filter((entry: any) => entry.type === "recordingAnnotationSave")
          .at(-1),
      );
      assert.equal(saved.annotationId, "annotation");
      assert.equal(saved.body, "Keep this exact point");
      assert.equal(saved.anchor.tagName, "h1");
      assert.ok(saved.anchor.viewport.width === 1000);
      assert.equal(
        await page.getByRole("button", { name: "Pause video" }).isDisabled(),
        false,
      );
      assert.equal(
        await page.locator(".saved-draft-pin").count(),
        0,
        "recording points do not become ordinary screenshot drafts",
      );
      // A manually paused capture stays paused after Escape cancels its annotation.
      await page.evaluate(() => {
        (window as any).manuallyPaused = true;
        (window as any).confirmPause = null;
      });
      await message(page, {
        type: "recordingState",
        state: "paused",
        mode: "video",
        elapsedMs: 4200,
      });
      await page.locator("#target").click({ button: "right" });
      await page.waitForFunction(
        () => typeof (window as any).confirmPause === "function",
      );
      await page.evaluate(() => (window as any).confirmPause());
      await editor.waitFor();
      await page.keyboard.press("Escape");
      await editor.waitFor({ state: "hidden" });
      assert.equal(
        await page.getByRole("button", { name: "Resume video" }).isVisible(),
        true,
      );
      assert.equal(
        await page.evaluate(
          () =>
            (window as any).sent.filter(
              (entry: any) => entry.type === "recordingAnnotationCancel",
            ).length,
        ),
        1,
      );
    } finally {
      await browser.close();
    }
  },
);
