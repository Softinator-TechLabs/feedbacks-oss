import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { PGlite } from "@electric-sql/pglite";
import { Database } from "../src/server/db.js";
import { migrate } from "../src/server/migrations.js";
import { Operations } from "../src/server/operations.js";
import { createApp } from "../src/server/app.js";

test(
  "rendered analytics supports project/date filters, drilldowns, aggregate CSV and private print on desktop/mobile",
  { skip: process.env.FEEDBACKS_RECORDING_BROWSER_SMOKE !== "1" },
  async () => {
    const pg = new PGlite(),
      db = new Database(pg as any);
    const config: any = { appOrigin: "http://127.0.0.1", production: false };
    let server: ReturnType<ReturnType<typeof createApp>["listen"]> | undefined;
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    try {
      await migrate(db);
      const ops = new Operations(db, {} as any, config);
      const password = "Synthetic-Analytics-Password-123";
      const owner = await ops.auth.bootstrap(
        "owner@example.test",
        "Synthetic owner",
        password,
      );
      const project = await ops.executeOperation(owner, "projects.create", {
        name: "Private synthetic project",
        origins: ["https://example.test"],
      });
      const other = await ops.executeOperation(owner, "projects.create", {
        name: "Other synthetic project",
        origins: ["https://other.example.test"],
      });
      for (const [projectId, body] of [
        [project.id, "Synthetic active report"],
        [project.id, "Synthetic resolved report"],
        [other.id, "Other synthetic report"],
      ]) {
        const thread = await ops.executeOperation(owner, "threads.create", {
          projectId,
          body,
          pageUrl:
            projectId === project.id
              ? "https://example.test/private?secret=token"
              : "https://other.example.test/",
          idempotencyKey: `${projectId}-${body}`,
        });
        if (body.includes("resolved"))
          await ops.executeOperation(owner, "threads.status", {
            threadId: thread.id,
            revision: thread.revision,
            state: "resolved",
          });
      }
      server = createApp(config, db, {} as any).listen(0, "127.0.0.1");
      await new Promise<void>((resolve) => server!.once("listening", resolve));
      const origin = `http://127.0.0.1:${(server.address() as any).port}`;
      config.appOrigin = origin;
      browser = await chromium.launch({ headless: true });
      await mkdir(".local/analytics-qa", { recursive: true });
      for (const [width, height, device] of [
        [1440, 1000, "desktop"],
        [390, 844, "mobile"],
      ] as const) {
        const page = await browser.newPage({
          viewport: { width, height },
          timezoneId: "Asia/Kolkata",
          acceptDownloads: true,
        });
        const login = await page.request.post(`${origin}/api/auth.login`, {
          headers: { Origin: origin },
          data: { email: "owner@example.test", password },
        });
        assert.equal(login.status(), 200);
        await page.goto(`${origin}/analytics`);
        const surface = page.locator(".analytics-page"),
          counts = surface.getByRole("table", { name: "Thread counts", exact: true });
        await counts
          .getByRole("button", { name: "View 3 incoming threads", exact: true })
          .waitFor();
        await surface.getByLabel("Project", { exact: true }).selectOption(project.id);
        await surface.getByLabel("Timezone", { exact: true }).fill("UTC");
        await surface.getByRole("button", { name: "Apply", exact: true }).click();
        await counts
          .getByRole("button", { name: "View 2 incoming threads", exact: true })
          .waitFor();
        await counts
          .getByRole("button", { name: "View 2 incoming threads", exact: true })
          .click();
        const matching = surface.getByRole("region", {
          name: "Matching threads",
          exact: true,
        });
        await matching
          .getByText("2 matching threads. Open a thread to read its discussion.")
          .waitFor();
        assert.equal(await matching.locator('a[href^="/threads/"]').count(), 2);
        await surface.getByLabel("Group by", { exact: true }).selectOption("browser");
        await surface
          .getByRole("table", { name: "Browser", exact: true })
          .getByRole("button", { name: "View 2 threads for Unknown", exact: true })
          .waitFor();
        const downloadPromise = page.waitForEvent("download");
        await surface
          .getByRole("button", { name: "Export totals CSV", exact: true })
          .click();
        const download = await downloadPromise,
          csvPath = `.local/analytics-qa/${device}.csv`;
        await download.saveAs(csvPath);
        const csv = await readFile(csvPath, "utf8");
        assert.match(csv, /"incoming","2"/);
        for (const privateValue of [
          project.name,
          other.name,
          "Synthetic owner",
          "example.test",
          "Synthetic active report",
        ])
          assert.ok(!csv.includes(privateValue));
        await page.evaluate(() => {
          window.print = () => {
            document.body.dataset.analyticsPrinted = "true";
          };
        });
        await surface.getByRole("button", { name: "Print totals", exact: true }).click();
        assert.equal(
          await page.locator("body").getAttribute("data-analytics-printed"),
          "true",
        );
        await page.emulateMedia({ media: "print" });
        assert.equal(await surface.locator(".analytics-detail").isVisible(), false);
        assert.equal(await surface.locator(".analytics-breakdown").isVisible(), false);
        await page.emulateMedia({ media: "screen" });
        await matching.getByRole("button", { name: "Close list", exact: true }).click();
        await counts.waitFor();
        await page.screenshot({
          path: `.local/analytics-qa/${device}.png`,
          fullPage: true,
        });
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          true,
        );
        // An empty historical period keeps the current backlog independently visible.
        const today = new Date().toISOString().slice(0, 10),
          yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86400000)
            .toISOString()
            .slice(0, 10);
        await surface.getByLabel("From", { exact: true }).fill(yesterday);
        await surface.getByLabel("Through", { exact: true }).fill(yesterday);
        await surface.getByRole("button", { name: "Apply", exact: true }).click();
        await counts
          .getByRole("button", { name: "View 0 incoming threads", exact: true })
          .waitFor();
        await counts
          .getByRole("button", { name: "View 1 active backlog now threads", exact: true })
          .waitFor();
        await page.close();
      }
    } finally {
      await browser?.close();
      if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
      await pg.close();
    }
  },
);
