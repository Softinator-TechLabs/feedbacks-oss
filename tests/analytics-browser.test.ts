import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { PGlite } from "@electric-sql/pglite";
import { Database } from "../src/server/db.js";
import { migrate } from "../src/server/migrations.js";
import { Operations } from "../src/server/operations.js";
import { createApp } from "../src/server/app.js";

test(
  "rendered analytics charts exact current project tasks, supports keyboard drilldowns and pagination, and keeps CSV/print private on desktop/mobile",
  { skip: process.env.FEEDBACKS_RECORDING_BROWSER_SMOKE !== "1", timeout: 180000 },
  async () => {
    const pg = new PGlite(),
      db = new Database(pg as any);
    const config: any = { appOrigin: "http://127.0.0.1", production: false };
    let server: ReturnType<ReturnType<typeof createApp>["listen"]> | undefined;
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    const errors: string[] = [],
      checks: string[] = [];
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
      const empty = await ops.executeOperation(owner, "projects.create", {
        name: "Zero task project",
        origins: ["https://zero.example.test"],
      });
      const today = new Date().toISOString().slice(0, 10),
        yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86400000)
          .toISOString()
          .slice(0, 10);
      const threads = new Map<string, any>();
      for (const [projectId, body] of [
        [project.id, "Synthetic overdue high report"],
        [project.id, "Synthetic due today report"],
        [project.id, "Synthetic resolved report"],
        [other.id, "Other synthetic report"],
      ]) {
        let thread = await ops.executeOperation(owner, "threads.create", {
          projectId,
          body,
          pageUrl:
            projectId === project.id
              ? "https://example.test/private?secret=token"
              : "https://other.example.test/",
          idempotencyKey: `${projectId}-${body}`,
        });
        if (projectId === project.id)
          thread = await ops.executeOperation(owner, "threads.plan", {
            threadId: thread.id,
            revision: thread.revision,
            workPlan: {
              priority: body.includes("today") ? "normal" : "high",
              schedule: "today",
              scheduledFor: body.includes("today") ? today : yesterday,
              timeZone: "UTC",
            },
          });
        if (body.includes("resolved"))
          thread = await ops.executeOperation(owner, "threads.status", {
            threadId: thread.id,
            revision: thread.revision,
            state: "resolved",
          });
        if (projectId === other.id)
          thread = await ops.executeOperation(owner, "threads.priority", {
            threadId: thread.id,
            revision: thread.revision,
            topPriority: true,
          });
        threads.set(body, thread);
      }
      server = createApp(config, db, {} as any).listen(0, "127.0.0.1");
      await new Promise<void>((resolve) => server!.once("listening", resolve));
      const origin = `http://127.0.0.1:${(server.address() as any).port}`;
      config.appOrigin = origin;
      browser = await chromium.launch({ headless: true });
      await mkdir(".local/analytics-qa", { recursive: true });
      async function signedPage(width: number, height: number) {
        const page = await browser!.newPage({
          viewport: { width, height },
          timezoneId: "Asia/Kolkata",
          acceptDownloads: true,
        });
        page.setDefaultTimeout(10000);
        page.on("pageerror", (error) => errors.push(error.message));
        const login = await page.request.post(`${origin}/api/auth.login`, {
          headers: { Origin: origin },
          data: { email: "owner@example.test", password },
        });
        assert.equal(login.status(), 200);
        await page.goto(`${origin}/analytics`);
        return page;
      }
      for (const [width, height, device] of [
        [1440, 1000, "desktop"],
        [390, 844, "mobile"],
      ] as const) {
        const page = await signedPage(width, height);
        const surface = page.locator(".analytics-page"),
          counts = surface.getByRole("table", { name: "Thread counts", exact: true }),
          chart = surface.getByRole("region", {
            name: "Pending tasks by project",
            exact: true,
          }),
          matching = surface.getByRole("region", {
            name: "Matching threads",
            exact: true,
          });
        await counts
          .getByRole("button", { name: "View 4 incoming threads", exact: true })
          .waitFor();
        assert.equal(await chart.locator(".analytics-project-list > li").count(), 3);
        await chart.getByText("Common scale: 0–2 tasks", { exact: true }).waitFor();
        const otherPending = chart.getByRole("button", {
          name: `View 1 pending tasks now for ${other.name}`,
          exact: true,
        });
        assert.equal(
          await otherPending
            .locator(".analytics-project-track > span")
            .evaluate((element: HTMLElement) => element.style.width),
          "50%",
        );
        const zero = chart.getByRole("button", {
          name: `View 0 pending tasks now for ${empty.name}`,
          exact: true,
        });
        assert.equal(
          await zero
            .locator(".analytics-project-track > span")
            .evaluate((element: HTMLElement) => element.style.width),
          "0%",
        );
        async function inspectProject(
          metric: "backlog" | "overdue" | "high_priority",
          label: string,
          selected: typeof project,
          ids: string[],
        ) {
          const button = chart.getByRole("button", {
            name: `View ${ids.length} ${label} for ${selected.name}`,
            exact: true,
          });
          const buttonId = await button.getAttribute("id");
          const received = page.waitForResponse(
            (response) =>
              response.url().endsWith("/api/analytics.get") &&
              response.request().postDataJSON()?.detail?.metric === metric,
          );
          await button.press("Enter");
          const response = await received;
          assert.equal(response.status(), 200);
          assert.deepEqual(response.request().postDataJSON().detail, {
            metric,
            dimension: "project",
            key: selected.id,
            offset: 0,
            limit: 25,
          });
          const payload = (await response.json()).data;
          assert.equal(payload.details.total, ids.length);
          assert.deepEqual(
            new Set(payload.details.items.map((thread: any) => thread.id)),
            new Set(ids),
          );
          await matching
            .getByRole("heading", {
              name: `${label[0].toUpperCase()}${label.slice(1)} · ${selected.name}`,
              exact: true,
            })
            .waitFor();
          await page.waitForFunction(() =>
            document.activeElement?.matches(".analytics-detail h2"),
          );
          assert.equal(
            await matching.locator('a[href^="/threads/"]').count(),
            ids.length,
          );
          await matching
            .getByRole("button", { name: "Close list", exact: true })
            .press("Enter");
          await button.waitFor();
          await page.waitForFunction((id) => document.activeElement?.id === id, buttonId);
        }
        await inspectProject("backlog", "pending tasks now", project, [
          threads.get("Synthetic overdue high report").id,
          threads.get("Synthetic due today report").id,
        ]);
        await inspectProject("overdue", "overdue tasks now", project, [
          threads.get("Synthetic overdue high report").id,
        ]);
        await inspectProject("high_priority", "high priority tasks now", other, [
          threads.get("Other synthetic report").id,
        ]);
        await inspectProject("backlog", "pending tasks now", empty, []);
        checks.push(
          `${device}: project bars share the full-report scale, zero-task projects remain visible, and keyboard counts request exact metric/project tasks with result and return focus`,
        );
        await surface.getByLabel("Project", { exact: true }).selectOption(project.id);
        await surface.getByLabel("Timezone", { exact: true }).fill("UTC");
        await surface.getByRole("button", { name: "Apply", exact: true }).click();
        await counts
          .getByRole("button", { name: "View 3 incoming threads", exact: true })
          .waitFor();
        assert.equal(await chart.locator(".analytics-project-list > li").count(), 1);
        await counts
          .getByRole("button", { name: "View 1 overdue tasks now threads", exact: true })
          .waitFor();
        await counts
          .getByRole("button", {
            name: "View 1 high priority tasks now threads",
            exact: true,
          })
          .waitFor();
        await counts
          .getByRole("button", { name: "View 3 incoming threads", exact: true })
          .click();
        await matching
          .getByText("3 matching threads. Open a thread to read its discussion.")
          .waitFor();
        assert.equal(await matching.locator('a[href^="/threads/"]').count(), 3);
        await surface.getByLabel("Group by", { exact: true }).selectOption("browser");
        await surface
          .getByRole("table", { name: "Browser", exact: true })
          .getByRole("button", { name: "View 3 threads for Unknown", exact: true })
          .waitFor();
        const downloadPromise = page.waitForEvent("download");
        await surface
          .getByRole("button", { name: "Export totals CSV", exact: true })
          .click();
        const download = await downloadPromise,
          csvPath = `.local/analytics-qa/${device}.csv`;
        await download.saveAs(csvPath);
        const csv = await readFile(csvPath, "utf8");
        assert.match(csv, /"incoming","3"/);
        assert.match(csv, /"overdue","1"/);
        assert.match(csv, /"high_priority","1"/);
        for (const privateValue of [
          project.name,
          other.name,
          empty.name,
          "Synthetic owner",
          "example.test",
          "Synthetic overdue high report",
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
        assert.equal(await chart.isVisible(), false);
        assert.equal(await surface.locator(".analytics-detail").isVisible(), false);
        assert.equal(await surface.locator(".analytics-breakdown").isVisible(), false);
        assert.ok(!(await page.locator("body").innerText()).includes(project.name));
        await page.emulateMedia({ media: "screen" });
        await matching.getByRole("button", { name: "Close list", exact: true }).click();
        await counts.waitFor();
        await surface.getByLabel("Project", { exact: true }).selectOption("");
        await surface.getByRole("button", { name: "Apply", exact: true }).click();
        await counts
          .getByRole("button", { name: "View 4 incoming threads", exact: true })
          .waitFor();
        await page.evaluate(async () => {
          await document.fonts.ready;
          (document.activeElement as HTMLElement)?.blur();
          window.scrollTo(0, 0);
        });
        await page.screenshot({
          path: `.local/analytics-qa/${device}.png`,
          fullPage: true,
        });
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          true,
        );
        // Saved due dates and priorities describe current work, even outside the period.
        await surface.getByLabel("Project", { exact: true }).selectOption(project.id);
        await surface.getByLabel("From", { exact: true }).fill(yesterday);
        await surface.getByLabel("Through", { exact: true }).fill(yesterday);
        await surface.getByRole("button", { name: "Apply", exact: true }).click();
        await counts
          .getByRole("button", { name: "View 0 incoming threads", exact: true })
          .waitFor();
        await counts
          .getByRole("button", { name: "View 2 pending tasks now threads", exact: true })
          .waitFor();
        await chart
          .getByRole("button", {
            name: `View 1 overdue tasks now for ${project.name}`,
            exact: true,
          })
          .waitFor();
        await chart
          .getByRole("button", {
            name: `View 1 high priority tasks now for ${project.name}`,
            exact: true,
          })
          .waitFor();
        checks.push(
          `${device}: current overdue/high-priority subsets ignore period, exclude resolved work and today's due date; CSV/print exclude project names and matching thread data`,
        );
        await page.close();
      }
      // Exercise real pagination after the three-project captures so the default view stays representative.
      for (let index = 1; index <= 21; index++)
        await ops.executeOperation(owner, "projects.create", {
          name: `ZZ empty project ${String(index).padStart(2, "0")}`,
          origins: ["https://empty.example.test"],
        });
      for (const [width, height, device] of [
        [1440, 1000, "desktop"],
        [390, 844, "mobile"],
      ] as const) {
        const page = await signedPage(width, height),
          chart = page.getByRole("region", {
            name: "Pending tasks by project",
            exact: true,
          });
        await chart.getByText("Projects 1–20 of 24", { exact: true }).waitFor();
        assert.equal(await chart.locator(".analytics-project-list > li").count(), 20);
        await chart
          .getByRole("button", { name: "Next projects", exact: true })
          .press("Enter");
        await chart.getByText("Projects 21–24 of 24", { exact: true }).waitFor();
        assert.equal(await chart.locator(".analytics-project-list > li").count(), 4);
        await chart.getByText("Common scale: 0–2 tasks", { exact: true }).waitFor();
        const button = chart.getByRole("button", {
            name: "View 0 pending tasks now for ZZ empty project 21",
            exact: true,
          }),
          id = await button.getAttribute("id");
        await button.press("Enter");
        const matching = page.getByRole("region", {
          name: "Matching threads",
          exact: true,
        });
        await matching
          .getByRole("heading", {
            name: "Pending tasks now · ZZ empty project 21",
            exact: true,
          })
          .waitFor();
        await matching
          .getByText("0 matching threads. Open a thread to read its discussion.")
          .waitFor();
        await matching
          .getByRole("button", { name: "Close list", exact: true })
          .press("Enter");
        await chart.getByText("Projects 21–24 of 24", { exact: true }).waitFor();
        await page.waitForFunction((value) => document.activeElement?.id === value, id);
        await chart
          .getByRole("button", { name: "Previous projects", exact: true })
          .press("Enter");
        await chart.getByText("Projects 1–20 of 24", { exact: true }).waitFor();
        checks.push(
          `${device}: 20-project pagination preserves common scale and returns to the same chart page after inspecting a zero count`,
        );
        await page.close();
      }
      assert.deepEqual(errors, []);
      const html = await readFile("dist/web/index.html", "utf8");
      await writeFile(
        ".local/analytics-qa/receipt.json",
        JSON.stringify(
          {
            checks,
            pageErrors: errors,
            bundle: html.match(/src="([^"]+\.js)"/)?.[1],
            screenshots: [
              ".local/analytics-qa/desktop.png",
              ".local/analytics-qa/mobile.png",
            ],
            externalRequests: "none; synthetic source app and database",
          },
          null,
          2,
        ),
      );
    } finally {
      await browser?.close();
      if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
      await pg.close();
    }
  },
);
