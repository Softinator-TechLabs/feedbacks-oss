import { chromium } from "playwright";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, cp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
const servers = [];
const origins = [];
for (let index = 0; index < 3; index++) {
  const server = createServer((req, res) =>
    res.end(
      `<!doctype html><h1>Origin ${index}</h1><input aria-label="Cross-site field"><a href="${origins[1] || ""}/approved">Approved redirect</a><button onclick="console.error('origin-${index}',{code:42})">Inspect origin ${index}</button>`,
    ),
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  servers.push(server);
  origins.push(`http://127.0.0.1:${server.address().port}`);
}
const profile = await mkdtemp(path.join(tmpdir(), "feedbacks-origin-"));
const extension = path.join(profile, "extension");
await cp("dist/extension/unpacked", extension, { recursive: true });
const manifest = JSON.parse(
  await readFile(path.join(extension, "manifest.json"), "utf8"),
);
manifest.host_permissions = ["<all_urls>"];
await writeFile(path.join(extension, "manifest.json"), JSON.stringify(manifest));
const context = await chromium.launchPersistentContext(path.join(profile, "profile"), {
  channel: "chromium",
  headless: true,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
try {
  const worker =
    context.serviceWorkers()[0] || (await context.waitForEvent("serviceworker"));
  const id = new URL(worker.url()).host;
  const page = await context.newPage();
  await page.goto(origins[0]);
  const tabId = await worker.evaluate(
    async (url) => (await chrome.tabs.query({})).find((t) => t.url === url + "/").id,
    origins[0],
  );
  const initial = {
    sourceTabId: tabId,
    projectId: crypto.randomUUID(),
    reviewId: crypto.randomUUID(),
    server: "https://feedback.test",
    origin: origins[0],
    url: origins[0] + "/",
    viewport: { width: 1280, height: 800 },
  };
  await worker.evaluate(
    async (target) =>
      chrome.storage.local.set({
        server: target.server,
        accounts: { [target.server]: { token: "synthetic" } },
        sessions: { [target.sourceTabId]: target },
      }),
    initial,
  );
  const recorder = await context.newPage();
  await recorder.goto(`chrome-extension://${id}/session.html?sourceTabId=${tabId}`);
  await recorder.locator("#redirect-options summary").click();
  await recorder.locator("#redirect-origins").fill(origins[1]);
  await recorder.locator("#start").click();
  await recorder.locator("#stop:not([hidden])").waitFor();
  const send = (message) =>
    recorder.evaluate(async (message) => {
      const r = await chrome.runtime.sendMessage(message);
      if (!r.ok) throw Error(r.error);
      return r.data;
    }, message);
  const otherProject = crypto.randomUUID();
  await worker.evaluate(
    async ({ target, otherProject, origin }) =>
      chrome.storage.local.set({
        sessions: {
          [target.sourceTabId]: {
            ...target,
            origin,
            projectId: otherProject,
            reviewId: crypto.randomUUID(),
          },
        },
      }),
    { target: initial, otherProject, origin: origins[1] },
  );
  await page.getByRole("link", { name: "Approved redirect" }).click();
  await page.waitForTimeout(700);
  await page.locator("input").fill("Across approved origin");
  await page.locator("button").click();
  await page.waitForTimeout(300);
  let state = await send({ type: "sessionStatus" });
  assert.equal(state.active, true);
  assert.equal(state.target.projectId, initial.projectId);
  assert.equal(state.recording.url, initial.url);
  assert.equal(state.currentOrigin, origins[1]);
  assert.deepEqual(
    state.recording.environment.captureOrigins.map((value) => new URL(value).origin),
    [origins[0], origins[1]],
  );
  assert.ok(
    state.recording.events.filter((e) => e.type === "replay" && e.data.type === 2)
      .length >= 2,
  );
  assert.ok(
    state.recording.events.some((e) => e.data.value === "Across approved origin"),
  );
  assert.ok(
    state.recording.events.some(
      (e) =>
        e.type === "activity" &&
        e.data.action === "click" &&
        e.data.label === "Approved redirect",
    ),
    "navigation-triggering click must survive approved cross-origin redirect",
  );
  await page.goto(origins[2]);
  await page.locator("button").click();
  await page.waitForTimeout(250);
  state = await send({ type: "sessionStatus" });
  assert.equal(state.scopeActive, false);
  assert.ok(!JSON.stringify(state.recording.events).includes("origin-2"));
  await page.goto(origins[1] + "/return");
  await page.waitForTimeout(700);
  await page.locator("button").click();
  await page.waitForTimeout(200);
  state = await send({ type: "sessionStop" });
  assert.equal(state.target.projectId, initial.projectId);
  assert.ok(
    state.recording.events.filter((e) => e.type === "replay" && e.data.type === 2)
      .length >= 3,
  );
  await recorder.reload();
  await recorder.getByRole("region", { name: "Recorded moments" }).waitFor();
  const restored = await send({ type: "sessionStatus" });
  assert.equal(restored.recording.events.length, state.recording.events.length);
  console.log(
    "PASS explicit cross-origin capture retains original project/account, captures approved redirect DOM+typing+console, excludes unknown origin, reinjects on return and survives recorder reload",
  );
} finally {
  await context.close();
  for (const server of servers) server.close();
  await rm(profile, { recursive: true, force: true });
}
