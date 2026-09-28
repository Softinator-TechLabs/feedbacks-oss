import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const child = spawn(process.execPath, ["scripts/dev-sandbox.mjs"], {
  stdio: ["ignore", "pipe", "pipe"],
});
let browser;
try {
  let output = "";
  const accessPath = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error("Sandbox did not start")), 30000);
    const receive = (chunk) => {
      output += String(chunk);
      const match = output.match(/Local access file: ([^\r\n]+)/);
      if (match) {
        clearTimeout(timeout);
        child.stdout.off("data", receive);
        resolve(match[1]);
      }
    };
    child.stdout.on("data", receive);
    child.once("exit", () => reject(Error("Sandbox exited before access file")));
  });
  const access = JSON.parse(await readFile(accessPath, "utf8"));
  const login = await fetch(`${access.url}/api/auth.login`, {
    method: "POST",
    headers: { Origin: access.url, "Content-Type": "application/json" },
    body: JSON.stringify({ email: access.email, password: access.password }),
  });
  assert.equal(login.ok, true);
  const csrf = (await login.json()).data.csrf;
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const equals = cookie.indexOf("=");
  const post = async (operation, input) => {
    const response = await fetch(`${access.url}/api/${operation}`, {
      method: "POST",
      headers: {
        Origin: access.url,
        "Content-Type": "application/json",
        Cookie: cookie,
        "X-CSRF-Token": csrf,
      },
      body: JSON.stringify(input),
    });
    if (!response.ok) throw Error(`${operation}: ${await response.text()}`);
    return (await response.json()).data;
  };
  const first = (await post("threads.list", { projectId: access.projectId })).items[0];
  await post("threads.organize", {
    threadId: first.id,
    revision: first.revision,
    tags: ["mobile"],
  });
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addCookies([
    { name: cookie.slice(0, equals), value: cookie.slice(equals + 1), url: access.url },
  ]);
  const page = await context.newPage();
  await mkdir("output/playwright", { recursive: true });
  await page.goto(`${access.url}/projects/${access.projectId}`);
  await page.locator(".thread-row").first().waitFor();
  const filters = page.locator("#feedback-filter-form");
  assert.equal(
    await filters.getByRole("combobox", { name: "Category" }).isVisible(),
    true,
  );
  assert.equal(await filters.getByRole("combobox", { name: "Tag" }).isVisible(), true);
  assert.equal(await filters.getByRole("button", { name: "Apply" }).count(), 0);
  assert.equal(
    await filters
      .getByRole("searchbox", { name: "Search feedback" })
      .evaluate((input) => input.getBoundingClientRect().width <= 360),
    true,
  );
  await filters.getByRole("combobox", { name: "Status" }).selectOption("true");
  await page.waitForURL(/showResolved=true/);
  await filters.getByRole("combobox", { name: "Status" }).selectOption("false");
  await page.waitForURL((url) => !url.searchParams.has("showResolved"));
  await filters.getByRole("combobox", { name: "Sort" }).selectOption("newest");
  await page.waitForURL(/sort=newest/);
  await filters.getByRole("combobox", { name: "Sort" }).selectOption("activity");
  await page.waitForURL((url) => !url.searchParams.has("sort"));
  await filters.getByRole("combobox", { name: "Category" }).selectOption("general");
  await page.waitForURL(/category=general/);
  await page.locator(".thread-row").first().waitFor();
  await filters.getByRole("combobox", { name: "Category" }).selectOption("");
  await page.waitForURL((url) => !url.searchParams.has("category"));
  await page
    .locator(".thread-row")
    .first()
    .getByRole("button", { name: "Filter by General" })
    .click();
  await page.waitForURL(/category=general/);
  await filters.getByRole("combobox", { name: "Tag" }).selectOption("mobile");
  await page.waitForURL(/tag=mobile/);
  await filters.getByRole("combobox", { name: "Tag" }).selectOption("");
  await page.waitForURL((url) => !url.searchParams.has("tag"));
  await page
    .locator(".thread-row")
    .first()
    .getByRole("button", { name: "Filter by mobile tag" })
    .click();
  await page.waitForURL(/tag=mobile/);
  await page.locator(".thread-row").first().waitFor();
  await page.screenshot({ path: "output/playwright/live-filters-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: /Search & filters/ }).click();
  assert.equal(await filters.getByRole("combobox", { name: "Tag" }).isVisible(), true);
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
  await page.screenshot({
    path: "output/playwright/live-filters-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await filters
    .getByRole("searchbox", { name: "Search feedback" })
    .fill("unlikely search phrase");
  await page.waitForTimeout(100);
  assert.equal(new URL(page.url()).searchParams.has("search"), false);
  await page.waitForURL(/search=unlikely/);
  assert.equal(
    await filters
      .getByRole("searchbox", { name: "Search feedback" })
      .evaluate((input) => input === document.activeElement),
    true,
    `Focus moved to ${await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 200))}`,
  );
  await page.getByText("No feedback in this view", { exact: true }).waitFor();
  await page.goBack();
  await page.waitForURL(
    (url) => !url.searchParams.has("search") && !url.searchParams.has("tag"),
  );
  assert.equal(await filters.getByRole("combobox", { name: "Tag" }).inputValue(), "");
  const tagButton = page
    .locator(".thread-row")
    .first()
    .getByRole("button", { name: "Filter by mobile tag" });
  await tagButton.focus();
  await page.keyboard.press("Enter");
  await page.waitForURL(/tag=mobile/);
  await filters.getByText("More filters").click();
  await filters.getByRole("combobox", { name: "Device" }).selectOption("desktop");
  await page.waitForURL(/deviceClass=desktop/);
  await filters.getByRole("textbox", { name: "Page URL" }).fill("https://");
  await page.waitForTimeout(500);
  assert.equal(new URL(page.url()).searchParams.has("url"), false);
  await filters.getByText("Enter a complete URL to filter.").waitFor();
  await filters.getByRole("combobox", { name: "Category" }).selectOption("visualDesign");
  await page.waitForURL(/category=visualDesign/);
  assert.equal(new URL(page.url()).searchParams.has("url"), false);
  await filters.getByRole("combobox", { name: "Category" }).selectOption("general");
  await page.waitForURL(/category=general/);
  await filters.getByRole("textbox", { name: "Page URL" }).fill("https://example.com/");
  await page.waitForURL(/url=https/);
  await page.getByRole("button", { name: "New feedback" }).click();
  const composerDraft = page.getByRole("textbox", { name: "Feedback", exact: true });
  await composerDraft.fill("Unsent synthetic draft");
  let leavePrompts = 0;
  page.on("dialog", async (dialog) => {
    leavePrompts++;
    await dialog.dismiss();
  });
  await filters.getByRole("combobox", { name: "Category" }).selectOption("visualDesign");
  await page.waitForURL(/category=visualDesign/);
  await filters.getByRole("searchbox", { name: "Search feedback" }).fill("Synthetic");
  await page.waitForURL(/search=Synthetic/);
  assert.equal(await composerDraft.inputValue(), "Unsent synthetic draft");
  await page.goBack();
  await page.waitForURL((url) => !url.searchParams.has("search"));
  assert.equal(await composerDraft.inputValue(), "Unsent synthetic draft");
  assert.equal(leavePrompts, 0);
  process.stdout.write("Filter UI QA passed\n");
} finally {
  if (browser) await browser.close();
  child.kill("SIGTERM");
}
