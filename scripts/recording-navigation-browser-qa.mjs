import { chromium } from "playwright";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, mkdir, cp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
let projects = [];
const servers = [],
  origins = [];
for (let index = 0; index < 3; index++) {
  const server = createServer((req, res) => {
    if (req.url.startsWith("/api/")) {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          ok: true,
          data: { items: req.url === "/api/projects.list" ? projects : [] },
        }),
      );
      return;
    }
    res.setHeader("Content-Type", "text/html");
    res.end(
      `<!doctype html><title>Capture origin ${index}</title><h1>Origin ${index}</h1><input aria-label="Navigation input"><a href="${origins[1]}/next">Go to approved site</a><button onclick="console.error('navigation-probe-${index}');fetch('/probe')">Site action</button><script>setTimeout(() => { console.log('page-load-${index}'); fetch('/load-probe'); }, 20);</script>`,
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  servers.push(server);
  origins.push(`http://127.0.0.1:${server.address().port}`);
}
const temp = await mkdtemp(path.join(tmpdir(), "feedbacks-navigation-"));
await mkdir(".local", { recursive: true });
const extension = path.join(temp, "extension");
await cp("dist/extension/unpacked", extension, { recursive: true });
// Only the test copy exposes the shadow root so Playwright can inspect controls.
const contentPath = path.join(extension, "content.js");
await writeFile(
  contentPath,
  (await readFile(contentPath, "utf8")).replace(
    'root = host.attachShadow({ mode: "closed" })',
    'root = host.attachShadow({ mode: "open" })',
  ),
);
const manifest = JSON.parse(
  await readFile(path.join(extension, "manifest.json"), "utf8"),
);
manifest.host_permissions = ["<all_urls>"];
await writeFile(path.join(extension, "manifest.json"), JSON.stringify(manifest));
const browser = await chromium.launchPersistentContext(path.join(temp, "profile"), {
  channel: "chromium",
  headless: true,
  // Native screenshots use the actual content area, including Chrome's debugger
  // banner. Viewport emulation would report dimensions the screenshot cannot have.
  viewport: null,
  args: [
    "--window-size=1280,900",
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
    "--autoplay-policy=no-user-gesture-required",
  ],
});
browser.setDefaultTimeout(15000);
try {
  const worker =
    browser.serviceWorkers()[0] || (await browser.waitForEvent("serviceworker"));
  const id = new URL(worker.url()).host;
  const page = await browser.newPage();
  await page.goto(origins[0]);
  const tabId = await worker.evaluate(
    async (url) => (await chrome.tabs.query({})).find((t) => t.url === url).id,
    page.url(),
  );
  const target = {
    sourceTabId: tabId,
    server: origins[0],
    projectId: crypto.randomUUID(),
    reviewId: crypto.randomUUID(),
    origin: origins[0],
    url: page.url(),
    viewport: { width: 1280, height: 720 },
  };
  projects = [
    {
      id: target.projectId,
      name: "Original project",
      origins: [origins[0]],
      permissions: { canWrite: true, canResolve: true },
    },
    {
      id: crypto.randomUUID(),
      name: "Destination project",
      origins: [origins[1]],
      permissions: { canWrite: true, canResolve: true },
    },
  ];
  await worker.evaluate(
    async (target) =>
      chrome.storage.local.set({
        server: target.server,
        accounts: { [target.server]: { token: "synthetic" } },
        sessions: { [target.sourceTabId]: target },
        reviewDefaults: { highlightEnabled: true, recordingHighlightEnabled: true },
      }),
    target,
  );
  const recorder = await browser.newPage();
  await recorder.goto(`chrome-extension://${id}/session.html?sourceTabId=${tabId}`);
  const send = (message, p = recorder) =>
    p.evaluate(async (message) => {
      const r = await chrome.runtime.sendMessage(message);
      if (!r.ok) throw Error(r.error);
      return r.data;
    }, message);
  const annotate = async (owner, mode) => {
    await page.bringToFront();
    const comment = `${mode} saved screenshot point`;
    const editor = page.getByRole("textbox", { name: "Comment on selected element" });
    const dialog = page.getByRole("dialog", { name: "Feedback at this point" });
    await page
      .getByRole("button", { name: "Site action", exact: true })
      .click({ button: "right" });
    await editor.waitFor();
    const paused = await send({ type: "sessionStatus" }, owner);
    assert.ok(
      paused.annotationPause,
      "right-click pauses debug capture before opening the editor",
    );
    await editor.fill(comment);
    await page.evaluate(() => console.error("PAUSED_EDITOR_CONSOLE_CANARY"));
    await page.waitForFunction(() => {
      const tip = document
        .querySelector("#feedbacks-review-root")
        ?.shadowRoot?.querySelector(".point-tip")?.textContent;
      return tip && !tip.startsWith("Capturing");
    });
    assert.match(await dialog.locator(".point-tip").innerText(), /^Original saved/);
    if (mode === "video")
      await page.screenshot({ path: ".local/recording-point-editor.png" });
    await dialog.getByRole("button", { name: "Save point", exact: true }).click();
    await dialog.waitFor({ state: "hidden" }).catch(async (error) => {
      throw Error(`${mode} point save did not resume: ${await dialog.innerText()}`, {
        cause: error,
      });
    });
    await page
      .getByRole("button", {
        name: mode === "video" ? "Pause video" : "Stop session",
        exact: true,
      })
      .waitFor();
    const saved = await send({ type: "recordingAnnotations" }, owner);
    assert.equal(saved.items.length, 1);
    assert.equal(saved.items[0].body, comment);
    assert.match(saved.items[0].imageBase64, /^data:image\//);
    const pixels = await owner.evaluate(async (url) => {
      const bitmap = await createImageBitmap(await (await fetch(url)).blob());
      const size = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return size;
    }, saved.items[0].imageBase64);
    assert.ok(pixels.width > 0 && pixels.height > 0);
    await page
      .getByRole("button", { name: "Site action", exact: true })
      .click({ button: "right" });
    await editor.waitFor();
    await editor.fill("CANCELLED_EDITOR_INPUT_CANARY");
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    await page
      .getByRole("button", {
        name: mode === "video" ? "Pause video" : "Stop session",
        exact: true,
      })
      .waitFor();
    const resumed = await send({ type: "sessionStatus" }, owner);
    assert.equal(resumed.annotationPause, null);
    assert.equal(resumed.annotationIntervals.length, 2);
    assert.equal((await send({ type: "recordingAnnotations" }, owner)).items.length, 1);
    assert.equal(
      resumed.recording.events.filter((e) => e.data.action === "annotation").length,
      1,
    );
    assert.ok(
      !resumed.recording.events.some(
        (e) => e.data.action === "input" && e.data.value === comment,
      ),
    );
    assert.ok(
      !JSON.stringify(resumed.recording.events).includes("CANCELLED_EDITOR_INPUT_CANARY"),
    );
    assert.ok(
      !JSON.stringify(resumed.recording.events).includes("PAUSED_EDITOR_CONSOLE_CANARY"),
    );
    if (mode === "session") assert.ok(resumed.pausedMs > 0);
  };
  await recorder.locator("#redirect-options summary").click();
  await recorder.locator("#redirect-origins").fill(origins[1]);
  await recorder.locator("#start").click();
  await recorder.locator("#stop:not([hidden])").waitFor();
  await page.goto(origins[0] + "/same-origin");
  await page.getByRole("button", { name: "Stop session", exact: true }).waitFor();
  await page.getByRole("link", { name: "Go to approved site" }).click();
  await page.getByRole("button", { name: "Stop session", exact: true }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Pause video", exact: true }).count(),
    0,
  );
  await page.getByLabel("Navigation input").fill("Session redirect input");
  await page.getByRole("button", { name: "Site action", exact: true }).click();
  await annotate(recorder, "session");
  await page.goto(origins[2]);
  assert.equal(await page.locator("#feedbacks-review-root").count(), 0);
  const suspended = await send({ type: "sessionStatus" });
  assert.equal(
    suspended.active,
    true,
    `Leaving approved origins should suspend capture: ${JSON.stringify(suspended.recording.coverage)}`,
  );
  assert.equal(suspended.scopeActive, false);
  await page.getByLabel("Navigation input").fill("outside-origin-input-canary");
  await page.getByRole("button", { name: "Site action", exact: true }).click();
  await page.goto(origins[1] + "/return");
  await page.getByRole("button", { name: "Stop session", exact: true }).waitFor();
  await page.getByLabel("Navigation input").fill("Session resumed input");
  await page.getByRole("button", { name: "Stop session", exact: true }).click();
  await recorder.getByRole("region", { name: "Recorded moments" }).waitFor();
  await page.getByRole("button", { name: "Review session", exact: true }).waitFor();
  await page.getByRole("button", { name: "Review session", exact: true }).click();
  let state = await send({ type: "sessionStatus" });
  assert.equal(state.target.projectId, target.projectId);
  assert.ok(
    state.recording.events.some((e) => e.data.value === "Session redirect input"),
  );
  assert.ok(state.recording.events.some((e) => e.data.value === "Session resumed input"));
  assert.ok(
    !JSON.stringify(state.recording.events).includes("outside-origin-input-canary"),
  );
  assert.ok(!JSON.stringify(state.recording.events).includes("navigation-probe-2"));
  assert.ok(state.recording.events.some((e) => e.data.action === "loading"));
  assert.ok(
    state.recording.events.some(
      (e) =>
        e.type === "network" &&
        e.data.phase === "request" &&
        e.data.url === origins[1] + "/return",
    ),
  );
  assert.ok(
    state.recording.events.filter((e) => e.type === "replay" && e.data.type === 2)
      .length >= 3,
  );
  const stored = await worker.evaluate(
    async (tabId) => (await chrome.storage.local.get("sessions")).sessions[tabId],
    tabId,
  );
  assert.equal(stored.reviewId, target.reviewId);
  assert.equal(stored.origin, origins[0]);
  await send({ type: "sessionDiscard" });
  await page.goto(origins[0] + "/video");
  await send({ type: "activate", tabId, projectId: target.projectId });
  const videoReview = await worker.evaluate(
    async (id) => (await chrome.storage.local.get("sessions")).sessions[id],
    tabId,
  );
  await page.evaluate(() => {
    const original = navigator.mediaDevices.setCaptureHandleConfig.bind(
      navigator.mediaDevices,
    );
    navigator.mediaDevices.setCaptureHandleConfig = (config) => {
      window.qaCaptureHandle = config.handle;
      original(config);
    };
  });
  const video = await browser.newPage();
  await video.goto(
    `chrome-extension://${id}/video.html?sourceTabId=${tabId}&reviewId=${videoReview.reviewId}`,
  );
  await video
    .locator("#start:enabled")
    .waitFor()
    .catch(async (error) => {
      throw Error(
        `Video recorder did not become ready: ${await video.locator("#status").textContent()}`,
        { cause: error },
      );
    });
  assert.equal(await video.locator("#debug-context").isChecked(), true);
  await page.waitForFunction(() => !!window.qaCaptureHandle);
  const handle = await page.evaluate(() => window.qaCaptureHandle);
  // The picker is replaced with a real canvas MediaStream; Chrome messaging,
  // MediaRecorder, debugger capture, navigation and on-page controls are real.
  await video.evaluate(
    ({ handle, origin }) => {
      navigator.mediaDevices.getDisplayMedia = async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 640;
        canvas.height = 360;
        const ctx = canvas.getContext("2d");
        const draw = () => {
          ctx.fillStyle = "white";
          ctx.fillRect(0, 0, 640, 360);
          ctx.fillStyle = "black";
          ctx.fillText(String(Date.now()), 30, 40);
        };
        draw();
        const stream = canvas.captureStream(24);
        const timer = setInterval(draw, 40);
        const track = stream.getVideoTracks()[0];
        track.getSettings = () => ({
          displaySurface: "browser",
          width: 640,
          height: 360,
        });
        track.getCaptureHandle = () => ({ handle, origin });
        track.addEventListener("ended", () => clearInterval(timer));
        return stream;
      };
    },
    { handle, origin: origins[0] },
  );
  await video.locator("#redirect-options summary").click();
  await video.locator("#redirect-origins").fill(origins[1]);
  await video.getByRole("button", { name: "Allow redirect sites", exact: true }).click();
  await video.locator("#start").click();
  await page.getByRole("button", { name: "Pause video", exact: true }).waitFor();
  await page.getByRole("link", { name: "Go to approved site" }).click();
  await page.getByRole("button", { name: "Pause video", exact: true }).waitFor();
  await page.getByLabel("Navigation input").fill("Video redirect input");
  await page.getByRole("button", { name: "Site action", exact: true }).click();
  await annotate(video, "video");
  await page.goto(origins[2] + "/video-outside");
  assert.equal(await page.locator("#feedbacks-review-root").count(), 0);
  const videoSuspended = await send({ type: "sessionStatus" }, video);
  assert.equal(videoSuspended.active, true);
  assert.equal(videoSuspended.scopeActive, false);
  await page.getByRole("button", { name: "Site action", exact: true }).click();
  await page.goto(origins[1] + "/video-return");
  await page.getByRole("button", { name: "Pause video", exact: true }).waitFor();
  await page.getByRole("button", { name: "Pause video", exact: true }).click();
  await page.getByRole("button", { name: "Resume video", exact: true }).waitFor();
  await page.reload();
  await page.getByRole("button", { name: "Resume video", exact: true }).waitFor();
  await page.getByRole("button", { name: "Resume video", exact: true }).click();
  await page.getByRole("button", { name: "Pause video", exact: true }).waitFor();
  await page.waitForTimeout(200);
  await page.getByRole("button", { name: "Stop video", exact: true }).click();
  await video.getByRole("region", { name: "Recorded moments" }).waitFor();
  await video
    .getByRole("heading", { name: "Screenshot comments (1)", exact: true })
    .waitFor();
  await video.screenshot({
    path: ".local/recording-annotation-review.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Review video", exact: true }).waitFor();
  state = await send({ type: "sessionStatus" }, video);
  assert.equal(state.active, false);
  assert.equal(state.target.projectId, target.projectId);
  assert.ok(state.recording.events.some((e) => e.data.value === "Video redirect input"));
  assert.ok(state.recording.events.some((e) => e.type === "console"));
  assert.ok(state.recording.events.some((e) => e.type === "network"));
  assert.ok(state.recording.events.some((e) => e.data.action === "loading"));
  assert.ok(!JSON.stringify(state.recording.events).includes("navigation-probe-2"));
  const pixels = await video.locator("#preview").evaluate((v) => ({
    width: v.videoWidth,
    height: v.videoHeight,
    duration: v.duration,
  }));
  assert.equal(pixels.width, 640);
  assert.ok(Number.isFinite(pixels.duration) && pixels.duration > 0);
  console.log(
    "PASS session/video navigation and suspension/return; screenshot point Save/Cancel pause and resume without editor leakage; original project preserved; default loading/network/console evidence and real MediaRecorder preview retained",
  );
} finally {
  await browser.close();
  for (const server of servers) server.close();
  await rm(temp, { recursive: true, force: true });
}
