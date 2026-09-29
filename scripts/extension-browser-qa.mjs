import { verifyReviewInteractions } from "./qa/extension/review-interactions.mjs";
import { verifyCaptureSafety } from "./qa/extension/capture-safety.mjs";
import { verifyChangingCapture } from "./qa/extension/changing-capture.mjs";
import { verifyDiagnostics } from "./qa/extension/diagnostics.mjs";
import { verifyOrderedCapture } from "./qa/extension/ordered-capture.mjs";
import { verifyPageReview } from "./qa/extension/page-review.mjs";
import { verifyThreadReview } from "./qa/extension/thread-review.mjs";
import { verifyReviewDefaults } from "./qa/extension/review-defaults.mjs";
import { verifyGithubToolbar } from "./qa/extension/github-toolbar.mjs";
import { verifyRecordingControls } from "./qa/extension/recording-controls.mjs";
import { verifyPublicCapture } from "./qa/extension/public-capture.mjs";
import { verifyPopupOptions } from "./qa/extension/popup-options.mjs";
import { previewDimensions, installReviewFixture } from "./qa/extension/fixture.mjs";
import { verifySetup } from "./qa/extension/setup.mjs";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import sharp from "sharp";

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
  fixture.mode = "long";
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
  const setCaptureMarker = async (style, size) =>
    worker.evaluate(
      async ({ tabId, style, size }) => {
        const [entry] = await chrome.scripting.executeScript({
          target: { tabId },
          func: ({ style, size }) => {
            const panel = globalThis.__feedbacksQaRoot;
            const styleSelect = panel.querySelector(
              '[aria-label="Screenshot marker for this review"]',
            );
            const sizeSelect = panel.querySelector(
              '[aria-label="Screenshot marker size for this review"]',
            );
            styleSelect.value = style;
            styleSelect.dispatchEvent(new Event("change", { bubbles: true }));
            sizeSelect.value = size;
            sizeSelect.dispatchEvent(new Event("change", { bubbles: true }));
            return { sizeDisabled: sizeSelect.disabled };
          },
          args: [{ style, size }],
        });
        return {
          ...entry.result,
          marker: (await chrome.tabs.sendMessage(tabId, { type: "captureContext" }))
            .captureMarker,
        };
      },
      { tabId: id, style, size },
    );
  assert.deepEqual(await setCaptureMarker("none", "large"), {
    sizeDisabled: true,
    marker: { style: "none", size: "large" },
  });
  assert.deepEqual(await setCaptureMarker("arrow", "medium"), {
    sizeDisabled: false,
    marker: { style: "arrow", size: "medium" },
  });
  assert.deepEqual(await setCaptureMarker("ring", "small"), {
    sizeDisabled: false,
    marker: { style: "ring", size: "small" },
  });
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
  assert.ok(
    inlineThread.assets.every((asset) => asset.rendition === "screenshot"),
    "approved point captures should keep pins in metadata, outside the image pixels",
  );
  assert.deepEqual(
    inlineThread.assets[0].markings
      .filter((mark) => mark.tool === "point")
      .map((mark) => mark.annotationId),
    inlineThread.context.annotations.map((item) => item.id),
  );
  assert.ok(inlineThread.assets[0].markings.some((mark) => mark.tool === "arrow"));
  assert.ok(inlineThread.assets[0].markings.some((mark) => mark.tool === "pencil"));
  assert.equal(inlineThread.context.captureMarker.style, "ring");
  assert.equal(
    inlineThread.assets[0].markings.some((mark) => mark.origin === "element"),
    false,
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
  for (let attempt = 0; attempt < 30; attempt++) {
    teammatePin = await inspectPin(hoverComments[0]);
    if (teammatePin?.link) break;
    await page.waitForTimeout(100);
  }
  assert.equal(teammatePin?.resolve, false);
  assert.equal(teammatePin?.link, `${access.url}/threads/${inlineThreadId}`);
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

  fixture.mode = "long";
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
  assert.deepEqual(await setCaptureMarker("none", "large"), {
    sizeDisabled: true,
    marker: { style: "none", size: "large" },
  });
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
  assert.deepEqual(multiVisible.context.captureMarker, { style: "none", size: "large" });
  assert.ok(
    multiVisible.pageToolStates.every((shapes) =>
      shapes.some((shape) => shape.tool === "point" && shape.markerStyle === "none"),
    ),
  );
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
  assert.equal(pointsThread.context.captureMarker.style, "none");
  assert.ok(
    pointsThread.assets.every((asset) =>
      asset.markings.some((mark) => mark.tool === "point"),
    ),
  );
  assert.deepEqual(
    pointsThread.assets.map(
      (asset) => asset.markings.find((mark) => mark.tool === "point")?.annotationId,
    ),
    pointsThread.context.annotations.map((item) => item.id),
  );
  const markerCookieSplit = teammateAuth.cookie.indexOf("=");
  await context.addCookies([
    {
      name: teammateAuth.cookie.slice(0, markerCookieSplit),
      value: teammateAuth.cookie.slice(markerCookieSplit + 1),
      url: access.url,
      sameSite: "Strict",
    },
  ]);
  const noMarkerThreadPage = await context.newPage();
  const noMarkerResponse = await noMarkerThreadPage.goto(
    `${access.url}/threads/${pointsThreadId}`,
  );
  await noMarkerThreadPage.waitForTimeout(700);
  if (
    !(await noMarkerThreadPage
      .getByRole("heading", { name: "Review on the page" })
      .count())
  )
    throw Error(
      `No-marker thread did not render: ${JSON.stringify({ status: noMarkerResponse?.status(), url: noMarkerThreadPage.url(), text: (await noMarkerThreadPage.locator("body").innerText()).slice(0, 500) })}`,
    );
  assert.equal(await noMarkerThreadPage.locator(".review-point-figure img").count(), 2);
  assert.equal(await noMarkerThreadPage.locator(".review-image-pin").count(), 0);
  assert.equal(
    await noMarkerThreadPage.getByRole("button", { name: "Hide pins" }).count(),
    0,
  );
  await noMarkerThreadPage.close();
  await context.clearCookies();
  assert.equal(await draft(), undefined);
  await pointsEditor.close();
  await page.bringToFront();
  await setCaptureMarker("ring", "small");
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
    fixture.mode = scope;
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
    assert.equal(result?.captured, true, JSON.stringify({ scope, error: result?.error }));
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
    persisted: true,
    marker: true,
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
  console.log(JSON.stringify(results));
} finally {
  if (context) await context.close();
  sandbox.kill("SIGTERM");
  await rm(profile, { recursive: true, force: true });
}
