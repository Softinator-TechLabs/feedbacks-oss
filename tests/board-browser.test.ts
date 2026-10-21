import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";

test(
  "board keyboard controls persist status and assignment, preserve conflicts, and apply shared filters",
  {
    skip: process.env.FEEDBACKS_BOARD_BROWSER_SMOKE !== "1",
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
        const timer = setTimeout(() => reject(new Error("Sandbox did not start")), 30000);
        child.stdout.on("data", (chunk) => {
          output += String(chunk);
          const path = output.match(/Local access file: ([^\r\n]+)/)?.[1];
          if (path) {
            clearTimeout(timer);
            resolve(path);
          }
        });
        child.once("exit", () => {
          clearTimeout(timer);
          reject(new Error("Sandbox exited"));
        });
      });
      const access = JSON.parse(await readFile(accessPath, "utf8"));
      const login = () =>
        fetch(`${access.url}/api/auth.login`, {
          method: "POST",
          headers: { Origin: access.url, "Content-Type": "application/json" },
          body: JSON.stringify({ email: access.email, password: access.password }),
        });
      const signed = await login();
      const session = (await signed.json()).data;
      const cookie = signed.headers.get("set-cookie")!.split(";")[0];
      async function post(name: string, input: unknown) {
        const response = await fetch(`${access.url}/api/${name}`, {
          method: "POST",
          headers: {
            Origin: access.url,
            "Content-Type": "application/json",
            Cookie: cookie,
            "X-CSRF-Token": session.csrf,
          },
          body: JSON.stringify(input),
        });
        const payload = await response.json();
        assert.equal(response.ok, true, `${name}: ${JSON.stringify(payload)}`);
        return payload.data;
      }
      const closed = await post("threads.create", {
        projectId: access.projectId,
        body: "Completed feedback",
        idempotencyKey: randomUUID(),
      });
      await post("threads.status", {
        threadId: closed.id,
        revision: closed.revision,
        state: "resolved",
      });
      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
      });
      const browserLogin = await login();
      const browserCookie = browserLogin.headers.get("set-cookie")!.split(";")[0];
      const equals = browserCookie.indexOf("=");
      await context.addCookies([
        {
          name: browserCookie.slice(0, equals),
          value: browserCookie.slice(equals + 1),
          url: access.url,
        },
      ]);
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const boardUrl = `${access.url}/projects/${access.projectId}/board`;
      await page.goto(boardUrl);
      await page.locator(".board-card").nth(1).waitFor();
      const filterToggle = page.getByRole("button", { name: /Search & filters/ });
      if ((await filterToggle.getAttribute("aria-expanded")) === "false")
        await filterToggle.press("Enter");
      await page
        .getByRole("combobox", { name: "Work status", exact: true })
        .selectOption("active");
      await page.waitForURL(/showResolved=false/);
      await page.waitForFunction(
        () => document.querySelectorAll(".board-card").length === 1,
      );
      await page
        .getByRole("combobox", { name: "Work status", exact: true })
        .selectOption("all");
      await page.waitForURL(/showResolved=true/);
      await page.locator(".board-card").nth(1).waitFor();
      const intake = page
        .locator(".board-lane")
        .filter({ has: page.getByRole("heading", { name: "Intake", exact: true }) });
      const card = intake.locator(".board-card").first();
      const threadId = await card.getAttribute("data-thread-id");
      await card.getByRole("checkbox").press("Space");
      await page
        .getByRole("combobox", { name: "Move to column", exact: true })
        .selectOption("in_progress");
      await page
        .getByRole("button", { name: "Move selected", exact: true })
        .press("Enter");
      await page
        .getByRole("status")
        .filter({ hasText: "1 feedback item moved." })
        .waitFor();
      assert.equal((await post("threads.get", { threadId })).work.state, "in_progress");
      const movedCard = page.locator(`.board-card[data-thread-id="${threadId}"]`);
      await movedCard.getByRole("checkbox").press("Space");
      await page
        .getByRole("combobox", { name: "Assign to", exact: true })
        .selectOption(session.actor.userId);
      await page
        .getByRole("button", { name: "Assign selected", exact: true })
        .press("Enter");
      await page
        .getByRole("status")
        .filter({ hasText: "1 feedback item assigned." })
        .waitFor();
      assert.equal(
        (await post("assignments.delegations", { projectId: access.projectId, threadId }))
          .items[0].userId,
        session.actor.userId,
      );
      await movedCard.getByRole("checkbox").press("Space");
      const current = await post("threads.get", { threadId });
      await post("threads.reply", {
        threadId,
        revision: current.revision,
        body: "Concurrent discussion",
        idempotencyKey: randomUUID(),
      });
      await page
        .getByRole("combobox", { name: "Move to column", exact: true })
        .selectOption("review");
      await page
        .getByRole("button", { name: "Move selected", exact: true })
        .press("Enter");
      await page.getByRole("alert").filter({ hasText: "Feedback changed" }).waitFor();
      assert.equal((await post("threads.get", { threadId })).work.state, "in_progress");
      await page.getByText("1 selected", { exact: true }).waitFor();
      await page
        .getByRole("button", { name: "Reload board", exact: true })
        .press("Enter");
      await page.getByText("0 selected", { exact: true }).waitFor();
      await page.setViewportSize({ width: 390, height: 844 });
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      );
      const lanes = await page
        .locator(".board-lane")
        .evaluateAll((elements) =>
          elements.map((element) => element.getBoundingClientRect().top),
        );
      assert.ok(lanes[1] > lanes[0]);
      assert.deepEqual(errors, []);
    } finally {
      await browser?.close();
      child.kill("SIGTERM");
      await new Promise<void>((resolve) =>
        child.exitCode !== null ? resolve() : child.once("exit", () => resolve()),
      );
    }
  },
);
