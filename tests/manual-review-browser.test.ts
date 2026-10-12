import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";

test(
  "manual reviews keep optional context, tags, cached pages and reading position",
  { skip: process.env.FEEDBACKS_RECORDING_BROWSER_SMOKE !== "1", timeout: 120000 },
  async () => {
    const child = spawn(process.execPath, ["scripts/dev-sandbox.mjs"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let browser;
    try {
      let output = "";
      const accessPath = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(Error("Sandbox did not start")), 30000);
        child.stdout.on("data", (chunk) => {
          output += String(chunk);
          const match = output.match(/Local access file: ([^\r\n]+)/);
          if (match) {
            clearTimeout(timer);
            resolve(match[1]);
          }
        });
        child.once("exit", () => reject(Error("Sandbox exited")));
      });
      const access = JSON.parse(await readFile(accessPath, "utf8"));
      const login = async () =>
        fetch(`${access.url}/api/auth.login`, {
          method: "POST",
          headers: { Origin: access.url, "Content-Type": "application/json" },
          body: JSON.stringify({ email: access.email, password: access.password }),
        });
      const signedIn = await login(),
        session = (await signedIn.json()).data;
      const post = async (operation: string, input: unknown) => {
        const response = await fetch(`${access.url}/api/${operation}`, {
          method: "POST",
          headers: {
            Origin: access.url,
            "Content-Type": "application/json",
            Cookie: signedIn.headers.get("set-cookie")!.split(";")[0],
            "X-CSRF-Token": session.csrf,
          },
          body: JSON.stringify(input),
        });
        const payload = await response.json();
        assert.equal(response.ok, true, operation + ": " + JSON.stringify(payload));
        return payload.data;
      };
      for (let index = 1; index <= 65; index++)
        await post("threads.create", {
          projectId: access.projectId,
          body: `Review request ${String(index).padStart(2, "0")}`,
          tags: index === 1 ? ["triage"] : [],
          context: {
            url: "https://example.com/",
            viewport: { width: 1280, height: 800 },
          },
          idempotencyKey: randomUUID(),
        });
      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
      });
      const browserLogin = await login(),
        cookie = browserLogin.headers.get("set-cookie")!.split(";")[0],
        equals = cookie.indexOf("=");
      await context.addCookies([
        {
          name: cookie.slice(0, equals),
          value: cookie.slice(equals + 1),
          url: access.url,
        },
      ]);
      const page = await context.newPage();
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      const listUrl = `${access.url}/projects/${access.projectId}`;
      await page.goto(listUrl);
      await page.locator(".thread-row").first().waitFor();
      const toggle = page.getByRole("button", { name: /Search & filters/ });
      assert.equal(await toggle.getAttribute("aria-expanded"), "false");
      assert.equal(
        await page.getByRole("searchbox", { name: "Search feedback" }).isVisible(),
        false,
      );
      await toggle.press("Enter");
      assert.equal(
        await page.getByRole("searchbox", { name: "Search feedback" }).isVisible(),
        true,
      );
      await page
        .getByRole("combobox", { name: "Tag", exact: true })
        .selectOption("triage");
      await page.waitForURL(/tag=triage/);
      await page
        .getByRole("heading", { name: "Review request 01", exact: true })
        .waitFor();
      await toggle.click();
      assert.match(await toggle.innerText(), /1 active/);
      await toggle.press("Enter");
      await page.getByRole("button", { name: "Clear", exact: true }).click();
      await page.waitForURL(listUrl);
      await page.getByRole("button", { name: "New feedback", exact: true }).click();
      assert.equal(await page.getByLabel("Page URL (optional)").isVisible(), false);
      assert.equal(await page.getByLabel("Viewport width (CSS px)").count(), 0);
      await page.getByLabel("Feedback", { exact: true }).fill("Body-only review request");
      await page
        .getByRole("button", { name: "Post feedback", exact: true })
        .press("Enter");
      await page.waitForURL(/\/threads\//);
      const bodyOnly = await post("threads.get", {
        threadId: new URL(page.url()).pathname.split("/").at(-1),
      });
      assert.deepEqual(bodyOnly.context, {});
      assert.equal(
        await page.getByRole("link", { name: "Open original page" }).count(),
        0,
      );
      await page.getByRole("link", { name: "← Feedback", exact: true }).click();
      await page.waitForURL(listUrl);
      await page.getByRole("button", { name: "New feedback", exact: true }).click();
      await page.getByLabel("Feedback", { exact: true }).fill("Tagged manual review");
      await page.locator("summary").filter({ hasText: "Optional details" }).click();
      await page
        .getByLabel("Page URL (optional)")
        .fill("https://example.com/manual?token=secret#section");
      await page.getByLabel("Choose an existing tag").selectOption("triage");
      await page.getByLabel("Or create a tag").fill("keyboard");
      await page.getByLabel("Or create a tag").press("Enter");
      assert.equal(new URL(page.url()).pathname, `/projects/${access.projectId}`);
      await page.getByLabel("Or create a tag").fill("pending");
      const submissions: any[] = [];
      await page.route("**/api/threads.create", async (route) => {
        submissions.push(route.request().postDataJSON());
        if (submissions.length === 1)
          await route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({
              ok: false,
              error: { code: "UNAVAILABLE", message: "Try posting again" },
            }),
          });
        else await route.continue();
      });
      await page.getByRole("button", { name: "Post feedback", exact: true }).click();
      await page.getByRole("alert").filter({ hasText: "Try posting again" }).waitFor();
      assert.equal(
        await page.getByLabel("Feedback", { exact: true }).inputValue(),
        "Tagged manual review",
      );
      assert.equal(await page.getByLabel("Or create a tag").inputValue(), "pending");
      await page.getByRole("button", { name: "Post feedback", exact: true }).click();
      await page.waitForURL(/\/threads\//);
      assert.equal(submissions[0].idempotencyKey, submissions[1].idempotencyKey);
      const tagged = await post("threads.get", {
        threadId: new URL(page.url()).pathname.split("/").at(-1),
      });
      assert.deepEqual(tagged.tags, ["keyboard", "pending", "triage"]);
      assert.equal(tagged.context.url, "https://example.com/manual");
      assert.equal(tagged.context.viewport, undefined);
      await page.unroute("**/api/threads.create");

      const secondPage = `${listUrl}?sort=newest&offset=30`;
      await page.goto(secondPage);
      await page.locator(".thread-row").nth(29).waitFor();
      const row = page.locator(".thread-row").nth(26),
        targetId = await row.getAttribute("data-thread-id");
      await row.scrollIntoViewIfNeeded();
      const before = await page.evaluate(() => scrollY);
      await row.locator(".thread-row-main").click();
      await page.waitForURL(/\/threads\//);
      await page
        .getByRole("button", { name: "Resolve feedback", exact: true })
        .first()
        .click();
      await page.waitForFunction(
        () =>
          document.querySelector<HTMLSelectElement>('[aria-label="Status"]')?.value ===
          "resolved",
      );
      let release!: () => void;
      const delayed = new Promise<void>((resolve) => (release = resolve));
      await page.route("**/api/threads.list", async (route) => {
        await delayed;
        await route.continue();
      });
      await page.getByRole("link", { name: "← Feedback", exact: true }).click();
      await page.waitForURL(secondPage);
      assert.equal(await page.locator(".thread-row").count(), 30);
      assert.ok(
        Math.abs((await page.evaluate(() => scrollY)) - before) < 25,
        "cached list returns at its reading position before refresh completes",
      );
      assert.equal(await page.getByText("Loading…", { exact: true }).count(), 0);
      release();
      await page.waitForFunction(
        (id) => !document.querySelector(`[data-thread-id="${id}"]`),
        targetId,
      );
      assert.ok(
        (await page.evaluate(() => scrollY)) > 1000,
        "resolving a row does not reset the list to the top",
      );
      await page.unroute("**/api/threads.list");
      const nextRow = page.locator(".thread-row").nth(25);
      await nextRow.scrollIntoViewIfNeeded();
      const backPosition = await page.evaluate(() => scrollY);
      await nextRow.locator(".thread-row-main").click();
      await page.waitForURL(/\/threads\//);
      await page.goBack();
      await page.waitForURL(secondPage);
      assert.ok(
        Math.abs((await page.evaluate(() => scrollY)) - backPosition) < 25,
        "native browser back also restores position",
      );
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(listUrl);
      await page.locator(".thread-row").first().waitFor();
      assert.equal(await toggle.getAttribute("aria-expanded"), "false");
      await toggle.press("Enter");
      assert.equal(
        await page.getByRole("searchbox", { name: "Search feedback" }).isVisible(),
        true,
      );
      await page.getByRole("button", { name: "New feedback", exact: true }).click();
      await page.locator("summary").filter({ hasText: "Optional details" }).click();
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        "mobile form and filters fit the viewport",
      );
      assert.deepEqual(pageErrors, []);
    } finally {
      await browser?.close();
      child.kill("SIGTERM");
      await new Promise<void>((resolve) =>
        child.exitCode !== null ? resolve() : child.once("exit", () => resolve()),
      );
    }
  },
);
