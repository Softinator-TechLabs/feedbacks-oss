import { verifySelectedText } from "./qa/extension/review/selected-text.mjs";
import { verifyCaptureTriage } from "./qa/extension/capture/triage.mjs";
import { verifySelectionBlockers } from "./qa/extension/review/selection-blockers.mjs";
import { verifyLiveSelection } from "./qa/extension/review/live-selection.mjs";
import { verifyFullpageScopes } from "./qa/extension/capture/fullpage-scopes.mjs";
import { verifySharedPins } from "./qa/extension/review/shared-pins.mjs";
import { verifyPendingPoints } from "./qa/extension/review/pending-points.mjs";
import { verifyMultiscrollReview } from "./qa/extension/review/multiscroll-review.mjs";
import { verifyInlineSubmission } from "./qa/extension/review/inline-submission.mjs";
import { verifyReviewInteractions } from "./qa/extension/review/review-interactions.mjs";
import { verifyCaptureSafety } from "./qa/extension/capture/capture-safety.mjs";
import { verifyChangingCapture } from "./qa/extension/capture/changing-capture.mjs";
import { verifyDiagnostics } from "./qa/extension/review/diagnostics.mjs";
import { verifyDiagnosticDom } from "./qa/extension/diagnostic-dom.mjs";
import { verifyOrderedCapture } from "./qa/extension/capture/ordered-capture.mjs";
import { verifyPageReview } from "./qa/extension/capture/page-review.mjs";
import { verifyThreadReview } from "./qa/extension/review/thread-review.mjs";
import { verifyReviewDefaults } from "./qa/extension/review/review-defaults.mjs";
import { verifyGithubToolbar } from "./qa/extension/github-toolbar.mjs";
import { verifyRecordingControls } from "./qa/extension/recording-controls.mjs";
import { verifyPublicCapture } from "./qa/extension/capture/public-capture.mjs";
import { verifyLargeVisibleCapture } from "./qa/extension/capture/large-visible.mjs";
import { verifyPopupOptions } from "./qa/extension/setup/popup-options.mjs";
import {
  previewDimensions,
  installReviewFixture,
} from "./qa/extension/setup/fixture.mjs";
import { verifySetup } from "./qa/extension/setup/setup.mjs";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const root = process.cwd();
const publicCaptureUrl = process.env.FEEDBACKS_QA_PUBLIC_URL;
if (process.env.FEEDBACKS_QA_PUBLIC_CAPTURE === "1" && !publicCaptureUrl)
  throw Error("Set FEEDBACKS_QA_PUBLIC_URL to the approved website for live capture QA.");
