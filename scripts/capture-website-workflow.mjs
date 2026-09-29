import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const root = process.cwd();
const storeMode = process.argv.includes("--store");
const captureDir = join(
  root,
  storeMode ? "dist/store-submission/screenshots" : "site/public/media/workflow",
);
if (storeMode) await rm(captureDir, { recursive: true, force: true });
await mkdir(captureDir, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), "feedbacks-extension-browser-"));
const extension = join(profile, "extension");
await cp(join(root, storeMode ? "dist/extension/unpacked" : "extension"), extension, {
  recursive: true,
});
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
    const timer = setTimeout(
      () => reject(Error("Sandbox startup timed out")),
      storeMode ? 90000 : 30000,
    );
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
  if (storeMode) {
    const projects = (await post("projects.list", {}, auth)).data.items;
    const project = projects.find((item) => item.name === "Sandbox review");
    if (!project) throw Error("Synthetic review project is missing");
    await post(
      "projects.update",
      {
        projectId: project.id,
        revision: project.revision,
        name: "Good Form review",
        origins: ["https://example.com"],
      },
      auth,
    );
  }
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
    viewport: { width: storeMode ? 1280 : 900, height: storeMode ? 800 : 740 },
    deviceScaleFactor: 1,
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

  const chair = await readFile("site/public/media/studio-chair.png");
  await context.route("https://example.com/**", (route) => {
    if (route.request().url().endsWith("chair.png"))
      return route.fulfill({ contentType: "image/png", body: chair });
    return route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><head><meta charset="utf-8"><title>Good Form — Lounge chair</title><style>*{box-sizing:border-box}body{margin:0;color:#252920;background:#f8f8f3;font:16px Arial}nav{height:72px;border-bottom:1px solid #deded6;display:flex;justify-content:space-between;align-items:center;padding:0 40px}nav strong{font-size:25px;letter-spacing:-1px}main{display:grid;grid-template-columns:1.2fr 1fr;gap:38px;padding:46px 40px}img{width:100%;height:420px;object-fit:cover}h1{font-size:49px;letter-spacing:-2px;line-height:1.05;margin:28px 0 20px}p{line-height:1.6;color:#60675c}small{font-size:14px}button{background:#e1e8d7;color:#3a442c;border:0;padding:17px 25px;font-size:16px;margin-top:22px;border-radius:3px}hr{border:0;border-top:1px solid #daddd1;margin-top:25px}</style></head><body><nav><strong>good form.</strong><span>Furniture &nbsp;&nbsp; Our story &nbsp;&nbsp; Bag (0)</span></nav><main><img src="/chair.png" alt="Orange lounge chair"/><section><small>Made for slow afternoons.</small><h1>Room for a<br>little comfort.</h1><p>The Sunday chair. Warm oak, soft curves,<br>and nowhere else you need to be.</p><p>Terracotta / natural &nbsp; · &nbsp; $420</p><button id="target">Add to bag</button><hr><small>Made to order. Worth the wait.</small></section></main></body></html>`,
    });
  });
  const page = context.pages()[0] ?? (await context.newPage());
  const control = await context.newPage();
  await control.goto(`chrome-extension://${extensionId}/popup.html`);
  const send = (message) =>
    control.evaluate(async (input) => {
      const r = await chrome.runtime.sendMessage(input);
      if (!r?.ok) throw Error(r?.error);
      return r.data;
    }, message);
  await page.bringToFront();
  await page.goto("https://example.com/lounge-chair");
  await page.waitForFunction(() => [...document.images].every((i) => i.complete));
  const id = await worker.evaluate(
    async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id,
  );
  await worker.evaluate(
    async (tabId) =>
      chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const attach = Element.prototype.attachShadow;
          Element.prototype.attachShadow = function (o) {
            const root = attach.call(this, o);
            if (this.id === "feedbacks-review-root") globalThis.__feedbacksQaRoot = root;
            return root;
          };
        },
      }),
    id,
  );
  await send({ type: "activate", tabId: id });
  if (storeMode) {
    await send({ type: "popupAction", tabId: id, action: "show-controls" });
    await page.screenshot({ path: join(captureDir, "01-review-controls.png") });
  }
  const target = await page.locator("#target").boundingBox();
  await page.mouse.click(target.x + target.width / 2, target.y + target.height / 2, {
    button: "right",
  });
  await page.waitForTimeout(1300);
  const inRoot = async (action) =>
    worker.evaluate(
      async ({ tabId, action }) =>
        (
          await chrome.scripting.executeScript({
            target: { tabId },
            func: (action) => {
              const root = globalThis.__feedbacksQaRoot;
              if (action === "fill") {
                const field = root.querySelector(".point-menu textarea");
                field.value = "Make this button darker so it’s easier to find.";
                field.dispatchEvent(new Event("input", { bubbles: true }));
              } else {
                const b = [...root.querySelectorAll("button")].find(
                  (b) => b.textContent === action,
                );
                if (!b) throw Error("No button " + action);
                b.click();
              }
            },
            args: [action],
          })
        )[0].result,
      { tabId: id, action },
    );
  await inRoot("fill");
  await page.screenshot({
    path: join(captureDir, storeMode ? "02-point-comment.png" : "point.png"),
  });
  if (!storeMode)
    await page.screenshot({
      path: join(captureDir, "point-detail.png"),
      clip: { x: 495, y: 385, width: 405, height: 340 },
    });
  await inRoot("Save point");
  await page.waitForTimeout(400);
  if (storeMode) await page.screenshot({ path: join(captureDir, "03-saved-draft.png") });
  await inRoot("Review & send");
  await page.waitForTimeout(1800);
  const editor = context.pages().find((p) => p.url().includes("editor.html"));
  if (!editor) throw Error("Review & send did not open the capture editor");
  if (editor) {
    await editor.setViewportSize({
      width: storeMode ? 1280 : 1100,
      height: storeMode ? 800 : 760,
    });
    if (storeMode) {
      const toolsFit = await editor.locator("#tools").evaluate((tools) => {
        const workspace = tools.closest(".image-workspace").getBoundingClientRect();
        return [...tools.children].every(
          (item) => item.getBoundingClientRect().right <= workspace.right - 8,
        );
      });
      if (!toolsFit) throw Error("Annotation tools overlap the feedback panel");
    }
    await editor
      .locator("#body")
      .fill("Make the Add to bag button darker so it’s easier to find.");
    await editor.screenshot({
      path: join(captureDir, storeMode ? "04-screenshot-editor.png" : "review.png"),
    });
    await editor.locator("#send").click();
    await editor.locator("#completion:not([hidden])").waitFor({ timeout: 60000 });
    const url = await editor.locator("#thread").getAttribute("href");
    const [name, ...value] = auth.cookie.split("=");
    await context.addCookies([{ name, value: value.join("="), url: access.url }]);
    const app = await context.newPage();
    await app.setViewportSize({
      width: storeMode ? 1280 : 1100,
      height: storeMode ? 800 : 760,
    });
    await app.goto(url);
    await app.waitForTimeout(2000);
    if (!storeMode) await app.screenshot({ path: join(captureDir, "thread.png") });
    console.log(
      "Captured actual extension review and sent server thread using synthetic data.",
    );
  }
} finally {
  if (context) await context.close();
  sandbox.kill("SIGTERM");
  await rm(profile, { recursive: true, force: true });
}
