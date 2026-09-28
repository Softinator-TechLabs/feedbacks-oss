import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import sharp from "sharp";

const root = process.cwd();
async function previewDimensions(page) {
  await page.locator("#preview-slot:not([hidden]) img").first().waitFor();
  await page.waitForFunction(() => {
    const images = [...document.querySelectorAll("#preview-slot img")];
    return (
      images.length > 0 &&
      images.every((image) => image.complete && image.naturalWidth > 0)
    );
  });
  return page.locator("#preview-slot img").evaluateAll((images) => ({
    width: images[0].naturalWidth,
    height: images.reduce((sum, image) => sum + image.naturalHeight, 0),
  }));
}
const publicCaptureUrl = process.env.FEEDBACKS_QA_PUBLIC_URL;
if (process.env.FEEDBACKS_QA_PUBLIC_CAPTURE === "1" && !publicCaptureUrl)
  throw Error("Set FEEDBACKS_QA_PUBLIC_URL to the approved website for live capture QA.");
const profile = await mkdtemp(join(tmpdir(), "feedbacks-extension-browser-"));
const extension = join(profile, "extension");
await cp(join(root, "extension"), extension, { recursive: true });
const manifestPath = join(extension, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
// Isolated fixture grants let headless Chromium run feature checks; this copy
// is never packaged, and optional permission UX remains a separate gate.
manifest.host_permissions = ["<all_urls>"];
await writeFile(manifestPath, JSON.stringify(manifest));

const sandbox = spawn(process.execPath, ["scripts/dev-sandbox.mjs"], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"],
});
let context;
try {
  let output = "";
  const accessPath = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error("Sandbox startup timed out")), 30000);
    sandbox.stdout.on("data", (chunk) => {
      output += String(chunk);
      const match = output.match(/Local access file: ([^\r\n]+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    sandbox.once("exit", () => reject(Error("Sandbox exited during startup")));
  });
  const access = JSON.parse(await readFile(accessPath, "utf8"));
  const post = async (name, input, auth = {}) => {
    const response = await fetch(`${access.url}/api/${name}`, {
      method: "POST",
      headers: {
        Origin: access.url,
        "Content-Type": "application/json",
        ...(auth.cookie ? { Cookie: auth.cookie, "X-CSRF-Token": auth.csrf } : {}),
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(10000),
    });
    const result = await response.json();
    if (!response.ok || !result.ok)
      throw Error(`${name}: ${result.error?.message || response.status}`);
    return {
      data: result.data,
      cookie: response.headers.get("set-cookie")?.split(";")[0],
    };
  };
  const login = await post("auth.login", {
    email: access.email,
    password: access.password,
  });
  const auth = { cookie: login.cookie, csrf: login.data.csrf };
  if (process.env.FEEDBACKS_QA_PUBLIC_CAPTURE === "1")
    await post(
      "projects.create",
      { name: "Public capture QA", origins: [new URL(publicCaptureUrl).origin] },
      auth,
    );
  const request = (await post("pairing.request", { name: "Synthetic browser QA" })).data;
  await post("pairing.approve", { pairingId: request.pairingId }, auth);
  const paired = (
    await post("pairing.poll", {
      pairingId: request.pairingId,
      deviceSecret: request.deviceSecret,
    })
  ).data;
  if (paired.status !== "approved" || !paired.token)
    throw Error("Pairing did not issue a device token");

  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    viewport: { width: 900, height: 650 },
    deviceScaleFactor: Number(process.env.FEEDBACKS_QA_DPR || 1),
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const worker =
    context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  const extensionId = new URL(worker.url()).host;
  await worker.evaluate(
    ({ server, token }) =>
      chrome.storage.local.set({
        server,
        allowLocal: true,
        instantReview: false,
        accounts: { [server]: { token } },
      }),
    { server: access.url, token: paired.token },
  );

  let mode = "long";
  await context.route("https://example.com/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/missing")
      return route.fulfill({ status: 404, body: "Missing" });
    const height =
      mode === "short"
        ? 260
        : mode === "tall"
          ? 22000
          : mode === "tooLong"
            ? 35000
            : 2100;
    const change =
      mode === "changing"
        ? '<script>let size=2100; window.qaTimer=setInterval(()=>{ size=size===2100?2300:2100; document.querySelector("main").style.height=size+"px" },75)</script>'
        : "";
    const clipped =
      mode === "clipped"
        ? '<style>html{overflow-x:hidden;scroll-behavior:smooth}body{overflow-x:hidden;position:relative}.wide-carousel{position:absolute;top:100px;width:6000px}</style><div class="wide-carousel"><video></video></div><script>window.qaMotion=setInterval(()=>{document.querySelector("video").dispatchEvent(new Event("resize"));document.querySelector(".wide-carousel").dispatchEvent(new Event("scroll"))},100)</script>'
        : "";
    const hover =
      mode === "hover"
        ? '<style>#hover-menu{display:none;position:absolute;top:48px;left:20px;width:320px;padding:20px;background:#eef;border:2px solid #356}#hover-host:hover #hover-menu{display:block}</style><nav id="hover-host" style="position:absolute;top:160px;left:20px;width:420px;height:80px;background:#ddd">About<div id="hover-menu">Research ethics menu</div></nav>'
        : "";
    return route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<!doctype html><title>Feedback fixture</title><style>body{margin:0;font:16px sans-serif}header{position:sticky;top:0;background:#eee;padding:16px}main{height:${height}px;padding:16px;position:relative}#lower{position:absolute;top:${Math.max(160, height - 260)}px;left:30px}</style><header>Sticky header</header><main><h1>Controlled page</h1><img src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs" /><a href="/missing">Broken same-origin link</a>${hover}<button id="lower">Bottom action</button></main>${change}${clipped}`,
    });
  });
  const page = context.pages()[0] ?? (await context.newPage());
  const control = await context.newPage();
  await control.goto(`chrome-extension://${extensionId}/popup.html`);
  const send = async (message) =>
    control.evaluate(async (input) => {
      const result = await chrome.runtime.sendMessage(input);
      if (!result?.ok) throw Error(result?.error || "No extension response");
      return result.data;
    }, message);
  const tabId = async () =>
    worker.evaluate(async () => {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      return tabs[0]?.id;
    });
  const draft = () =>
    worker.evaluate(async () => (await chrome.storage.local.get("draft")).draft);
  const toFixture = async () => {
    await page.bringToFront();
    await page.goto("https://example.com/review", { waitUntil: "load" });
    await page.getByRole("heading", { name: "Controlled page" }).waitFor();
  };
  const results = {};

  if (process.env.FEEDBACKS_QA_PUBLIC_CAPTURE === "1") {
    await page.setViewportSize({ width: 1920, height: 1064 });
    await page.bringToFront();
    await page.goto(publicCaptureUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(2500);
    const publicTab = await tabId();
    const full = await send({
      type: "popupAction",
      tabId: publicTab,
      action: "capture-full",
    });
    const captured = await draft();
    results.publicSite = {
      url: publicCaptureUrl,
      fullCaptured: full.captured,
      fullPages: captured?.capturePages?.length || 0,
      fullError: captured?.captureError,
    };
    assert.equal(
      results.publicSite.fullCaptured,
      true,
      JSON.stringify(results.publicSite),
    );
    assert.ok(results.publicSite.fullPages > 1);
    if (process.env.FEEDBACKS_QA_PUBLIC_SEND === "1") {
      const review = await context.newPage();
      await review.goto(`chrome-extension://${extensionId}/editor.html`);
      await review.locator("#page-select option").last().waitFor({ state: "attached" });
      await review.locator("#full-page-toggle:not([disabled])").waitFor();
      await review.getByRole("button", { name: "Full page preview" }).click();
      results.publicSite.previewHeight = (await previewDimensions(review)).height;
      assert.ok(results.publicSite.previewHeight > 1064);
      await review.getByRole("button", { name: "Back to sections" }).click();
      await review.locator("#include-combined").check();
      await review.locator("#body").fill("Synthetic local full-page upload QA.");
      await review.locator("#send").click();
      await review
        .locator("#completion:not([hidden]), #send:has-text('Retry Send')")
        .first()
        .waitFor({ timeout: 180000 });
      results.publicSite.sendStatus = await review.locator("#status").textContent();
      results.publicSite.uploadIndex = (await draft())?.uploadIndex;
      results.publicSite.frozen = (await draft())?.frozen;
      results.publicSite.sent = await review.locator("#completion").isVisible();
      if (results.publicSite.sent) {
        const threadUrl = await review.locator("#thread").getAttribute("href");
        const threadId = threadUrl?.match(/[0-9a-f-]{36}/)?.[0];
        if (!threadId) throw Error("Public capture QA lacks a thread link");
        const thread = (await post("threads.get", { threadId }, auth)).data;
        results.publicSite.assets = thread.assets.map(({ filename, width, height }) => ({
          filename,
          width,
          height,
        }));
      }
      console.log(JSON.stringify({ publicSite: results.publicSite }));
      assert.equal(results.publicSite.sent, true, results.publicSite.sendStatus);
      assert.equal(results.publicSite.assets.length, captured.capturePages.length + 1);
      const combined = results.publicSite.assets.at(-1);
      assert.equal(combined.filename, "full-page-combined.webp");
      assert.ok(combined.width * combined.height <= 40000000);
      assert.ok(combined.height <= 12000);
      await review.close();
    }
    await send({ type: "discard" });
    await page.bringToFront();
    const visible = await send({
      type: "popupAction",
      tabId: publicTab,
      action: "capture",
    });
    const visibleDraft = await draft();
    results.publicSite.visibleCaptured = visible.captured;
    results.publicSite.visibleImage = !!visibleDraft?.image;
    assert.equal(results.publicSite.visibleCaptured, true);
    assert.equal(results.publicSite.visibleImage, true);
    await send({ type: "discard" });
    await page.setViewportSize({ width: 900, height: 650 });
  }

  await toFixture();
  await mkdir(join(root, ".local/remaining-todos-qa"), { recursive: true });
  await control.reload();
  await control.locator("#review-controls:visible").waitFor();
  const fullCaptureButton = await control.locator("#capture").boundingBox();
  assert.ok(
    fullCaptureButton && fullCaptureButton.y + fullCaptureButton.height < 600,
    "Primary capture actions should fit without scrolling in a compact popup",
  );
  assert.equal(await control.locator(".access-status").getAttribute("open"), null);
  await control.screenshot({
    path: join(root, ".local/remaining-todos-qa/access-status.png"),
  });
  assert.equal(
    await control.locator("#capture-full").isVisible(),
    true,
    "Full page remains directly available beside video",
  );
  assert.equal(await control.locator("#record-video").isVisible(), true);
  const diagnosticsSummary = await control
    .locator(".diagnostic-controls summary")
    .boundingBox();
  assert.ok(
    diagnosticsSummary.y + diagnosticsSummary.height < 600,
    "Connected popup's collapsed controls should fit Chrome's popup height",
  );
  const optionsOpened = context.waitForEvent("page");
  await control.locator("#settings").click();
  const options = await optionsOpened;
  await options.waitForURL(`chrome-extension://${extensionId}/options.html`);
  await options.locator("#connection-status").filter({ hasText: "Connected" }).waitFor();
  assert.equal(await options.locator("#server").inputValue(), access.url);
  await options.locator("#review-shortcuts").uncheck();
  await options.locator("#message").filter({ hasText: "saved" }).waitFor();
  assert.equal((await send({ type: "settings" })).reviewShortcuts, false);
  await options.locator("#review-shortcuts").check();
  await page.bringToFront();
  const defaultsTabId = await tabId();
  const navigationDefault = options.locator('[data-review-default="navigationLocked"]');
  await navigationDefault.focus();
  await navigationDefault.press("Space");
  await options.locator("#message").filter({ hasText: "Defaults saved" }).waitFor();
  await options.waitForFunction(
    () =>
      document.activeElement ===
      document.querySelector('[data-review-default="navigationLocked"]'),
  );
  assert.equal((await send({ type: "settings" })).reviewDefaults.navigationLocked, false);
  await page.bringToFront();
  // A new default must not silently change a review already in progress.
  assert.equal(
    (await send({ type: "popupAction", tabId: defaultsTabId, action: "state" }))
      .navigationLocked,
    true,
  );
  await page.bringToFront();
  await send({ type: "popupAction", tabId: defaultsTabId, action: "stop" });
  await send({ type: "activate", tabId: defaultsTabId });
  assert.equal(
    (await send({ type: "popupAction", tabId: defaultsTabId, action: "state" }))
      .navigationLocked,
    false,
  );
  await navigationDefault.check();
  await options.locator("#message").filter({ hasText: "Defaults saved" }).waitFor();
  await options.waitForFunction(
    () => !document.querySelector('[data-review-default="navigationLocked"]').disabled,
  );
  await Promise.all([
    send({ type: "saveReviewPreferences", reviewDefaults: { showPins: false } }),
    send({ type: "saveReviewPreferences", reviewDefaults: { showResolved: true } }),
  ]);
  const savedDefaults = (await send({ type: "settings" })).reviewDefaults;
  assert.equal(savedDefaults.showPins, false);
  assert.equal(savedDefaults.showResolved, true);
  await send({
    type: "saveReviewPreferences",
    reviewDefaults: { showPins: true, showResolved: false },
  });
  await page.bringToFront();
  await send({ type: "popupAction", tabId: defaultsTabId, action: "stop" });
  await send({ type: "activate", tabId: defaultsTabId });
  assert.equal(
    (await send({ type: "popupAction", tabId: defaultsTabId, action: "state" }))
      .navigationLocked,
    true,
  );

  await send({
    type: "saveReviewPreferences",
    reviewDefaults: {
      navigationLocked: false,
      highlightEnabled: false,
      clickIndicators: false,
      recordingNavigationLocked: true,
      recordingHighlightEnabled: true,
      recordingClickIndicators: true,
    },
  });
  await page.bringToFront();
  await send({ type: "popupAction", tabId: defaultsTabId, action: "stop" });
  await send({ type: "activate", tabId: defaultsTabId });
  const recordingPreferenceState = async (state) => {
    await worker.evaluate(
      ({ tabId, state }) =>
        chrome.tabs.sendMessage(tabId, { type: "recordingState", state }),
      { tabId: defaultsTabId, state },
    );
    return send({ type: "popupAction", tabId: defaultsTabId, action: "state" });
  };
  // Opening the popup again must retain this review's recording defaults too.
  await send({
    type: "saveReviewPreferences",
    reviewDefaults: {
      recordingNavigationLocked: false,
      recordingHighlightEnabled: false,
    },
  });
  await send({ type: "activate", tabId: defaultsTabId });
  for (const state of ["recording", "paused"]) {
    const controls = await recordingPreferenceState(state);
    assert.equal(controls.navigationLocked, true);
    assert.equal(controls.highlightEnabled, true);
    assert.equal(controls.clickIndicators, true);
  }
  const restoredPreferences = await recordingPreferenceState("idle");
  assert.equal(restoredPreferences.navigationLocked, false);
  assert.equal(restoredPreferences.highlightEnabled, false);
  assert.equal(restoredPreferences.clickIndicators, false);
  await send({
    type: "saveReviewPreferences",
    reviewDefaults: {
      navigationLocked: true,
      highlightEnabled: true,
      clickIndicators: true,
      recordingNavigationLocked: false,
      recordingHighlightEnabled: false,
      recordingClickIndicators: true,
    },
  });
  await send({ type: "popupAction", tabId: defaultsTabId, action: "stop" });
  await send({ type: "activate", tabId: defaultsTabId });
  await options.reload();
  await options.locator("#connection-status").filter({ hasText: "Connected" }).waitFor();
  assert.equal(
    await options.locator('[data-review-default="navigationLocked"]').isChecked(),
    true,
  );
  await options.locator("#defaults").scrollIntoViewIfNeeded();
  await options.screenshot({
    path: join(root, ".local/remaining-todos-qa/review-defaults-desktop.png"),
  });
  await options.evaluate(() => scrollTo(0, 0));
  await options.screenshot({
    path: join(root, ".local/remaining-todos-qa/settings.png"),
    fullPage: true,
  });
  const shortcutsOpened = context.waitForEvent("page");
  await options.locator("#customize-shortcuts").click();
  const shortcuts = await shortcutsOpened;
  await shortcuts.waitForURL("chrome://extensions/shortcuts");
  await shortcuts.close();
  const accessOpened = context.waitForEvent("page");
  await options.locator("#manage-access").click();
  const permissions = await accessOpened;
  await permissions.waitForURL(`chrome://extensions/?id=${extensionId}`);
  await permissions.close();
  await options.setViewportSize({ width: 390, height: 844 });
  await options.evaluate(() => scrollTo(0, 0));
  assert.equal(
    await options.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
  await options.screenshot({
    path: join(root, ".local/remaining-todos-qa/settings-mobile.png"),
    fullPage: true,
  });
  await options.locator("#defaults").scrollIntoViewIfNeeded();
  await options.screenshot({
    path: join(root, ".local/remaining-todos-qa/review-defaults-mobile.png"),
  });
  await options.close();
  await page.bringToFront();
  const id = await tabId();
  const exposeReviewRoot = () =>
    worker.evaluate(async (tabId) => {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          window.addEventListener(
            "pointerdown",
            (event) => {
              if (event.button !== 2) return;
              const start = performance.now();
              requestAnimationFrame(() => {
                const root = globalThis.__feedbacksQaRoot;
                globalThis.__pointFirstPaint = {
                  elapsed: performance.now() - start,
                  visible:
                    !root.querySelector(".point-menu").classList.contains("hidden") &&
                    getComputedStyle(root.host).display !== "none",
                };
              });
            },
            { capture: true },
          );
          const attach = Element.prototype.attachShadow;
          Element.prototype.attachShadow = function (options) {
            const shadow = attach.call(this, options);
            if (this.id === "feedbacks-review-root")
              globalThis.__feedbacksQaRoot = shadow;
            else globalThis.__feedbacksInstantRoot = shadow;
            return shadow;
          };
        },
      });
    }, id);
  const inspectReview = () =>
    worker.evaluate(async (tabId) => {
      const [entry] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const root = globalThis.__feedbacksQaRoot;
          return {
            ready: !!root?.querySelector(".point-menu:not(.hidden)"),
            frozen: !!root?.querySelector(".freeze-frame:not(.hidden)"),
            points: root?.querySelectorAll(".draft-section li").length || 0,
            meta: root?.querySelector(".bar .meta")?.textContent || "",
            notice: root?.querySelector(".notice")?.textContent || "",
            tip: root?.querySelector(".point-tip")?.textContent || "",
          };
        },
      });
      return entry.result;
    }, id);
  const waitReview = async (predicate) => {
    for (let attempt = 0; attempt < 50; attempt++) {
      const state = await inspectReview();
      if (predicate(state)) return state;
      await page.waitForTimeout(100);
    }
    throw Error(
      `Review UI did not reach expected state: ${JSON.stringify(await inspectReview())}`,
    );
  };
  const saveInlinePoint = async (target, body) => {
    const before = (await inspectReview()).points;
    await target.click({ button: "right" });
    await waitReview((state) => state.ready);
    const result = await worker.evaluate(
      async ({ tabId, body }) => {
        const [entry] = await chrome.scripting.executeScript({
          target: { tabId },
          func: (body) => {
            const root = globalThis.__feedbacksQaRoot;
            const menu = root?.querySelector(".point-menu");
            const field = menu?.querySelector("textarea");
            const save = [...(menu?.querySelectorAll("button") || [])].find(
              (button) => button.textContent === "Save point",
            );
            if (!menu || menu.classList.contains("hidden") || !field || !save)
              return { ready: false };
            field.value = body;
            field.dispatchEvent(new Event("input", { bubbles: true }));
            save.click();
            return {
              ready: true,
              count: root.querySelectorAll(".saved-draft-pin").length,
            };
          },
          args: [body],
        });
        return entry.result;
      },
      { tabId: id, body },
    );
    assert.equal(result.ready, true, `Inline comment field did not open: ${body}`);
    return (await waitReview((state) => state.points === before + 1)).points;
  };
  results.qa = await send({ type: "popupAction", tabId: id, action: "qa-scan" });
  const qaDraft = await draft();
  results.qaDraft = {
    hasAltFinding: /alt/i.test(qaDraft?.body || ""),
    hasBrokenLink: /missing/i.test(qaDraft?.body || ""),
    hasImage: Boolean(qaDraft?.image),
  };
  await send({ type: "discard" });

  mode = "hover";
  await toFixture();
  await exposeReviewRoot();
  await send({ type: "activate", tabId: id });
  const sendFromReview = (message) =>
    worker.evaluate(
      async ({ tabId, message }) =>
        (
          await chrome.scripting.executeScript({
            target: { tabId },
            func: (message) => chrome.runtime.sendMessage(message),
            args: [message],
          })
        )[0].result,
      { tabId: id, message },
    );
  // Default navigation lock leaves menus usable but prevents leaving the page.
  await page.getByRole("link", { name: "Broken same-origin link" }).click();
  assert.equal(new URL(page.url()).pathname, "/review");
  const formBlocked = await page.evaluate(() => {
    const form = document.createElement("form");
    document.body.append(form);
    const event = new Event("submit", { bubbles: true, cancelable: true });
    form.dispatchEvent(event);
    form.remove();
    return event.defaultPrevented;
  });
  assert.equal(formBlocked, true);
  const unlocked = await send({ type: "popupAction", tabId: id, action: "navigation" });
  assert.equal(unlocked.navigationLocked, false);
  const defaultAllowed = await page
    .getByRole("link", { name: "Broken same-origin link" })
    .evaluate((link) => {
      const event = new MouseEvent("click", { bubbles: true, cancelable: true });
      let allowed;
      window.addEventListener(
        "click",
        (e) => {
          allowed = !e.defaultPrevented;
          e.preventDefault();
        },
        { once: true },
      );
      link.dispatchEvent(event);
      return allowed;
    });
  assert.equal(defaultAllowed, true);
  await send({ type: "popupAction", tabId: id, action: "navigation" });

  const dockResult = await worker.evaluate(async (tabId) => {
    const [entry] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const root = globalThis.__feedbacksQaRoot;
        const dock = root.querySelector(".review-dock");
        const grip = root.querySelector(".review-drag");
        const before = dock.getBoundingClientRect().left;
        grip.dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
        );
        const moved = dock.getBoundingClientRect().left < before;
        root.querySelector(".drawer-handle").click();
        const bounds = root.querySelector(".bar").getBoundingClientRect();
        const fits = bounds.top >= 0 && bounds.bottom <= innerHeight;
        [...root.querySelectorAll(".review-bar-heading button")]
          .find((b) => b.textContent === "Hide")
          .click();
        return {
          moved,
          visibleGrip: root.querySelectorAll(".drag-grip circle").length === 6,
          moveHint: root.querySelector(".drag-hint").textContent,
          fits,
          hidden: dock.hidden,
          label: root.querySelector(".drawer-handle").getAttribute("aria-label"),
        };
      },
    });
    return entry.result;
  }, id);
  assert.equal(dockResult.moved, true);
  assert.equal(dockResult.visibleGrip, true);
  assert.match(dockResult.moveHint, /Drag the dotted handle/);
  assert.equal(dockResult.fits, true);
  assert.equal(dockResult.hidden, true);
  assert.doesNotMatch(dockResult.label, /FeedbacksS/);
  await send({ type: "popupAction", tabId: id, action: "show-controls" });
  await worker.evaluate(async (tabId) => {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const root = globalThis.__feedbacksQaRoot;
        if (root.querySelector(".review-dock").hidden)
          throw Error("Dock did not restore");
        root.querySelector(".drawer-handle").click();
      },
    });
  }, id);
  await send({ type: "saveReviewPreferences", reviewShortcuts: false });
  const disabledWidth = await page.evaluate(() => innerWidth);
  await page.keyboard.press("t");
  assert.equal(await page.evaluate(() => innerWidth), disabledWidth);
  await send({ type: "saveReviewPreferences", reviewShortcuts: true });
  await page.locator("#hover-host").hover();
  const liveHover = await worker.evaluate(async (tabId) => {
    const [entry] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () =>
        !globalThis.__feedbacksQaRoot
          .querySelector(".hover-target")
          .classList.contains("hidden"),
    });
    return entry.result;
  }, id);
  assert.equal(
    liveHover,
    true,
    "Review should highlight a hovered element before selection",
  );
  const menuBounds = await page.locator("#hover-menu").boundingBox();
  await worker.evaluate(async (tabId) => {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const send = chrome.runtime.sendMessage.bind(chrome.runtime);
        chrome.runtime.sendMessage = async (message, ...rest) => {
          if (message.type === "freezeView")
            await new Promise((resolve) => setTimeout(resolve, 1200));
          return send(message, ...rest);
        };
      },
    });
  }, id);
  await page.locator("#hover-menu").evaluate((menu) => {
    // A transitioning menu must retain its selected visual state during capture.
    menu.style.transition = "opacity .2s ease, transform .2s ease";
    window.qaMenuMotion = menu.animate(
      [{ transform: "translateY(0px)" }, { transform: "translateY(16px)" }],
      { duration: 1300, iterations: Infinity, direction: "alternate" },
    );
  });
  await page.mouse.click(menuBounds.x + 20, menuBounds.y + 20, { button: "right" });
  await waitReview((state) => state.ready);
  const firstPaint = await worker.evaluate(
    async (tabId) =>
      (
        await chrome.scripting.executeScript({
          target: { tabId },
          func: async () => {
            // The menu is synchronous; its first-paint probe runs next frame.
            // Fast workers can read the visible menu before that frame occurs.
            if (!globalThis.__pointFirstPaint) await new Promise(requestAnimationFrame);
            return globalThis.__pointFirstPaint;
          },
        })
      )[0].result,
    id,
  );
  assert.equal(
    firstPaint.visible,
    true,
    "Comment field must paint before a delayed original capture finishes",
  );
  await page.mouse.move(700, 500);
  await page.keyboard.type("t");
  await waitReview((state) => state.frozen);
  assert.equal(
    (await inspectReview()).frozen,
    true,
    "Capture a menu during its entrance animation",
  );
  await page.evaluate(() => {
    window.qaMenuMotion.cancel();
    document.body.dispatchEvent(new Event("scroll"));
    const video = document.createElement("video");
    document.body.append(video);
    video.dispatchEvent(new Event("resize"));
    video.remove();
  });
  assert.equal(
    (await inspectReview()).ready,
    true,
    "Nested scroll and video resize must not close the comment editor",
  );
  await page.mouse.move(700, 500);
  assert.equal(await page.locator("#hover-menu").isVisible(), false);
  assert.equal(
    (await inspectReview()).frozen,
    true,
    "The selected hover state should stay visible while writing the point",
  );
  const typingWidth = await page.evaluate(() => innerWidth);
  await page.keyboard.type("Keep this menu visible for review");
  assert.equal(
    await page.evaluate(() => innerWidth),
    typingWidth,
    "Typing t in a comment must not switch to tablet size",
  );
  await worker.evaluate(async (tabId) => {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const menu = globalThis.__feedbacksQaRoot.querySelector(".point-menu");
        [...menu.querySelectorAll("button")]
          .find((button) => button.textContent === "Save point")
          .click();
      },
    });
  }, id);
  await waitReview((state) => state.points === 1);
  // Escape exits review without discarding saved points; opening again restores them.
  await page.keyboard.press("Escape");
  await page.locator("#feedbacks-review-root").waitFor({ state: "detached" });
  await send({ type: "activate", tabId: id });
  await waitReview((state) => state.points === 1);
  results.escapePreservesDraft = true;
  // The menu closed: its pin must not float over unrelated page content.
  await page.waitForTimeout(200);
  const hiddenDraft = await worker.evaluate(async (tabId) => {
    const [entry] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const root = globalThis.__feedbacksQaRoot;
        const result = {
          pins: root.querySelectorAll(".saved-draft-pin").length,
          handle: root.querySelector(".drawer-handle").getAttribute("aria-label"),
        };
        root.querySelector(".drawer-handle").click();
        const row = root.querySelector(".draft-section li");
        [...row.querySelectorAll("button")]
          .find((button) => button.textContent === "Edit")
          .click();
        return {
          ...result,
          editing: !!row.querySelector("textarea"),
          visible: !!row.querySelector("textarea")?.getBoundingClientRect().width,
        };
      },
    });
    return entry.result;
  }, id);
  assert.equal(hiddenDraft.pins, 0);
  assert.match(hiddenDraft.handle, /1 outside this view/);
  assert.equal(hiddenDraft.editing, true);
  assert.equal(
    hiddenDraft.visible,
    true,
    "Draft editor must actually be visible, not just exist in hidden DOM",
  );
  await worker.evaluate(async (tabId) => {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const root = globalThis.__feedbacksQaRoot;
        const row = root.querySelector(".draft-section li");
        row.querySelector("textarea").value = "Edited before screenshot";
        [...row.querySelectorAll("button")]
          .find((button) => button.textContent === "Save")
          .click();
      },
    });
  }, id);
  assert.match((await inspectReview()).meta, /not sent/i);
  assert.equal((await inspectReview()).points, 1);
  assert.equal(
    (await inspectReview()).frozen,
    false,
    "The frozen view should clear after saving",
  );
  results.hoverPoint = {
    saved: true,
    frozenWhileWriting: true,
    liveHover,
    draftPinEdited: true,
    typingWidth,
  };
  await send({ type: "popupAction", tabId: id, action: "stop" });
  await send({ type: "activate", tabId: id });
  await waitReview((state) => state.points === 1);
  results.hoverPoint.restoredAfterReviewToggle = true;
  // Preserve the selected menu's original pixels even when a later visible
  // screenshot contains only the closed page.
  await send({ type: "popupAction", tabId: id, action: "capture" });
  const menuDraft = await draft();
  assert.equal(menuDraft.capturePages.length, 2);
  assert.equal(menuDraft.capturePages[1].pointNumber, 1);
  assert.equal(
    menuDraft.pageToolStates[0].filter((shape) => shape.tool === "point").length,
    0,
  );
  assert.equal(
    menuDraft.pageToolStates[1].filter((shape) => shape.tool === "point").length,
    1,
  );
  const originalMenu = await send({ type: "capturePage", id: menuDraft.id, index: 1 });
  const menuPixel = await sharp(Buffer.from(originalMenu.image.split(",")[1], "base64"))
    .extract({
      left: Math.round(menuBounds.x + 8),
      top: Math.round(menuBounds.y + 8),
      width: 1,
      height: 1,
    })
    .raw()
    .toBuffer();
  assert.ok(
    menuPixel[2] > menuPixel[0],
    "Original hover menu background should survive closure",
  );
  results.hoverPoint.originalImageRetained = true;
  await send({ type: "discard" });
  await page.bringToFront();
  await send({ type: "popupAction", tabId: id, action: "stop" });
  mode = "hover";
  await toFixture();
  await exposeReviewRoot();
  // Canceled captures must never restore UI over a newer point's pixels.
  await send({ type: "activate", tabId: id });
  await worker.evaluate(async (tabId) => {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const send = chrome.runtime.sendMessage.bind(chrome.runtime);
        chrome.runtime.sendMessage = async (message, ...rest) => {
          if (message.type !== "freezeView") return send(message, ...rest);
          globalThis.__captureToken = message.key;
          await new Promise((resolve) => setTimeout(resolve, 1200));
          return { ok: false, error: "Synthetic capture failure" };
        };
      },
    });
  }, id);
  const selectedToken = () =>
    worker.evaluate(
      async (tabId) =>
        (
          await chrome.scripting.executeScript({
            target: { tabId },
            func: () => globalThis.__captureToken,
          })
        )[0].result,
      id,
    );
  const cancelPoint = () =>
    worker.evaluate(async (tabId) => {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          [...globalThis.__feedbacksQaRoot.querySelectorAll(".point-menu button")]
            .find((b) => b.textContent === "Cancel")
            .click();
        },
      });
    }, id);
  await page.getByRole("heading", { name: "Controlled page" }).click({ button: "right" });
  await waitReview((state) => state.ready);
  await page.waitForTimeout(50);
  const oldToken = await selectedToken();
  await worker.evaluate(
    async ({ id, token }) =>
      chrome.tabs.sendMessage(id, { type: "preparePointImage", pointToken: token }),
    { id, token: oldToken },
  );
  await cancelPoint();
  await page.getByRole("heading", { name: "Controlled page" }).click({ button: "right" });
  await waitReview((state) => state.ready);
  await page.waitForTimeout(50);
  const currentToken = await selectedToken();
  assert.notEqual(oldToken, currentToken);
  const retainedHidden = await worker.evaluate(
    async ({ id, oldToken, currentToken }) => {
      await chrome.tabs.sendMessage(id, {
        type: "preparePointImage",
        pointToken: currentToken,
      });
      await chrome.tabs.sendMessage(id, {
        type: "pointImageCaptured",
        pointToken: oldToken,
      });
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: id },
        func: () => globalThis.__feedbacksQaRoot.host.style.opacity,
      });
      await chrome.tabs.sendMessage(id, {
        type: "pointImageCaptured",
        pointToken: currentToken,
      });
      return result;
    },
    { id, oldToken, currentToken },
  );
  assert.equal(retainedHidden, "0");
  await page.keyboard.type("Keep my comment after image failure");
  await waitReview((state) => state.tip.includes("Synthetic capture failure"));
  await worker.evaluate(async (tabId) => {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        [...globalThis.__feedbacksQaRoot.querySelectorAll(".point-menu button")]
          .find((b) => b.textContent === "Save point")
          .click();
      },
    });
  }, id);
  await waitReview((state) => state.points === 1);
  const failedDraft = await worker.evaluate(
    async (tabId) =>
      (
        await chrome.scripting.executeScript({
          target: { tabId },
          func: () =>
            globalThis.__feedbacksQaRoot.querySelector(".draft-section").textContent,
        })
      )[0].result,
    id,
  );
  assert.match(failedDraft, /Keep my comment after image failure/);
  assert.match(failedDraft, /No original image/);
  results.captureFailure = { textRetained: true, canceledCaptureCannotRevealNewUI: true };
  await send({ type: "popupAction", tabId: id, action: "stop" });
  await toFixture();
  await exposeReviewRoot();
  await send({ type: "enableInstant", tabId: id });
  await page.locator("#hover-host").hover();
  await page.locator("#hover-menu").click({ button: "right" });
  const autoStarted = await worker.evaluate(async (tabId) => {
    const [entry] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () =>
        Boolean(globalThis.feedbacksReviewActive || globalThis.__feedbacksInstantRoot),
    });
    return entry.result;
  }, id);
  assert.equal(
    autoStarted,
    false,
    "All-site access must not start review on right-click",
  );
  results.allSitePregrant = { autoStarted };
  await send({ type: "disableInstant" });
  mode = "long";
  await toFixture();
  await exposeReviewRoot();
  await send({ type: "activate", tabId: id });
  await page.getByRole("heading", { name: "Controlled page" }).click({ button: "right" });
  await waitReview((state) => state.ready);
  await page.screenshot({
    path: join(root, ".local/remaining-todos-qa/inline-comment-desktop.png"),
  });
  await worker.evaluate(async (tabId) => {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const menu = globalThis.__feedbacksQaRoot.querySelector(".point-menu");
        menu.querySelector("textarea").value = "Make this heading shorter";
        [...menu.querySelectorAll("button")]
          .find((button) => button.textContent === "Save point")
          .click();
      },
    });
  }, id);
  await waitReview((state) => state.points === 1);
  const pinLocation = () =>
    worker.evaluate(async (tabId) => {
      const [entry] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const root = globalThis.__feedbacksQaRoot;
          const pin = root.querySelector(".saved-draft-pin");
          if (!pin) return null;
          const r = pin.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        },
      });
      return entry.result;
    }, id);
  const desktopPoint = await pinLocation();
  await page.mouse.move(desktopPoint.x, desktopPoint.y);
  await page.waitForTimeout(200);
  const hoverState = await worker.evaluate(async (tabId) => {
    const [entry] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const preview = globalThis.__feedbacksQaRoot.querySelector(".draft-preview");
        return {
          text: preview?.textContent,
          visible: !!preview?.getBoundingClientRect().width,
        };
      },
    });
    return entry.result;
  }, id);
  assert.equal(hoverState.visible, true);
  assert.match(hoverState.text, /Draft, not sent/);
  assert.match(hoverState.text, /Edit point/);
  await page.screenshot({
    path: join(root, ".local/remaining-todos-qa/draft-pin-popover.png"),
  });
  await page.setViewportSize({ width: 390, height: 650 });
  await page.waitForTimeout(300);
  const mobilePoint = await pinLocation();
  assert.ok(
    mobilePoint.x < desktopPoint.x,
    "Point should follow the heading after responsive reflow",
  );
  assert.ok(mobilePoint.x < 390);
  await page.setViewportSize({ width: 900, height: 650 });
  await page.waitForTimeout(200);
  // Bare T works away from fields; T inside a website input must not resize.
  await page.evaluate(() => {
    const input = document.createElement("input");
    input.id = "typing-fixture";
    document.body.append(input);
    input.focus({ preventScroll: true });
  });
  await page.keyboard.type("mtdwspr");
  assert.equal(await page.evaluate(() => innerWidth), 900);
  assert.equal(await page.locator("#typing-fixture").inputValue(), "mtdwspr");
  await page.evaluate(() => document.querySelector("#typing-fixture").remove());
  await page.keyboard.press("r");
  await page.locator("#feedbacks-review-root").waitFor({ state: "detached" });
  await page.keyboard.press("t");
  assert.equal(await page.evaluate(() => innerWidth), 900);
  await send({ type: "activate", tabId: id });
  await waitReview((state) => state.points === 1);
  results.responsiveDraft = {
    desktopPoint,
    mobilePoint,
    hoverPopover: true,
    websiteTypingSafe: true,
    stopKey: true,
  };
  assert.equal(
    await saveInlinePoint(
      page.getByRole("link", { name: "Broken same-origin link" }),
      "Repair this link",
    ),
    2,
  );
  assert.equal(await draft(), undefined, "The editor must not open after each point");
  const inlineCapture = await send({ type: "popupAction", tabId: id, action: "capture" });
  const inlineDraft = await draft();
  assert.equal(inlineCapture.captured, true);
  assert.deepEqual(
    inlineDraft.context.annotations.map(({ body }) => body),
    ["Make this heading shorter", "Repair this link"],
  );
  assert.notEqual(
    inlineDraft.context.annotations[0].anchor.selector,
    inlineDraft.context.annotations[1].anchor.selector,
  );
  for (const candidate of context
    .pages()
    .filter((candidate) =>
      candidate.url().startsWith(`chrome-extension://${extensionId}/editor.html`),
    ))
    await candidate.close();
  const inlineEditor = await context.newPage();
  await inlineEditor.goto(`chrome-extension://${extensionId}/editor.html`);
  await inlineEditor.locator("#point-notes textarea").first().waitFor();
  assert.deepEqual(
    await inlineEditor
      .locator("#point-notes textarea")
      .evaluateAll((nodes) => nodes.map((node) => node.value)),
    ["Make this heading shorter", "Repair this link"],
  );
  await inlineEditor
    .locator("#point-notes textarea")
    .first()
    .fill("Make this heading **clearer**");
  await inlineEditor.waitForFunction(
    async () =>
      (await chrome.storage.local.get("draft")).draft?.context.annotations?.[0]?.body ===
      "Make this heading **clearer**",
  );
  await inlineEditor.waitForTimeout(600);
  assert.equal(
    (await draft()).context.annotations[0].body,
    "Make this heading **clearer**",
  );
  await inlineEditor.reload();
  await inlineEditor.waitForFunction(() => {
    const canvas = document.getElementById("canvas");
    return canvas?.width > 0 && !document.getElementById("send")?.disabled;
  });
  assert.equal(
    await inlineEditor.locator("#point-notes textarea").first().inputValue(),
    "Make this heading **clearer**",
  );
  assert.equal(await inlineEditor.locator("#body").inputValue(), "");
  await inlineEditor.locator('[data-tool="arrow"]').click();
  await inlineEditor.locator("#canvas").scrollIntoViewIfNeeded();
  const arrowCanvas = await inlineEditor.locator("#canvas").boundingBox();
  assert.ok(arrowCanvas);
  await inlineEditor.mouse.move(
    arrowCanvas.x + arrowCanvas.width * 0.2,
    arrowCanvas.y + arrowCanvas.height * 0.3,
  );
  await inlineEditor.mouse.down();
  await inlineEditor.mouse.move(
    arrowCanvas.x + arrowCanvas.width * 0.4,
    arrowCanvas.y + arrowCanvas.height * 0.4,
  );
  await inlineEditor.mouse.up();
  await inlineEditor.locator('[data-tool="pencil"]').click();
  await inlineEditor.locator("#canvas").scrollIntoViewIfNeeded();
  const pencilCanvas = await inlineEditor.locator("#canvas").boundingBox();
  assert.ok(pencilCanvas);
  await inlineEditor.mouse.move(
    pencilCanvas.x + pencilCanvas.width * 0.5,
    pencilCanvas.y + pencilCanvas.height * 0.5,
  );
  await inlineEditor.mouse.down();
  await inlineEditor.mouse.move(
    pencilCanvas.x + pencilCanvas.width * 0.6,
    pencilCanvas.y + pencilCanvas.height * 0.6,
    { steps: 4 },
  );
  await inlineEditor.mouse.up();
  await inlineEditor.waitForTimeout(500);
  assert.ok(
    (await draft()).toolState.some((mark) => mark.tool === "arrow"),
    `Arrow annotation was not saved: ${JSON.stringify((await draft()).toolState.map((mark) => mark.tool))}`,
  );
  await inlineEditor.locator("#send-header").click();
  await inlineEditor.getByText("Feedback sent").waitFor({ timeout: 120000 });
  const inlineThreadUrl = await inlineEditor.locator("#thread").getAttribute("href");
  const inlineThreadId = inlineThreadUrl?.match(/[0-9a-f-]{36}/)?.[0];
  assert.ok(inlineThreadId);
  const inlineThread = (await post("threads.get", { threadId: inlineThreadId }, auth))
    .data;
  assert.deepEqual(
    inlineThread.context.annotations.map(({ body }) => body),
    ["Make this heading **clearer**", "Repair this link"],
  );
  assert.equal(inlineThread.context.annotations[0].anchor.tagName, "h1");
  assert.ok(inlineThread.context.annotations[0].anchor.rect.width > 0);
  assert.equal(
    typeof inlineThread.context.annotations[0].anchor.styles.borderStyle,
    "string",
  );
  assert.equal(inlineThread.assets.length, 3);
  assert.deepEqual(
    inlineThread.assets[0].markings
      .filter((mark) => mark.tool === "point")
      .map((mark) => mark.annotationId),
    inlineThread.context.annotations.map((item) => item.id),
  );
  assert.ok(inlineThread.assets[0].markings.some((mark) => mark.tool === "arrow"));
  assert.ok(inlineThread.assets[0].markings.some((mark) => mark.tool === "pencil"));
  assert.deepEqual(
    inlineThread.assets[0].markings
      .filter((mark) => mark.origin === "element")
      .map((mark) => mark.annotationId),
    inlineThread.context.annotations.map((item) => item.id),
  );
  assert.equal(inlineThread.assets[0].captureRegion.pageWidth, 900);
  results.inlineReview = {
    points: inlineThread.context.annotations.length,
    selectorsDistinct: true,
    screenshotSent: true,
    overallNoteOptional: true,
    markings: inlineThread.assets[0].markings.map((mark) => mark.tool),
  };
  await inlineEditor.close();
  await page.bringToFront();
  assert.match((await inspectReview()).notice, /Feedback sent/i);
  await send({ type: "activate", tabId: id });
  const hoverComments = ["Make this heading **clearer**", "Repair this link"];
  const inspectPin = (body) =>
    worker.evaluate(
      async ({ tabId, body }) => {
        const [result] = await chrome.scripting.executeScript({
          target: { tabId },
          func: (body) => {
            const root = globalThis.__feedbacksQaRoot;
            const pin = [...(root?.querySelectorAll("button.pin") || [])].find((item) =>
              item.getAttribute("aria-label")?.includes(body),
            );
            if (!pin) return null;
            const rect = pin.getBoundingClientRect();
            return {
              x: rect.x + rect.width / 2,
              y: rect.y + rect.height / 2,
              preview: root.querySelector(".preview")?.textContent,
              link: root.querySelector(".preview a")?.getAttribute("href"),
              resolve: !!root.querySelector(".preview button.resolve-thread"),
              visible: getComputedStyle(pin).visibility !== "hidden",
            };
          },
          args: [body],
        });
        return result.result;
      },
      { tabId: id, body },
    );
  for (const comment of hoverComments) {
    let point;
    for (let attempt = 0; attempt < 30; attempt++) {
      point = await inspectPin(comment);
      if (point) break;
      await page.waitForTimeout(200);
    }
    assert.ok(point, `Saved point is not visible on its element: ${comment}`);
    await page.mouse.move(point.x, point.y);
    const hovered = await inspectPin(comment);
    assert.ok(hovered?.preview?.includes(comment));
    assert.match(hovered.preview, /just now|ago/);
    assert.equal(hovered.link, `${access.url}/threads/${inlineThreadId}`);
    assert.equal(hovered.resolve, true);
  }
  const firstPoint = await inspectPin(hoverComments[0]);
  await page.evaluate(({ x, y }) => {
    const menu = document.createElement("div");
    menu.id = "qa-covering-menu";
    menu.style.cssText = `position:fixed;left:${x - 40}px;top:${y - 40}px;width:80px;height:80px;background:white;z-index:1000`;
    document.body.append(menu);
  }, firstPoint);
  await page.mouse.move(firstPoint.x + 1, firstPoint.y + 1);
  // MutationObserver and the paint/occlusion frames may span more than 50 ms
  // on a busy CI browser. Wait for the actual state, not one assumed frame.
  for (let attempt = 0; attempt < 20; attempt++) {
    if ((await inspectPin(hoverComments[0]))?.visible === false) break;
    await page.waitForTimeout(50);
  }
  assert.equal((await inspectPin(hoverComments[0]))?.visible, false);
  await page.locator("#qa-covering-menu").evaluate((menu) => menu.remove());
  await page.mouse.move(firstPoint.x + 2, firstPoint.y + 2);
  for (let attempt = 0; attempt < 20; attempt++) {
    if ((await inspectPin(hoverComments[0]))?.visible === true) break;
    await page.waitForTimeout(50);
  }
  assert.equal((await inspectPin(hoverComments[0]))?.visible, true);
  await page.mouse.move(800, 400);
  await page.waitForTimeout(200);
  await page.mouse.move(firstPoint.x, firstPoint.y);
  for (let attempt = 0; attempt < 20; attempt++) {
    if ((await inspectPin(hoverComments[0]))?.resolve) break;
    await page.waitForTimeout(50);
  }
  await page.screenshot({
    path: join(root, ".local/remaining-todos-qa/inline-comment-hover.png"),
  });
  const resolveClick = await worker.evaluate(async (tabId) => {
    const [entry] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const control = globalThis.__feedbacksQaRoot.querySelector(
          ".preview button.resolve-thread",
        );
        const before = {
          found: !!control,
          disabled: control?.disabled,
          action: typeof control?.onclick,
        };
        control?.click();
        return before;
      },
    });
    return entry.result;
  }, id);
  assert.equal(resolveClick.found, true);
  assert.equal(resolveClick.disabled, false);
  for (let attempt = 0; attempt < 30; attempt++) {
    const current = (await post("threads.get", { threadId: inlineThreadId }, auth)).data;
    if (
      current.annotationStates?.[inlineThread.context.annotations[0].id]?.state ===
      "resolved"
    )
      break;
    await page.waitForTimeout(100);
  }
  assert.equal(
    (await post("threads.get", { threadId: inlineThreadId }, auth)).data.annotationStates[
      inlineThread.context.annotations[0].id
    ].state,
    "resolved",
  );
  assert.equal(
    (await post("threads.get", { threadId: inlineThreadId }, auth)).data.work.state,
    "open",
    "Resolving one pin must leave the thread and other points open",
  );
  const overview = await send({ type: "pageOverview", tabId: id, scope: "page" });
  assert.ok(overview.summary.points.resolved >= 1);
  assert.equal(new URL(overview.url).searchParams.get("url"), page.url());
  assert.equal(new URL(overview.url).pathname, `/projects/${inlineThread.projectId}`);
  const teammate = (
    await post(
      "members.create",
      {
        name: "Team reviewer",
        email: "reviewer@example.test",
        password: "Synthetic-Reviewer-Pass-123",
        grants: [{ projectId: inlineThread.projectId, role: "reviewer" }],
      },
      auth,
    )
  ).data;
  assert.ok(teammate.id);
  const teammateLogin = await post("auth.login", {
    email: "reviewer@example.test",
    password: "Synthetic-Reviewer-Pass-123",
  });
  const teammateAuth = {
    cookie: teammateLogin.cookie,
    csrf: teammateLogin.data.csrf,
  };
  const teammatePairing = (await post("pairing.request", { name: "Team browser" })).data;
  await post("pairing.approve", { pairingId: teammatePairing.pairingId }, teammateAuth);
  const teammateToken = (
    await post("pairing.poll", {
      pairingId: teammatePairing.pairingId,
      deviceSecret: teammatePairing.deviceSecret,
    })
  ).data.token;
  await send({ type: "popupAction", tabId: id, action: "stop" });
  await worker.evaluate(
    ({ server, token }) =>
      chrome.storage.local.set({
        accounts: { [server]: { token } },
      }),
    { server: access.url, token: teammateToken },
  );
  await send({ type: "activate", tabId: id });
  await send({ type: "popupAction", tabId: id, action: "resolved" });
  let teammatePin;
  for (let attempt = 0; attempt < 30; attempt++) {
    teammatePin = await inspectPin(hoverComments[0]);
    if (teammatePin?.visible) break;
    await page.waitForTimeout(100);
  }
  assert.ok(teammatePin?.visible, "A teammate should see the published point");
  await page.mouse.move(teammatePin.x, teammatePin.y);
  assert.equal((await inspectPin(hoverComments[0])).resolve, false);
  assert.equal(
    (await inspectPin(hoverComments[0])).link,
    `${access.url}/threads/${inlineThreadId}`,
  );
  results.inlineReview.teammateCanRead = true;
  await page.setViewportSize({ width: 390, height: 650 });
  await page.waitForTimeout(200);
  const publishedMobile = await inspectPin(hoverComments[0]);
  assert.ok(
    publishedMobile?.visible,
    "A uniquely matched shared pin follows its element across screen sizes",
  );
  assert.ok(publishedMobile.x < 390);
  results.inlineReview.sharedResponsive = true;
  await page.setViewportSize({ width: 900, height: 650 });
  await send({ type: "popupAction", tabId: id, action: "stop" });
  await worker.evaluate(
    ({ server, token }) =>
      chrome.storage.local.set({
        accounts: { [server]: { token } },
      }),
    { server: access.url, token: paired.token },
  );
  results.inlineReview.hoverComments = hoverComments;

  mode = "long";
  await toFixture();
  await exposeReviewRoot();
  await send({ type: "activate", tabId: id });
  assert.equal(
    await saveInlinePoint(
      page.getByRole("heading", { name: "Controlled page" }),
      "Top point",
    ),
    1,
  );
  await page.locator("#lower").scrollIntoViewIfNeeded();
  assert.equal(await saveInlinePoint(page.locator("#lower"), "Bottom point"), 2);
  // Finalize from the collapsed dock, using only already saved originals.
  await mkdir(join(root, ".local/finalize-qa"), { recursive: true });
  await page.screenshot({ path: join(root, ".local/finalize-qa/pending-points.png") });
  const finalizeState = await worker.evaluate(async (tabId) => {
    const [entry] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const button = globalThis.__feedbacksQaRoot.querySelector(".finalize-review");
        return { visible: !!button && !button.hidden, label: button?.textContent };
      },
    });
    return entry.result;
  }, id);
  assert.equal(finalizeState.visible, true, "Pending pins need a visible dock action");
  assert.match(finalizeState.label, /2 unsent/);
  await worker.evaluate(() => {
    globalThis.qaNativeCapture = chrome.tabs.captureVisibleTab;
    chrome.tabs.captureVisibleTab = () => {
      throw Error("Finalize must not capture");
    };
  });
  // An old completed/empty editor must not swallow a new review.
  const staleEditor = await context.newPage();
  await staleEditor.goto(`chrome-extension://${extensionId}/editor.html`);
  await page.bringToFront();
  const freshEditor = context.waitForEvent("page");
  await worker.evaluate(async (tabId) => {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        globalThis.__feedbacksQaRoot.querySelector(".finalize-review").click();
      },
    });
  }, id);
  await worker.evaluate(async () => {
    for (let i = 0; i < 100; i++) {
      const { draft } = await chrome.storage.local.get("draft");
      if (draft?.capturePages?.length === 2 && !draft.captureError) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw Error("Finalizing saved points did not prepare the draft");
  });
  await worker.evaluate(() => {
    chrome.tabs.captureVisibleTab = globalThis.qaNativeCapture;
  });
  const multiVisible = await draft();
  assert.equal(multiVisible.captureScope, "points");
  assert.equal(multiVisible.capturePages.length, 2);
  assert.deepEqual(
    multiVisible.capturePages.map((item) => item.pointNumber),
    [1, 2],
  );
  for (let i = 0; i < 2; i++)
    assert.ok(
      multiVisible.pageToolStates[i].some(
        (shape) => shape.tool === "point" && shape.number === i + 1,
      ),
    );
  assert.equal(multiVisible.captureError, null);
  results.inlineReview.finalizeWithoutCapture = true;
  assert.equal(multiVisible.context.pointEvidence, undefined);
  assert.equal(multiVisible.context.liveAnnotations, undefined);
  results.inlineReview.offscreenOriginalRetained = true;
  const pointsEditor = await freshEditor;
  await pointsEditor.waitForURL(
    `chrome-extension://${extensionId}/editor.html?draft=${multiVisible.id}`,
  );
  assert.notEqual(pointsEditor, staleEditor);
  await pointsEditor.locator("#send-header:not([disabled])").waitFor();
  await page.bringToFront();
  await send({ type: "resume" });
  const resumedEditors = await worker.evaluate(async (url) => {
    const editors = await chrome.runtime.getContexts({
      contextTypes: ["TAB"],
      documentUrls: [url],
    });
    return Promise.all(editors.map((editor) => chrome.tabs.get(editor.tabId)));
  }, pointsEditor.url());
  assert.equal(resumedEditors.length, 1, "Resume must reuse the matching editor");
  assert.equal(resumedEditors[0].active, true);
  await staleEditor.close();
  assert.equal(await pointsEditor.locator("#point-notes textarea").count(), 2);
  await pointsEditor.locator("#send-header").click();
  await pointsEditor.locator("#thread:not([hidden])").waitFor();
  const pointsThreadId = (await pointsEditor.locator("#thread").getAttribute("href"))
    .split("/")
    .at(-1);
  const pointsThread = (await post("threads.get", { threadId: pointsThreadId }, auth))
    .data;
  assert.equal(pointsThread.assets.length, 2, "Only the two originals should upload");
  assert.equal(pointsThread.context.annotations.length, 2);
  assert.equal(await draft(), undefined);
  await pointsEditor.close();
  await page.bringToFront();
  // New editor tabs change the native capture area in headless Chromium.
  await page.setViewportSize({ width: 900, height: 563 });
  await page.evaluate(() => scrollTo(0, 0));
  await saveInlinePoint(
    page.getByRole("heading", { name: "Controlled page" }),
    "Top point",
  );
  await page.locator("#lower").scrollIntoViewIfNeeded();
  await saveInlinePoint(page.locator("#lower"), "Bottom point");
  await page.bringToFront();
  await worker.evaluate((tabId) => chrome.tabs.update(tabId, { active: true }), id);
  const multiScroll = await send({
    type: "popupAction",
    tabId: id,
    action: "capture-full",
  });
  const multiScrollDraft = await draft();
  assert.equal(multiScroll.captured, true, JSON.stringify(multiScroll));
  assert.equal(multiScrollDraft.captureScope, "fullPage");
  assert.equal(multiScrollDraft.context.annotations.length, 2);
  const markedPages = multiScrollDraft.pageToolStates.flatMap((states, pageIndex) =>
    states.map((shape) => [pageIndex, shape.number]),
  );
  assert.ok(markedPages.some(([, number]) => number === 1));
  assert.ok(markedPages.some(([, number]) => number === 2));
  assert.notEqual(
    markedPages.find(([, number]) => number === 1)[0],
    markedPages.find(([, number]) => number === 2)[0],
  );
  results.inlineReview.multiScrollPages = markedPages;
  const multiEditor = await context.newPage();
  await multiEditor.goto(`chrome-extension://${extensionId}/editor.html`);
  await multiEditor.locator("#full-page-toggle:not([disabled])").waitFor();
  const editorViewport = multiEditor.viewportSize();
  for (const width of [1280, 390, 320]) {
    await multiEditor.setViewportSize({ width, height: 800 });
    await multiEditor.evaluate(() => scrollTo(0, document.body.scrollHeight));
    const headerState = await multiEditor.evaluate(() => {
      const button = document.getElementById("send-header");
      const rect = button.getBoundingClientRect();
      return {
        visible: rect.top >= 0 && rect.bottom <= innerHeight && rect.right <= innerWidth,
        reachable: button.contains(
          document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2),
        ),
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    assert.deepEqual(headerState, { visible: true, reachable: true, overflow: false });
    const pointHeading = multiEditor.locator(".point-note-heading").first();
    await pointHeading.scrollIntoViewIfNeeded();
    const label = await pointHeading.locator("label").boundingBox();
    const original = await pointHeading.locator("button").boundingBox();
    assert.ok(
      original.x >= label.x + label.width + 11 ||
        original.y >= label.y + label.height + 7,
      "Point label and original-image action need a visible gap, including when wrapped",
    );
    if (width !== 320)
      await multiEditor.screenshot({
        path: join(root, `.local/remaining-todos-qa/editor-actions-${width}.png`),
      });
  }
  await multiEditor.setViewportSize(editorViewport);
  await multiEditor.evaluate(() => scrollTo(0, 0));

  await multiEditor.getByRole("button", { name: "Full page preview" }).click();
  await previewDimensions(multiEditor);
  const continuousHeight = multiScrollDraft.capturePages
    .filter((item) => !item.annotationId)
    .reduce((sum, item) => sum + item.pixelHeight, 0);
  assert.equal((await previewDimensions(multiEditor)).height, continuousHeight);
  results.inlineReview.combinedExcludesOriginals = true;
  await multiEditor.close();
  await send({ type: "discard" });

  await page.setViewportSize({ width: 390, height: 844 });
  await toFixture();
  await exposeReviewRoot();
  await send({ type: "activate", tabId: id });
  await page.getByRole("heading", { name: "Controlled page" }).click({ button: "right" });
  await waitReview((state) => state.ready);
  await page.screenshot({
    path: join(root, ".local/remaining-todos-qa/inline-comment-mobile.png"),
  });
  await page.keyboard.press("Escape");
  assert.equal((await inspectReview()).ready, false);
  assert.equal(await page.locator("#feedbacks-review-root").count(), 1);
  await page.keyboard.press("Escape");
  await page.locator("#feedbacks-review-root").waitFor({ state: "detached" });
  results.escapeClosesEditorBeforeExit = true;
  await page.setViewportSize({ width: 900, height: 650 });

  for (const scope of ["short", "long", "tall", "tooLong", "clipped"]) {
    mode = scope;
    if (["tall", "tooLong"].includes(scope))
      await page.setViewportSize({ width: 1200, height: 800 });
    await toFixture();
    if (scope === "clipped") {
      const width = await page.evaluate(() => ({
        root: document.scrollingElement.scrollWidth,
        body: document.body.scrollWidth,
        viewport: innerWidth,
      }));
      assert.equal(width.root, width.viewport);
      assert.ok(width.body > width.viewport);
    }
    await page.evaluate(() => scrollTo(0, 120));
    const before = await page.evaluate(() => scrollY);
    const result = await send({ type: "popupAction", tabId: id, action: "capture-full" });
    const captured = await draft();
    results[scope] = {
      captured: result?.captured,
      scope: captured?.captureScope,
      hasImage: Boolean(captured?.image),
      pageCount: captured?.capturePages?.length || 0,
      firstName: captured?.capturePages?.[0]?.name,
      lastName: captured?.capturePages?.at(-1)?.name,
      notice: captured?.captureNotice,
      scrollRestored: Math.abs((await page.evaluate(() => scrollY)) - before) < 2,
    };
    if (
      ["long", "tall", "tooLong", "clipped"].includes(scope) &&
      captured?.capturePages?.length
    ) {
      const first = await send({ type: "capturePage", id: captured.id, index: 0 });
      const last = await send({
        type: "capturePage",
        id: captured.id,
        index: captured.capturePages.length - 1,
      });
      const pixels = Buffer.from(first.image.split(",")[1], "base64");
      const size = await sharp(pixels).metadata();
      results[scope].firstHeight = size.height;
      results[scope].lastHeight = (
        await sharp(Buffer.from(last.image.split(",")[1], "base64")).metadata()
      ).height;
      await mkdir(join(root, ".local/remaining-todos-qa"), { recursive: true });
      if (scope === "long")
        await writeFile(
          join(root, ".local/remaining-todos-qa/full-page-first.webp"),
          pixels,
        );
    }
    await send({ type: "discard" });
  }

  mode = "long";
  await page.setViewportSize({ width: 900, height: 650 });
  await toFixture();
  await send({ type: "popupAction", tabId: id, action: "capture-full" });
  const seriesDraft = await draft();
  const seriesEditor = await context.newPage();
  await seriesEditor.goto(`chrome-extension://${extensionId}/editor.html`);
  await seriesEditor.locator("#page-select option").last().waitFor({ state: "attached" });
  await seriesEditor.locator(".page-thumbnail img[src]").first().waitFor();
  await seriesEditor.locator("#full-page-toggle:not([disabled])").waitFor();
  await seriesEditor.getByRole("button", { name: "Full page preview" }).click();
  const seriesDimensions = await previewDimensions(seriesEditor);
  results.seriesReview = {
    previewHeight: seriesDimensions.height,
    previewWidth: seriesDimensions.width,
  };
  assert.ok(results.seriesReview.previewHeight > 650);
  assert.ok(results.seriesReview.previewWidth > 0);
  await seriesEditor.setViewportSize({ width: 1440, height: 900 });
  await seriesEditor.screenshot({
    path: join(root, ".local/remaining-todos-qa/full-page-preview-desktop.png"),
  });
  await seriesEditor.setViewportSize({ width: 390, height: 844 });
  await seriesEditor.screenshot({
    path: join(root, ".local/remaining-todos-qa/full-page-preview-mobile.png"),
  });
  await seriesEditor.getByRole("button", { name: "Back to sections" }).click();
  await seriesEditor.setViewportSize({ width: 1440, height: 900 });
  await seriesEditor.screenshot({
    path: join(root, ".local/remaining-todos-qa/ordered-editor.png"),
  });
  await seriesEditor.setViewportSize({ width: 390, height: 844 });
  await seriesEditor.screenshot({
    path: join(root, ".local/remaining-todos-qa/ordered-editor-mobile.png"),
    fullPage: true,
  });
  await seriesEditor.setViewportSize({ width: 1440, height: 900 });
  results.seriesReview = {
    ...results.seriesReview,
    pageOptions: await seriesEditor.locator("#page-select option").count(),
    firstLabel: await seriesEditor.locator("#page-select option").first().textContent(),
  };
  await seriesEditor.locator("#page-next").click();
  await seriesEditor.waitForFunction(
    () => document.querySelector("#page-select")?.value === "1",
  );
  results.seriesReview.secondSelected = await seriesEditor
    .locator("#page-select")
    .inputValue();
  const beforeRedaction = await send({
    type: "capturePage",
    id: seriesDraft.id,
    index: 1,
  });
  await seriesEditor.locator('[data-tool="redact"]').click();
  const area = await seriesEditor.locator("#canvas").boundingBox();
  if (!area) throw Error("The ordered screenshot is not visible in the editor");
  await seriesEditor.mouse.move(area.x + 24, area.y + 24);
  await seriesEditor.mouse.down();
  await seriesEditor.mouse.move(area.x + 90, area.y + 65, { steps: 4 });
  await seriesEditor.mouse.up();
  await seriesEditor
    .getByText("Redaction permanently saved.", { exact: false })
    .waitFor();
  const afterRedaction = await send({
    type: "capturePage",
    id: seriesDraft.id,
    index: 1,
  });
  results.seriesReview.redactionPersisted =
    beforeRedaction.image !== afterRedaction.image &&
    (await draft()).imageRevision > seriesDraft.imageRevision;
  await worker.evaluate(() => {
    const original = globalThis.fetch;
    let interrupt = true;
    globalThis.fetch = async (...args) => {
      if (
        interrupt &&
        String(args[0]).endsWith("/api/assets.upload") &&
        JSON.parse(args[1]?.body || "{}").filename === "full-page-002-of-004.webp"
      ) {
        interrupt = false;
        await new Promise((resolve) => setTimeout(resolve, 1800));
        throw Error("Synthetic upload interruption");
      }
      return original(...args);
    };
  });
  await seriesEditor.locator("#body").fill("Synthetic ordered capture acceptance.");
  await seriesEditor.evaluate(() => {
    window.qaUploadProgress = [];
    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === "submitProgress" && Number.isInteger(message.completed))
        window.qaUploadProgress.push({
          completed: message.completed,
          total: message.total,
          fills: ["send", "send-header"].map((id) => ({
            progress: document
              .getElementById(id)
              .style.getPropertyValue("--send-progress"),
            busy: document.getElementById(id).getAttribute("aria-busy"),
          })),
          actionsLocked: ["send", "send-header"].every(
            (id) => document.getElementById(id).disabled,
          ),
        });
    });
  });
  await seriesEditor.locator("#send").click();
  await seriesEditor.locator("#send-header:has-text('Sending 25%')").waitFor();
  await mkdir(join(root, ".local/finalize-qa"), { recursive: true });
  await seriesEditor.evaluate(() => scrollTo(0, 0));
  await seriesEditor.screenshot({
    path: join(root, ".local/finalize-qa/upload-fill.png"),
  });
  await seriesEditor.locator("#send:has-text('Retry Send')").waitFor();
  assert.equal(
    (await seriesEditor.locator("#send-header").textContent()).trim(),
    "Retry Send",
  );
  assert.equal(await seriesEditor.locator("#send-header").isEnabled(), true);
  const progressFills = await seriesEditor.evaluate(() => window.qaUploadProgress);
  assert.ok(progressFills.length > 0);
  for (const sample of progressFills)
    for (const fill of sample.fills) {
      assert.equal(
        fill.progress,
        `${Math.round((sample.completed / sample.total) * 100)}%`,
      );
      assert.equal(fill.busy, "true");
    }
  assert.equal(
    await seriesEditor.locator("#send-header").getAttribute("aria-busy"),
    "false",
  );
  const interrupted = await draft();
  assert.ok(
    interrupted?.thread?.id,
    "The thread was published before image upload stopped",
  );
  assert.match(
    await seriesEditor.locator("#status").textContent(),
    /thread is already published/i,
  );
  assert.equal(
    await seriesEditor.locator("#published-thread").getAttribute("href"),
    `${access.url}/threads/${interrupted.thread.id}`,
  );
  results.seriesReview.resumeIndex = interrupted?.uploadIndex;
  results.seriesReview.frozenAfterInterruption = interrupted?.frozen;
  results.seriesReview.visibleProgress = await seriesEditor
    .locator("#upload-label")
    .textContent();
  results.seriesReview.meter = await seriesEditor
    .locator("#upload-meter")
    .evaluate((meter) => meter.value);
  await seriesEditor.locator("#send-header").click();
  await seriesEditor.getByText("Feedback sent").waitFor({ timeout: 120000 });
  results.seriesReview.uploadProgress = await seriesEditor.evaluate(
    () => window.qaUploadProgress,
  );
  assert.ok(results.seriesReview.uploadProgress.every((entry) => entry.actionsLocked));
  assert.equal(await seriesEditor.locator("#send-header").isVisible(), false);
  const seriesThreadUrl = await seriesEditor.locator("#thread").getAttribute("href");
  const seriesThreadId = seriesThreadUrl?.match(/[0-9a-f-]{36}/)?.[0];
  if (!seriesThreadId) throw Error("Ordered screenshot submission lacks a thread link");
  const seriesThread = (await post("threads.get", { threadId: seriesThreadId }, auth))
    .data;
  results.seriesReview.assetNames = seriesThread.assets.map((asset) => asset.filename);
  results.seriesReview.draftCleared = !(await draft());
  assert.equal(results.seriesReview.pageOptions, seriesDraft.capturePages.length);
  assert.equal(results.seriesReview.secondSelected, "1");
  assert.equal(results.seriesReview.redactionPersisted, true);
  assert.equal(results.seriesReview.resumeIndex, 1);
  assert.equal(results.seriesReview.frozenAfterInterruption, true);
  assert.equal(results.seriesReview.visibleProgress, "1 of 4 images uploaded · 25%");
  assert.equal(results.seriesReview.meter, 25);
  assert.deepEqual(
    results.seriesReview.assetNames,
    seriesDraft.capturePages.map((item) => item.name),
  );
  assert.equal(results.seriesReview.draftCleared, true);
  assert.ok(results.seriesReview.uploadProgress.some((entry) => entry.completed === 1));
  assert.ok(
    results.seriesReview.uploadProgress.some(
      (entry) => entry.completed === seriesDraft.capturePages.length,
    ),
  );

  mode = "long";
  await toFixture();
  await send({ type: "popupAction", tabId: id, action: "capture-full" });
  const removableDraft = await draft();
  const removableEditor = await context.newPage();
  await removableEditor.goto(`chrome-extension://${extensionId}/editor.html`);
  await removableEditor.locator(".page-thumbnail").last().waitFor();
  await removableEditor.locator(".page-thumbnail img[src]").first().waitFor();
  results.pageReview = {
    previews: await removableEditor.locator(".page-thumbnail").count(),
  };
  await removableEditor.locator("#page-select").selectOption("1");
  await removableEditor.locator("#remove-current").click();
  await removableEditor.locator(".page-thumbnail").last().waitFor();
  await removableEditor.waitForFunction(
    () => document.querySelectorAll(".page-thumbnail").length === 3,
  );
  const pruned = await draft();
  results.pageReview.remaining = pruned.capturePages.map((page) => page.name);
  results.pageReview.secondImageMatches =
    (await send({ type: "capturePage", id: pruned.id, index: 1 })).page.name ===
    "full-page-003-of-004.webp";
  await removableEditor.locator("#page-select").selectOption("0");
  await removableEditor.locator('[data-tool="rectangle"]').click();
  await removableEditor.waitForFunction(
    () =>
      document.querySelector("#status")?.textContent ===
      "Reviewing full-page-001-of-004.webp.",
  );
  await removableEditor.locator("#canvas").scrollIntoViewIfNeeded();
  const reviewArea = await removableEditor.locator("#canvas").evaluate((canvas) => {
    const image = canvas.getBoundingClientRect();
    const viewport = document.querySelector("#canvas-scroll").getBoundingClientRect();
    return {
      left: Math.max(image.left, viewport.left, 0) + 8,
      top: Math.max(image.top, viewport.top, 0) + 8,
      right: Math.min(image.right, viewport.right, innerWidth) - 8,
      bottom: Math.min(image.bottom, viewport.bottom, innerHeight) - 8,
    };
  });
  assert.ok(reviewArea.right - reviewArea.left > 40, JSON.stringify(reviewArea));
  assert.ok(reviewArea.bottom - reviewArea.top > 40, JSON.stringify(reviewArea));
  const drawingStart = { x: reviewArea.left + 8, y: reviewArea.top + 8 };
  assert.equal(
    await removableEditor.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.id,
      drawingStart,
    ),
    "canvas",
  );
  await removableEditor.mouse.move(drawingStart.x, drawingStart.y);
  await removableEditor.mouse.down();
  await removableEditor.mouse.move(reviewArea.right - 8, reviewArea.bottom - 8, {
    steps: 4,
  });
  await removableEditor.mouse.up();
  await removableEditor.getByRole("button", { name: "Full page preview" }).click();
  await previewDimensions(removableEditor);
  results.pageReview.previewMarkedPixels = await removableEditor
    .locator("#preview-slot img")
    .first()
    .evaluate((image) => {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let marked = 0;
      for (let index = 0; index < pixels.length; index += 4)
        if (pixels[index] > 120 && pixels[index + 1] < 100 && pixels[index + 2] < 120)
          marked++;
      return marked;
    });
  assert.ok(results.pageReview.previewMarkedPixels > 12);
  await removableEditor.getByRole("button", { name: "Back to sections" }).click();
  await removableEditor.locator("#include-combined").check();
  await removableEditor
    .locator("#body")
    .fill("Synthetic capture selection and combined image.");
  await worker.evaluate(() => {
    const original = globalThis.fetch;
    let interrupt = true;
    globalThis.fetch = async (...args) => {
      if (
        interrupt &&
        String(args[0]).endsWith("/api/assets.upload") &&
        JSON.parse(args[1]?.body || "{}").filename === "full-page-combined.webp"
      ) {
        interrupt = false;
        throw Error("Synthetic combined upload interruption");
      }
      return original(...args);
    };
  });
  await removableEditor.locator("#send").click();
  await removableEditor.locator("#send:has-text('Retry Send')").waitFor();
  const interruptedCombined = await draft();
  assert.match(
    await removableEditor.locator("#status").textContent(),
    /thread is already published/i,
  );
  results.pageReview.resumeAtCombined =
    interruptedCombined?.frozen &&
    interruptedCombined.uploadIndex === interruptedCombined.capturePages.length;
  await removableEditor.evaluate(async (draftId) => {
    const { putPage } = await import(chrome.runtime.getURL("page-store.js"));
    const oversized = new OffscreenCanvas(1920, 15000);
    const context = oversized.getContext("2d");
    context.fillStyle = "#f6f7f8";
    context.fillRect(0, 0, oversized.width, oversized.height);
    const blob = await oversized.convertToBlob({ type: "image/webp", quality: 0.7 });
    await putPage(draftId, 0, "combined", blob);
  }, interruptedCombined.id);
  await removableEditor.locator("#send").click();
  await removableEditor.getByText("Feedback sent").waitFor({ timeout: 120000 });
  const combinedThreadUrl = await removableEditor.locator("#thread").getAttribute("href");
  const combinedThreadId = combinedThreadUrl?.match(/[0-9a-f-]{36}/)?.[0];
  if (!combinedThreadId)
    throw Error("Combined screenshot submission lacks a thread link");
  const combinedThread = (await post("threads.get", { threadId: combinedThreadId }, auth))
    .data;
  results.pageReview.assetNames = combinedThread.assets.map((asset) => asset.filename);
  assert.ok(
    combinedThread.assets.at(-1).markings.some((mark) => mark.tool === "rectangle"),
    "Combined image must expose its drawn rectangle to MCP clients",
  );
  assert.deepEqual(
    combinedThread.assets
      .at(-1)
      .captureSections.map(({ startY, endY }) => [startY, endY]),
    pruned.capturePages.map(({ startY, endY }) => [startY, endY]),
  );
  results.pageReview.combinedMarkings = combinedThread.assets
    .at(-1)
    .markings.map((mark) => mark.tool);
  const combinedResponse = await fetch(
    `${access.url}${combinedThread.assets.at(-1).url}`,
    { headers: { Cookie: auth.cookie } },
  );
  assert.equal(combinedResponse.status, 200);
  const composite = await sharp(Buffer.from(await combinedResponse.arrayBuffer()))
    .extract({ left: 0, top: 0, width: 220, height: 250 })
    .removeAlpha()
    .raw()
    .toBuffer();
  let markedPixels = 0;
  for (let pixel = 0; pixel < composite.length; pixel += 3)
    if (
      composite[pixel] > 120 &&
      composite[pixel + 1] < 100 &&
      composite[pixel + 2] < 120
    )
      markedPixels++;
  results.pageReview.combinedMarkedPixels = markedPixels;
  assert.ok(markedPixels > 12, "Combined image is missing the page annotation");
  assert.equal(results.pageReview.previews, removableDraft.capturePages.length);
  assert.equal(results.pageReview.secondImageMatches, true);
  assert.equal(results.pageReview.resumeAtCombined, true);
  assert.deepEqual(results.pageReview.assetNames, [
    "full-page-001-of-004.webp",
    "full-page-003-of-004.webp",
    "full-page-004-of-004.webp",
    "full-page-combined.webp",
  ]);

  await page.setViewportSize({ width: 900, height: 650 });
  mode = "changing";
  await toFixture();
  await page.evaluate(() => clearInterval(window.qaTimer));
  await exposeReviewRoot();
  await send({ type: "activate", tabId: id });
  await saveInlinePoint(
    page.getByRole("heading", { name: "Controlled page" }),
    "Keep this original through retry",
  );
  // Move the viewport once after the first full-page step is measured. A height
  // timer can return to the same height (or grow forever, which capture supports).
  await worker.evaluate(() => {
    const send = chrome.tabs.sendMessage.bind(chrome.tabs);
    chrome.tabs.sendMessage = async (tabId, message, ...rest) => {
      const response = await send(tabId, message, ...rest);
      if (message.type === "fullPageScroll") {
        chrome.tabs.sendMessage = send;
        await chrome.scripting.executeScript({
          target: { tabId },
          func: () => scrollBy(0, 8),
        });
      }
      return response;
    };
  });
  const beforeChanging = await page.evaluate(() => scrollY);
  const changed = await send({ type: "popupAction", tabId: id, action: "capture-full" });
  const changingDraft = await draft();
  const beforeOriginalIndex = changingDraft.capturePages.findIndex(
    (item) => item.annotationId,
  );
  assert.ok(beforeOriginalIndex >= 0);
  const beforeOriginal = await send({
    type: "capturePage",
    id: changingDraft.id,
    index: beforeOriginalIndex,
  });
  results.changing = {
    captured: changed?.captured,
    hasImage: Boolean(changingDraft?.image),
    scrollRestored: Math.abs((await page.evaluate(() => scrollY)) - beforeChanging) < 2,
    error: changed?.error,
  };
  await page.evaluate(() => clearInterval(window.qaTimer));
  // Headless Chromium's native capture uses a 563px content area after
  // switching from an extension editor. Match that viewport for this test.
  await page.setViewportSize({ width: 900, height: 563 });
  const retainedArrow = {
    tool: "arrow",
    points: [
      { x: 40, y: 60 },
      { x: 140, y: 160 },
    ],
  };
  const editedNote = "Edited original note before retry";
  await send({
    type: "saveDraft",
    id: changingDraft.id,
    imageRevision: changingDraft.imageRevision,
    projectId: changingDraft.projectId,
    body: "Keep editor changes through page retry",
    pageIndex: beforeOriginalIndex,
    toolState: [...changingDraft.pageToolStates[beforeOriginalIndex], retainedArrow],
    annotations: changingDraft.context.annotations.map((item) => ({
      id: item.id,
      body: editedNote,
    })),
  });
  const retryEditor = await context.newPage();
  await retryEditor.goto(`chrome-extension://${extensionId}/editor.html`);
  await retryEditor.getByRole("button", { name: "Retry full-page capture" }).waitFor();
  await retryEditor.getByRole("button", { name: "Retry full-page capture" }).click();
  await retryEditor
    .getByText("Capture ready.", { exact: false })
    .waitFor({ timeout: 120000 });
  results.changing.retryPages = (await draft())?.capturePages?.length;
  assert.ok(results.changing.retryPages > 1);
  const retried = await draft();
  const afterOriginalIndex = retried.capturePages.findIndex((item) => item.annotationId);
  assert.ok(afterOriginalIndex >= 0);
  assert.equal(retried.context.annotations[0].body, editedNote);
  assert.deepEqual(retried.pageToolStates[afterOriginalIndex].at(-1), retainedArrow);
  const afterOriginal = await send({
    type: "capturePage",
    id: retried.id,
    index: afterOriginalIndex,
  });
  assert.equal(
    afterOriginal.image,
    beforeOriginal.image,
    "Retry keeps the exact original point pixels",
  );
  assert.equal(retried.capturePages.filter((item) => item.annotationId).length, 1);
  results.changing.originalRetainedThroughRetry = true;
  await send({ type: "discard" });

  mode = "short";
  await toFixture();
  await exposeReviewRoot();
  await send({ type: "activate", tabId: id });
  await send({ type: "popupAction", tabId: id, action: "show-controls" });
  const clickPageControl = async (label) =>
    worker.evaluate(
      async ({ tabId, label }) => {
        const [entry] = await chrome.scripting.executeScript({
          target: { tabId },
          args: [label],
          func: (label) => {
            const root = globalThis.__feedbacksQaRoot;
            const button = [...root.querySelectorAll("button")].find(
              (node) => node.textContent === label,
            );
            if (!button || button.disabled) return false;
            button.click();
            return true;
          },
        });
        return entry.result;
      },
      { tabId: id, label },
    );
  for (let attempt = 0; attempt < 30; attempt++) {
    if (await clickPageControl("Start diagnostics")) break;
    await page.waitForTimeout(100);
  }
  for (let attempt = 0; attempt < 30; attempt++) {
    if ((await send({ type: "diagnostics", tabId: id, action: "status" })).active) break;
    await page.waitForTimeout(100);
  }
  assert.equal(
    (await send({ type: "diagnostics", tabId: id, action: "status" })).active,
    true,
  );
  const commentsOpened = context.waitForEvent("page");
  assert.equal(await clickPageControl("Page comments"), true);
  const commentsTab = await commentsOpened;
  await commentsTab.waitForURL(
    (url) => url.pathname.startsWith("/projects/") && url.searchParams.has("url"),
  );
  assert.equal(
    new URL(commentsTab.url()).searchParams.get("url"),
    new URL(page.url()).origin + new URL(page.url()).pathname,
  );
  await commentsTab.close();
  await page.bringToFront();
  await page.evaluate(() =>
    console.warn("Synthetic card token PRIVATE-123 should be masked"),
  );
  await send({ type: "popupAction", tabId: id, action: "capture" });
  const diagnosticDraft = await draft();
  const diagnosticIndex = diagnosticDraft?.diagnostics?.console?.findIndex((entry) =>
    entry.message.includes("PRIVATE-123"),
  );
  if (diagnosticIndex < 0) throw Error("Synthetic console message was not captured");
  const editor = await context.newPage();
  await editor.goto(`chrome-extension://${extensionId}/editor.html`);
  await editor.locator("#diagnostics-review summary").click();
  const messageField = editor.getByRole("textbox", {
    name: `Console message ${diagnosticIndex + 1}`,
  });
  await messageField.waitFor();
  await messageField.evaluate((element) => {
    const start = element.value.indexOf("PRIVATE-123");
    element.setSelectionRange(start, start + "PRIVATE-123".length);
  });
  await editor.locator("[data-diagnostic-mask]").nth(diagnosticIndex).click();
  await editor.getByText("Selected text masked in the local draft.").waitFor();
  await editor.reload();
  const masked = await draft();
  results.diagnostics = {
    persisted:
      !masked.diagnostics.console[diagnosticIndex].message.includes("PRIVATE-123"),
    marker: masked.diagnostics.console[diagnosticIndex].message.includes("[redacted]"),
  };
  await editor.locator("#body").fill("Synthetic diagnostics masking browser check.");
  await editor.locator("#diagnostics-review summary").click();
  await editor.locator("#include-diagnostics").check();
  await editor.locator("#send").click();
  await editor.getByText("Feedback sent").waitFor();
  const threadUrl = await editor.locator("#thread").getAttribute("href");
  const threadId = threadUrl?.match(/[0-9a-f-]{36}/)?.[0];
  if (!threadId) throw Error("Submitted feedback lacks a thread link");
  const saved = (await post("threads.get", { threadId }, auth)).data;
  const serialized = JSON.stringify(saved);
  results.diagnostics.submitted =
    !serialized.includes("PRIVATE-123") && serialized.includes("masked");
  results.diagnostics.draftCleared = !(await draft());
  assert.equal(results.qa.captured, true, JSON.stringify(results.qa));
  assert.deepEqual(results.qaDraft, {
    hasAltFinding: true,
    hasBrokenLink: true,
    hasImage: true,
  });
  for (const scope of ["short", "long", "clipped"]) {
    assert.equal(results[scope].captured, true);
    assert.equal(results[scope].scope, "fullPage");
    assert.equal(results[scope].hasImage, false);
    assert.ok(results[scope].pageCount >= 1);
    assert.equal(results[scope].scrollRestored, true);
  }
  assert.ok(results.long.pageCount > 1);
  assert.equal(results.tall.captured, true);
  assert.equal(results.tall.scope, "fullPage");
  assert.equal(results.tall.hasImage, false);
  assert.ok(results.tall.pageCount > 8);
  assert.ok(results.tall.firstHeight <= 800);
  assert.match(results.tall.notice, /ordered screenshots/);
  assert.equal(results.tall.scrollRestored, true);
  assert.equal(results.tooLong.captured, true);
  assert.equal(results.tooLong.scope, "fullPage");
  assert.equal(results.tooLong.hasImage, false);
  assert.ok(results.tooLong.pageCount > results.tall.pageCount);
  assert.equal(results.tooLong.scrollRestored, true);
  assert.equal(results.changing.captured, false);
  assert.equal(results.changing.hasImage, false);
  assert.equal(results.changing.scrollRestored, true);
  assert.match(results.changing.error, /page (moved|changed) during full-page capture/);
  assert.deepEqual(results.diagnostics, {
    persisted: true,
    marker: true,
    submitted: true,
    draftCleared: true,
  });
  const cookieSplit = auth.cookie.indexOf("=");
  const cookieName = auth.cookie.slice(0, cookieSplit);
  const cookieValue = auth.cookie.slice(cookieSplit + 1);
  await context.addCookies([
    { name: cookieName, value: cookieValue, url: access.url, sameSite: "Strict" },
  ]);
  // Cross-site links must enter the web app first: Strict cookies are omitted
  // on the top-level navigation, then sent on the app's same-site API requests.
  const linkedOriginal = inlineThread.assets.find(
    (asset) => asset.filename === "point-002-original.webp",
  );
  assert.ok(linkedOriginal);
  const crossSite = await context.newPage();
  await crossSite.goto("https://example.com/");
  const assetLink = `${access.url}/threads/${inlineThreadId}#asset-${linkedOriginal.id}`;
  await crossSite.evaluate((href) => {
    const link = document.createElement("a");
    link.href = href;
    link.target = "_blank";
    link.textContent = "Open feedback image";
    document.body.prepend(link);
  }, assetLink);
  const linkedPagePromise = context.waitForEvent("page");
  await crossSite.getByRole("link", { name: "Open feedback image" }).click();
  const linkedPage = await linkedPagePromise;
  await linkedPage
    .locator(`.review-point-figure[id="asset-${linkedOriginal.id}"]`)
    .waitFor();
  await linkedPage.waitForFunction(() => {
    const img = document.querySelector(".review-point-figure img");
    return img?.complete && img.naturalWidth > 0;
  });
  assert.equal(
    await linkedPage.getByRole("button", { name: "Sign in", exact: true }).count(),
    0,
  );
  results.githubAssetLink = {
    existingSessionReused: true,
    selectedOriginal: true,
    imageLoaded: true,
  };
  await linkedPage.close();
  await crossSite.close();
  const inlineThreadPage = await context.newPage();
  await inlineThreadPage.goto(`${access.url}/threads/${inlineThreadId}`);
  await inlineThreadPage.getByRole("heading", { name: "Review on the page" }).waitFor();
  assert.equal(await inlineThreadPage.locator(".review-main-capture").count(), 1);
  assert.equal(await inlineThreadPage.locator(".review-point-figure").count(), 2);
  assert.equal(
    await inlineThreadPage.getByRole("button", { name: "Show original view" }).count(),
    0,
  );
  await inlineThreadPage.waitForFunction(() =>
    [
      ...document.querySelectorAll(".review-main-capture img, .review-point-figure img"),
    ].every((image) => image.complete && image.naturalWidth > 0),
  );
  await inlineThreadPage.screenshot({
    path: join(root, ".local/remaining-todos-qa/thread-inline-desktop.png"),
    fullPage: true,
  });
  await inlineThreadPage.getByRole("button", { name: "Switch to dark mode" }).click();
  await inlineThreadPage.screenshot({
    path: join(root, ".local/remaining-todos-qa/thread-inline-dark-desktop.png"),
    fullPage: true,
  });
  await inlineThreadPage.setViewportSize({ width: 390, height: 844 });
  assert.equal(await inlineThreadPage.locator(".review-point-figure").count(), 2);
  await inlineThreadPage.screenshot({
    path: join(root, ".local/remaining-todos-qa/thread-inline-dark-mobile.png"),
    fullPage: true,
  });
  await inlineThreadPage.getByRole("button", { name: "Switch to light mode" }).click();
  await inlineThreadPage
    .getByRole("button", { name: "Resolve point", exact: true })
    .click();
  await inlineThreadPage
    .getByRole("status")
    .filter({ hasText: "Point resolved." })
    .waitFor();
  assert.equal(
    await inlineThreadPage
      .getByRole("button", { name: "Reopen point", exact: true })
      .count(),
    2,
  );
  await inlineThreadPage
    .getByRole("button", { name: "Remove point", exact: true })
    .last()
    .click();
  await inlineThreadPage
    .getByRole("status")
    .filter({ hasText: "Point removed." })
    .waitFor();
  await inlineThreadPage.getByLabel("Filter points").selectOption("removed");
  await inlineThreadPage
    .getByRole("button", { name: "Restore point", exact: true })
    .click();
  await inlineThreadPage
    .getByRole("status")
    .filter({ hasText: "Point reopened." })
    .waitFor();
  await inlineThreadPage.getByLabel("Filter points").selectOption("all");
  assert.equal(
    await inlineThreadPage
      .getByRole("button", { name: "Resolve point", exact: true })
      .count(),
    1,
  );
  await inlineThreadPage.screenshot({
    path: join(root, ".local/remaining-todos-qa/thread-inline-mobile.png"),
  });
  results.inlineReview.inlinePointImages = 2;
  results.inlineReview.mobilePointSelection = true;
  const threadPage = await context.newPage();
  await threadPage.goto(
    `${access.url}/threads/${seriesThreadId}#asset-${seriesThread.assets[2].id}`,
  );
  await threadPage
    .getByText("Full-page capture · 4 numbered images")
    .waitFor({ timeout: 15000 });
  results.seriesReview.galleryImages = await threadPage
    .locator(".capture-page-grid figure")
    .count();
  await threadPage.screenshot({
    path: join(root, ".local/remaining-todos-qa/thread-gallery.png"),
  });
  assert.equal(results.seriesReview.galleryImages, 4);
  // GitHub toolbar states use local API fixtures; no GitHub writes are made.
  const githubPage = await context.newPage();
  let githubConfigured = true,
    githubMultiple = false,
    githubLinked = false,
    githubPending = false;
  const githubCreates = [];
  const repositories = ["https://github.com/demo/web", "https://github.com/demo/api"];
  await githubPage.route(`${access.url}/api/**`, async (route) => {
    const operation = route.request().url().split("/").at(-1);
    let data;
    if (operation === "github.connection")
      data = {
        configured: githubConfigured,
        installation: githubConfigured ? "installed" : "not_configured",
        repositories: (githubMultiple ? repositories : repositories.slice(0, 1)).map(
          (repositoryUrl) => ({
            repositoryUrl,
            connected: true,
            installation: "installed",
          }),
        ),
      };
    else if (operation === "github.issueState")
      data = {
        status: githubPending ? "pending" : githubLinked ? "linked" : "none",
        issueUrl: githubLinked ? `${repositories[0]}/issues/1` : null,
        canAbandon: false,
      };
    else if (operation === "github.issueCreateQuick") {
      githubCreates.push(route.request().postDataJSON());
      githubLinked = true;
      data = seriesThread;
    } else if (operation === "projects.get") {
      const response = await route.fetch();
      const body = await response.json();
      body.data.githubConnected = true;
      return route.fulfill({ json: body });
    } else return route.continue();
    await route.fulfill({ json: { ok: true, data } });
  });
  await githubPage.goto(`${access.url}/threads/${seriesThreadId}`);
  await githubPage
    .getByRole("button", { name: "Create GitHub issue", exact: true })
    .waitFor();
  assert.equal(await githubPage.locator(".github-issue-control").isVisible(), false);
  await githubPage.screenshot({
    path: join(root, ".local/finalize-qa/github-toolbar.png"),
  });
  await githubPage
    .getByRole("button", { name: "Create GitHub issue", exact: true })
    .click();
  await githubPage
    .getByRole("button", { name: "View GitHub issue", exact: true })
    .waitFor();
  assert.equal(githubCreates.length, 1);
  assert.equal(githubCreates[0].repositoryUrl, repositories[0]);
  await githubPage
    .getByRole("button", { name: "View GitHub issue", exact: true })
    .click();
  await githubPage.getByRole("dialog", { name: "GitHub issue", exact: true }).waitFor();
  await githubPage.keyboard.press("Escape");
  githubConfigured = false;
  githubLinked = false;
  await githubPage.reload();
  await githubPage
    .getByRole("button", { name: "View or link issues", exact: true })
    .click();
  await githubPage.locator("#thread-issues[open]").waitFor();
  assert.equal(githubCreates.length, 1);
  githubConfigured = true;
  githubMultiple = true;
  await githubPage.reload();
  await githubPage
    .getByRole("button", { name: "Create GitHub issue", exact: true })
    .click();
  await githubPage
    .getByRole("combobox", { name: /Create Issue in/ })
    .selectOption(repositories[1]);
  assert.equal(githubCreates.length, 1);
  await githubPage.getByRole("button", { name: "Create Issue", exact: true }).click();
  await githubPage.getByRole("link", { name: "Open GitHub Issue" }).waitFor();
  assert.equal(githubCreates.length, 2);
  assert.equal(githubCreates[1].repositoryUrl, repositories[1]);
  githubPending = true;
  githubLinked = false;
  await githubPage.reload();
  await githubPage
    .getByText("The last Issue request may have succeeded.", { exact: false })
    .waitFor();
  assert.equal(githubCreates.length, 2, "Uncertain requests must never create again");
  await githubPage.setViewportSize({ width: 320, height: 720 });
  assert.equal(
    await githubPage
      .locator("dialog[open]")
      .evaluate((el) => el.getBoundingClientRect().right <= innerWidth),
    true,
  );
  await githubPage.screenshot({
    path: join(root, ".local/finalize-qa/github-pending-mobile.png"),
  });
  await githubPage.close();
  results.githubToolbar = {
    singleRepositoryQuickCreate: true,
    noPersistentBanner: true,
    manualFallback: true,
    multipleRepositories: true,
    pendingRecovery: true,
  };
  await page.bringToFront();
  await send({ type: "activate", tabId: id });
  // Real MediaRecorder, deterministic local canvas stream in place of Chrome's
  // user-operated picker. Do not record a user's desktop in automated tests.
  const recorderOpened = context.waitForEvent("page");
  await sendFromReview({ type: "openRecorder" });
  const recorderPage = await recorderOpened;
  await recorderPage.waitForLoadState();
  await recorderPage.locator("#start:enabled").waitFor();
  await recorderPage.evaluate(() => {
    window.qaPlaybackVideos = [];
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      window.qaPlaybackVideos.push(this);
      return play.call(this);
    };
    const tone = () => {
      const audio = new AudioContext();
      const oscillator = audio.createOscillator();
      const destination = audio.createMediaStreamDestination();
      oscillator.connect(destination);
      oscillator.start();
      const track = destination.stream.getAudioTracks()[0];
      track.addEventListener("ended", () => audio.close());
      return destination.stream;
    };
    navigator.mediaDevices.getUserMedia = async () => tone();
    navigator.mediaDevices.getDisplayMedia = async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 320;
      canvas.height = 180;
      const ctx = canvas.getContext("2d");
      const draw = () => {
        ctx.fillStyle = "#17324d";
        ctx.fillRect(0, 0, 320, 180);
        ctx.fillStyle = "white";
        ctx.fillText(String(Date.now()), 20, 50);
      };
      draw();
      const stream = canvas.captureStream(10);
      stream.addTrack(tone().getAudioTracks()[0]);
      const timer = setInterval(draw, 100);
      const track = stream.getVideoTracks()[0];
      track.getSettings = () => ({ displaySurface: "browser" });
      track.addEventListener("ended", () => clearInterval(timer));
      return stream;
    };
  });
  await recorderPage.locator("#tab-audio").check();
  await recorderPage.locator("#microphone").check();
  await recorderPage.locator("#start").click();
  await page.waitForTimeout(400);
  assert.match(
    await recorderPage.locator("#timer").textContent(),
    /(300|29[0-9]) seconds remaining/,
  );
  // Cross MV3's idle timeout while the recorder is in the background.
  await page.waitForTimeout(32000);
  await page.reload();
  await page.waitForTimeout(1500);
  assert.equal(
    (await sendFromReview({ type: "recordingControl", action: "pause" })).ok,
    true,
  );
  await sendFromReview({ type: "recordingControl", action: "resume" });
  assert.equal(
    (await sendFromReview({ type: "recordingControl", action: "pause" })).ok,
    true,
  );
  await recorderPage.locator("#pause").filter({ hasText: "Resume" }).waitFor();
  await recorderPage.locator("#timer").filter({ hasText: "Paused" }).waitFor();
  const pausedText = await recorderPage.locator("#timer").textContent();
  await page.waitForTimeout(1100);
  assert.equal(await recorderPage.locator("#timer").textContent(), pausedText);
  await sendFromReview({ type: "recordingControl", action: "resume" });
  await recorderPage.locator("#pause").filter({ hasText: "Pause" }).waitFor();
  await page.waitForTimeout(400);
  await sendFromReview({ type: "recordingControl", action: "stop" });
  await recorderPage.locator("#review:visible").waitFor();
  assert.ok(
    (await recorderPage.locator("#preview").getAttribute("src")).startsWith("blob:"),
  );
  // Trim with both drag handles, seek, and play only the selected interval.
  await recorderPage.locator("#trim-start-handle").waitFor();
  await recorderPage.locator("#trim-track").scrollIntoViewIfNeeded();
  const trimTrack = await recorderPage.locator("#trim-track").boundingBox();
  assert.ok(trimTrack);
  const dragHandle = async (id, fraction) => {
    const handle = await recorderPage.locator(id).boundingBox();
    await recorderPage.mouse.move(
      handle.x + handle.width / 2,
      handle.y + handle.height / 2,
    );
    await recorderPage.mouse.down();
    await recorderPage.mouse.move(
      trimTrack.x + trimTrack.width * fraction,
      trimTrack.y + 30,
      { steps: 6 },
    );
    await recorderPage.mouse.up();
  };
  await dragHandle("#trim-start-handle", 0.2);
  await dragHandle("#trim-end-handle", 0.3);
  const trimStart = Number(await recorderPage.locator("#trim-start").inputValue());
  const trimEnd = Number(await recorderPage.locator("#trim-end").inputValue());
  assert.ok(trimStart > 5 && trimEnd > trimStart);
  assert.equal(await recorderPage.locator("#send").isEnabled(), false);
  await recorderPage.locator("#trim-play").click();
  await recorderPage.locator("#trim-pause-icon:visible").waitFor();
  await recorderPage.waitForFunction(() => document.querySelector("#preview").paused, {
    timeout: 10000,
  });
  assert.ok(
    Math.abs(
      (await recorderPage.locator("#preview").evaluate((v) => v.currentTime)) - trimEnd,
    ) < 0.15,
  );
  await recorderPage.locator("#trim-start-handle").focus();
  await recorderPage.keyboard.press("ArrowRight");
  assert.ok(Number(await recorderPage.locator("#trim-start").inputValue()) > trimStart);
  await recorderPage.locator("#precise-trim summary").click();
  await recorderPage.locator("#trim-end").fill("");
  await recorderPage.locator("#trim-end").pressSequentially("30");
  assert.equal(await recorderPage.locator("#trim-end").inputValue(), "30");
  await recorderPage.locator("#trim-start").fill("0.1");
  await recorderPage.locator("#trim-end").fill("0.5");
  await recorderPage.locator("#crop-editing summary").click();
  await recorderPage.locator("#crop-width").fill("50");
  await recorderPage.locator("#apply-edit").click();
  await recorderPage
    .locator("#status")
    .filter({ hasText: "Edits applied" })
    .waitFor({ timeout: 20000 })
    .catch(async (error) => {
      throw Error(
        `${error.message}: ${await recorderPage.locator("#status").textContent()} ${JSON.stringify(await recorderPage.evaluate(() => window.qaPlaybackVideos.map((video) => ({ currentTime: video.currentTime, paused: video.paused, ended: video.ended, readyState: video.readyState, duration: video.duration, error: video.error?.message }))))}`,
      );
    });
  await recorderPage.locator("#preview").evaluate(
    (video) =>
      new Promise((resolve) => {
        if (video.readyState >= 1) resolve();
        else video.onloadedmetadata = resolve;
      }),
  );
  assert.equal(
    await recorderPage.locator("#preview").evaluate((video) => video.videoWidth),
    160,
  );
  // Crop again while the crop panel stays open: coordinates must remain original-based.
  await recorderPage.locator("#crop-preview").scrollIntoViewIfNeeded();
  const cropBoxVisible = await recorderPage.locator("#crop-preview").boundingBox();
  await recorderPage.mouse.move(
    cropBoxVisible.x + cropBoxVisible.width * 0.5,
    cropBoxVisible.y + 10,
  );
  await recorderPage.mouse.down();
  await recorderPage.mouse.move(
    cropBoxVisible.x + cropBoxVisible.width * 0.75,
    cropBoxVisible.y + cropBoxVisible.height - 10,
    { steps: 4 },
  );
  await recorderPage.mouse.up();
  assert.ok(Number(await recorderPage.locator("#crop-left").inputValue()) >= 49);
  assert.ok(Number(await recorderPage.locator("#crop-width").inputValue()) <= 26);
  await recorderPage.waitForFunction(
    () => document.querySelector("#preview").videoWidth === 320,
  );
  await recorderPage.locator("#reset-edit").click();
  await recorderPage.locator("#preview").evaluate(
    (video) =>
      new Promise((resolve) => {
        if (video.readyState >= 1) resolve();
        else video.onloadedmetadata = resolve;
      }),
  );
  assert.equal(
    await recorderPage.locator("#preview").evaluate((video) => video.videoWidth),
    320,
  );
  await recorderPage.evaluate(() => {
    document.getElementById("precise-trim").open = false;
    document.getElementById("crop-editing").open = false;
    window.scrollTo(0, 0);
  });
  await recorderPage.setViewportSize({ width: 1440, height: 1200 });
  await recorderPage.screenshot({
    path: join(root, ".local/remaining-todos-qa/video-desktop.png"),
  });
  await recorderPage.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await recorderPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
  await recorderPage.screenshot({
    path: join(root, ".local/remaining-todos-qa/video-mobile.png"),
  });
  await recorderPage.close();
  await page.bringToFront();
  results.recordingControls = {
    pauseResumeStop: true,
    preview: true,
    navigation: true,
    cropExport: true,
    originalRestored: true,
  };
  // A recorder retiring after a project switch cannot restore the prior review's state.
  await page.bringToFront();
  const switchTabId = await tabId();
  await send({ type: "activate", tabId: switchTabId });
  await worker.evaluate(
    (tabId) =>
      chrome.tabs.sendMessage(tabId, { type: "recordingState", state: "recording" }),
    switchTabId,
  );
  await send({
    type: "saveReviewPreferences",
    reviewDefaults: {
      navigationLocked: false,
      highlightEnabled: false,
      clickIndicators: false,
    },
  });
  const switchLogin = await post("auth.login", {
    email: access.email,
    password: access.password,
  });
  const switchAuth = { cookie: switchLogin.cookie, csrf: switchLogin.data.csrf };
  const alternateProject = (
    await post(
      "projects.create",
      {
        name: "Alternate synthetic review",
        origins: [new URL(page.url()).origin],
      },
      switchAuth,
    )
  ).data;
  // Pairing keys intentionally snapshot project access; refresh the synthetic key
  // so this test can actually switch to the newly created project.
  const switchPair = (await post("pairing.request", { name: "Project switch QA" })).data;
  await post("pairing.approve", { pairingId: switchPair.pairingId }, switchAuth);
  const switchToken = (
    await post("pairing.poll", {
      pairingId: switchPair.pairingId,
      deviceSecret: switchPair.deviceSecret,
    })
  ).data;
  await worker.evaluate(
    ({ server, token }) =>
      chrome.storage.local.set({
        accounts: { [server]: { token } },
      }),
    { server: access.url, token: switchToken.token },
  );
  const switchedReview = await send({
    type: "activate",
    tabId: switchTabId,
    projectId: alternateProject.id,
  });
  assert.equal(switchedReview.project.id, alternateProject.id);
  await worker.evaluate(
    (tabId) => chrome.tabs.sendMessage(tabId, { type: "recordingState", state: "idle" }),
    switchTabId,
  );
  const switchedControls = await send({
    type: "popupAction",
    tabId: switchTabId,
    action: "state",
  });
  assert.equal(switchedControls.navigationLocked, false);
  assert.equal(switchedControls.highlightEnabled, false);
  assert.equal(switchedControls.clickIndicators, false);
  results.reviewDefaults = {
    persisted: true,
    keyboardFocus: true,
    recordingRestored: true,
    projectSwitch: true,
  };
  console.log(JSON.stringify(results));
} finally {
  if (context) await context.close();
  sandbox.kill("SIGTERM");
  await rm(profile, { recursive: true, force: true });
}