const profile = await mkdtemp(join(tmpdir(), "feedbacks-extension-browser-"));
const extension = join(profile, "extension");
// Exercise the same local bundles and HTML that the ZIP ships. Source-only
// copies omit generated rrweb/WebM scripts and cannot finalize native video.
await cp(join(root, "dist/extension/unpacked"), extension, { recursive: true });
const manifestPath = join(extension, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
// Isolated fixture grants let headless Chromium run feature checks; this copy
// is never packaged, and optional permission UX remains a separate gate.
manifest.host_permissions = ["<all_urls>"];
await writeFile(manifestPath, JSON.stringify(manifest));
// Headless Chrome cannot grant a toolbar invocation to tabCapture. This test
// copy swaps only the one-use ID and media source; the packaged ZIP is untouched.
const backgroundPath = join(extension, "background.js");
const backgroundSource = await readFile(backgroundPath, "utf8");
const nativeStreamId = `streamId: await chrome.tabCapture.getMediaStreamId({
          targetTabId: tab.id,
          consumerTabId: sender.tab.id,
        }),`;
assert.ok(backgroundSource.includes(nativeStreamId));
await writeFile(
  backgroundPath,
  backgroundSource.replace(nativeStreamId, 'streamId: "qa-tab-stream",'),
);
const videoHtmlPath = join(extension, "video.html");
const videoHtml = await readFile(videoHtmlPath, "utf8");
assert.ok(videoHtml.includes('id="debug-context" type="checkbox" checked'));
await writeFile(
  videoHtmlPath,
  videoHtml.replace(
    'id="debug-context" type="checkbox" checked',
    'id="debug-context" type="checkbox"',
  ),
);

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
  const post = async (name, input, auth = {}, renew = true) => {
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
    // A browser tab can renew this same cookie session while the harness runs.
    if (result.error?.code === "CSRF" && auth.cookie && renew && name !== "auth.me") {
      const refreshed = await post("auth.me", {}, auth, false);
      auth.csrf = refreshed.data.csrf;
      if (refreshed.cookie) auth.cookie = refreshed.cookie;
      return post(name, input, auth, false);
    }
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
  for (const origin of new Set(
    (process.env.FEEDBACKS_QA_SELECTION_URLS || "")
      .split(",")
      .filter(Boolean)
      .map((url) => new URL(url).origin),
  ))
    await post(
      "projects.create",
      { name: `Selection QA ${new URL(origin).hostname}`, origins: [origin] },
      auth,
    );
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

  if (!process.env.FEEDBACKS_QA_SELECTED_TEXT_ONLY)
    await verifySetup({ context, worker, post, access, extensionId, root });
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

  const fixture = await installReviewFixture(context);
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

  if (!process.env.FEEDBACKS_QA_SELECTED_TEXT_ONLY) {
    await verifyPublicCapture({
      context,
      page,
      publicCaptureUrl,
      tabId,
      send,
      draft,
      extensionId,
      post,
      auth,
      results,
    });

    await verifyPopupOptions({
      context,
      control,
      extensionId,
      access,
      worker,
      send,
      page,
      tabId,
      root,
      toFixture,
    });
    await verifyDiagnosticDom({ page, control, toFixture, tabId, send, draft, results });
    await verifyLargeVisibleCapture({
      context,
      page,
      toFixture,
      tabId,
      send,
      draft,
      extensionId,
      post,
      auth,
      results,
    });
  }
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
  await verifySelectionBlockers({
    page,
    fixture,
    toFixture,
    exposeReviewRoot,
    send,
    id,
    worker,
    results,
  });
  await verifySelectedText({
    page,
    fixture,
    toFixture,
    exposeReviewRoot,
    send,
    id,
    worker,
    draft,
    results,
    waitReview,
    root,
    context,
    extensionId,
    post,
    auth,
    access,
  });
  await verifyLiveSelection({ page, send, id, worker, exposeReviewRoot, root, results });
  if (!process.env.FEEDBACKS_QA_SELECTED_TEXT_ONLY) {
    const sendFromReview = await verifyReviewInteractions({
      page,
      fixture,
      toFixture,
      exposeReviewRoot,
      send,
      id,
      worker,
      draft,
      results,
      waitReview,
      inspectReview,
    });
    await verifyCaptureSafety({
      page,
      fixture,
      toFixture,
      exposeReviewRoot,
      send,
      id,
      worker,
      draft,
      results,
      waitReview,
      inspectReview,
    });
    const { inlineThreadId, inlineThread, setCaptureMarker } =
      await verifyInlineSubmission({
        page,
        fixture,
        toFixture,
        exposeReviewRoot,
        send,
        id,
        worker,
        draft,
        results,
        waitReview,
        inspectReview,
        saveInlinePoint,
        root,
        context,
        extensionId,
        post,
        auth,
      });
    const teammateAuth = await verifySharedPins({
      page,
      worker,
      id,
      send,
      results,
      root,
      post,
      auth,
      access,
      inlineThreadId,
      inlineThread,
      paired,
    });
    await verifyPendingPoints({
      fixture,
      toFixture,
      exposeReviewRoot,
      send,
      id,
      page,
      root,
      worker,
      context,
      extensionId,
      draft,
      post,
      auth,
      teammateAuth,
      access,
      saveInlinePoint,
      setCaptureMarker,
      results,
    });
    await verifyMultiscrollReview({
      setCaptureMarker,
      page,
      saveInlinePoint,
      worker,
      id,
      send,
      draft,
      results,
      context,
      extensionId,
      root,
      previewDimensions,
      toFixture,
      exposeReviewRoot,
      waitReview,
      inspectReview,
    });
    await verifyFullpageScopes({
      fixture,
      page,
      toFixture,
      send,
      id,
      draft,
      results,
      root,
    });
    const { seriesThreadId, seriesThread } = await verifyOrderedCapture({
      fixture,
      page,
      toFixture,
      send,
      id,
      draft,
      context,
      extensionId,
      previewDimensions,
      results,
      root,
      worker,
      access,
      post,
      auth,
    });
    await verifyPageReview({
      fixture,
      toFixture,
      send,
      id,
      draft,
      context,
      extensionId,
      results,
      previewDimensions,
      worker,
      post,
      auth,
      access,
    });
    await verifyChangingCapture({
      page,
      fixture,
      toFixture,
      exposeReviewRoot,
      send,
      id,
      saveInlinePoint,
      worker,
      draft,
      context,
      extensionId,
      results,
    });
    await verifyDiagnostics({
      page,
      fixture,
      toFixture,
      exposeReviewRoot,
      send,
      id,
      root,
      worker,
      context,
      extensionId,
      draft,
      post,
      auth,
      results,
      access,
    });
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
      checked: true,
      download: true,
      boundedPreview: true,
      localArchive: true,
      submitted: true,
      draftCleared: true,
    });
    await verifyThreadReview({
      context,
      auth,
      access,
      inlineThread,
      inlineThreadId,
      root,
      results,
    });
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
    await verifyGithubToolbar({
      context,
      access,
      seriesThreadId,
      seriesThread,
      root,
      results,
    });
    await verifyRecordingControls({
      page,
      send,
      id,
      sendFromReview,
      context,
      root,
      results,
      worker,
    });

    await verifyReviewDefaults({ page, tabId, send, worker, post, access, results });
  }
  if (!process.env.FEEDBACKS_QA_SELECTED_TEXT_ONLY)
    await verifyCaptureTriage({
      context,
      worker,
      post,
      auth,
      access,
      extensionId,
      root,
      page,
      toFixture,
      tabId,
      send,
      results,
    });
  console.log(JSON.stringify(results));
} finally {
  if (context) await context.close();
  sandbox.kill("SIGTERM");
  await rm(profile, { recursive: true, force: true });
}
