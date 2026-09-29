// Synthetic, isolated setup acceptance: no production credentials or clipboard reads.
import { spawn } from "node:child_process";
import { readFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
import { chromium } from "playwright";
const child = spawn(process.execPath, ["scripts/dev-sandbox.mjs"], {
  stdio: ["ignore", "pipe", "pipe"],
});
let browser;
try {
  const path = await new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(Error("Sandbox startup timeout")), 30000);
    child.stdout.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/Local access file: ([^\r\n]+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[1]);
      }
    });
    child.on("exit", () => {
      clearTimeout(timeout);
      reject(Error("Sandbox exited"));
    });
  });
  const access = JSON.parse(await readFile(path, "utf8"));
  const login = await fetch(access.url + "/api/auth.login", {
    method: "POST",
    headers: { Origin: access.url, "Content-Type": "application/json" },
    body: JSON.stringify({ email: access.email, password: access.password }),
  });
  const session = await login.json();
  assert.equal(session.ok, true);
  const cookie = login.headers.get("set-cookie").split(";")[0],
    split = cookie.indexOf("=");
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 980 } });
  await context.addCookies([
    { name: cookie.slice(0, split), value: cookie.slice(split + 1), url: access.url },
  ]);
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === access.url
      ? route.continue()
      : route.abort(),
  );
  // Only the browser clipboard boundary is substituted: never touch the developer's clipboard.
  await context.addInitScript(() => {
    window.setupClipboard = { denied: false, text: "" };
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async (text) => {
          if (window.setupClipboard.denied)
            throw new DOMException("Synthetic clipboard denial", "NotAllowedError");
          window.setupClipboard.text = text;
        },
      },
    });
  });
  const page = await context.newPage();
  let creations = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/tokens.create")) creations++;
  });
  const clipboard = () => page.evaluate(() => window.setupClipboard.text);
  const metadata = (text) => JSON.parse(text.match(/```json\n([\s\S]*?)\n```/)[1]);
  const issueOnClick = async (name) => {
    const response = page.waitForResponse(
      (r) => r.url().endsWith("/api/tokens.create") && r.status() === 200,
    );
    await page.getByRole("button", { name, exact: true }).click();
    const result = await (await response).json();
    assert.equal(result.ok, true);
    return result.data;
  };
  await page.goto(access.url + "/help");
  await page.getByRole("button", { name: "Create & copy prompt", exact: true }).waitFor();
  assert.equal(creations, 0, "opening Setup must not issue keys");
  assert.equal(
    await page
      .getByRole("checkbox", { name: "Read shared recordings and diagnostics" })
      .count(),
    0,
    "easy setup should include evidence reads without an opt-in",
  );
  assert.equal(
    await page.getByRole("button", { name: "Copy key", exact: true }).isDisabled(),
    true,
  );
  await page.evaluate(() => {
    window.setupClipboard.denied = true;
  });
  const issued = await issueOnClick("Create & copy prompt");
  const selectable = page.getByRole("textbox", {
    name: "Agent setup prompt without key",
    exact: true,
  });
  await selectable.waitFor();
  assert.equal((await selectable.inputValue()).includes(issued.token), false);
  assert.equal(
    await page
      .getByRole("textbox", { name: "Private agent setup prompt", exact: true })
      .count(),
    0,
    "private prompt must not be mounted until revealed",
  );
  const me = await fetch(access.url + "/api/auth.me", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + issued.token,
    },
    body: "{}",
  }).then((r) => r.json());
  assert.equal(me.ok, true);
  for (const scope of [
    "recordings.list",
    "recordings.get",
    "recordings.events",
    "recordings.export",
    "diagnostics.list",
    "diagnostics.describe",
    "diagnostics.read",
    "diagnostics.search",
  ])
    assert.ok(
      me.data.credential.scopes.includes(scope),
      "missing default evidence read: " + scope,
    );
  assert.ok(!me.data.credential.scopes.includes("github.issueCreate"));
  await page.evaluate(() => {
    window.setupClipboard.denied = false;
  });
  await page.getByRole("button", { name: "Copy prompt", exact: true }).click();
  const separate = await clipboard();
  assert.equal(separate.includes(issued.token), false);
  assert.equal(metadata(separate).authentication.source, "local-clipboard");
  await page.getByRole("button", { name: "Copy prompt + key", exact: true }).click();
  assert.equal(metadata(await clipboard()).authentication.secret === issued.token, true);
  assert.equal(metadata(await clipboard()).tokenId, metadata(separate).tokenId);
  await page.getByRole("button", { name: "Copy key", exact: true }).click();
  assert.equal((await clipboard()) === issued.token, true);
  assert.equal(creations, 1, "denial, retry and switching modes must reuse one issuance");
  await page.getByText("Help & manual copy", { exact: true }).click();
  await page
    .getByRole("region", { name: "Keep key out of chat", exact: true })
    .scrollIntoViewIfNeeded();
  await mkdir("output/playwright", { recursive: true });
  await page
    .locator(".help-agent")
    .screenshot({ path: "output/playwright/setup-handoff-desktop.png" });
  await page
    .locator(".help-page")
    .screenshot({ path: "output/playwright/setup-page-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".agent-handoff").scrollIntoViewIfNeeded();
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    "mobile horizontal overflow",
  );
  await page
    .locator(".help-agent")
    .screenshot({ path: "output/playwright/setup-handoff-mobile.png" });
  await page
    .locator(".help-page")
    .screenshot({ path: "output/playwright/setup-page-mobile.png" });
  await page.getByRole("button", { name: "Copy prompt", exact: true }).focus();
  await page.keyboard.press("Enter");
  assert.equal((await clipboard()).includes(issued.token), false);
  await page.getByText("Help & manual copy", { exact: true }).click();
  await page.getByRole("button", { name: "Forget key in this tab", exact: true }).click();
  await page.getByRole("button", { name: "Create & copy prompt", exact: true }).waitFor();
  const quickIssued = await issueOnClick("Create & copy all");
  await page.getByRole("button", { name: "Copy prompt + key", exact: true }).waitFor();
  assert.equal(
    metadata(await clipboard()).authentication.secret === quickIssued.token,
    true,
    "quick mode supports one-click initial creation",
  );
  assert.equal(creations, 2);
  await page.goto(access.url + "/account#agent-setup");
  await page.route("**/api/help", (route) =>
    route.fulfill({
      status: 503,
      contentType: "text/plain",
      body: "Synthetic unavailable instructions",
    }),
  );
  const accountIssued = await issueOnClick("Create agent key");
  await page
    .getByRole("button", { name: "Retry loading setup instructions", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Copy prompt + key", exact: true })
      .isDisabled(),
    true,
  );
  await page.getByRole("button", { name: "Copy key", exact: true }).click();
  assert.equal((await clipboard()) === accountIssued.token, true);
  await page.unroute("**/api/help");
  await page
    .getByRole("button", { name: "Retry loading setup instructions", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Copy prompt", exact: true })
    .waitFor({ state: "visible" });
  await page.waitForFunction(() =>
    [...document.querySelectorAll("button")].some(
      (b) => b.textContent === "Copy prompt" && !b.disabled,
    ),
  );
  await page.getByRole("button", { name: "Copy prompt", exact: true }).click();
  assert.equal((await clipboard()).includes(accountIssued.token), false);
  assert.equal(creations, 3);
  console.log(
    JSON.stringify({
      passed: true,
      checks: [
        "no issuance on open",
        "default evidence reads",
        "no key in recommended prompt",
        "quick one-click creation",
        "same-key retry and mode switch",
        "no hidden secret textarea",
        "clipboard failure manual fallback",
        "Account instruction failure and retry",
        "desktop/mobile layout",
        "keyboard activation",
      ],
      screenshots: 4,
    }),
  );
} finally {
  await browser?.close();
  child.kill("SIGTERM");
}
