import test from "node:test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { PGlite } from "@electric-sql/pglite";
import { Database } from "../src/server/db.js";
import { migrate } from "../src/server/migrations.js";
import { Operations } from "../src/server/operations.js";
import { createApp } from "../src/server/app.js";
import { deliverNotifications } from "../src/server/notifications/worker.js";

test(
  "email settings, project sender inheritance, subscriptions and confirmation unsubscribe work in the rendered app",
  { skip: process.env.FEEDBACKS_RECORDING_BROWSER_SMOKE !== "1" },
  async () => {
    const pg = new PGlite(),
      db = new Database(pg as any);
    const objects = new Map<string, Buffer>();
    const store: any = {
      put: async (k: string, v: Buffer) => {
        objects.set(k, v);
      },
      get: async (k: string) => objects.get(k),
      remove: async (k: string) => {
        objects.delete(k);
      },
    };
    const config: any = {
      appOrigin: "http://127.0.0.1",
      production: false,
      organizationId: "00000000-0000-4000-8000-000000000001",
    };
    let server: any, browser: any;
    try {
      await migrate(db);
      const ops = new Operations(db, store, config),
        password = "Synthetic-Email-Password-123";
      const owner = await ops.auth.bootstrap(
        "owner@example.test",
        "Synthetic owner",
        password,
      );
      const project = await ops.executeOperation(owner, "projects.create", {
        name: "Synthetic email project",
        origins: ["https://example.test"],
      });
      server = createApp(config, db, store).listen(0, "127.0.0.1");
      await new Promise<void>((resolve) => server.once("listening", resolve));
      const origin = `http://127.0.0.1:${server.address().port}`;
      config.appOrigin = origin;
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      const login = await page.request.post(`${origin}/api/auth.login`, {
        headers: { Origin: origin },
        data: { email: "owner@example.test", password },
      });
      assert.equal(login.status(), 200);
      await page.goto(`${origin}/email`);
      const settings = page.locator(".email-settings");
      await settings
        .getByLabel("Enable email notifications by default", { exact: true })
        .check();
      await settings.getByText("Configure provider", { exact: true }).click();
      await settings
        .getByLabel("Sender email", { exact: true })
        .fill("feedbacks@example.test");
      await settings.getByLabel("SMTP host", { exact: true }).fill("smtp.example.test");
      await settings.getByLabel("SMTP username", { exact: true }).fill("synthetic-user");
      await settings
        .getByLabel("SMTP password or Google app password", { exact: true })
        .fill("synthetic-only-secret");
      await settings
        .getByRole("button", { name: "Save email settings", exact: true })
        .click();
      await settings.getByText("Email settings saved.", { exact: true }).waitFor();
      assert.equal(
        (await ops.executeOperation(owner, "notifications.settings", {})).provider,
        "smtp",
      );
      assert.ok(!(await page.content()).includes("synthetic-only-secret"));
      await settings
        .getByText("Configure notification templates", { exact: true })
        .click();
      await settings
        .getByLabel("Subject", { exact: true })
        .fill("[{{project}}] {{event}}");
      await settings
        .getByRole("button", { name: "Preview template", exact: true })
        .click();
      await settings.locator(".email-preview").waitFor();
      assert.ok(
        (await settings.locator(".email-preview").innerText()).includes(
          "Example project",
        ),
      );
      await settings
        .getByRole("button", { name: "Save email settings", exact: true })
        .click();
      await settings.getByText("Email settings saved.", { exact: true }).waitFor();
      await mkdir(".impeccable/review", { recursive: true });
      await page.screenshot({
        path: ".impeccable/review/email-desktop.png",
        fullPage: true,
      });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      await page.goto(`${origin}/projects/${project.id}/settings#integrations`);
      const projectSettings = page.locator(".email-settings");
      await projectSettings.getByText("Project sender", { exact: true }).click();
      await projectSettings
        .getByLabel("Project sender email", { exact: true })
        .fill("technology@example.test");
      await projectSettings
        .getByRole("button", { name: "Save email settings", exact: true })
        .click();
      await projectSettings.getByText("Email settings saved.", { exact: true }).waitFor();
      const saved = await ops.executeOperation(owner, "notifications.settings", {
        projectId: project.id,
      });
      assert.equal(saved.inherited, true);
      assert.equal(saved.identity?.fromEmail, "technology@example.test");
      await page.goto(`${origin}/projects/${project.id}`);
      const subscription = page.locator(".email-subscription");
      await subscription.locator("summary").click();
      await subscription.getByLabel("New feedback", { exact: true }).check();
      await subscription.getByLabel("Discussion replies", { exact: true }).check();
      await subscription.getByLabel("Include my own activity", { exact: true }).check();
      await subscription
        .getByRole("button", { name: "Save email preferences", exact: true })
        .click();
      await subscription.getByText("Email preferences saved.", { exact: true }).waitFor();
      const thread = await ops.executeOperation(owner, "threads.create", {
        projectId: project.id,
        body: "Synthetic email browser event",
        idempotencyKey: "email-browser-event",
      });
      const messages: any[] = [];
      await deliverNotifications(
        db,
        config,
        store,
        async (_transport, identity, mail) => {
          messages.push({ identity, mail });
        },
      );
      assert.equal(messages.length, 1);
      assert.equal(messages[0].identity.fromEmail, "technology@example.test");
      assert.ok(messages[0].mail.text.includes(`/threads/${thread.id}`));
      assert.ok(!messages[0].mail.text.includes("Synthetic email browser event"));
      const row = await db.one(
        "SELECT unsubscribe_token FROM notification_subscriptions WHERE project_id=$1",
        [project.id],
      );
      await page.goto(
        `${origin}/notifications/unsubscribe?token=${row.unsubscribe_token}`,
      );
      assert.equal(
        (
          await ops.executeOperation(owner, "notifications.subscription", {
            projectId: project.id,
          })
        ).events.length,
        2,
      );
      await page
        .getByRole("button", { name: "Unsubscribe from this project", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "Project emails stopped", exact: true })
        .waitFor();
      assert.deepEqual(
        (
          await ops.executeOperation(owner, "notifications.subscription", {
            projectId: project.id,
          })
        ).events,
        [],
      );
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${origin}/email`);
      await settings
        .getByText("Configure notification templates", { exact: true })
        .click();
      await settings.getByLabel("Subject", { exact: true }).waitFor();
      await page.screenshot({
        path: ".impeccable/review/email-mobile.png",
        fullPage: true,
      });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      await page.close();
    } finally {
      await browser?.close();
      if (server) {
        server.closeAllConnections();
        await new Promise<void>((r) => server.close(r));
      }
      await pg.close();
    }
  },
);
