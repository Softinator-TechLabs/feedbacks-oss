import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { PGlite } from "@electric-sql/pglite";
import { Database } from "../src/server/db.js";
import { migrate } from "../src/server/migrations.js";
import { Operations } from "../src/server/operations.js";
import { createApp } from "../src/server/app.js";
import { processGithubComments } from "../src/server/github/comments.js";

test(
  "rendered GitHub discussions preserve reviewed intent, safe text and uncertain reconciliation on desktop and mobile",
  { skip: process.env.FEEDBACKS_RECORDING_BROWSER_SMOKE !== "1", timeout: 120000 },
  async () => {
    const pg = new PGlite(),
      db = new Database(pg as any),
      nativeFetch = globalThis.fetch;
    const pem = generateKeyPairSync("rsa", { modulusLength: 2048 })
      .privateKey.export({ type: "pkcs8", format: "pem" })
      .toString();
    const config: any = {
      production: false,
      appOrigin: "http://127.0.0.1",
      organizationId: randomUUID(),
      githubAppId: "123",
      githubAppSlug: "feedbacks-test",
      githubAppPrivateKey: pem,
    };
    const store: any = {
      put: async () => {},
      get: async () => {
        throw Error("Unexpected asset read");
      },
      remove: async () => {},
    };
    const issueUrl = "https://github.com/acme/site/issues/13";
    const comments: any[] = [
      {
        id: 100,
        html_url: `${issueUrl}#issuecomment-100`,
        issue_url: "https://api.github.com/repos/acme/site/issues/13",
        body: "Synthetic external discussion <script>window.remoteExecuted = true</script>",
        created_at: "2026-10-21T09:00:00Z",
        user: { login: "external-reviewer" },
      },
    ];
    let issueBody = "",
      posts = 0,
      failReadback = false,
      server: any,
      browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    const checks: string[] = [],
      errors: string[] = [],
      requests: any[] = [];
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.origin !== "https://api.github.com") {
        assert.equal(url.origin, config.appOrigin);
        return nativeFetch(input, init);
      }
      const path = url.pathname;
      if (path.endsWith("/installation")) return Response.json({ id: 91 });
      if (path.endsWith("/access_tokens"))
        return Response.json({ token: "synthetic-installation-token" });
      if (path.endsWith("/issues") && init?.method === "POST") {
        issueBody = JSON.parse(String(init.body)).body;
        return Response.json({ number: 13 }, { status: 201 });
      }
      if (path.endsWith("/issues/13"))
        return Response.json({
          html_url: issueUrl,
          number: 13,
          state: "open",
          body: issueBody,
        });
      if (path.endsWith("/issues/13/comments")) {
        if (init?.method === "POST") {
          const body = JSON.parse(String(init.body));
          requests.push(body);
          const id = 101 + posts++;
          const record = {
            id,
            html_url: `${issueUrl}#issuecomment-${id}`,
            issue_url: "https://api.github.com/repos/acme/site/issues/13",
            body: body.body,
            created_at: "2026-10-21T10:00:00Z",
            user: { login: "feedbacks-test[bot]" },
          };
          comments.push(record);
          return Response.json(record, { status: 201 });
        }
        return Response.json(comments.slice(0, 20));
      }
      if (path.includes("/issues/comments/")) {
        if (failReadback) return Response.json({}, { status: 401 });
        const record = comments.find(
          (entry) => entry.id === Number(path.split("/").at(-1)),
        );
        return record ? Response.json(record) : Response.json({}, { status: 404 });
      }
      throw Error(`Unexpected synthetic GitHub request ${path}`);
    };
    try {
      await migrate(db);
      const ops = new Operations(db, store, config),
        password = "Synthetic-GitHub-Comments-123";
      const owner = await ops.auth.bootstrap(
        "owner@example.test",
        "Synthetic owner",
        password,
      );
      const project = await ops.executeOperation(owner, "projects.create", {
        name: "GitHub comments review",
        origins: ["https://example.test"],
        repositoryUrl: "https://github.com/acme/site",
      });
      await ops.executeOperation(owner, "github.connect", {
        projectId: project.id,
        revision: project.revision,
      });
      const viewer = await ops.executeOperation(owner, "members.create", {
        name: "Viewer",
        email: "viewer@example.test",
        password,
        grants: [{ projectId: project.id, role: "viewer" }],
      });
      await db.query("UPDATE users SET must_change_password=false WHERE id=$1", [
        viewer.id,
      ]);
      server = createApp(config, db, store).listen(0, "127.0.0.1");
      await new Promise<void>((resolve) => server.once("listening", resolve));
      config.appOrigin = `http://127.0.0.1:${server.address().port}`;
      browser = await chromium.launch({ headless: true });
      const html = await readFile("dist/web/index.html", "utf8"),
        bundle = html.match(/\/assets\/index-[^" ]+\.js/)?.[0];
      assert.ok(bundle);
      await mkdir(".impeccable/review", { recursive: true });
      for (const [device, width, height] of [
        ["desktop", 1440, 1000],
        ["mobile", 390, 844],
      ] as const) {
        const original = await ops.executeOperation(owner, "threads.create", {
          projectId: project.id,
          body: `Synthetic GitHub discussion ${device}`,
          context: {
            url: "https://example.test/checkout",
            viewport: { width: 1200, height: 800 },
          },
          idempotencyKey: `github-browser-${device}`,
        });
        const thread = await ops.executeOperation(owner, "github.issueCreate", {
          threadId: original.id,
          revision: original.revision,
          reviewed: true,
          title: "Reviewed Issue",
          body: "Issue text",
          idempotencyKey: `github-browser-issue-${device}`,
        });
        const context = await browser.newContext({
          viewport: { width, height },
          reducedMotion: "reduce",
          timezoneId: "UTC",
        });
        const login = await context.request.post(`${config.appOrigin}/api/auth.login`, {
          headers: { Origin: config.appOrigin },
          data: { email: "owner@example.test", password },
        });
        assert.equal(login.status(), 200);
        const csrf = (await login.json()).data.csrf;
        const page = await context.newPage();
        page.setDefaultTimeout(10000);
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto(`${config.appOrigin}/threads/${thread.id}`);
        await page.locator('summary[aria-label="More actions"]').waitFor();
        assert.ok(await page.locator(`script[src="${bundle}"]`).count());
        await page.locator('summary[aria-label="More actions"]').press("Enter");
        await page
          .getByRole("button", { name: "GitHub issue options", exact: true })
          .click();
        const dialog = page.getByRole("dialog", { name: "GitHub issue", exact: true });
        await dialog.waitFor();
        const discussion = dialog
          .locator("details")
          .filter({ has: page.locator("summary", { hasText: /^Issue discussion$/ }) })
          .first();
        await discussion.locator(":scope > summary").press("Enter");
        await discussion
          .getByRole("button", { name: "Load GitHub comments", exact: true })
          .click();
        await discussion
          .getByRole("region", { name: "GitHub comments", exact: true })
          .getByText(comments[0].body, { exact: true })
          .waitFor();
        assert.equal(
          await page.evaluate(() => Boolean((window as any).remoteExecuted)),
          false,
        );
        await discussion
          .getByLabel("Comment text", { exact: true })
          .fill(`Reviewed ${device} comment only`);
        assert.equal(
          await discussion
            .getByRole("button", { name: "Queue GitHub comment", exact: true })
            .isEnabled(),
          false,
        );
        await discussion.getByText("Preview exact comment text", { exact: true }).click();
        await discussion
          .getByLabel("I reviewed this text and destination for sharing on GitHub.", {
            exact: true,
          })
          .check();
        await page.screenshot({
          path: `.impeccable/review/github-comments-${device}-preview.png`,
          fullPage: true,
        });
        const reservations: string[] = [];
        let loseResponse = true;
        await page.route("**/api/github.commentQueue", async (route) => {
          reservations.push(route.request().postDataJSON().idempotencyKey);
          if (loseResponse) {
            loseResponse = false;
            await route.fetch();
            await route.abort("failed");
          } else await route.continue();
        });
        await discussion
          .getByRole("button", { name: "Queue GitHub comment", exact: true })
          .click();
        await discussion.locator('[role="alert"]').waitFor();
        await writeFile(
          ".local/github-comments-browser-debug.html",
          await page.content(),
        );
        assert.equal(
          await discussion
            .getByRole("textbox", { name: "Comment text", exact: true })
            .inputValue(),
          `Reviewed ${device} comment only`,
        );
        await discussion
          .getByRole("button", { name: "Queue GitHub comment", exact: true })
          .click();
        await discussion
          .getByText("Reviewed GitHub comment queued. Check delivery below.", {
            exact: true,
          })
          .waitFor();
        assert.equal(reservations.length, 2);
        assert.equal(reservations[0], reservations[1]);
        assert.equal(
          (
            await db.one(
              "SELECT count(*)::int n FROM github_comment_jobs WHERE thread_id=$1",
              [thread.id],
            )
          ).n,
          1,
        );
        failReadback = true;
        await processGithubComments(db, config);
        failReadback = false;
        await discussion.locator(":scope > summary").press("Enter");
        await discussion.locator(":scope > summary").press("Enter");
        await discussion.getByText("Check uncertain delivery", { exact: true }).click();
        const job = await db.one("SELECT * FROM github_comment_jobs WHERE thread_id=$1", [
          thread.id,
        ]);
        assert.equal(job.status, "uncertain");
        await discussion
          .getByLabel("Actual GitHub comment ID", { exact: true })
          .fill(String(job.comment_id));
        await discussion
          .getByLabel("I checked the destination Issue.", { exact: true })
          .check();
        await discussion
          .getByRole("button", { name: "Verify delivered comment", exact: true })
          .click();
        await discussion
          .getByText("Comment delivery reconciled.", { exact: true })
          .waitFor();
        assert.equal(
          (await db.one("SELECT status FROM github_comment_jobs WHERE id=$1", [job.id]))
            .status,
          "delivered",
        );
        await discussion
          .getByRole("link", { name: "View comment", exact: true })
          .waitFor();
        assert.equal(
          await discussion
            .getByRole("textbox", { name: "Comment text", exact: true })
            .inputValue(),
          "",
        );
        const metrics = await page.evaluate(() => ({
          viewport: innerWidth,
          width: document.documentElement.scrollWidth,
        }));
        assert.ok(metrics.width <= metrics.viewport + 1, JSON.stringify(metrics));
        await page.screenshot({
          path: `.impeccable/review/github-comments-${device}-delivered.png`,
          fullPage: true,
        });
        checks.push(
          `${device}: actual HTTP preview, remote text escaping, lost-response same reservation, one provider POST, uncertain GET401, inspected readback reconciliation, no horizontal overflow`,
        );
        await context.close();
        const readonly = await browser.newContext({ viewport: { width, height } });
        const viewerLogin = await readonly.request.post(
          `${config.appOrigin}/api/auth.login`,
          {
            headers: { Origin: config.appOrigin },
            data: { email: "viewer@example.test", password },
          },
        );
        assert.equal(viewerLogin.status(), 200);
        const viewerCsrf = (await viewerLogin.json()).data.csrf;
        const denied = await readonly.request.post(
          `${config.appOrigin}/api/github.comments`,
          {
            headers: { Origin: config.appOrigin, "X-CSRF-Token": viewerCsrf },
            data: { threadId: thread.id, issueUrl },
          },
        );
        assert.equal(denied.status(), 403);
        const readonlyPage = await readonly.newPage();
        await readonlyPage.goto(`${config.appOrigin}/threads/${thread.id}`);
        await readonlyPage.locator('summary[aria-label="More actions"]').waitFor();
        assert.equal(
          await readonlyPage
            .getByRole("button", { name: "GitHub issue options", exact: true })
            .count(),
          0,
        );
        await readonly.close();
      }
      assert.equal(posts, 2);
      assert.deepEqual(requests, [
        { body: "Reviewed desktop comment only" },
        { body: "Reviewed mobile comment only" },
      ]);
      assert.deepEqual(errors, []);
      await writeFile(
        ".local/github-comments-browser-receipt.json",
        JSON.stringify(
          {
            bundle,
            checks,
            providerPosts: posts,
            errors,
            externalRequests: "Synthetic api.github.com only; no live provider sends",
          },
          null,
          2,
        ),
      );
    } finally {
      globalThis.fetch = nativeFetch;
      await browser?.close();
      if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
      await pg.close();
    }
  },
);
