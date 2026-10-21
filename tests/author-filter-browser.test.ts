import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { chromium } from "playwright";

test(
  "Added by filters submitters across pagination, saved views and mobile",
  {
    skip: process.env.FEEDBACKS_RECORDING_BROWSER_SMOKE !== "1",
    timeout: 120000,
  },
  async () => {
    const child = spawn(process.execPath, ["scripts/dev-sandbox.mjs"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let browser;
    try {
      const accessPath = await new Promise<string>((resolve, reject) => {
        let output = "";
        const timer = setTimeout(() => reject(Error("Sandbox startup timed out")), 30000);
        child.stdout.on("data", (chunk) => {
          output += chunk;
          const match = output.match(/Local access file: ([^\r\n]+)/);
          if (match) {
            clearTimeout(timer);
            resolve(match[1]);
          }
        });
        child.once("exit", () => reject(Error("Sandbox exited")));
      });
      const access = JSON.parse(await readFile(accessPath, "utf8"));
      const login = async (email = access.email) => {
        const response = await fetch(`${access.url}/api/auth.login`, {
          method: "POST",
          headers: { Origin: access.url, "Content-Type": "application/json" },
          body: JSON.stringify({ email, password: access.password }),
        });
        assert.equal(response.ok, true);
        return {
          cookie: response.headers.get("set-cookie")!.split(";")[0],
          ...(await response.json()).data,
        };
      };
      const owner = await login();
      const post = async (operation: string, input: unknown, session = owner) => {
        const response = await fetch(`${access.url}/api/${operation}`, {
          method: "POST",
          headers: {
            Origin: access.url,
            "Content-Type": "application/json",
            Cookie: session.cookie,
            "X-CSRF-Token": session.csrf,
          },
          body: JSON.stringify(input),
        });
        const payload = await response.json();
        assert.equal(response.ok, true, `${operation}: ${JSON.stringify(payload)}`);
        return payload.data;
      };
      const invite = await post("members.invite", {
        email: "submitter@example.test",
        projectId: access.projectId,
        role: "reviewer",
      });
      await post("auth.acceptInvite", {
        token: invite.token,
        name: "Review teammate",
        password: access.password,
      });
      const reviewer = await login("submitter@example.test");
      const ownThread = await post("threads.create", {
        projectId: access.projectId,
        body: "Owner submission",
        idempotencyKey: randomUUID(),
      });
      await post("assignments.assign", {
        threadId: ownThread.id,
        threadRevision: ownThread.revision,
        annotationIds: [],
        userId: reviewer.actor.userId,
        summary: "Work assigned to a different submitter",
        category: "general",
        tags: [],
        githubDecision: "undecided",
        githubRationale: "Synthetic filter fixture",
        idempotencyKey: randomUUID(),
      });
      for (let index = 1; index <= 31; index++)
        await post(
          "threads.create",
          {
            projectId: access.projectId,
            body: `Reviewer submission ${index}`,
            idempotencyKey: randomUUID(),
          },
          reviewer,
        );
      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
      });
      const browserOwner = await login();
      const equals = browserOwner.cookie.indexOf("=");
      await context.addCookies([
        {
          name: browserOwner.cookie.slice(0, equals),
          value: browserOwner.cookie.slice(equals + 1),
          url: access.url,
        },
      ]);
      const page = await context.newPage();
      const listUrl = `${access.url}/projects/${access.projectId}`;
      await page.goto(listUrl);
      const toggle = page.getByRole("button", { name: /Search & filters/ });
      const openFilters = async () => {
        if ((await toggle.getAttribute("aria-expanded")) !== "true")
          await toggle.press("Enter");
      };
      await openFilters();
      const addedBy = page.getByRole("combobox", { name: "Added by", exact: true });
      await addedBy.waitFor({ timeout: 3000 });
      await addedBy.focus();
      await addedBy.press("m");
      await addedBy.press("Enter");
      assert.equal(
        await addedBy.inputValue(),
        owner.actor.userId,
        "Native keyboard selection must choose Me",
      );
      await page.waitForURL(
        (url) => url.searchParams.get("authorId") === owner.actor.userId,
      );
      await page
        .getByRole("heading", { name: "Owner submission", exact: true })
        .waitFor();
      assert.equal(
        await page.getByRole("heading", { name: /^Reviewer submission/ }).count(),
        0,
      );
      await page
        .getByRole("combobox", { name: "Assigned to", exact: true })
        .selectOption(reviewer.actor.userId);
      await page.waitForURL((url) => url.searchParams.has("assignedTo"));
      await page.locator(".pagination").getByText("1–1 of 1", { exact: true }).waitFor();
      assert.equal(new URL(page.url()).searchParams.get("authorId"), owner.actor.userId);
      await page.getByRole("button", { name: "Clear", exact: true }).click();
      await page.waitForURL(listUrl);
      await addedBy.selectOption(reviewer.actor.userId);
      await page.waitForURL(
        (url) => url.searchParams.get("authorId") === reviewer.actor.userId,
      );
      await page
        .locator(".pagination")
        .getByText("1–30 of 31", { exact: true })
        .waitFor();
      assert.equal(
        await page
          .getByRole("heading", { name: "Owner submission", exact: true })
          .count(),
        0,
      );
      await page.getByRole("button", { name: "Next", exact: true }).click();
      await page.waitForURL((url) => url.searchParams.get("offset") === "30");
      await page
        .locator(".pagination")
        .getByText("31–31 of 31", { exact: true })
        .waitFor();
      assert.equal(
        new URL(page.url()).searchParams.get("authorId"),
        reviewer.actor.userId,
      );
      await page.locator(".thread-row h2").click();
      await page.waitForURL(/\/threads\//);
      await page.getByRole("link", { name: "← Feedback", exact: true }).click();
      await page.waitForURL((url) => url.searchParams.get("offset") === "30");
      await openFilters();
      assert.equal(await addedBy.inputValue(), reviewer.actor.userId);
      await page.reload();
      await openFilters();
      assert.equal(await addedBy.inputValue(), reviewer.actor.userId);
      assert.match(await toggle.innerText(), /1 active/);
      await page.locator(".saved-view-manage summary").click();
      await page
        .getByRole("textbox", { name: "Name for current filters" })
        .fill("Teammate submissions");
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await page.getByText("Current filters saved.", { exact: true }).waitFor();
      const saved = (
        await post("reviewViews.list", { projectId: access.projectId })
      ).items.find((view: any) => view.name === "Teammate submissions");
      assert.equal(saved.filters.authorId, reviewer.actor.userId);
      await page.getByRole("button", { name: "Clear", exact: true }).click();
      await page.waitForURL(listUrl);
      await page.locator(".saved-view-manage summary").click();
      await page
        .getByRole("combobox", { name: "Open a saved view" })
        .selectOption(saved.id);
      await page.waitForURL(
        (url) => url.searchParams.get("authorId") === reviewer.actor.userId,
      );
      assert.equal(new URL(page.url()).searchParams.has("offset"), false);
      await openFilters();
      await page
        .locator(".pagination")
        .getByText("1–30 of 31", { exact: true })
        .waitFor();
      if ((await page.locator(".saved-view-manage").getAttribute("open")) !== null)
        await page.locator(".saved-view-manage summary").click();
      await mkdir(".local/author-filter-qa", { recursive: true });
      await page.screenshot({ path: ".local/author-filter-qa/desktop.png" });
      await page.setViewportSize({ width: 390, height: 844 });
      await addedBy.scrollIntoViewIfNeeded();
      assert.equal(await addedBy.inputValue(), reviewer.actor.userId);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      await page.screenshot({ path: ".local/author-filter-qa/mobile.png" });
      await post("members.update", {
        userId: reviewer.actor.userId,
        name: "Review teammate",
        active: false,
        classification: "employee",
        expertise: [],
        policy: { general: 1 },
      });
      await page.reload();
      await openFilters();
      await addedBy
        .locator("option")
        .filter({ hasText: "Review teammate (inactive)" })
        .waitFor({ state: "attached" });
      assert.match(await addedBy.locator("option:checked").innerText(), /inactive/);
      await page
        .locator(".pagination")
        .getByText("1–30 of 31", { exact: true })
        .waitFor();
      await post("members.archive", { userId: reviewer.actor.userId, archived: true });
      await page.reload();
      await openFilters();
      assert.equal(
        await addedBy.locator("option:checked").innerText(),
        "Unavailable member",
      );
      await page
        .locator(".pagination")
        .getByText("1–30 of 31", { exact: true })
        .waitFor();
      const missing = randomUUID();
      await page.goto(`${listUrl}?authorId=${missing}`);
      await openFilters();
      assert.equal(await addedBy.inputValue(), missing);
      assert.equal(
        await addedBy.locator("option:checked").innerText(),
        "Unavailable member",
      );
      await page
        .getByText("Change the filters to find other feedback.", { exact: true })
        .waitFor();
      await page.getByRole("button", { name: "Clear", exact: true }).click();
      await page.waitForURL(listUrl);
      assert.equal(await addedBy.inputValue(), "");
      await page.locator(".thread-row").first().waitFor();
    } finally {
      await browser?.close();
      child.kill("SIGTERM");
    }
  },
);
