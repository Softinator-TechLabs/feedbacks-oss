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
  const loginData = (await login.json()).data;
  let csrf = loginData.csrf;
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const post = async (operation, input, retry = true) => {
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
    const payload = await response.json();
    if (!response.ok && payload.error?.code === "CSRF" && retry) {
      const session = await fetch(`${access.url}/api/auth.me`, {
        method: "POST",
        headers: {
          Origin: access.url,
          "Content-Type": "application/json",
          Cookie: cookie,
        },
        body: "{}",
      });
      assert.equal(session.ok, true);
      csrf = (await session.json()).data.csrf;
      return post(operation, input, false);
    }
    if (!response.ok) throw Error(`${operation}: ${JSON.stringify(payload)}`);
    return payload.data;
  };
  const first = (await post("threads.list", { projectId: access.projectId })).items[0];
  await post("threads.organize", {
    threadId: first.id,
    revision: first.revision,
    tags: ["mobile"],
  });
  const makeAssigned = async (body, state) => {
    const thread = await post("threads.create", {
      projectId: access.projectId,
      body,
      context: { url: "https://example.com/", viewport: { width: 1440, height: 900 } },
      idempotencyKey: `filter-qa-${state}`,
    });
    const current = await post("threads.status", {
      threadId: thread.id,
      revision: thread.revision,
      state,
      ...(state === "open"
        ? { note: "Original status note", duplicateOf: first.id }
        : {}),
    });
    if (["resolved", "declined"].includes(state)) return;
    await post("assignments.assign", {
      threadId: current.id,
      threadRevision: current.revision,
      annotationIds: [],
      userId: loginData.actor.userId,
      summary: body,
      category: "general",
      tags: [],
      githubDecision: "undecided",
      githubRationale: "Filter QA fixture",
      idempotencyKey: `filter-qa-assign-${state}`,
    });
  };
  await makeAssigned("Open assigned sample", "open");
  await makeAssigned("Review assigned sample", "ready_for_review");
  await makeAssigned("Progress assigned sample", "in_progress");
  await makeAssigned("Resolved assigned sample", "resolved");
  await makeAssigned("Declined assigned sample", "declined");
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  // Keep browser CSRF renewal separate from the fixture API session.
  const browserLogin = await fetch(`${access.url}/api/auth.login`, {
    method: "POST",
    headers: { Origin: access.url, "Content-Type": "application/json" },
    body: JSON.stringify({ email: access.email, password: access.password }),
  });
  assert.equal(browserLogin.ok, true);
  const browserCookie = browserLogin.headers.get("set-cookie").split(";")[0];
  const equals = browserCookie.indexOf("=");
  await context.addCookies([
    {
      name: browserCookie.slice(0, equals),
      value: browserCookie.slice(equals + 1),
      url: access.url,
    },
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
  const statusFilter = filters.getByRole("combobox", { name: "Work status" });
  for (const [state, title] of [
    ["open", "Open assigned sample"],
    ["in_progress", "Progress assigned sample"],
    ["ready_for_review", "Review assigned sample"],
    ["resolved", "Resolved assigned sample"],
    ["declined", "Declined assigned sample"],
  ]) {
    await statusFilter.selectOption(state);
    await page.waitForURL((url) => url.searchParams.get("workState") === state);
    await page.getByRole("heading", { name: title }).waitFor();
    assert.equal(
      await page
        .locator(".thread-row select")
        .evaluateAll((selects) =>
          selects.every((select) => select.value === selects[0].value),
        ),
      true,
    );
  }
  await statusFilter.selectOption("closed");
  await page.waitForURL(/workState=closed/);
  await page.getByRole("heading", { name: "Resolved assigned sample" }).waitFor();
  await page.getByRole("heading", { name: "Declined assigned sample" }).waitFor();
  assert.equal(await page.locator(".thread-row").count(), 2);
  await page.reload();
  await page.getByRole("heading", { name: "Resolved assigned sample" }).waitFor();
  assert.equal(await statusFilter.inputValue(), "closed");
  // A status change within Closed must retain its row.
  await page
    .getByRole("combobox", { name: "Status for Resolved assigned sample", exact: true })
    .selectOption("declined");
  await page
    .getByRole("combobox", { name: "Status for Resolved assigned sample", exact: true })
    .waitFor();
  assert.equal(await page.getByRole("button", { name: "Undo status change" }).count(), 0);
  await page
    .getByRole("combobox", { name: "Status for Resolved assigned sample", exact: true })
    .selectOption("resolved");
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".thread-row select")].some(
      (select) => select.value === "resolved",
    ),
  );
  await page.screenshot({ path: "output/playwright/status-closed-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: /Search & filters/ }).click();
  assert.equal(await statusFilter.isVisible(), true);
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
  await page.screenshot({
    path: "output/playwright/status-closed-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: /Search & filters/ }).click();
  await page.setViewportSize({ width: 1440, height: 900 });
  await statusFilter.selectOption("open");
  await page.getByRole("heading", { name: "Open assigned sample" }).waitFor();
  await page
    .getByRole("combobox", { name: "Status for Open assigned sample", exact: true })
    .selectOption("in_progress");
  const undo = page.getByRole("button", { name: "Undo status change" });
  await undo.waitFor();
  assert.equal(
    await page.getByRole("heading", { name: "Open assigned sample" }).count(),
    0,
  );
  await page.screenshot({ path: "output/playwright/status-recovery-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.getByRole("link", { name: "Open feedback", exact: true }).isVisible(),
    true,
  );
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
  await page.screenshot({
    path: "output/playwright/status-recovery-mobile.png",
    fullPage: true,
  });
  await undo.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("heading", { name: "Open assigned sample" }).waitFor();
  await page.setViewportSize({ width: 1440, height: 900 });
  await statusFilter.selectOption("active");
  await page
    .getByRole("combobox", { name: "Status for Open assigned sample", exact: true })
    .selectOption("resolved");
  await undo.waitFor();
  await undo.click();
  await page.getByRole("heading", { name: "Open assigned sample" }).waitFor();
  const restored = (
    await post("threads.list", {
      projectId: access.projectId,
      workState: "open",
      search: "Open assigned sample",
    })
  ).items[0];
  assert.equal(restored.work.note, "Original status note");
  assert.equal(restored.work.duplicateOf, first.id);
  // A newer edit must reject stale undo while the direct discussion link survives.
  await statusFilter.selectOption("open");
  await page
    .getByRole("combobox", { name: "Status for Open assigned sample", exact: true })
    .selectOption("declined");
  await undo.waitFor();
  const closedThread = (
    await post("threads.list", {
      projectId: access.projectId,
      workState: "declined",
      search: "Open assigned sample",
    })
  ).items[0];
  const newer = await post("threads.status", {
    threadId: closedThread.id,
    revision: closedThread.revision,
    state: "declined",
    note: "Newer edit must survive undo",
  });
  await undo.click();
  await page
    .getByRole("alert")
    .filter({ hasText: /changed|conflict/i })
    .waitFor();
  const readback = await post("threads.get", { threadId: newer.id });
  assert.equal(readback.work.state, "declined");
  assert.equal(readback.work.note, "Newer edit must survive undo");
  await page.getByRole("link", { name: "Open feedback", exact: true }).click();
  await page.waitForURL(new RegExp(`/threads/${newer.id}`));
  await page.getByRole("combobox", { name: "Status", exact: true }).waitFor();
  await post("threads.status", {
    threadId: newer.id,
    revision: readback.revision,
    state: "open",
  });
  await page.goto(`${access.url}/projects/${access.projectId}`);
  await page.getByRole("heading", { name: "Open assigned sample" }).waitFor();
  await filters.getByRole("combobox", { name: "Work status" }).selectOption("all");
  await page.waitForURL(/showResolved=true/);
  await filters.getByRole("combobox", { name: "Work status" }).selectOption("active");
  await page.waitForURL((url) => !url.searchParams.has("showResolved"));
  await filters.getByRole("combobox", { name: "Work status" }).selectOption("open");
  await page.waitForURL(/workState=open/);
  await filters
    .getByRole("combobox", { name: "Assigned to" })
    .selectOption(loginData.actor.userId);
  await page.waitForURL(/assignedTo=/);
  await page.getByRole("heading", { name: "Open assigned sample" }).waitFor();
  assert.equal(await page.locator(".thread-row").count(), 1);
  assert.equal(
    await page.getByRole("heading", { name: "Review assigned sample" }).count(),
    0,
  );
  await filters
    .getByRole("combobox", { name: "Work status" })
    .selectOption("ready_for_review");
  await page.waitForURL(/workState=ready_for_review/);
  await page.getByRole("heading", { name: "Review assigned sample" }).waitFor();
  assert.equal(
    await page.getByRole("heading", { name: "Open assigned sample" }).count(),
    0,
  );
  await filters.getByRole("combobox", { name: "Work status" }).selectOption("open");
  await page.waitForURL(/workState=open/);
  await page.getByRole("heading", { name: "Open assigned sample" }).waitFor();
  await page.screenshot({ path: "output/playwright/assigned-open-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: /Search & filters/ }).click();
  assert.equal(
    await filters.getByRole("combobox", { name: "Assigned to" }).inputValue(),
    loginData.actor.userId,
  );
  assert.equal(
    await filters.getByRole("combobox", { name: "Work status" }).inputValue(),
    "open",
  );
  await page.screenshot({
    path: "output/playwright/assigned-open-mobile.png",
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
  await page.getByRole("button", { name: /Search & filters/ }).click();
  await page.setViewportSize({ width: 1440, height: 900 });
  await filters.getByRole("combobox", { name: "Sort" }).selectOption("newest");
  await page.getByRole("button", { name: "Assigned to me" }).click();
  await page.waitForURL((url) => !url.searchParams.has("assignedTo"));
  await page.getByRole("button", { name: "Assigned to me" }).click();
  await page.waitForURL(/assignedTo=/);
  assert.equal(new URL(page.url()).searchParams.get("workState"), "open");
  assert.equal(new URL(page.url()).searchParams.get("sort"), "newest");
  await filters.getByRole("button", { name: "Clear" }).click();
  await page.waitForURL((url) => !url.searchParams.has("assignedTo"));
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
  await page.getByRole("button", { name: "Filter by mobile tag" }).first().click();
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
  const tagButton = page.getByRole("button", { name: "Filter by mobile tag" }).first();
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
  const invite = await post("members.invite", {
    email: "status-reviewer@example.test",
    projectId: access.projectId,
    role: "reviewer",
  });
  await post("auth.acceptInvite", {
    token: invite.token,
    name: "Status reviewer",
    password: access.password,
  });
  const reviewerLogin = await fetch(`${access.url}/api/auth.login`, {
    method: "POST",
    headers: { Origin: access.url, "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "status-reviewer@example.test",
      password: access.password,
    }),
  });
  assert.equal(reviewerLogin.ok, true);
  const reviewerCookie = reviewerLogin.headers.get("set-cookie").split(";")[0];
  const reviewerEquals = reviewerCookie.indexOf("=");
  const reviewerContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  await reviewerContext.addCookies([
    {
      name: reviewerCookie.slice(0, reviewerEquals),
      value: reviewerCookie.slice(reviewerEquals + 1),
      url: access.url,
    },
  ]);
  const reviewerPage = await reviewerContext.newPage();
  await reviewerPage.goto(`${access.url}/projects/${access.projectId}?workState=closed`);
  const reviewerStatus = reviewerPage.getByRole("combobox", {
    name: "Status for Resolved assigned sample",
    exact: true,
  });
  await reviewerStatus.waitFor();
  for (const state of ["resolved", "declined"]) {
    const option = reviewerStatus.locator(`option[value="${state}"]`);
    assert.equal(await option.isDisabled(), true);
    assert.match(await option.textContent(), /permission required/);
  }
  await reviewerStatus.selectOption("open");
  await reviewerPage
    .getByRole("button", {
      name: "Undo status change (permission required)",
      exact: true,
    })
    .waitFor();
  assert.equal(
    await reviewerPage
      .getByRole("button", {
        name: "Undo status change (permission required)",
        exact: true,
      })
      .isDisabled(),
    true,
  );
  await reviewerPage.getByRole("link", { name: "Open feedback", exact: true }).click();
  const detailStatus = reviewerPage.getByRole("combobox", {
    name: "Status",
    exact: true,
  });
  await detailStatus.waitFor();
  await reviewerPage.waitForURL(/\/threads\//);
  for (const state of ["resolved", "declined"]) {
    const option = detailStatus.locator(`option[value="${state}"][disabled]`);
    await option.waitFor({ state: "attached" });
    assert.equal(await option.evaluate((element) => element.disabled), true);
    assert.match(await option.textContent(), /permission required/);
  }
  await reviewerContext.close();
  process.stdout.write("Filter UI QA passed\n");
} finally {
  if (browser) await browser.close();
  child.kill("SIGTERM");
}
