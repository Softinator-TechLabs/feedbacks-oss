import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { chromium } from "playwright";
import sharp from "sharp";

test(
  "reviewers retain readable selection, source navigation, archive state and survey choices",
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
      const path = await new Promise<string>((resolve, reject) => {
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
      const access = JSON.parse(await readFile(path, "utf8"));
      const signedIn = await fetch(`${access.url}/api/auth.login`, {
        method: "POST",
        headers: { Origin: access.url, "Content-Type": "application/json" },
        body: JSON.stringify({ email: access.email, password: access.password }),
      });
      const session = (await signedIn.json()).data;
      const cookie = signedIn.headers.get("set-cookie")!.split(";")[0];
      const post = async (operation: string, input: unknown) => {
        const response = await fetch(`${access.url}/api/${operation}`, {
          method: "POST",
          headers: {
            Origin: access.url,
            "Content-Type": "application/json",
            Cookie: cookie,
            "X-CSRF-Token": session.csrf,
          },
          body: JSON.stringify(input),
        });
        const result = await response.json();
        assert.equal(response.ok, true, operation + ": " + JSON.stringify(result));
        return result.data;
      };
      const project = await post("projects.get", { projectId: access.projectId });
      await post("projects.update", {
        projectId: project.id,
        revision: project.revision,
        name: project.name,
        origins: project.origins,
        documentsEnabled: true,
        surveysEnabled: true,
      });
      const image = await sharp({
        create: { width: 800, height: 600, channels: 3, background: "white" },
      })
        .png()
        .toBuffer();
      const document = await post("documents.upload", {
        projectId: project.id,
        name: "Synthetic review.png",
        fileBase64: image.toString("base64"),
        idempotencyKey: randomUUID(),
      });
      const docThread = await post("threads.create", {
        projectId: project.id,
        body: "Review the source document",
        document: { documentId: document.id, page: 1, x: 0.5, y: 0.5 },
        idempotencyKey: randomUUID(),
      });
      const webThread = await post("threads.create", {
        projectId: project.id,
        body: "Review the website",
        pageUrl: "https://example.com/",
        idempotencyKey: randomUUID(),
      });
      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext({
        viewport: { width: 1440, height: 950 },
      });
      const browserLogin = await fetch(`${access.url}/api/auth.login`, {
        method: "POST",
        headers: { Origin: access.url, "Content-Type": "application/json" },
        body: JSON.stringify({ email: access.email, password: access.password }),
      });
      const browserCookie = browserLogin.headers.get("set-cookie")!.split(";")[0];
      await context.addCookies([
        {
          name: browserCookie.slice(0, browserCookie.indexOf("=")),
          value: browserCookie.slice(browserCookie.indexOf("=") + 1),
          url: access.url,
        },
      ]);
      const page = await context.newPage();
      await page.addInitScript(() => localStorage.setItem("feedbacks-theme", "dark"));
      const listUrl = `${access.url}/projects/${project.id}`;
      await page.goto(listUrl);
      await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
      const row = page.locator(`[data-thread-id="${docThread.id}"]`);
      await row.waitFor();
      assert.equal(await page.locator(".email-subscription").count(), 0);
      assert.equal(
        await page
          .getByRole("button", { name: "Archive selected (0)", exact: true })
          .count(),
        0,
      );
      const firstRowTop = (await page.locator(".thread-row").first().boundingBox())!.y;
      console.info("First feedback top at 1440 px:", firstRowTop);
      assert.ok(
        firstRowTop <= 360,
        `Feedback starts within the initial desktop viewport: ${firstRowTop}`,
      );
      await mkdir(".local/compact-workspace", { recursive: true });
      await page.screenshot({ path: ".local/compact-workspace/list-desktop-dark.png" });
      const more = page.locator(".thread-list-more");
      await more.locator("summary").press("Enter");
      await more.getByRole("link", { name: "Board view", exact: true }).waitFor();
      await more.getByRole("link", { name: "Board view", exact: true }).press("Escape");
      assert.equal(await more.getAttribute("open"), null);
      await page.setViewportSize({ width: 390, height: 844 });
      const mobileTop = (await page.locator(".thread-row").first().boundingBox())!.y;
      console.info("First feedback top at 390 px:", mobileTop);
      assert.ok(mobileTop <= 500, `First feedback is reachable on mobile: ${mobileTop}`);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      await page.screenshot({ path: ".local/compact-workspace/list-mobile-dark.png" });
      await page.setViewportSize({ width: 1440, height: 950 });
      const select = row.getByRole("checkbox");
      await select.check();
      const selectedBackground = await row.evaluate(
        (el) => getComputedStyle(el).backgroundColor,
      );
      await select.uncheck();
      await page.mouse.move(0, 0);
      const focusedBackground = await row.evaluate(
        (el) => getComputedStyle(el).backgroundColor,
      );
      assert.notEqual(
        selectedBackground,
        focusedBackground,
        "Deselecting removes the selection tint even while the checkbox retains keyboard focus",
      );
      assert.notEqual(
        focusedBackground,
        "rgb(247, 249, 250)",
        "Dark keyboard focus never leaves a light row behind",
      );
      await page.getByRole("heading", { name: "Feedback", exact: true }).click();
      assert.equal(await select.isChecked(), false);
      const source = row.getByRole("link", { name: /Open document/ });
      assert.equal(
        await source.getAttribute("href"),
        `/projects/${project.id}/documents/${document.id}?page=1`,
      );
      assert.equal(await row.getByRole("link", { name: /Open website/ }).count(), 0);
      await row.locator(".thread-row-main").click();
      const detailSource = page.getByRole("link", {
        name: /Open document.*Synthetic review/,
      });
      await detailSource.waitFor();
      assert.equal(await detailSource.isVisible(), true);
      await page.getByRole("link", { name: "← Feedback", exact: true }).click();
      await row.getByRole("checkbox").check();
      await page
        .getByRole("button", { name: "Archive selected (1)", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Confirm archive (1)", exact: true })
        .click();
      await page.waitForFunction(
        (id) => !document.querySelector(`[data-thread-id="${id}"]`),
        docThread.id,
      );
      assert.equal(
        (await post("threads.get", { threadId: webThread.id })).archived,
        false,
        "Unselected feedback stays in the inbox",
      );
      await page.goto(`${access.url}/threads/${docThread.id}`);
      await page.getByRole("button", { name: "Unarchive thread", exact: true }).waitFor();
      await page.reload();
      await page.getByRole("button", { name: "Unarchive thread", exact: true }).waitFor();
      assert.equal(
        (await post("threads.get", { threadId: docThread.id })).archived,
        true,
      );
      await page.getByRole("link", { name: "← Feedback", exact: true }).click();
      await page.locator(`[data-thread-id="${webThread.id}"]`).waitFor();
      await page.waitForFunction(
        (id) => !document.querySelector(`[data-thread-id="${id}"]`),
        docThread.id,
      );
      await page.getByRole("button", { name: "View archive", exact: true }).click();
      await row.waitFor();
      await row.locator(".thread-row-main").click();
      await page.getByRole("link", { name: "← Feedback", exact: true }).click();
      assert.equal(new URL(page.url()).searchParams.get("archived"), "true");
      await row.waitFor();
      await page.reload();
      await row.waitFor();
      await mkdir(".local/reviewer-usability", { recursive: true });
      await page.screenshot({ path: ".local/reviewer-usability/archive-dark.png" });
      const partial = await post("threads.create", {
        projectId: project.id,
        body: "Partial archive fixture",
        idempotencyKey: randomUUID(),
      });
      await page.goto(listUrl);
      await page
        .locator(`[data-thread-id="${partial.id}"]`)
        .getByRole("checkbox")
        .check();
      await page
        .locator(`[data-thread-id="${webThread.id}"]`)
        .getByRole("checkbox")
        .check();
      await page.route("**/api/threads.archive", (route) =>
        route.request().postDataJSON().threadId === webThread.id
          ? route.fulfill({
              status: 409,
              contentType: "application/json",
              body: JSON.stringify({
                ok: false,
                error: { code: "CONFLICT", message: "Synthetic revision conflict" },
              }),
            })
          : route.continue(),
      );
      await page
        .getByRole("button", { name: "Archive selected (2)", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Confirm archive (2)", exact: true })
        .click();
      await page
        .getByRole("alert")
        .filter({ hasText: "1 of 2 confirmed archived" })
        .waitFor();
      assert.equal(
        await page
          .getByRole("button", { name: "Confirm archive (2)", exact: true })
          .isDisabled(),
        true,
      );
      assert.equal((await post("threads.get", { threadId: partial.id })).archived, true);
      assert.equal(
        (await post("threads.get", { threadId: webThread.id })).archived,
        false,
      );
      await page.getByRole("button", { name: "Review feedback", exact: true }).click();
      await page.waitForFunction(
        (id) => !document.querySelector(`[data-thread-id="${id}"]`),
        partial.id,
      );
      assert.equal(
        await page
          .locator(`[data-thread-id="${webThread.id}"]`)
          .getByRole("checkbox")
          .isChecked(),
        true,
      );
      await page.unroute("**/api/threads.archive");
      await page.goto(`${listUrl}/surveys`);
      await page.getByLabel("Title", { exact: true }).fill("Synthetic choice survey");
      await page
        .getByRole("combobox", { name: /^Answer type/ })
        .selectOption("single_choice");
      await page.getByRole("textbox", { name: "Choice 1", exact: true }).fill("Clear");
      await page
        .getByRole("textbox", { name: "Choice 2", exact: true })
        .fill("Needs work");
      await page.getByRole("button", { name: "Add choice", exact: true }).click();
      await page
        .getByRole("textbox", { name: "Choice 3", exact: true })
        .fill("Uncertain");
      await page.getByRole("button", { name: "Remove choice 2", exact: true }).click();
      assert.equal(
        await page.getByRole("textbox", { name: "Choice 2", exact: true }).inputValue(),
        "Uncertain",
      );
      for (const [name, width, height] of [
        ["desktop", 1440, 950],
        ["mobile", 390, 844],
      ] as const) {
        await page.setViewportSize({ width, height });
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          true,
        );
        await page.screenshot({ path: `.local/reviewer-usability/survey-${name}.png` });
      }
      await page.getByRole("button", { name: "Create survey link", exact: true }).click();
      await page
        .getByText("Survey created. Copy its link now.", { exact: true })
        .waitFor();
      const surveys = await post("surveys.list", { projectId: project.id });
      assert.deepEqual(surveys.items[0].questions[0].options, ["Clear", "Uncertain"]);
    } finally {
      await browser?.close();
      child.kill("SIGINT");
      await new Promise<void>((resolve) => child.once("exit", () => resolve()));
    }
  },
);
