import { chromium } from "playwright";
import { createServer } from "node:http";
import { mkdtemp, cp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
// Packaged extension acceptance with synthetic pages only. The isolated test copy
// grants hosts to bypass native permission prompts; production grants are separate.
await mkdir(".local", { recursive: true });
const server = createServer((req, res) => {
  if (req.url.startsWith("/api")) {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true, password: "CANARY_PASSWORD", result: "test" }));
    return;
  }
  res.end(
    '<!doctype html><html><body><h1>Replay fixture</h1><input name="password" type="password" value="CANARY_PASSWORD"><input id="normal" value="CANARY_INPUT"><button id="click">Change</button><p id="result">Before</p><script>document.querySelector("#click").onclick=()=>{document.querySelector("#result").textContent="After"; console.error("password=CANARY_PASSWORD",{code:42,password:"CANARY_OBJECT_PASSWORD"}); fetch("/api?token=CANARY_TOKEN",{headers:{Authorization:"Bearer CANARY_AUTH"}});}</script></body></html>',
  );
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(path.join(tmpdir(), "feedbacks-replay-"));
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
  await page.goto(origin);
  const tabId = await worker.evaluate(
    async (origin) =>
      (await chrome.tabs.query({})).find((t) => t.url === origin + "/").id,
    origin,
  );
  const target = {
    sourceTabId: tabId,
    projectId: crypto.randomUUID(),
    reviewId: crypto.randomUUID(),
    server: "https://feedback.test",
    url: origin + "/?token=CANARY_START",
    viewport: { width: 1200, height: 800 },
  };
  await worker.evaluate(
    async ({ target, origin }) => {
      await chrome.storage.local.set({
        server: target.server,
        accounts: { [target.server]: { token: "fake" } },
        sessions: { [target.sourceTabId]: { ...target, origin } },
      });
    },
    { target, origin },
  );
  const recorder = await context.newPage();
  await recorder.goto(`chrome-extension://${id}/session.html?sourceTabId=${tabId}`);
  const send = (message) =>
    recorder.evaluate(async (message) => {
      const r = await chrome.runtime.sendMessage(message);
      if (!r.ok) throw Error(r.error);
      return r.data;
    }, message);
  await send({
    type: "sessionStart",
    target,
    privacy: { maskText: false, maskInputs: true, networkBodies: true },
    mode: "session",
  });
  await page.locator("#click").click();
  await page.locator("#normal").fill("CANARY_INPUT");
  await page.waitForTimeout(600);
  let s = await send({ type: "sessionStatus" });
  assert.ok(s.recording.events.some((e) => e.type === "replay" && e.data.type === 2));
  assert.ok(s.recording.events.some((e) => e.type === "console"));
  assert.ok(
    s.recording.events.some(
      (e) => e.type === "console" && JSON.stringify(e.data).includes('"code":"42"'),
    ),
    "passive console object fields retained",
  );
  assert.ok(s.recording.events.some((e) => e.type === "network"));
  assert.ok(
    s.recording.events.some((e) => e.type === "activity" && e.data.label === "Change"),
  );
  await page.goto(origin + "/next");
  await page.waitForTimeout(700);
  await recorder.reload();
  s = await send({ type: "sessionStatus" });
  assert.ok(
    s.recording.events.filter((e) => e.type === "replay" && e.data.type === 2).length >=
      2,
  );
  s = await send({ type: "sessionStop" });
  assert.equal(s.active, false);
  const serialized = JSON.stringify(s.recording);
  await writeFile(".local/session-browser-debug.json", serialized);
  assert.ok(!serialized.includes("CANARY_PASSWORD"));
  assert.ok(!serialized.includes("CANARY_OBJECT_PASSWORD"));
  assert.ok(!serialized.includes("CANARY_AUTH"));
  assert.ok(!serialized.includes("CANARY_TOKEN"));
  assert.ok(!serialized.includes("CANARY_INPUT"), "explicit input privacy");
  assert.ok(!serialized.includes("CANARY_START"));
  await recorder.waitForTimeout(1300);
  await recorder.getByRole("heading", { name: "Review before sending" }).waitFor();
  await recorder.waitForFunction(
    () =>
      document
        .querySelector("#capture-inspector")
        .textContent.includes("Local DOM reconstruction"),
    {},
    { timeout: 10000 },
  );
  const activity = recorder
    .locator(".review-event")
    .filter({ hasText: "Click Change" })
    .first();
  await activity.click();
  assert.match(await recorder.locator(".review-detail").innerText(), /"x"/);
  await recorder.getByRole("tab", { name: /Console/ }).click();
  await recorder.locator(".review-mode input").check();
  await recorder.locator(".review-event").filter({ hasText: "error" }).first().click();
  assert.match(await recorder.locator(".review-detail").innerText(), /42/);
  await recorder.locator('input[aria-label="Captured context timeline"]').fill("0");
  assert.equal(
    await recorder.locator(".review-detail").isVisible(),
    false,
    "later diagnostic detail clears when rewinding",
  );
  assert.ok(await recorder.locator("#send").isVisible(), "review happens before send");
  await recorder.getByRole("tab", { name: /Activity/ }).click();
  await recorder.screenshot({ path: ".local/session-desktop.png", fullPage: true });
  await recorder.setViewportSize({ width: 390, height: 900 });
  await recorder.screenshot({ path: ".local/session-mobile.png", fullPage: true });
  await writeFile(".local/session-browser-recording.json", serialized);
  await recorder.locator("#discard").click();
  await recorder.locator("#mask-inputs").uncheck();
  await recorder.locator("#start").click();
  await recorder.locator("#stop:not([hidden])").waitFor();
  await page.locator("#normal").fill("Visible synthetic typed value");
  await page.locator("#click").click();
  await recorder.locator("#stop").click();
  await recorder
    .locator(".review-event")
    .filter({ hasText: "Visible synthetic typed value" })
    .waitFor();
  assert.match(
    await recorder.locator("#capture-inspector").innerText(),
    /Ordinary typed values are included/,
  );
  const unmasked = await send({ type: "sessionStatus" });
  assert.ok(!JSON.stringify(unmasked.recording).includes("CANARY_PASSWORD"));
  await recorder.setViewportSize({ width: 1200, height: 900 });
  await recorder.screenshot({
    path: ".local/session-presend-unmasked.png",
    fullPage: true,
  });
  console.log(
    "PASS actual packaged rrweb snapshot, DOM mutations, debugger console/network, navigation reinjection, recorder reload and secret canaries",
  );
} finally {
  await context.close();
  server.close();
  await rm(profile, { recursive: true, force: true });
}
