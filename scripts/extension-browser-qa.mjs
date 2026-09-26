import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import sharp from "sharp";

const root = process.cwd();
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
        ? '<script>let size=2100; setInterval(()=>{ size=size===2100?2300:2100; document.querySelector("main").style.height=size+"px" },75)</script>'
        : "";
    return route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<!doctype html><title>Feedback fixture</title><style>body{margin:0;font:16px sans-serif}header{position:sticky;top:0;background:#eee;padding:16px}main{height:${height}px;padding:16px}</style><header>Sticky header</header><main><h1>Controlled page</h1><img src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs" /><a href="/missing">Broken same-origin link</a></main>${change}`,
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

  await toFixture();
  await mkdir(join(root, ".local/remaining-todos-qa"), { recursive: true });
  await control.screenshot({
    path: join(root, ".local/remaining-todos-qa/access-status.png"),
  });
  const id = await tabId();
  results.qa = await send({ type: "popupAction", tabId: id, action: "qa-scan" });
  const qaDraft = await draft();
  results.qaDraft = {
    hasAltFinding: /alt/i.test(qaDraft?.body || ""),
    hasBrokenLink: /missing/i.test(qaDraft?.body || ""),
    hasImage: Boolean(qaDraft?.image),
  };
  await send({ type: "discard" });

  for (const scope of ["short", "long", "tall", "tooLong"]) {
    mode = scope;
    if (["tall", "tooLong"].includes(scope))
      await page.setViewportSize({ width: 1200, height: 800 });
    await toFixture();
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
    if (["long", "tall", "tooLong"].includes(scope) && captured?.capturePages?.length) {
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
  await seriesEditor.screenshot({
    path: join(root, ".local/remaining-todos-qa/ordered-editor.png"),
  });
  results.seriesReview = {
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
  await seriesEditor.locator("#send").click();
  await seriesEditor.getByRole("button", { name: "Retry Send" }).waitFor();
  const interrupted = await draft();
  results.seriesReview.resumeIndex = interrupted?.uploadIndex;
  results.seriesReview.frozenAfterInterruption = interrupted?.frozen;
  await seriesEditor.locator("#send").click();
  await seriesEditor.getByText("Feedback sent").waitFor({ timeout: 120000 });
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
  assert.deepEqual(
    results.seriesReview.assetNames,
    seriesDraft.capturePages.map((item) => item.name),
  );
  assert.equal(results.seriesReview.draftCleared, true);

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
  assert.equal(results.qa.captured, true);
  assert.deepEqual(results.qaDraft, {
    hasAltFinding: true,
    hasBrokenLink: true,
    hasImage: true,
  });
  for (const scope of ["short", "long"]) {
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
