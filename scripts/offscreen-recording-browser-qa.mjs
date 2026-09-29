import { chromium } from "playwright";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, cp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

const projectId = crypto.randomUUID();
let origin;
const server = createServer((req, res) => {
  if (req.url?.startsWith("/api/")) {
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        ok: true,
        data: {
          items:
            req.url === "/api/projects.list"
              ? [
                  {
                    id: projectId,
                    name: "Recording QA",
                    origins: [origin],
                    permissions: { canWrite: true, canResolve: true },
                  },
                ]
              : [],
        },
      }),
    );
    return;
  }
  res.setHeader("Content-Type", "text/html");
  res.end(
    "<!doctype html><title>Offscreen recording QA</title><h1>Capture source</h1><button id=\"action\" onclick=\"console.warn('qa warning');fetch('/probe')\">Act</button>",
  );
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
origin = `http://127.0.0.1:${server.address().port}`;
const temp = await mkdtemp(path.join(tmpdir(), "feedbacks-offscreen-qa-"));
const extension = path.join(temp, "extension");
await cp("dist/extension/unpacked", extension, { recursive: true });
const contentPath = path.join(extension, "content.js");
await writeFile(
  contentPath,
  (await readFile(contentPath, "utf8")).replace(
    'attachShadow({ mode: "closed" })',
    'attachShadow({ mode: "open" })',
  ),
);
// Headless activation bypasses the toolbar gesture that grants activeTab. Keep
// the packaged control, diagnostics, offscreen recorder, and review handoff real;
// substitute only tabCapture's one-use stream with a visible moving canvas.
const backgroundPath = path.join(extension, "background.js");
await writeFile(
  backgroundPath,
  (await readFile(backgroundPath, "utf8")).replace(
    "const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });",
    'const streamId = "qa-test-stream";',
  ),
);
const offscreenPath = path.join(extension, "offscreen-video.html");
await writeFile(
  offscreenPath,
  (await readFile(offscreenPath, "utf8")).replace(
    '<script type="module" src="offscreen-video.js"></script>',
    '<script src="qa-offscreen.js"></script><script type="module" src="offscreen-video.js"></script>',
  ),
);
await writeFile(
  path.join(extension, "qa-offscreen.js"),
  `
  const canvas = document.createElement('canvas');
  canvas.width = 640; canvas.height = 360;
  const context = canvas.getContext('2d');
  setInterval(() => {
    context.fillStyle = '#17324d'; context.fillRect(0, 0, 640, 360);
    context.fillStyle = '#fff'; context.fillText(String(Date.now()), 20, 40);
  }, 40);
  navigator.mediaDevices.getUserMedia = async () => canvas.captureStream(24);
`,
);
const manifestPath = path.join(extension, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
manifest.host_permissions = ["<all_urls>"];
await writeFile(manifestPath, JSON.stringify(manifest));
const browser = await chromium.launchPersistentContext(path.join(temp, "profile"), {
  channel: "chromium",
  headless: true,
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
  await page.goto(origin);
  const tabId = await worker.evaluate(
    async (url) => (await chrome.tabs.query({})).find((tab) => tab.url === url).id,
    page.url(),
  );
  await worker.evaluate(
    async ({ origin, tabId }) =>
      chrome.storage.local.set({
        server: origin,
        accounts: { [origin]: { token: "synthetic" } },
        videoRecordingOptions: { tabAudio: false, microphone: false },
      }),
    { origin, tabId },
  );
  const control = await browser.newPage();
  await control.goto(`chrome-extension://${id}/options.html`);
  const activate = await control.evaluate(
    async ({ tabId, projectId }) =>
      chrome.runtime.sendMessage({ type: "activate", tabId, projectId }),
    { tabId, projectId },
  );
  assert.equal(activate.ok, true, JSON.stringify(activate));
  await page.bringToFront();
  await page.locator(".drawer-handle").hover();
  const start = page.getByRole("button", { name: "Record video + session" });
  await start.waitFor();
  await start.click();
  await page
    .getByRole("button", { name: "Pause video" })
    .waitFor({ timeout: 12000 })
    .catch(async (error) => {
      const source = await page
        .locator("#feedbacks-review-root")
        .evaluate((node) => node.shadowRoot?.querySelector(".notice")?.textContent)
        .catch(() => "source unavailable");
      const state = await control.evaluate(async () =>
        chrome.runtime.sendMessage({ type: "sessionStatus" }),
      );
      throw Error(`Video start failed: ${source}\n${JSON.stringify(state)}`, {
        cause: error,
      });
    });
  assert.equal(
    browser.pages().filter((tab) => tab.url().includes("/video.html")).length,
    0,
    "starting should not open a recorder tab",
  );
  await page.locator("#action").click();
  await page.waitForTimeout(550);
  const reviewOpened = browser.waitForEvent("page", {
    predicate: (tab) =>
      tab.url().includes("/video.html?") && tab.url().includes("draftId="),
    timeout: 12000,
  });
  await page.getByRole("button", { name: "Stop video" }).click();
  const review = await reviewOpened.catch(async (error) => {
    const source = await page.locator("#feedbacks-review-root").evaluate((node) => ({
      notice: node.shadowRoot?.querySelector(".notice")?.textContent,
      controls: node.shadowRoot?.querySelector(".recording-controls")?.textContent,
    }));
    const contexts = await worker.evaluate(async () => ({
      contexts: await chrome.runtime.getContexts({}),
      tabs: await chrome.tabs.query({}),
    }));
    const state = await control.evaluate(async () =>
      chrome.runtime.sendMessage({ type: "sessionStatus" }),
    );
    throw Error(`Review did not open: ${JSON.stringify({ source, contexts, state })}`, {
      cause: error,
    });
  });
  await review.locator("#preview").waitFor({ state: "visible" });
  const status = await control.evaluate(async () =>
    chrome.runtime.sendMessage({ type: "sessionStatus" }),
  );
  assert.equal(status.ok, true, JSON.stringify(status));
  assert.ok(status.data.recording.events.some((event) => event.type === "activity"));
  assert.ok(status.data.recording.events.some((event) => event.type === "console"));
  assert.ok(status.data.recording.events.some((event) => event.type === "network"));
  assert.ok(await review.locator("#preview").evaluate((video) => video.videoWidth > 0));
  console.log(
    "PASS one-click hidden video + session, source controls, console/network/activity, Stop-to-review handoff",
  );
} finally {
  await browser.close();
  server.close();
  await rm(temp, { recursive: true, force: true });
}
