import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import sharp from "sharp";

const root = process.cwd();
const publicCaptureUrl =
  process.env.FEEDBACKS_QA_PUBLIC_URL || "https://impeccable.style/";
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
    return route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<!doctype html><title>Feedback fixture</title><style>body{margin:0;font:16px sans-serif}header{position:sticky;top:0;background:#eee;padding:16px}main{height:${height}px;padding:16px;position:relative}#lower{position:absolute;top:${Math.max(160, height - 260)}px;left:30px}</style><header>Sticky header</header><main><h1>Controlled page</h1><img src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs" /><a href="/missing">Broken same-origin link</a><button id="lower">Bottom action</button></main>${change}${clipped}`,
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
      await review.locator("#full-page-preview:visible").waitFor({ timeout: 60000 });
      results.publicSite.previewHeight = await review
        .locator("#full-page-preview")
        .evaluate((image) => image.naturalHeight);
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
  await control.screenshot({
    path: join(root, ".local/remaining-todos-qa/access-status.png"),
  });
  const id = await tabId();
  const exposeReviewRoot = () =>
    worker.evaluate(async (tabId) => {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const attach = Element.prototype.attachShadow;
          Element.prototype.attachShadow = function (options) {
            const shadow = attach.call(this, options);
            if (this.id === "feedbacks-review-root")
              globalThis.__feedbacksQaRoot = shadow;
            return shadow;
          };
        },
      });
    }, id);
  const saveInlinePoint = async (target, body) => {
    await target.click({ button: "right" });
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
    return result.count;
  };
  results.qa = await send({ type: "popupAction", tabId: id, action: "qa-scan" });
  const qaDraft = await draft();
  results.qaDraft = {
    hasAltFinding: /alt/i.test(qaDraft?.body || ""),
    hasBrokenLink: /missing/i.test(qaDraft?.body || ""),
    hasImage: Boolean(qaDraft?.image),
  };
  await send({ type: "discard" });

  await toFixture();
  await exposeReviewRoot();
  await send({ type: "activate", tabId: id });
  await page.getByRole("heading", { name: "Controlled page" }).click({ button: "right" });
  await page.screenshot({
    path: join(root, ".local/remaining-todos-qa/inline-comment-desktop.png"),
  });
  await page.keyboard.type("Make this heading shorter");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await page
    .getByRole("link", { name: "Broken same-origin link" })
    .click({ button: "right" });
  await page.keyboard.type("Repair this link");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
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
  const inlineEditor = await context.newPage();
  await inlineEditor.goto(`chrome-extension://${extensionId}/editor.html`);
  await inlineEditor.getByText("Make this heading shorter").waitFor();
  await inlineEditor.getByText("Repair this link").waitFor();
  assert.equal(await inlineEditor.locator("#body").inputValue(), "");
  const inlineCanvas = await inlineEditor.locator("#canvas").boundingBox();
  assert.ok(inlineCanvas);
  await inlineEditor.locator('[data-tool="arrow"]').click();
  await inlineEditor.mouse.move(inlineCanvas.x + 110, inlineCanvas.y + 260);
  await inlineEditor.mouse.down();
  await inlineEditor.mouse.move(inlineCanvas.x + 210, inlineCanvas.y + 300);
  await inlineEditor.mouse.up();
  await inlineEditor.locator('[data-tool="pencil"]').click();
  await inlineEditor.mouse.move(inlineCanvas.x + 250, inlineCanvas.y + 320);
  await inlineEditor.mouse.down();
  await inlineEditor.mouse.move(inlineCanvas.x + 300, inlineCanvas.y + 345, { steps: 4 });
  await inlineEditor.mouse.up();
  await inlineEditor.locator("#send").click();
  await inlineEditor.getByText("Feedback sent").waitFor({ timeout: 120000 });
  const inlineThreadUrl = await inlineEditor.locator("#thread").getAttribute("href");
  const inlineThreadId = inlineThreadUrl?.match(/[0-9a-f-]{36}/)?.[0];
  assert.ok(inlineThreadId);
  const inlineThread = (await post("threads.get", { threadId: inlineThreadId }, auth))
    .data;
  assert.deepEqual(
    inlineThread.context.annotations.map(({ body }) => body),
    ["Make this heading shorter", "Repair this link"],
  );
  assert.equal(inlineThread.assets.length, 1);
  assert.deepEqual(
    inlineThread.assets[0].markings
      .filter((mark) => mark.tool === "point")
      .map((mark) => mark.annotationId),
    inlineThread.context.annotations.map((item) => item.id),
  );
  assert.ok(inlineThread.assets[0].markings.some((mark) => mark.tool === "arrow"));
  assert.ok(inlineThread.assets[0].markings.some((mark) => mark.tool === "pencil"));
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
  await send({ type: "activate", tabId: id });
  const hoverComments = ["Make this heading shorter", "Repair this link"];
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
    assert.ok((await inspectPin(comment))?.preview?.includes(comment));
  }
  await page.screenshot({
    path: join(root, ".local/remaining-todos-qa/inline-comment-hover.png"),
  });
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
  assert.equal(await saveInlinePoint(page.locator("#lower"), "Bottom point"), 1);
  await page.bringToFront();
  await worker.evaluate((tabId) => chrome.tabs.update(tabId, { active: true }), id);
  const multiScroll = await send({
    type: "popupAction",
    tabId: id,
    action: "capture-full",
  });
  const multiScrollDraft = await draft();
  assert.equal(multiScroll.captured, true);
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
  await send({ type: "discard" });

  await page.setViewportSize({ width: 390, height: 844 });
  await toFixture();
  await send({ type: "activate", tabId: id });
  await page.getByRole("heading", { name: "Controlled page" }).click({ button: "right" });
  await page.screenshot({
    path: join(root, ".local/remaining-todos-qa/inline-comment-mobile.png"),
  });
  await page.keyboard.press("Escape");
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
  await seriesEditor
    .locator("#full-page-preview:visible")
    .waitFor()
    .catch(async (error) => {
      throw Error(
        `Preview did not open: ${await seriesEditor.locator("#status").textContent()} (${error.message})`,
      );
    });
  results.seriesReview = {
    previewHeight: await seriesEditor
      .locator("#full-page-preview")
      .evaluate((image) => image.naturalHeight),
    previewWidth: await seriesEditor
      .locator("#full-page-preview")
      .evaluate((image) => image.naturalWidth),
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
        });
    });
  });
  await seriesEditor.locator("#send").click();
  await seriesEditor.getByRole("button", { name: "Retry Send" }).waitFor();
  const interrupted = await draft();
  results.seriesReview.resumeIndex = interrupted?.uploadIndex;
  results.seriesReview.frozenAfterInterruption = interrupted?.frozen;
  results.seriesReview.visibleProgress = await seriesEditor
    .locator("#upload-label")
    .textContent();
  results.seriesReview.meter = await seriesEditor
    .locator("#upload-meter")
    .evaluate((meter) => meter.value);
  await seriesEditor.locator("#send").click();
  await seriesEditor.getByText("Feedback sent").waitFor({ timeout: 120000 });
  results.seriesReview.uploadProgress = await seriesEditor.evaluate(
    () => window.qaUploadProgress,
  );
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
  const reviewImage = await removableEditor.locator("#canvas").boundingBox();
  if (!reviewImage) throw Error("The screenshot is missing from the review editor");
  await removableEditor.mouse.move(reviewImage.x + 32, reviewImage.y + 94);
  await removableEditor.mouse.down();
  await removableEditor.mouse.move(reviewImage.x + 115, reviewImage.y + 155, {
    steps: 4,
  });
  await removableEditor.mouse.up();
  await removableEditor.getByRole("button", { name: "Full page preview" }).click();
  await removableEditor.locator("#full-page-preview:visible").waitFor();
  results.pageReview.previewMarkedPixels = await removableEditor
    .locator("#full-page-preview")
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
  await removableEditor.getByRole("button", { name: "Retry Send" }).waitFor();
  const interruptedCombined = await draft();
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
  const beforeChanging = await page.evaluate(() => scrollY);
  const changed = await send({ type: "popupAction", tabId: id, action: "capture-full" });
  const changingDraft = await draft();
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
  const retryEditor = await context.newPage();
  await retryEditor.goto(`chrome-extension://${extensionId}/editor.html`);
  await retryEditor.getByRole("button", { name: "Retry full-page capture" }).waitFor();
  await retryEditor.getByRole("button", { name: "Retry full-page capture" }).click();
  await retryEditor
    .getByText("Capture ready.", { exact: false })
    .waitFor({ timeout: 120000 });
  results.changing.retryPages = (await draft())?.capturePages?.length;
  assert.ok(results.changing.retryPages > 1);
  await send({ type: "discard" });

  mode = "short";
  await toFixture();
  await send({ type: "activate", tabId: id });
  await send({ type: "diagnostics", tabId: id, action: "start" });
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
    { name: cookieName, value: cookieValue, url: access.url, sameSite: "Lax" },
  ]);
  const inlineThreadPage = await context.newPage();
  await inlineThreadPage.goto(`${access.url}/threads/${inlineThreadId}`);
  await inlineThreadPage.getByRole("heading", { name: "Review on the page" }).waitFor();
  assert.equal(await inlineThreadPage.locator(".review-evidence-pin").count(), 2);
  await inlineThreadPage.locator(".review-evidence-pin").first().hover();
  await inlineThreadPage
    .locator(".review-evidence-popover")
    .getByText("Make this heading shorter")
    .waitFor();
  await inlineThreadPage.screenshot({
    path: join(root, ".local/remaining-todos-qa/thread-inline-desktop.png"),
  });
  await inlineThreadPage.setViewportSize({ width: 390, height: 844 });
  await inlineThreadPage.locator(".review-point-list button").last().click();
  assert.equal(await inlineThreadPage.locator(".review-evidence-pin").count(), 2);
  await inlineThreadPage.screenshot({
    path: join(root, ".local/remaining-todos-qa/thread-inline-mobile.png"),
  });
  results.inlineReview.webPins = 2;
  results.inlineReview.mobilePointSelection = true;
  const threadPage = await context.newPage();
  await threadPage.goto(`${access.url}/threads/${seriesThreadId}`);
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
  console.log(JSON.stringify(results));
} finally {
  if (context) await context.close();
  sandbox.kill("SIGTERM");
  await rm(profile, { recursive: true, force: true });
}
