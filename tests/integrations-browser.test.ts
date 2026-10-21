import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { chromium, type Locator } from "playwright";
import { PGlite } from "@electric-sql/pglite";
import { Database } from "../src/server/db.js";
import { migrate } from "../src/server/migrations.js";
import { Operations } from "../src/server/operations.js";
import { createApp } from "../src/server/app.js";

test(
  "rendered tracker, channel, reviewed replay and time workflows persist synthetic data and enforce denied controls",
  {
    skip: process.env.FEEDBACKS_RECORDING_BROWSER_SMOKE !== "1",
    timeout: 180000,
  },
  async () => {
    const pg = new PGlite(),
      db = new Database(pg as any);
    const keys = new Map<string, Buffer>();
    const store = {
      put: async (key: string, value: Buffer) => {
        keys.set(key, value);
      },
      get: async (key: string) => keys.get(key)!,
      remove: async (key: string) => {
        keys.delete(key);
      },
    };
    const config: any = {
      appOrigin: "http://127.0.0.1",
      production: false,
      organizationId: randomUUID(),
    };
    const originalFetch = globalThis.fetch;
    const external: string[] = [],
      checks: string[] = [],
      errors: string[] = [],
      screenshots: string[] = [];
    const providerLayouts: { device: string; provider: string; fields: number }[] = [];
    let server: any, browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    // Provider verification is the only mocked boundary. App HTTP requests,
    // credentials, grants, persistence, validation and queue writes remain real.
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (["127.0.0.1", "localhost"].includes(url.hostname))
        return originalFetch(input, init);
      external.push(url.origin + url.pathname);
      const json = (data: unknown) =>
        new Response(JSON.stringify(data), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      if (
        url.origin === "https://app.asana.com" &&
        url.pathname === "/api/1.0/projects/123"
      )
        return json({ data: { name: "Synthetic Asana project" } });
      if (url.origin === "https://api.harvestapp.com") {
        if (url.pathname === "/v2/company")
          return json({ wants_timestamp_timers: false });
        if (url.pathname === "/v2/projects/42")
          return json({ name: "Synthetic Harvest project" });
        if (url.pathname === "/v2/projects/42/task_assignments")
          return json({ task_assignments: [{ task: { id: 44 }, is_active: true }] });
      }
      if (
        url.origin === "https://api2.timedoctor.com" &&
        url.pathname === "/api/1.0/tasks/task44"
      )
        return json({
          data: { project: { id: "project42" }, name: "Synthetic Time Doctor task" },
        });
      if (
        url.origin === "https://system.firmao.pl" &&
        url.pathname.startsWith("/review_org/svc/v1/")
      ) {
        assert.equal(init?.method, "GET");
        const authorization = new Headers(init?.headers).get("authorization") ?? "";
        assert.match(authorization, /^Basic /);
        assert.match(
          Buffer.from(authorization.slice(6), "base64").toString("utf8"),
          /^synthetic-firmao-login-(desktop|mobile):synthetic-firmao-password-\1$/,
        );
        assert.equal(url.searchParams.get("start"), "0");
        assert.equal(url.searchParams.get("dataFormat"), "MEDIUM");
        if (url.pathname.endsWith("/projects")) {
          assert.equal(url.searchParams.get("limit"), "1");
          assert.equal(url.searchParams.get("id(eq)"), "123");
          return json({
            data: [
              {
                id: 123,
                name: "Synthetic Firmao CRM project",
                teamMembers: [{ id: 2 }],
                managers: [],
                permissions: { project: ["read"], task: ["create", "read", "update"] },
              },
            ],
          });
        }
        if (url.pathname.endsWith("/tasks")) {
          assert.equal(url.searchParams.get("limit"), "50");
          return json({
            data: [
              {
                id: 50017,
                name: "Synthetic CRM task",
                project: { id: 123 },
                status: { key: "DONE", label_en: "Done" },
                permissions: { task: ["read", "update"] },
              },
            ],
          });
        }
      }
      throw Error("Unexpected external request in synthetic browser verification");
    };
    try {
      await migrate(db);
      const ops = new Operations(db, store, config),
        password = "Synthetic-Integration-Password-123";
      const owner = await ops.auth.bootstrap(
        "owner@example.test",
        "Synthetic owner",
        password,
      );
      const projects = [];
      for (const device of ["desktop", "mobile"])
        projects.push(
          await ops.executeOperation(owner, "projects.create", {
            name: `Integration review ${device}`,
            origins: ["https://example.test"],
          }),
        );
      const viewer = await ops.executeOperation(owner, "members.create", {
        name: "Read-only reviewer",
        email: "viewer@example.test",
        password,
        grants: projects.map((project) => ({ projectId: project.id, role: "viewer" })),
      });
      await db.query("UPDATE users SET must_change_password=false WHERE id=$1", [
        viewer.id,
      ]);
      server = createApp(config, db, store).listen(0, "127.0.0.1");
      await new Promise<void>((resolve) => server.once("listening", resolve));
      const origin = `http://127.0.0.1:${server.address().port}`;
      config.appOrigin = origin;
      browser = await chromium.launch({ headless: true });
      async function signedContext(
        email: string,
        viewport: { width: number; height: number },
      ) {
        const context = await browser!.newContext({ viewport, timezoneId: "UTC" });
        const response = await context.request.post(`${origin}/api/auth.login`, {
          headers: { Origin: origin },
          data: { email, password },
        });
        assert.equal(response.status(), 200);
        return { context, csrf: (await response.json()).data.csrf };
      }
      const apiSession = await signedContext("owner@example.test", {
        width: 1000,
        height: 800,
      });
      async function post(
        operation: string,
        input: unknown,
        session = apiSession,
        expected = 200,
      ) {
        const response = await session.context.request.post(
          `${origin}/api/${operation}`,
          { headers: { Origin: origin, "X-CSRF-Token": session.csrf }, data: input },
        );
        const payload = await response.json();
        assert.equal(
          response.status(),
          expected,
          `${operation}: ${JSON.stringify(payload)}`,
        );
        if (expected === 403) assert.equal(payload.error?.code, "FORBIDDEN");
        return payload.data;
      }
      await mkdir(".local/integration-tabs-qa", { recursive: true });
      for (const [index, device, width, height] of [
        [0, "desktop", 1440, 1000],
        [1, "mobile", 390, 844],
      ] as const) {
        const project = projects[index];
        const signed = await signedContext("owner@example.test", { width, height });
        const page = await signed.context.newPage();
        page.setDefaultTimeout(10000);
        page.on("pageerror", (error) => errors.push(error.message));
        let dismissNextDialog = false;
        page.on("dialog", (dialog) => {
          if (dismissNextDialog) {
            dismissNextDialog = false;
            return dialog.dismiss();
          }
          return dialog.accept();
        });
        async function dismissReplacement(
          form: Locator,
          replace: () => Promise<unknown>,
        ) {
          const snapshot = () =>
            form.evaluate((element: HTMLFormElement) =>
              [...new FormData(element).entries()].map(([name, value]) => [
                name,
                String(value),
              ]),
            );
          const before = await snapshot();
          dismissNextDialog = true;
          const shown = page.waitForEvent("dialog");
          await replace();
          const dialog = await shown;
          assert.match(dialog.message(), /^Discard this .* draft\?/);
          assert.equal(dismissNextDialog, false);
          assert.deepEqual(
            await snapshot(),
            before,
            `${device}: cancelled replacement preserves every draft field`,
          );
        }
        await page.goto(`${origin}/trackers?projectId=${projects[1 - index].id}`);
        const trackers = page.locator(".tracker-settings");
        await trackers.waitFor({ timeout: 5000 }).catch(async () => {
          throw new Error(
            `Tracker surface missing. Page: ${await page.locator("body").innerText()}. Errors: ${JSON.stringify(errors)}`,
          );
        });
        await trackers
          .getByRole("combobox", { name: "Project", exact: true })
          .selectOption(project.id);
        await trackers
          .getByRole("button", { name: "Add tracker connection", exact: true })
          .press("Enter");
        const trackerForm = trackers.locator(".tracker-form");
        await trackerForm
          .getByRole("combobox", { name: "Provider", exact: true })
          .selectOption("asana");
        await trackerForm
          .getByLabel("Connection name", { exact: true })
          .fill(`Asana ${device}`);
        await trackerForm.getByLabel("Asana project ID", { exact: true }).fill("123");
        await trackerForm
          .getByLabel("API token", { exact: true })
          .fill(`synthetic-asana-${device}`);
        await trackerForm
          .getByText("Status mappings and polling", { exact: true })
          .press("Enter");
        await trackerForm
          .getByLabel("open → remote status", { exact: true })
          .fill("open");
        await trackerForm
          .getByLabel("resolved → remote status", { exact: true })
          .fill("completed");
        await trackerForm
          .getByLabel("Import remote status changes automatically", { exact: false })
          .check();
        await dismissReplacement(trackerForm, () =>
          trackers
            .getByRole("combobox", { name: "Project", exact: true })
            .selectOption(projects[1 - index].id),
        );
        assert.equal(
          await trackers
            .getByRole("combobox", { name: "Project", exact: true })
            .inputValue(),
          project.id,
        );
        assert.equal(
          await trackerForm
            .getByRole("combobox", { name: "Provider", exact: true })
            .inputValue(),
          "asana",
        );
        await trackerForm
          .getByRole("button", { name: "Save connection", exact: true })
          .press("Enter");
        await trackers
          .getByRole("heading", { name: `Asana ${device}`, exact: true })
          .waitFor();
        let connections = (await post("trackers.list", { projectId: project.id }))
          .connections;
        assert.equal(connections.length, 1);
        assert.equal(connections[0].configuration.targetId, "123");
        assert.deepEqual(
          connections[0].configuration.states.map((entry: any) => entry.remote),
          ["open", "completed"],
        );
        assert.equal(connections[0].configuration.poll, true);
        const storedTracker = await db.one(
          "SELECT * FROM tracker_connections WHERE id=$1",
          [connections[0].id],
        );
        assert.ok(!JSON.stringify(storedTracker).includes(`synthetic-asana-${device}`));
        assert.ok(!(await page.content()).includes(`synthetic-asana-${device}`));
        await trackers
          .getByRole("button", { name: "Test connection", exact: true })
          .press("Enter");
        await trackers
          .getByText("Provider access and status mappings verified.", { exact: true })
          .waitFor();
        assert.equal(
          (await post("trackers.list", { projectId: project.id })).connections[0].health,
          "healthy",
        );
        checks.push(
          `${device}: owner project/provider/destination/mapping saved, encrypted and verified`,
        );
        await trackers
          .getByRole("button", { name: "Add tracker connection", exact: true })
          .press("Enter");
        await trackerForm
          .getByLabel("Connection name", { exact: true })
          .fill(`Unsent tracker ${device}`);
        await trackerForm
          .getByLabel("Asana project ID", { exact: true })
          .fill("unsent123");
        await trackerForm
          .getByLabel("API token", { exact: true })
          .fill(`unsent-tracker-secret-${device}`);
        await dismissReplacement(trackerForm, () =>
          trackers
            .getByRole("button", { name: "Edit connection", exact: true })
            .press("Enter"),
        );
        await trackers
          .getByRole("button", { name: "Edit connection", exact: true })
          .press("Enter");
        assert.equal(
          await trackerForm.getByLabel("Connection name", { exact: true }).inputValue(),
          `Asana ${device}`,
        );
        await trackers
          .getByRole("button", { name: "Add tracker connection", exact: true })
          .press("Enter");
        checks.push(
          `${device}: dismissed project and tracker editor replacements preserve project, token and configuration; accepted discard changes editor`,
        );
        await trackerForm
          .getByRole("combobox", { name: "Provider", exact: true })
          .selectOption("firmao");
        await trackerForm
          .getByLabel("Connection name", { exact: true })
          .fill(`Firmao ${device}`);
        await trackerForm
          .getByLabel("Firmao CRM project ID", { exact: true })
          .fill("123");
        await trackerForm
          .getByLabel(/^Firmao organization identifier/)
          .fill("review_org");
        await trackerForm.getByLabel(/^Responsible user ID \(optional\)/).fill("2");
        await trackerForm
          .getByLabel("Firmao API login", { exact: true })
          .fill(`synthetic-firmao-login-${device}`);
        await trackerForm
          .getByLabel("Firmao API password", { exact: true })
          .fill(`synthetic-firmao-password-${device}`);
        await trackerForm
          .getByText("Status mappings and polling", { exact: true })
          .press("Enter");
        await trackerForm
          .getByLabel("open → remote status", { exact: true })
          .fill("WAITING");
        await trackerForm
          .getByLabel("resolved → remote status", { exact: true })
          .fill("DONE");
        await trackerForm
          .getByRole("button", { name: "Save connection", exact: true })
          .press("Enter");
        const firmaoRow = trackers.locator("li").filter({
          has: page.getByRole("heading", { name: `Firmao ${device}`, exact: true }),
        });
        await firmaoRow
          .getByRole("button", { name: "Test connection", exact: true })
          .press("Enter");
        await firmaoRow
          .getByText("Synthetic Firmao CRM project: available status IDs", {
            exact: true,
          })
          .waitFor();
        const firmao = (
          await post("trackers.list", { projectId: project.id })
        ).connections.find((connection: any) => connection.provider === "firmao");
        assert.equal(firmao.health, "healthy");
        assert.equal(firmao.configuration.workspaceId, "review_org");
        assert.equal(firmao.configuration.targetId, "123");
        assert.equal(firmao.configuration.assigneeId, "2");
        const storedFirmao = JSON.stringify(
          await db.one("SELECT * FROM tracker_connections WHERE id=$1", [firmao.id]),
        );
        assert.ok(!storedFirmao.includes(`synthetic-firmao-login-${device}`));
        assert.ok(!storedFirmao.includes(`synthetic-firmao-password-${device}`));
        assert.ok(
          !(await page.content()).includes(`synthetic-firmao-password-${device}`),
        );
        assert.ok(!(await page.content()).includes(`synthetic-firmao-login-${device}`));
        checks.push(
          `${device}: Firmao organization, project, responsible user, basic API login/password and manual status mappings saved encrypted and verified against exact synthetic API filters`,
        );
        await trackers
          .getByRole("button", { name: "Add tracker connection", exact: true })
          .press("Enter");
        await trackerForm
          .getByRole("combobox", { name: "Provider", exact: true })
          .selectOption("jira");
        await trackerForm
          .getByLabel("Connection name", { exact: true })
          .fill(`Jira ${device}`);
        await trackerForm
          .getByLabel("Jira project ID or key", { exact: true })
          .fill("REVIEW");
        await trackerForm.getByLabel("Jira issue type ID", { exact: true }).fill("10001");
        await trackerForm
          .getByRole("button", { name: "Connect with Jira Cloud", exact: true })
          .press("Enter");
        await trackerForm
          .getByRole("alert")
          .filter({ hasText: "operator must configure" })
          .waitFor();
        assert.equal(
          (await post("trackers.list", { projectId: project.id })).connections.length,
          2,
        );
        assert.equal(
          await trackerForm.getByLabel("Connection name", { exact: true }).inputValue(),
          `Jira ${device}`,
        );
        checks.push(
          `${device}: missing Jira broker produces actionable error and preserves entered form`,
        );
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({
          path: `.local/integration-tabs-qa/trackers-${device}.png`,
          fullPage: true,
        });
        screenshots.push(`.local/integration-tabs-qa/trackers-${device}.png`);
        assert.ok(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          `${device} tracker page fits`,
        );
        const settingsRequests: string[] = [];
        page.on("request", (request) => {
          const pathname = new URL(request.url()).pathname;
          if (/^\/api\/(notifications|channels|timeTracking|webhooks)\./.test(pathname))
            settingsRequests.push(pathname);
        });
        const settingsUrl = `${origin}/projects/${project.id}/settings`;
        await page.goto(settingsUrl);
        await page
          .getByRole("heading", { name: "Project details", exact: true })
          .waitFor();
        assert.deepEqual(
          settingsRequests,
          [],
          `${device}: project details do not mount unrelated integration providers`,
        );
        await page.goto(`${settingsUrl}#integrations`);
        const providerTabs = page.getByRole("tablist", {
          name: "Project integration providers",
          exact: true,
        });
        const providers = [
          {
            id: "channels",
            label: "Slack & Teams",
            ready: () =>
              page.getByRole("button", { name: "Add notification channel", exact: true }),
          },
          {
            id: "github",
            label: "GitHub",
            ready: () => page.getByRole("link", { name: "Set up GitHub", exact: true }),
          },
          {
            id: "webhooks",
            label: "Webhooks",
            ready: () => page.getByRole("button", { name: "Add webhook", exact: true }),
          },
          {
            id: "time",
            label: "Time tracking",
            ready: () =>
              page.getByRole("button", { name: "Add time connection", exact: true }),
          },
        ] as const;
        const providerTab = (label: string) =>
          providerTabs.getByRole("tab", { name: label, exact: true });
        async function assertSelectedProvider(label: string) {
          const selected = providerTab(label);
          assert.equal(
            await selected.getAttribute("aria-selected"),
            "true",
            `${device}: ${label} selected`,
          );
          assert.equal(
            await providerTabs.getByRole("tab", { selected: true }).count(),
            1,
          );
          for (const tab of await providerTabs.getByRole("tab").all()) {
            const panelId = await tab.getAttribute("aria-controls");
            assert.ok(panelId, `${device}: each provider tab owns a panel`);
            const active = (await tab.getAttribute("aria-selected")) === "true";
            assert.equal(
              await page.locator(`#${panelId}`).isVisible(),
              active,
              `${device}: ${await tab.innerText()} panel visibility follows its tab`,
            );
            assert.equal(await tab.getAttribute("tabindex"), active ? "0" : "-1");
          }
          assert.ok(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
            `${device}: ${label} fits the viewport`,
          );
        }
        await providers[0].ready().waitFor();
        await assertSelectedProvider("Slack & Teams");
        assert.ok(settingsRequests.some((path) => path === "/api/channels.list"));
        assert.ok(
          settingsRequests.every((path) => path.startsWith("/api/channels.")),
          `${device}: integrations link opens only its default provider requests`,
        );
        // Capture each initial provider surface before entering any credentials.
        for (const provider of providers) {
          await providerTab(provider.label).click();
          await provider.ready().waitFor();
          await assertSelectedProvider(provider.label);
          assert.equal(new URL(page.url()).hash, `#integrations-${provider.id}`);
          const addName =
            provider.id === "channels"
              ? "Add notification channel"
              : provider.id === "webhooks"
                ? "Add webhook"
                : provider.id === "time"
                  ? "Add time connection"
                  : undefined;
          if (addName) {
            await page.getByRole("button", { name: addName, exact: true }).click();
            const selectedPanel = page.locator(`#integrations-${provider.id}`);
            const fields = await selectedPanel
              .locator(".connection-form .field")
              .evaluateAll((labels) =>
                labels.map((label) => {
                  const caption = label.querySelector("span")!;
                  const control = label.querySelector(
                    "input:not([type='checkbox']),select,textarea",
                  )!;
                  const text = caption.getBoundingClientRect(),
                    input = control.getBoundingClientRect();
                  return {
                    caption: caption.textContent,
                    textBottom: text.bottom,
                    inputTop: input.top,
                    inputHeight: input.height,
                    inputWidth: input.width,
                  };
                }),
              );
            assert.ok(
              fields.length > 0,
              `${device}: ${provider.label} form has labeled fields`,
            );
            for (const field of fields) {
              assert.ok(
                field.textBottom <= field.inputTop + 1,
                `${device}: ${provider.label} ${field.caption} label stays above its control`,
              );
              assert.ok(
                field.inputHeight >= 32 && field.inputWidth >= 140,
                `${device}: ${provider.label} ${field.caption} control remains usable`,
              );
            }
            providerLayouts.push({
              device,
              provider: provider.id,
              fields: fields.length,
            });
          }
          await page.evaluate(() => window.scrollTo(0, 0));
          const capture = `.local/integration-tabs-qa/${device}-${provider.id}.png`;
          await page.screenshot({ path: capture, fullPage: true });
          screenshots.push(capture);
          if (addName)
            await page.getByRole("button", { name: "Cancel", exact: true }).click();
        }
        checks.push(
          `${device}: four separate provider panels, one selected, no horizontal overflow; default settings and integration link mount only the required provider`,
        );
        const keyMoves = [
          ["Home", "Slack & Teams"],
          ["End", "Time tracking"],
          ["ArrowRight", "Slack & Teams"],
          ["ArrowLeft", "Time tracking"],
          ["Home", "Slack & Teams"],
          ["ArrowRight", "GitHub"],
        ] as const;
        await providerTab("Time tracking").focus();
        for (const [key, label] of keyMoves) {
          await page.keyboard.press(key);
          await assertSelectedProvider(label);
          assert.equal(
            await providerTab(label).evaluate((tab) => tab === document.activeElement),
            true,
            `${device}: ${key} focuses the selected ${label} tab`,
          );
        }
        for (const provider of providers) {
          await page.goto(`${settingsUrl}#integrations-${provider.id}`);
          await page.reload();
          await provider.ready().waitFor();
          await assertSelectedProvider(provider.label);
        }
        checks.push(
          `${device}: Arrow keys wrap and Home/End preserve roving focus; all four provider deep links restore the requested panel after page navigation`,
        );
        await page.goto(`${settingsUrl}#integrations-email`);
        await page
          .getByRole("tab", { name: "Email notifications", exact: true })
          .waitFor();
        assert.equal(
          await page
            .getByRole("tab", { name: "Email notifications", exact: true })
            .getAttribute("aria-selected"),
          "true",
          `${device}: legacy email link opens the dedicated notification settings`,
        );
        const emailEnabled = page.getByLabel(
          "Enable email notifications for this project",
          { exact: true },
        );
        const originalEmailEnabled = await emailEnabled.isChecked();
        await emailEnabled.setChecked(!originalEmailEnabled);
        await page.getByRole("tab", { name: "Integrations", exact: true }).click();
        await providerTab("Slack & Teams").click();
        const channels = page.locator("section").filter({
          has: page.getByRole("heading", {
            name: "Slack and Teams notifications",
            exact: true,
          }),
        });
        await channels
          .getByRole("button", { name: "Add notification channel", exact: true })
          .press("Enter");
        const channelForm = channels.locator("form");
        await channelForm
          .getByRole("combobox", { name: "Provider", exact: true })
          .selectOption("slack");
        await channelForm
          .getByLabel("Connection name", { exact: true })
          .fill(`Review updates ${device}`);
        const webhook = `https://hooks.slack.com/services/SYNTHETIC/REVIEW/${device}secret`;
        await channelForm
          .getByLabel("Incoming webhook URL", { exact: true })
          .fill(webhook);
        await channelForm.getByLabel("Discussion and replies", { exact: true }).check();
        await providerTab("Webhooks").click();
        await page.getByRole("button", { name: "Add webhook", exact: true }).click();
        await page.getByRole("button", { name: "Save webhook", exact: true }).waitFor();
        await page
          .getByLabel(/^Destination URL/)
          .fill("https://hooks.example.test/unsaved");
        await page.getByRole("tab", { name: "Email notifications", exact: true }).click();
        assert.equal(
          await emailEnabled.isChecked(),
          !originalEmailEnabled,
          `${device}: unsaved email settings survive section navigation`,
        );
        await page.getByRole("tab", { name: "Integrations", exact: true }).click();
        await providerTab("Slack & Teams").click();
        const settingsTabs = page.getByRole("tablist", {
          name: "Project settings sections",
          exact: true,
        });
        await settingsTabs.getByRole("tab", { name: "Project", exact: true }).click();
        await page
          .getByRole("heading", { name: "Project details", exact: true })
          .waitFor();
        await settingsTabs
          .getByRole("tab", { name: "Integrations", exact: true })
          .click();
        await assertSelectedProvider("Slack & Teams");
        assert.equal(
          await channelForm.getByLabel("Connection name", { exact: true }).inputValue(),
          `Review updates ${device}`,
        );
        assert.equal(
          await channelForm
            .getByLabel("Incoming webhook URL", { exact: true })
            .inputValue(),
          webhook,
        );
        assert.equal(
          await channelForm
            .getByLabel("Discussion and replies", { exact: true })
            .isChecked(),
          true,
        );
        await providerTab("Webhooks").click();
        assert.equal(
          await page.getByLabel(/^Destination URL/).inputValue(),
          "https://hooks.example.test/unsaved",
        );
        await providerTab("Slack & Teams").click();
        checks.push(
          `${device}: provider and top-level tab switches preserve selected provider, channel name/secret/events, email preference and webhook destination`,
        );
        await channelForm
          .getByRole("button", { name: "Save channel", exact: true })
          .press("Enter");
        await channels
          .getByRole("heading", { name: `Review updates ${device}`, exact: true })
          .waitFor();
        const channel = (await post("channels.list", { projectId: project.id }))
          .channels[0];
        assert.deepEqual(channel.events, ["created", "discussion"]);
        assert.ok(
          !JSON.stringify(
            await db.one("SELECT * FROM notification_channels WHERE id=$1", [channel.id]),
          ).includes(webhook),
        );
        await channels
          .getByRole("button", { name: "Send test message", exact: true })
          .press("Enter");
        await channels
          .getByText("Test queued. Check delivery history and the destination channel.", {
            exact: true,
          })
          .waitFor();
        assert.equal(
          (await post("channels.deliveries", { projectId: project.id })).items[0].status,
          "pending",
        );
        checks.push(
          `${device}: channel event settings persisted, webhook encrypted, test queued over real HTTP`,
        );
        await channels
          .getByRole("button", { name: "Add notification channel", exact: true })
          .press("Enter");
        await channelForm
          .getByLabel("Connection name", { exact: true })
          .fill(`Unsent channel ${device}`);
        await channelForm
          .getByLabel("Incoming webhook URL", { exact: true })
          .fill(`${webhook}-unsent`);
        await channelForm.getByLabel("Assignments", { exact: true }).check();
        await dismissReplacement(channelForm, () =>
          channels
            .getByRole("button", { name: "Edit connection", exact: true })
            .press("Enter"),
        );
        await channels
          .getByRole("button", { name: "Edit connection", exact: true })
          .press("Enter");
        assert.equal(
          await channelForm.getByLabel("Connection name", { exact: true }).inputValue(),
          `Review updates ${device}`,
        );
        checks.push(
          `${device}: dismissed channel editor replacement preserves name, webhook and event settings; accepted discard changes editor`,
        );
        await providerTab("Time tracking").click();
        const time = page.locator("section").filter({
          has: page.getByRole("heading", {
            name: "Harvest and Time Doctor",
            exact: true,
          }),
        });
        const times: any[] = [];
        for (const provider of ["harvest", "timedoctor"] as const) {
          await time
            .getByRole("button", { name: "Add time connection", exact: true })
            .press("Enter");
          const form = time.locator("form");
          await form
            .getByRole("combobox", { name: "Provider", exact: true })
            .selectOption(provider);
          await form
            .getByLabel("Connection name", { exact: true })
            .fill(`${provider} ${device}`);
          await form
            .getByLabel(
              provider === "harvest" ? "Harvest account ID" : "Time Doctor company ID",
              { exact: true },
            )
            .fill(provider === "harvest" ? "7" : "company7");
          await form
            .getByLabel("Provider project ID", { exact: true })
            .fill(provider === "harvest" ? "42" : "project42");
          await form
            .getByLabel("Provider task ID", { exact: true })
            .fill(provider === "harvest" ? "44" : "task44");
          if (provider === "timedoctor")
            await form.getByLabel("Time Doctor user ID", { exact: true }).fill("user7");
          await form
            .getByLabel(
              provider === "harvest" ? "Harvest API token" : "Time Doctor JWT API token",
              { exact: true },
            )
            .fill(`synthetic-time-${provider}-${device}`);
          await providerTab("GitHub").click();
          await providerTab("Time tracking").click();
          assert.equal(
            await form.getByLabel("Connection name", { exact: true }).inputValue(),
            `${provider} ${device}`,
          );
          assert.equal(
            await form
              .getByLabel(
                provider === "harvest"
                  ? "Harvest API token"
                  : "Time Doctor JWT API token",
                { exact: true },
              )
              .inputValue(),
            `synthetic-time-${provider}-${device}`,
          );
          await form
            .getByRole("button", { name: "Save time connection", exact: true })
            .press("Enter");
          const saved = time.locator("li").filter({
            has: page.getByRole("heading", {
              name: `${provider} ${device}`,
              exact: true,
            }),
          });
          const verifiedResponse = page.waitForResponse((response) =>
            response.url().endsWith("/api/timeTracking.test"),
          );
          await saved
            .getByRole("button", { name: "Test destination", exact: true })
            .press("Enter");
          const verified = await verifiedResponse;
          assert.equal(verified.status(), 200);
          const result = (await verified.json()).data;
          assert.equal(
            result.healthy,
            true,
            result.errorCode ?? "Destination should verify",
          );
          await time
            .getByText("Time tracking destination verified.", { exact: true })
            .waitFor();
          const connection = (
            await post("timeTracking.list", { projectId: project.id })
          ).connections.find((item: any) => item.provider === provider);
          assert.equal(connection.health, "healthy");
          assert.ok(
            !JSON.stringify(
              await db.one("SELECT * FROM time_connections WHERE id=$1", [connection.id]),
            ).includes(`synthetic-time-${provider}-${device}`),
          );
          times.push(connection);
        }
        const harvestRow = time.locator("li").filter({
          has: page.getByRole("heading", { name: `harvest ${device}`, exact: true }),
        });
        const timeDoctorRow = time.locator("li").filter({
          has: page.getByRole("heading", { name: `timedoctor ${device}`, exact: true }),
        });
        await harvestRow
          .getByRole("button", { name: "Edit", exact: true })
          .press("Enter");
        const timeForm = time.locator("form");
        await timeForm
          .getByLabel("Connection name", { exact: true })
          .fill(`Unsent time ${device}`);
        await timeForm
          .getByLabel("Provider project ID", { exact: true })
          .fill("unsent42");
        await timeForm
          .getByLabel("Replace token (leave empty to keep current)", { exact: true })
          .fill(`unsent-time-secret-${device}`);
        await dismissReplacement(timeForm, () =>
          timeDoctorRow.getByRole("button", { name: "Edit", exact: true }).press("Enter"),
        );
        assert.equal(
          await timeForm
            .getByRole("combobox", { name: "Provider", exact: true })
            .inputValue(),
          "harvest",
        );
        await timeDoctorRow
          .getByRole("button", { name: "Edit", exact: true })
          .press("Enter");
        assert.equal(
          await timeForm.getByLabel("Connection name", { exact: true }).inputValue(),
          `timedoctor ${device}`,
        );
        assert.equal(
          await timeForm
            .getByRole("combobox", { name: "Provider", exact: true })
            .inputValue(),
          "timedoctor",
        );
        checks.push(
          `${device}: dismissed time editor replacement preserves provider, token and destination; accepted discard changes editor`,
        );
        assert.ok(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          `${device} project settings fits`,
        );
        const thread = await post("threads.create", {
          projectId: project.id,
          body: `Reviewed integration work ${device}`,
          pageUrl: "https://example.test/review?variant=a",
          idempotencyKey: randomUUID(),
        });
        await page.goto(`${origin}/threads/${thread.id}`);
        await page.locator('summary[aria-label="More actions"]').press("Enter");
        await page.getByRole("button", { name: "Details", exact: true }).press("Enter");
        const detail = page.locator("#thread-details");
        await page.waitForFunction(() => document.activeElement?.id === "thread-details");
        await detail
          .getByRole("button", { name: "← Discussion", exact: true })
          .press("Enter");
        await page.waitForFunction(
          () => document.activeElement?.id === "thread-discussion-heading",
        );
        await page.locator('summary[aria-label="More actions"]').press("Enter");
        // Hold the navigation frame so the next native keyboard interaction can
        // begin first, as it can when rendering and input share a busy frame.
        await page.evaluate(() => {
          const requestFrame = window.requestAnimationFrame;
          const callbacks: FrameRequestCallback[] = [];
          window.requestAnimationFrame = (callback) => {
            callbacks.push(callback);
            return callbacks.length;
          };
          (window as any).__flushThreadDetailFrame = () => {
            window.requestAnimationFrame = requestFrame;
            delete (window as any).__flushThreadDetailFrame;
            for (const callback of callbacks) callback(performance.now());
            return callbacks.length;
          };
        });
        await page.getByRole("button", { name: "Details", exact: true }).press("Enter");
        const replay = detail.locator("details").filter({
          has: page
            .locator("summary")
            .filter({ hasText: /^Fullstory and LogRocket sessions/ }),
        });
        await replay.locator("summary").focus();
        assert.equal(
          await page.evaluate(() => (window as any).__flushThreadDetailFrame()),
          1,
        );
        assert.equal(
          await replay
            .locator("summary")
            .evaluate((summary) => summary === document.activeElement),
          true,
          `${device}: deferred Details focus preserves the reviewer's focused disclosure`,
        );
        await replay.locator("summary").press("Enter");
        await replay
          .getByRole("combobox", { name: "Provider", exact: true })
          .selectOption("logrocket");
        await replay
          .getByLabel("Provider session URL", { exact: true })
          .fill(`https://app.logrocket.com/synthetic/review/s/${device}/1`);
        await replay
          .getByLabel("Exact page URL reviewed in that session", { exact: true })
          .fill("https://example.test/wrong-page");
        await replay.getByLabel("Capture time", { exact: true }).fill("2026-10-20T10:30");
        await replay
          .getByRole("button", { name: "Add reviewed session link", exact: true })
          .press("Enter");
        await replay
          .getByRole("alert")
          .filter({ hasText: "must exactly match" })
          .waitFor();
        await replay
          .getByLabel("Exact page URL reviewed in that session", { exact: true })
          .fill("https://example.test/review?variant=a");
        await replay
          .getByRole("button", { name: "Add reviewed session link", exact: true })
          .press("Enter");
        await replay.getByText("Reviewed session link added.", { exact: true }).waitFor();
        assert.equal(
          (await post("replayLinks.list", { threadId: thread.id })).items.length,
          1,
        );
        await replay.getByRole("button", { name: "Remove", exact: true }).press("Enter");
        await replay.getByText("Session link removed.", { exact: true }).waitFor();
        assert.equal(
          (await post("replayLinks.list", { threadId: thread.id })).items.length,
          0,
        );
        checks.push(
          `${device}: reviewed replay page validation, add and removal persist over real HTTP`,
        );
        const timeEntry = detail
          .locator("details")
          .filter({ has: page.getByText("Log reviewed work time", { exact: true }) });
        await timeEntry.locator("summary").press("Enter");
        for (const connection of times) {
          await timeEntry
            .getByRole("combobox", { name: "Time tracking destination", exact: true })
            .selectOption(connection.id);
          await timeEntry.getByLabel("Work date", { exact: true }).fill("2026-10-20");
          if (connection.provider === "timedoctor")
            await timeEntry
              .getByLabel("Start time in your local timezone", { exact: true })
              .fill("2026-10-20T10:00");
          await timeEntry.getByLabel("Minutes worked", { exact: true }).fill("1441");
          assert.equal(
            await timeEntry
              .getByLabel("Minutes worked", { exact: true })
              .evaluate((input: HTMLInputElement) => input.validity.rangeOverflow),
            true,
          );
          await timeEntry
            .getByLabel("Minutes worked", { exact: true })
            .fill(connection.provider === "harvest" ? "25" : "15");
          await timeEntry
            .getByLabel("Reviewed note to share with the provider", { exact: true })
            .fill(`Reviewed ${connection.provider} work`);
          const entryResponse = page.waitForResponse((response) =>
            response.url().endsWith("/api/timeTracking.log"),
          );
          await timeEntry
            .getByRole("button", { name: "Submit reviewed time entry", exact: true })
            .press("Enter");
          assert.equal((await entryResponse).status(), 200);
          await timeEntry
            .getByText("Time entry queued. Check the delivery history below.", {
              exact: true,
            })
            .waitFor();
        }
        const entries = (await post("timeTracking.history", { threadId: thread.id }))
          .entries;
        assert.equal(entries.length, 2);
        assert.deepEqual(
          new Set(entries.map((entry: any) => entry.minutes)),
          new Set([25, 15]),
        );
        assert.ok(entries.every((entry: any) => entry.status === "pending"));
        checks.push(
          `${device}: Harvest and Time Doctor fields, destination verification, native time limits and reviewed entries queued`,
        );
        const denied = await signedContext("viewer@example.test", { width, height });
        const readonly = await denied.context.newPage();
        readonly.setDefaultTimeout(10000);
        readonly.on("pageerror", (error) => errors.push(error.message));
        await readonly.goto(`${origin}/trackers`);
        await readonly
          .getByRole("alert")
          .filter({ hasText: "Server owner access required" })
          .waitFor();
        assert.equal(
          await readonly
            .getByRole("button", { name: "Add tracker connection", exact: true })
            .count(),
          0,
        );
        await readonly.goto(`${settingsUrl}#integrations-webhooks`);
        await readonly
          .getByRole("heading", { name: "GitHub Issues", exact: true })
          .waitFor();
        const deniedProviderTabs = readonly.getByRole("tablist", {
          name: "Project integration providers",
          exact: true,
        });
        assert.deepEqual(await deniedProviderTabs.getByRole("tab").allTextContents(), [
          "GitHub",
        ]);
        assert.equal(
          await readonly
            .getByRole("button", { name: "Add webhook", exact: true })
            .count(),
          0,
        );
        assert.equal(
          await readonly
            .getByRole("button", { name: "Add notification channel", exact: true })
            .count(),
          0,
        );
        await readonly.goto(`${origin}/threads/${thread.id}`);
        await readonly.locator('summary[aria-label="More actions"]').press("Enter");
        await readonly
          .getByRole("button", { name: "Details", exact: true })
          .press("Enter");
        assert.equal(
          await readonly
            .getByRole("button", { name: "Add reviewed session link", exact: true })
            .count(),
          0,
        );
        assert.equal(
          await readonly.getByText("Log reviewed work time", { exact: true }).count(),
          0,
        );
        assert.equal(
          await readonly.getByText("External tasks", { exact: true }).count(),
          0,
        );
        // Keep denied HTTP assertions on a separate session: the rendered app
        // renews its own CSRF during navigation and must not race this client.
        const deniedApi = await signedContext("viewer@example.test", { width, height });
        await post(
          "trackers.save",
          {
            projectId: project.id,
            provider: "asana",
            label: "Denied",
            configuration: { targetId: "123", states: [], poll: false },
            credential: { token: "synthetic-denied-token", auth: "token" },
          },
          deniedApi,
          403,
        );
        await post(
          "timeTracking.log",
          {
            connectionId: times[0].id,
            threadId: thread.id,
            revision: thread.revision,
            spentDate: "2026-10-20",
            minutes: 5,
            note: "Denied synthetic time",
            idempotencyKey: randomUUID(),
          },
          deniedApi,
          403,
        );
        await post(
          "channels.save",
          {
            projectId: project.id,
            provider: "slack",
            label: "Denied",
            events: ["created"],
            webhookUrl: webhook,
          },
          deniedApi,
          403,
        );
        await post(
          "replayLinks.add",
          {
            threadId: thread.id,
            revision: thread.revision,
            provider: "logrocket",
            sessionUrl: "https://app.logrocket.com/synthetic/review/s/session",
            pageUrl: "https://example.test/review?variant=a",
            capturedAt: "2026-10-20T10:00:00.000Z",
            idempotencyKey: randomUUID(),
          },
          deniedApi,
          403,
        );
        checks.push(
          `${device}: read-only UI and real HTTP deny tracker configuration, time and replay writes`,
        );
        await readonly.close();
        await denied.context.close();
        await deniedApi.context.close();
        await page.close();
        await signed.context.close();
      }
      assert.deepEqual(errors, []);
      const html = await readFile("dist/web/index.html", "utf8");
      const bundle = html.match(/src="([^"]+\.js)"/)?.[1];
      await mkdir(".local", { recursive: true });
      await writeFile(
        ".local/integrations-qa-receipt.json",
        JSON.stringify(
          {
            checks,
            pageErrors: errors,
            externalVerificationMocks: [...new Set(external)],
            channelDelivery: "queued only; no real webhook messages or time entries sent",
            bundle,
            htmlSha256: createHash("sha256").update(html).digest("hex"),
            screenshots,
            providerLayouts,
          },
          null,
          2,
        ),
      );
    } finally {
      globalThis.fetch = originalFetch;
      await browser?.close();
      if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
      await pg.close();
    }
  },
);
