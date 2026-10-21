import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { paceQaApi } from "../scripts/lib/qa-api-pacing.mjs";
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
      openProjectAllowedOrigins: ["https://synthetic.openproject.test"],
    };
    const originalFetch = globalThis.fetch;
    const external: string[] = [],
      checks: string[] = [],
      errors: string[] = [],
      screenshots: string[] = [];
    const providerLayouts: { device: string; provider: string; fields: number }[] = [];
    let server: any,
      browser: Awaited<ReturnType<typeof chromium.launch>> | undefined,
      pacing: ReturnType<typeof paceQaApi> | undefined;
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
      if (url.origin === "https://api.clickup.com") {
        if (new Headers(init?.headers).get("authorization")?.includes("denied"))
          return new Response("{}", { status: 401 });
        if (url.pathname === "/api/v2/team")
          return json({ teams: [{ id: "team1", name: "Synthetic studio" }] });
        if (url.pathname === "/api/v2/team/team1/space")
          return json({ spaces: [{ id: "space1", name: "Web development" }] });
        if (url.pathname === "/api/v2/space/space1/folder")
          return json({ folders: [{ id: "folder1", name: "Client projects" }] });
        if (url.pathname === "/api/v2/space/space1/list")
          return json({ lists: [{ id: "list2", name: "Intake" }] });
        if (url.pathname === "/api/v2/folder/folder1/list")
          return json({ lists: [{ id: "list1", name: "Website tasks" }] });
        if (["/api/v2/list/list1", "/api/v2/list/list2"].includes(url.pathname))
          return json({
            name: url.pathname.endsWith("list1") ? "Website tasks" : "Intake",
            statuses: [{ status: "Open" }, { status: "Closed" }],
          });
      }
      if (url.origin === "https://api.monday.com" && url.pathname === "/v2") {
        const body = JSON.parse(String(init?.body));
        if (body.query.includes("boards(limit:50"))
          return json({
            data: {
              boards:
                body.variables.page === 1
                  ? Array.from({ length: 50 }, (_, index) => ({
                      id: String(1000 + index),
                      name: `Studio board ${index + 1}`,
                    }))
                  : [{ id: "5001", name: "Synthetic launch board" }],
            },
          });
        return json({
          data: {
            boards: [
              {
                id: "5001",
                name: "Synthetic launch board",
                columns: [
                  { id: "long_text", title: "Task details", type: "long_text" },
                  {
                    id: "status",
                    title: "Work stage",
                    type: "status",
                    settings: { labels: [{ label: "New" }, { label: "Complete" }] },
                  },
                ],
              },
            ],
          },
        });
      }
      if (
        url.origin === "https://app.asana.com" &&
        url.pathname === "/api/1.0/projects/123"
      )
        return json({ data: { name: "Synthetic Asana project" } });
      if (url.origin === "https://synthetic.openproject.test") {
        assert.equal(init?.method ?? "GET", "GET");
        const authorization = new Headers(init?.headers).get("authorization") ?? "";
        assert.match(authorization, /^Basic /);
        assert.match(
          Buffer.from(authorization.slice(6), "base64").toString("utf8"),
          /^apikey:synthetic-openproject-token-(desktop|mobile)$/,
        );
        if (url.pathname === "/api/v3/projects/42")
          return json({
            id: 42,
            name: "Synthetic OpenProject project",
            _links: {
              createWorkPackageImmediate: {
                href: "/api/v3/projects/42/work_packages",
                method: "post",
              },
            },
          });
        if (url.pathname === "/api/v3/projects/42/types")
          return json({ _embedded: { elements: [{ id: 1, name: "Task" }] } });
        if (url.pathname === "/api/v3/statuses")
          return json({
            _embedded: {
              elements: [
                { id: 1, name: "New" },
                { id: 12, name: "Closed" },
              ],
            },
          });
      }
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
      const emptyTasksProject = await ops.executeOperation(owner, "projects.create", {
        name: "Empty task providers",
        origins: ["https://example.test"],
      });
      const viewer = await ops.executeOperation(owner, "members.create", {
        name: "Read-only reviewer",
        email: "viewer@example.test",
        password,
        grants: projects.map((project) => ({ projectId: project.id, role: "viewer" })),
      });
      const maintainer = await ops.executeOperation(owner, "members.create", {
        name: "Project maintainer",
        email: "maintainer@example.test",
        password,
        grants: projects.map((project) => ({
          projectId: project.id,
          role: "maintainer",
        })),
      });
      for (const member of [viewer, maintainer])
        await db.query("UPDATE users SET must_change_password=false WHERE id=$1", [
          member.id,
        ]);
      pacing = paceQaApi(createApp(config, db, store));
      server = createServer(pacing).listen(0, "127.0.0.1");
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
        await page.goto(
          `${origin}/projects/${emptyTasksProject.id}/settings#integrations-tasks`,
        );
        await page.getByText("No task connections.", { exact: true }).waitFor();
        const choices = page.getByRole("list", {
          name: "Supported task providers",
          exact: true,
        });
        assert.deepEqual(await choices.getByRole("button").allTextContents(), [
          "Jira Cloud",
          "Linear",
          "Asana",
          "ClickUp",
          "monday.com",
          "Trello",
          "Productive",
          "Teamwork",
          "Firmao CRM",
          "OpenProject",
        ]);
        assert.equal(
          await page.getByRole("combobox", { name: "Project", exact: true }).count(),
          0,
        );
        assert.ok(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          `${device}: provider chooser fits viewport`,
        );
        const choicesCapture = `.local/integration-tabs-qa/${device}-task-providers.png`;
        await page.screenshot({ path: choicesCapture, fullPage: true });
        screenshots.push(choicesCapture);
        await choices
          .getByRole("button", { name: "Add OpenProject connection", exact: true })
          .click();
        assert.equal(
          await page
            .getByRole("combobox", { name: "Provider", exact: true })
            .inputValue(),
          "openproject",
        );
        await page
          .getByLabel("OpenProject instance URL", { exact: true })
          .or(page.getByRole("combobox", { name: "Account", exact: true }))
          .first()
          .waitFor();
        await page.getByRole("button", { name: "Cancel", exact: true }).click();
        checks.push(
          `${device}: empty project Tasks shows all 10 named providers and the OpenProject shortcut opens its form without a project selector`,
        );
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
          .and(trackers.locator("button:enabled"))
          .waitFor();
        await trackers
          .getByRole("button", { name: "Add tracker connection", exact: true })
          .press("Enter");
        const trackerForm = trackers.locator(".tracker-form");
        await trackerForm
          .getByRole("button", { name: "Advanced setup", exact: true })
          .click();
        const trackerProviders = [
          "jira",
          "linear",
          "asana",
          "clickup",
          "monday",
          "trello",
          "productive",
          "teamwork",
          "firmao",
          "openproject",
        ];
        assert.deepEqual(
          await trackerForm
            .getByRole("combobox", { name: "Provider", exact: true })
            .locator("option")
            .evaluateAll((options) => options.map((option) => option.value)),
          trackerProviders,
        );
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
          .getByRole("button", { name: "Advanced setup", exact: true })
          .click();
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
        await trackerForm
          .getByRole("button", { name: "Advanced setup", exact: true })
          .click();
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
          .getByRole("button", { name: "Advanced setup", exact: true })
          .click();
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
        const settingsRequests: string[] = [],
          taskProjectRequests: string[] = [];
        page.on("request", (request) => {
          const pathname = new URL(request.url()).pathname;
          if (
            /^\/api\/(notifications|channels|timeTracking|webhooks|trackers)\./.test(
              pathname,
            )
          )
            settingsRequests.push(pathname);
          if (pathname === "/api/trackers.list")
            taskProjectRequests.push(request.postDataJSON().projectId);
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
        const settingsTabs = page.getByRole("tablist", {
          name: "Project settings sections",
          exact: true,
        });
        const emailSettingsTab = settingsTabs.getByRole("tab", {
          name: "Email notifications",
          exact: true,
        });
        const integrationsSettingsTab = settingsTabs.getByRole("tab", {
          name: "Integrations",
          exact: true,
        });
        const providers = [
          {
            id: "tasks",
            label: "Tasks",
            ready: () =>
              page
                .locator("#integrations-tasks")
                .getByRole("heading", { name: `Asana ${device}`, exact: true }),
          },
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
        await assertSelectedProvider("Tasks");
        assert.ok(settingsRequests.some((path) => path === "/api/trackers.list"));
        assert.ok(
          settingsRequests.every((path) => path.startsWith("/api/trackers.")),
          `${device}: legacy integrations link opens only its default Tasks requests`,
        );
        // Capture each initial provider surface before entering any credentials.
        for (const provider of providers) {
          await providerTab(provider.label).click();
          await provider.ready().waitFor();
          await assertSelectedProvider(provider.label);
          if (provider.id === "tasks") {
            assert.ok(
              taskProjectRequests.length > 0,
              `${device}: Tasks fetches on first visit`,
            );
            assert.deepEqual(
              new Set(taskProjectRequests),
              new Set([project.id]),
              `${device}: Tasks fetch is pinned to the selected project`,
            );
          }
          assert.equal(new URL(page.url()).hash, `#integrations-${provider.id}`);
          const addName =
            provider.id === "tasks"
              ? "Add connection"
              : provider.id === "channels"
                ? "Add notification channel"
                : provider.id === "webhooks"
                  ? "Add webhook"
                  : provider.id === "time"
                    ? "Add time connection"
                    : undefined;
          if (addName) {
            await page.getByRole("button", { name: addName, exact: true }).click();
            const selectedPanel = page.locator(`#integrations-${provider.id}`);
            if (provider.id === "tasks")
              await selectedPanel
                .getByRole("combobox", { name: "Provider", exact: true })
                .selectOption("openproject");
            const fields = await selectedPanel
              .locator(".connection-form .field:visible, .tracker-form .field:visible")
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
          `${device}: five separate provider panels, one selected, no horizontal overflow; default settings and legacy link mount only the required provider`,
        );
        const keyMoves = [
          ["Home", "Tasks"],
          ["End", "Time tracking"],
          ["ArrowRight", "Tasks"],
          ["ArrowLeft", "Time tracking"],
          ["Home", "Tasks"],
          ["ArrowRight", "Slack & Teams"],
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
          `${device}: Arrow keys wrap and Home/End preserve roving focus; all five provider deep links restore the requested panel after page navigation`,
        );
        await providerTab("Tasks").click();
        const taskSettings = page.locator("#integrations-tasks .tracker-settings");
        await taskSettings
          .getByRole("heading", { name: `Asana ${device}`, exact: true })
          .waitFor();
        assert.equal(
          await taskSettings
            .getByRole("combobox", { name: "Project", exact: true })
            .count(),
          0,
        );
        assert.equal(
          await taskSettings
            .getByRole("heading", {
              name: `Asana ${device === "desktop" ? "mobile" : "desktop"}`,
              exact: true,
            })
            .count(),
          0,
        );
        await taskSettings
          .getByRole("button", { name: "Add connection", exact: true })
          .click();
        const projectTaskForm = taskSettings.locator(".tracker-form");
        await projectTaskForm
          .getByRole("button", { name: "Advanced setup", exact: true })
          .click();
        assert.deepEqual(
          await projectTaskForm
            .getByRole("combobox", { name: "Provider", exact: true })
            .locator("option")
            .evaluateAll((options) => options.map((option) => option.value)),
          trackerProviders,
        );
        await projectTaskForm
          .getByRole("combobox", { name: "Provider", exact: true })
          .selectOption("openproject");
        await projectTaskForm
          .getByLabel("Connection name", { exact: true })
          .fill(`OpenProject ${device}`);
        await projectTaskForm
          .getByLabel(/^OpenProject instance URL/)
          .fill("https://synthetic.openproject.test");
        await projectTaskForm
          .getByLabel("OpenProject project ID", { exact: true })
          .fill("42");
        await projectTaskForm
          .getByLabel("Work package type ID", { exact: true })
          .fill("1");
        await projectTaskForm
          .getByLabel("API token", { exact: true })
          .fill(`synthetic-openproject-token-${device}`);
        await emailSettingsTab.click();
        await integrationsSettingsTab.click();
        await providerTab("Tasks").click();
        assert.equal(
          await projectTaskForm
            .getByLabel("Connection name", { exact: true })
            .inputValue(),
          `OpenProject ${device}`,
        );
        assert.equal(
          await projectTaskForm.getByLabel(/^OpenProject instance URL/).inputValue(),
          "https://synthetic.openproject.test",
        );
        assert.equal(
          await projectTaskForm
            .getByLabel("OpenProject project ID", { exact: true })
            .inputValue(),
          "42",
        );
        assert.equal(
          await projectTaskForm
            .getByLabel("Work package type ID", { exact: true })
            .inputValue(),
          "1",
        );
        assert.equal(
          await projectTaskForm.getByLabel("API token", { exact: true }).inputValue(),
          `synthetic-openproject-token-${device}`,
        );
        await projectTaskForm
          .getByText("Status mappings and polling", { exact: true })
          .press("Enter");
        await projectTaskForm
          .getByLabel("open → remote status", { exact: true })
          .fill("1");
        await projectTaskForm
          .getByLabel("resolved → remote status", { exact: true })
          .fill("12");
        await projectTaskForm
          .getByLabel(/^OpenProject instance URL/)
          .fill("https://not-allowed.openproject.test");
        const draftSnapshot = () =>
          projectTaskForm.evaluate((form: HTMLFormElement) =>
            [...new FormData(form).entries()].map(([name, value]) => [
              name,
              String(value),
            ]),
          );
        const deniedDraft = await draftSnapshot();
        const connectionsBeforeDeniedOrigin = await db.one(
          "SELECT count(*)::int n FROM tracker_connections WHERE project_id=$1",
          [project.id],
        );
        const externalBeforeDeniedOrigin = external.length;
        const deniedOriginResponse = page.waitForResponse((response) =>
          response.url().endsWith("/api/trackers.save"),
        );
        await projectTaskForm
          .getByRole("button", { name: "Save connection", exact: true })
          .click();
        const deniedOrigin = await deniedOriginResponse;
        assert.equal(
          deniedOrigin.status(),
          400,
          `${device}: an unallowed OpenProject origin is a setup error`,
        );
        const deniedOriginPayload = await deniedOrigin.json();
        assert.equal(deniedOriginPayload.error.code, "OPENPROJECT_ORIGIN_NOT_ALLOWED");
        assert.match(deniedOriginPayload.error.message, /OPENPROJECT_ALLOWED_ORIGINS/);
        assert.match(deniedOriginPayload.error.message, /recreate|restart/i);
        await projectTaskForm
          .getByRole("alert")
          .filter({ hasText: "OPENPROJECT_ALLOWED_ORIGINS" })
          .waitFor();
        assert.equal(
          external.length,
          externalBeforeDeniedOrigin,
          `${device}: denied origin sends no external request`,
        );
        assert.equal(
          (
            await db.one(
              "SELECT count(*)::int n FROM tracker_connections WHERE project_id=$1",
              [project.id],
            )
          ).n,
          connectionsBeforeDeniedOrigin.n,
          `${device}: denied origin persists no connection`,
        );
        assert.deepEqual(
          await draftSnapshot(),
          deniedDraft,
          `${device}: setup failure preserves token, project, type, mappings and the entire draft`,
        );
        assert.equal(
          await projectTaskForm
            .getByRole("combobox", { name: "Provider", exact: true })
            .inputValue(),
          "openproject",
        );
        assert.equal(await projectTaskForm.getAttribute("data-unsaved"), "true");
        checks.push(
          `${device}: unallowed OpenProject origin returns actionable HTTP400 allowlist/recreate guidance, causes no provider request or saved connection and preserves the complete credential/configuration draft`,
        );
        await projectTaskForm
          .getByLabel(/^OpenProject instance URL/)
          .fill("https://synthetic.openproject.test");
        await projectTaskForm
          .getByRole("button", { name: "Save connection", exact: true })
          .click();
        const openProjectRow = taskSettings.locator("li").filter({
          has: page.getByRole("heading", {
            name: `OpenProject ${device}`,
            exact: true,
          }),
        });
        await openProjectRow
          .getByRole("button", { name: "Test connection", exact: true })
          .click();
        await openProjectRow
          .getByText("Synthetic OpenProject project: available status IDs", {
            exact: true,
          })
          .waitFor();
        const openProject = (
          await post("trackers.list", { projectId: project.id })
        ).connections.find((connection: any) => connection.provider === "openproject");
        assert.equal(openProject.projectId, project.id);
        assert.equal(
          openProject.configuration.instanceOrigin,
          "https://synthetic.openproject.test",
        );
        assert.equal(openProject.configuration.targetId, "42");
        assert.equal(openProject.configuration.issueTypeId, "1");
        assert.equal(openProject.health, "healthy");
        const encryptedOpenProject = JSON.stringify(
          await db.one("SELECT * FROM tracker_connections WHERE id=$1", [openProject.id]),
        );
        assert.ok(
          !encryptedOpenProject.includes(`synthetic-openproject-token-${device}`),
        );
        assert.ok(
          !(await page.content()).includes(`synthetic-openproject-token-${device}`),
        );
        assert.deepEqual(new Set(taskProjectRequests), new Set([project.id]));
        checks.push(
          `${device}: Tasks pins its project, offers all 10 providers, preserves OpenProject drafts across tabs, saves encrypted origin/project/type/token and verifies Basic API access and mapped status IDs`,
        );
        async function startGuided(provider: string) {
          await taskSettings
            .getByRole("button", { name: "Add connection", exact: true })
            .click();
          await projectTaskForm
            .getByRole("combobox", { name: "Provider", exact: true })
            .selectOption(provider);
          await projectTaskForm
            .getByRole("button", { name: "Continue", exact: true })
            .waitFor();
          await page.waitForFunction(
            () => !document.querySelector(".tracker-setup .loading"),
          );
        }
        async function chooseDestination(title: string, value: string) {
          const field = projectTaskForm.getByRole("combobox", {
            name: title,
            exact: true,
          });
          await field.selectOption(value);
          await projectTaskForm
            .getByRole("button", { name: "Continue", exact: true })
            .press("Enter");
        }
        await startGuided("clickup");
        if (
          await projectTaskForm
            .getByRole("combobox", { name: "Account", exact: true })
            .count()
        )
          await projectTaskForm
            .getByRole("combobox", { name: "Account", exact: true })
            .selectOption("");
        await projectTaskForm
          .getByLabel("API token", { exact: true })
          .fill(`synthetic-clickup-denied-${device}`);
        assert.equal(
          await projectTaskForm.getByLabel("Connection name", { exact: true }).count(),
          0,
        );
        assert.equal(
          await projectTaskForm.getByLabel("ClickUp list ID", { exact: true }).count(),
          0,
        );
        const accountCapture = `.local/integration-tabs-qa/${device}-guided-clickup-account.png`;
        await projectTaskForm.screenshot({ path: accountCapture });
        screenshots.push(accountCapture);
        await projectTaskForm
          .getByRole("button", { name: "Continue", exact: true })
          .press("Enter");
        await projectTaskForm.getByRole("alert").waitFor();
        assert.equal(
          await projectTaskForm.getByLabel("API token", { exact: true }).inputValue(),
          `synthetic-clickup-denied-${device}`,
        );
        await projectTaskForm
          .getByLabel("API token", { exact: true })
          .fill(`synthetic-clickup-${device}`);
        await emailSettingsTab.click();
        await integrationsSettingsTab.click();
        await providerTab("Tasks").click();
        assert.equal(
          await projectTaskForm.getByLabel("API token", { exact: true }).inputValue(),
          `synthetic-clickup-${device}`,
        );
        await projectTaskForm
          .getByRole("button", { name: "Continue", exact: true })
          .press("Enter");
        await projectTaskForm
          .getByRole("combobox", { name: "Workspace", exact: true })
          .waitFor();
        assert.equal(
          await projectTaskForm
            .getByRole("combobox", { name: "Workspace", exact: true })
            .evaluate((element) => element === document.activeElement),
          true,
        );
        await chooseDestination("Workspace", "team1");
        await chooseDestination("Space", "space1");
        await chooseDestination("Folder or list", "folder_folder1");
        await chooseDestination("List", "list1");
        await projectTaskForm
          .getByRole("button", { name: "Connect", exact: true })
          .waitFor();
        assert.match(
          await projectTaskForm.locator(".tracker-setup-ready").innerText(),
          /Synthetic studio.*Web development.*Client projects/s,
        );
        assert.equal(
          await projectTaskForm
            .getByLabel("Connection name", { exact: true })
            .isVisible(),
          false,
        );
        assert.equal(
          await projectTaskForm
            .getByRole("combobox", { name: "Open", exact: true })
            .isVisible(),
          false,
        );
        const destinationCapture = `.local/integration-tabs-qa/${device}-guided-clickup-ready.png`;
        await projectTaskForm.screenshot({ path: destinationCapture });
        screenshots.push(destinationCapture);
        await projectTaskForm
          .getByText("Advanced options", { exact: true })
          .press("Enter");
        await projectTaskForm
          .getByRole("combobox", { name: "Open", exact: true })
          .selectOption("Open");
        await projectTaskForm
          .getByRole("combobox", { name: "Resolved", exact: true })
          .selectOption("Closed");
        await projectTaskForm
          .getByLabel("Import remote status changes automatically", { exact: false })
          .check();
        assert.equal(
          await projectTaskForm
            .getByRole("combobox", { name: "Closed", exact: true })
            .locator('option[value="Closed"]')
            .evaluate((option: HTMLOptionElement) => option.disabled),
          true,
        );
        await projectTaskForm.getByRole("button", { name: "Back", exact: true }).click();
        assert.equal(
          await projectTaskForm
            .getByRole("combobox", { name: "List", exact: true })
            .inputValue(),
          "list1",
        );
        await projectTaskForm
          .getByRole("button", { name: "Continue", exact: true })
          .press("Enter");
        await projectTaskForm
          .getByRole("button", { name: "Connect", exact: true })
          .waitFor();
        await projectTaskForm
          .getByText("Advanced options", { exact: true })
          .press("Enter");
        assert.equal(
          await projectTaskForm
            .getByRole("combobox", { name: "Resolved", exact: true })
            .inputValue(),
          "Closed",
        );
        await projectTaskForm
          .getByRole("button", { name: "Connect", exact: true })
          .click();
        await taskSettings
          .getByRole("heading", { name: "ClickUp · Website tasks", exact: true })
          .waitFor();
        await projectTaskForm.waitFor({ state: "detached" });
        const clickup = (
          await post("trackers.list", { projectId: project.id })
        ).connections.find((item: any) => item.label === "ClickUp · Website tasks");
        assert.equal(clickup.health, "healthy");
        assert.equal(clickup.configuration.targetId, "list1");
        assert.equal(clickup.configuration.poll, true);
        assert.deepEqual(
          clickup.configuration.states.map((state: any) => state.remote),
          ["Open", "Closed"],
        );
        assert.equal(
          (await page.content()).includes(`synthetic-clickup-${device}`),
          false,
        );
        await startGuided("clickup");
        await projectTaskForm
          .getByRole("combobox", { name: "Account", exact: true })
          .selectOption(clickup.id);
        assert.equal(
          await projectTaskForm.getByLabel("API token", { exact: true }).count(),
          0,
        );
        await projectTaskForm
          .getByRole("button", { name: "Continue", exact: true })
          .press("Enter");
        await chooseDestination("Workspace", "team1");
        await chooseDestination("Space", "space1");
        await chooseDestination("Folder or list", "list_list2");
        await projectTaskForm
          .getByRole("button", { name: "Connect", exact: true })
          .click();
        await taskSettings
          .getByRole("heading", { name: "ClickUp · Intake", exact: true })
          .waitFor();
        await projectTaskForm.waitFor({ state: "detached" });
        const reused = (
          await post("trackers.list", { projectId: project.id })
        ).connections.find((item: any) => item.label === "ClickUp · Intake");
        assert.equal(reused.health, "healthy");
        assert.deepEqual(reused.configuration.states, []);
        assert.equal(reused.configuration.poll, false);
        checks.push(
          `${device}: guided ClickUp preserves rejected-token and tab drafts, discovers named workspace/space/folder/list, focuses the next choice, auto-names, retains optional named mappings across Back, verifies save and reuses an encrypted account without showing its token`,
        );
        await startGuided("monday");
        if (
          await projectTaskForm
            .getByRole("combobox", { name: "Account", exact: true })
            .count()
        )
          await projectTaskForm
            .getByRole("combobox", { name: "Account", exact: true })
            .selectOption("");
        await projectTaskForm
          .getByLabel("API token", { exact: true })
          .fill(`synthetic-monday-${device}`);
        await projectTaskForm
          .getByRole("button", { name: "Continue", exact: true })
          .press("Enter");
        await projectTaskForm
          .getByRole("button", { name: "Load more", exact: true })
          .click();
        await projectTaskForm
          .getByRole("combobox", { name: "Board", exact: true })
          .locator('option[value="5001"]')
          .waitFor({ state: "attached" });
        await chooseDestination("Board", "5001");
        await chooseDestination("Description column", "long_text");
        await chooseDestination("Status column", "status");
        await projectTaskForm
          .getByRole("button", { name: "Connect", exact: true })
          .waitFor();
        assert.equal(
          await projectTaskForm
            .getByLabel("Connection name", { exact: true })
            .isVisible(),
          false,
        );
        const mondayCapture = `.local/integration-tabs-qa/${device}-guided-monday-ready.png`;
        await projectTaskForm.screenshot({ path: mondayCapture });
        screenshots.push(mondayCapture);
        assert.ok(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        );
        const saveKeys: string[] = [];
        let loseMondayResponse = true;
        await page.route("**/api/trackers.save", async (route) => {
          const input = route.request().postDataJSON();
          if (input.provider !== "monday") return route.continue();
          saveKeys.push(input.idempotencyKey);
          if (!loseMondayResponse) return route.continue();
          loseMondayResponse = false;
          const response = await route.fetch();
          assert.equal(response.status(), 200);
          await route.abort("failed");
        });
        await projectTaskForm
          .getByRole("button", { name: "Connect", exact: true })
          .click();
        await projectTaskForm
          .getByRole("alert")
          .filter({ hasText: "Connection failed" })
          .waitFor();
        assert.equal(
          (await post("trackers.list", { projectId: project.id })).connections.filter(
            (item: any) => item.provider === "monday",
          ).length,
          1,
        );
        await projectTaskForm
          .getByRole("button", { name: "Connect", exact: true })
          .click();
        await taskSettings
          .getByRole("heading", {
            name: "monday.com · Synthetic launch board",
            exact: true,
          })
          .waitFor();
        await projectTaskForm.waitFor({ state: "detached" });
        await page.unroute("**/api/trackers.save");
        assert.equal(saveKeys.length, 2);
        assert.ok(saveKeys[0]);
        assert.equal(saveKeys[0], saveKeys[1]);
        assert.equal(
          (await post("trackers.list", { projectId: project.id })).connections.filter(
            (item: any) => item.provider === "monday",
          ).length,
          1,
        );
        const monday = (
          await post("trackers.list", { projectId: project.id })
        ).connections.find((item: any) => item.provider === "monday");
        assert.equal(monday.health, "healthy");
        assert.equal(monday.configuration.targetId, "5001");
        assert.equal(monday.configuration.secondaryId, "long_text");
        assert.equal(monday.configuration.statusColumn, "status");
        assert.equal(monday.configuration.descriptionColumnType, "long_text");
        assert.deepEqual(monday.configuration.states, []);
        checks.push(
          `${device}: monday setup loads another board page, chooses description/status columns by name and connects with automatic label and no status-mapping requirement; a committed save whose HTTP response is lost retries with the same key and creates exactly one connection`,
        );
        await page.goto(`${settingsUrl}#integrations-email`);
        await page
          .getByRole("heading", { name: "Project email notifications", exact: true })
          .waitFor();
        assert.equal(
          await emailSettingsTab.getAttribute("aria-selected"),
          "true",
          `${device}: legacy email link opens dedicated notification settings`,
        );
        assert.equal(
          await providerTabs.count(),
          0,
          `${device}: notification settings have no integration provider tabs`,
        );
        await page.goto(`${settingsUrl}#notifications`);
        await page.reload();
        await page
          .getByRole("heading", { name: "Project email notifications", exact: true })
          .waitFor();
        await page
          .getByRole("heading", { name: "My email preferences", exact: true })
          .waitFor();
        assert.equal(await emailSettingsTab.getAttribute("aria-selected"), "true");
        assert.ok(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          `${device}: dedicated notification section fits viewport`,
        );
        await page.evaluate(() => window.scrollTo(0, 0));
        const notificationsCapture = `.local/integration-tabs-qa/${device}-notifications.png`;
        await page.screenshot({ path: notificationsCapture, fullPage: true });
        screenshots.push(notificationsCapture);
        const emailEnabled = page.getByLabel(
          "Enable email notifications for this project",
          { exact: true },
        );
        const originalEmailEnabled = await emailEnabled.isChecked();
        await emailEnabled.setChecked(!originalEmailEnabled);
        await integrationsSettingsTab.click();
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
        await emailSettingsTab.click();
        assert.equal(
          await emailEnabled.isChecked(),
          !originalEmailEnabled,
          `${device}: unsaved email settings survive section navigation`,
        );
        await integrationsSettingsTab.click();
        await providerTab("Slack & Teams").click();
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
        const maintained = await signedContext("maintainer@example.test", {
          width,
          height,
        });
        const maintainedPage = await maintained.context.newPage();
        maintainedPage.setDefaultTimeout(10000);
        maintainedPage.on("pageerror", (error) => errors.push(error.message));
        await maintainedPage.goto(`${settingsUrl}#integrations-tasks`);
        const maintainedTasks = maintainedPage.locator(
          "#integrations-tasks .tracker-settings",
        );
        await maintainedTasks
          .getByRole("heading", { name: `Asana ${device}`, exact: true })
          .waitFor();
        assert.equal(
          await maintainedTasks
            .getByRole("combobox", { name: "Project", exact: true })
            .count(),
          0,
        );
        for (const name of ["Add connection", "Edit connection", "Disconnect", "Enable"])
          assert.equal(
            await maintainedTasks.getByRole("button", { name, exact: true }).count(),
            0,
            `${device}: maintainer cannot ${name}`,
          );
        assert.equal(
          await maintainedTasks
            .getByRole("button", { name: /^Add .+ connection$/ })
            .count(),
          0,
        );
        const maintainedAsana = maintainedTasks.locator("li").filter({
          has: maintainedPage.getByRole("heading", {
            name: `Asana ${device}`,
            exact: true,
          }),
        });
        await maintainedAsana
          .getByRole("button", { name: "Test connection", exact: true })
          .click();
        await maintainedTasks
          .getByText("Provider access and status mappings verified.", { exact: true })
          .waitFor();
        const maintainedApi = await signedContext("maintainer@example.test", {
          width,
          height,
        });
        const maintainedList = await post(
          "trackers.list",
          { projectId: project.id },
          maintainedApi,
        );
        assert.ok(
          maintainedList.connections.every(
            (connection: any) => connection.projectId === project.id,
          ),
        );
        await post(
          "trackers.save",
          {
            projectId: project.id,
            provider: "asana",
            label: "Denied maintainer",
            configuration: { targetId: "123", states: [], poll: false },
            credential: { token: "synthetic-denied-maintainer-token", auth: "token" },
          },
          maintainedApi,
          403,
        );
        await post(
          "trackers.enable",
          {
            connectionId: openProject.id,
            revision: openProject.revision,
            enabled: false,
          },
          maintainedApi,
          403,
        );
        checks.push(
          `${device}: nonowner maintainer can inspect and test project task connections; management controls and real save/enable HTTP writes remain owner-only`,
        );
        await maintainedPage.close();
        await maintained.context.close();
        await maintainedApi.context.close();
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
        await readonly.goto(`${settingsUrl}#integrations-tasks`);
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
        await post("trackers.list", { projectId: project.id }, deniedApi, 403);
        await post("trackers.test", { connectionId: openProject.id }, deniedApi, 403);
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
      assert.equal(pacing.stats.overflow, 0);
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
            apiPacing: pacing.stats,
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

test(
  "Jira consent-first setup discovers named destinations and safely retries canonical completion",
  {
    skip: process.env.FEEDBACKS_RECORDING_BROWSER_SMOKE !== "1",
    timeout: 120000,
  },
  async () => {
    const pg = new PGlite(),
      db = new Database(pg as any),
      originalFetch = globalThis.fetch;
    const objects = new Map<string, Buffer>();
    const store: any = {
      put: async (key: string, value: Buffer) => objects.set(key, value),
      get: async (key: string) => objects.get(key)!,
      remove: async (key: string) => objects.delete(key),
    };
    const config: any = {
      appOrigin: "http://127.0.0.1",
      production: false,
      organizationId: randomUUID(),
    };
    const cloudId = "b59926c7-6474-4931-8cc2-34af0d589444",
      otherCloudId = "9d1d2481-19b0-4987-a50e-8623f6f54a79";
    const checks: string[] = [],
      screenshots: string[] = [],
      errors: string[] = [];
    let server: ReturnType<typeof createServer> | undefined,
      browser: Awaited<ReturnType<typeof chromium.launch>> | undefined,
      authorized = false,
      remoteExpired = false,
      remoteFlows = 0,
      pollCount = 0;
    const json = (data: unknown) =>
      new Response(JSON.stringify(data), {
        headers: { "Content-Type": "application/json" },
      });
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (["127.0.0.1", "localhost"].includes(url.hostname))
        return originalFetch(input, init);
      if (url.origin === "https://broker.example.test") {
        if (url.pathname === "/v1/start") {
          remoteFlows++;
          authorized = false;
          return json({
            flowId: `synthetic-remote-${remoteFlows}`,
            pollToken: `synthetic-poll-secret-${remoteFlows}`,
            authorizeUrl: `https://auth.atlassian.com/authorize?state=synthetic-${remoteFlows}`,
          });
        }
        if (url.pathname === "/v1/ack") return json({ removed: true });
        if (url.pathname === "/v1/poll") {
          pollCount++;
          if (remoteExpired) {
            remoteExpired = false;
            return new Response(JSON.stringify({ error: "expired_or_restarted" }), {
              status: 410,
            });
          }
          return json(
            !authorized
              ? { status: "pending" }
              : {
                  status: "ready",
                  token: {
                    access_token: "synthetic-jira-ui-access",
                    refresh_token: "synthetic-jira-ui-refresh",
                    expires_in: 3600,
                  },
                  resources: [
                    {
                      id: otherCloudId,
                      name: "Studio archive",
                      url: "https://archive.atlassian.net",
                    },
                    {
                      id: cloudId,
                      name: "Studio delivery",
                      url: "https://delivery.atlassian.net",
                    },
                  ],
                },
          );
        }
      }
      if (url.origin === "https://api.atlassian.com") {
        assert.equal(
          new Headers(init?.headers).get("authorization"),
          "Bearer synthetic-jira-ui-access",
        );
        const base = `/ex/jira/${cloudId}/rest/api/3`;
        if (url.pathname === `${base}/project/search`)
          return json({
            values: [{ id: "123", name: "Website launch" }],
            startAt: 0,
            maxResults: 50,
            total: 1,
          });
        if (url.pathname === `${base}/issue/createmeta/123/issuetypes`)
          return json({
            issueTypes: [
              { id: "10001", name: "Task", subtask: false },
              { id: "10002", name: "Bug", subtask: false },
              { id: "10003", name: "Subtask", subtask: true },
            ],
            startAt: 0,
            maxResults: 50,
            total: 3,
          });
        if (url.pathname === `${base}/issue/createmeta/123/issuetypes/10001`)
          return json({
            fields: ["project", "issuetype", "summary", "description"].map((fieldId) => ({
              fieldId,
              key: fieldId,
              required: true,
              hasDefaultValue: false,
              operations: ["set"],
            })),
            startAt: 0,
            maxResults: 50,
            total: 4,
          });
        if (url.pathname === `${base}/project/123`)
          return json({
            id: "123",
            key: "WEB",
            name: "Website launch",
            issueTypes: [
              { id: "10001", name: "Task", subtask: false },
              { id: "10002", name: "Bug", subtask: false },
              { id: "10003", name: "Subtask", subtask: true },
            ],
          });
        if (url.pathname === `${base}/project/123/statuses`)
          return json([
            {
              id: "10001",
              statuses: [
                { id: "1", name: "Open" },
                { id: "2", name: "Done" },
              ],
            },
            {
              id: "10002",
              statuses: [
                { id: "1", name: "Open" },
                { id: "2", name: "Done" },
              ],
            },
          ]);
      }
      throw new Error(`Unexpected synthetic Jira request: ${url.origin}${url.pathname}`);
    };
    try {
      await migrate(db);
      const ops = new Operations(db, store, config),
        password = "Synthetic-Jira-UI-Password-123";
      const owner = await ops.auth.bootstrap(
        "owner@example.test",
        "Synthetic owner",
        password,
      );
      const pacing = paceQaApi(createApp(config, db, store));
      server = createServer(pacing).listen(0, "127.0.0.1");
      await new Promise<void>((resolve) => server!.once("listening", resolve));
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      const origin = `http://127.0.0.1:${address.port}`;
      config.appOrigin = origin;
      browser = await chromium.launch({ headless: true });
      await mkdir(".local/integration-tabs-qa", { recursive: true });
      for (const [device, width, height] of [
        ["desktop", 1440, 1000],
        ["mobile", 390, 844],
      ] as const) {
        const project = await ops.executeOperation(owner, "projects.create", {
          name: `Jira review ${device}`,
          origins: ["https://example.test"],
        });
        const context = await browser.newContext({
          viewport: { width, height },
          timezoneId: "UTC",
        });
        const login = await context.request.post(`${origin}/api/auth.login`, {
          headers: { Origin: origin },
          data: { email: "owner@example.test", password },
        });
        assert.equal(login.status(), 200);
        const page = await context.newPage();
        page.setDefaultTimeout(10000);
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("dialog", (dialog) => dialog.accept());
        const responseBodies: string[] = [];
        page.on("response", async (response) => {
          if (response.url().includes("/api/trackers.oauth"))
            responseBodies.push(await response.text().catch(() => ""));
        });
        await page.goto(`${origin}/projects/${project.id}/settings#integrations-tasks`);
        await page
          .getByRole("button", { name: "Add Jira Cloud connection", exact: true })
          .click();
        const form = page.locator(".tracker-jira-setup");
        await form
          .getByRole("heading", { name: "Connect Jira Cloud", exact: true })
          .waitFor();
        for (const name of [
          "API token",
          "Jira project ID or key",
          "Jira issue type ID",
          "Connection name",
        ])
          assert.equal(await form.getByLabel(name, { exact: true }).count(), 0);
        config.trackerOAuth = undefined;
        await form
          .getByRole("button", { name: "Connect with Jira Cloud", exact: true })
          .click();
        await form
          .getByRole("alert")
          .filter({ hasText: "operator must configure" })
          .waitFor();
        assert.equal(
          await db
            .one("SELECT count(*)::int n FROM tracker_oauth_flows WHERE project_id=$1", [
              project.id,
            ])
            .then((row) => row.n),
          0,
        );
        config.trackerOAuth = {
          brokerUrl: "https://broker.example.test",
          installationKey: "synthetic-installation-key".padEnd(40, "a"),
        };
        const started = page.waitForResponse(
          (response) =>
            response.url().endsWith("/api/trackers.oauthStart") &&
            response.status() === 200,
        );
        await form
          .getByRole("button", { name: "Connect with Jira Cloud", exact: true })
          .click();
        const startResponse = await started,
          initialFlow = (await startResponse.json()).data;
        assert.deepEqual(startResponse.request().postDataJSON(), {
          projectId: project.id,
          provider: "jira",
          guided: true,
        });
        await form
          .getByRole("link", { name: "Authorize Jira Cloud", exact: true })
          .waitFor();
        assert.match(
          (await form
            .getByRole("link", { name: "Authorize Jira Cloud", exact: true })
            .getAttribute("href")) ?? "",
          /^https:\/\/auth\.atlassian\.com\/authorize\?/,
        );
        const consentCapture = `.local/integration-tabs-qa/${device}-jira-consent.png`;
        await form.screenshot({ path: consentCapture });
        screenshots.push(consentCapture);
        let release!: () => void, arrived!: () => void;
        const held = new Promise<void>((resolve) => {
          release = resolve;
        });
        const requested = new Promise<void>((resolve) => {
          arrived = resolve;
        });
        await page.route("**/api/trackers.oauthDiscover", async (route) => {
          arrived();
          await held;
          await route.continue();
        });
        await form
          .getByRole("button", { name: "Check connection status", exact: true })
          .click();
        await requested;
        assert.equal(
          await form
            .getByRole("combobox", { name: "Provider", exact: true })
            .isDisabled(),
          true,
        );
        assert.equal(
          await form.getByRole("button", { name: "Cancel", exact: true }).isDisabled(),
          true,
        );
        assert.equal(
          await form
            .getByRole("button", { name: "Advanced setup", exact: true })
            .isDisabled(),
          true,
        );
        release();
        await form
          .getByRole("status")
          .filter({ hasText: "Finish authorization" })
          .waitFor();
        await page.unroute("**/api/trackers.oauthDiscover");
        assert.equal(
          await form.getByRole("combobox", { name: "Jira site", exact: true }).count(),
          0,
        );
        await db.query(
          "UPDATE tracker_oauth_flows SET expires_at=now()-interval '1 second' WHERE id=$1",
          [initialFlow.flowId],
        );
        await form
          .getByRole("button", { name: "Check connection status", exact: true })
          .click();
        await form.getByRole("alert").filter({ hasText: "expired" }).waitFor();
        const restarted = page.waitForResponse(
          (response) =>
            response.url().endsWith("/api/trackers.oauthStart") &&
            response.status() === 200,
        );
        await form.getByRole("button", { name: "Start again", exact: true }).click();
        const remoteExpiryFlow = (await (await restarted).json()).data;
        await form
          .getByRole("link", { name: "Authorize Jira Cloud", exact: true })
          .waitFor();
        assert.equal(
          (
            await db.one(
              "SELECT expires_at>now() AS active FROM tracker_oauth_flows WHERE id=$1",
              [remoteExpiryFlow.flowId],
            )
          ).active,
          true,
        );
        remoteExpired = true;
        const remoteExpiry = page.waitForResponse(
          (response) =>
            response.url().endsWith("/api/trackers.oauthDiscover") &&
            response.status() === 409,
        );
        await form
          .getByRole("button", { name: "Check connection status", exact: true })
          .click();
        const remoteExpiryPayload = await (await remoteExpiry).json();
        assert.equal(remoteExpiryPayload.error.code, "TRACKER_OAUTH_EXPIRED");
        assert.match(remoteExpiryPayload.error.message, /broker/i);
        assert.match(remoteExpiryPayload.error.message, /restart|expired/i);
        assert.match(remoteExpiryPayload.error.message, /start.*again/i);
        await form
          .getByRole("alert")
          .filter({ hasText: /broker/i })
          .waitFor();
        await form.getByRole("button", { name: "Start again", exact: true }).click();
        await form
          .getByRole("link", { name: "Authorize Jira Cloud", exact: true })
          .waitFor();
        authorized = true;
        await form
          .getByRole("button", { name: "Check connection status", exact: true })
          .click();
        const site = form.getByRole("combobox", { name: "Jira site", exact: true });
        await site.waitFor();
        assert.deepEqual(await site.locator("option").allTextContents(), [
          "Choose a site",
          "Studio archive · archive.atlassian.net",
          "Studio delivery · delivery.atlassian.net",
        ]);
        await site.selectOption(cloudId);
        await form.getByRole("button", { name: "Continue", exact: true }).press("Enter");
        await form
          .getByRole("combobox", { name: "Project", exact: true })
          .selectOption("123");
        await form.getByRole("button", { name: "Continue", exact: true }).press("Enter");
        const issueType = form.getByRole("combobox", { name: "Issue type", exact: true });
        await issueType.waitFor();
        assert.deepEqual(await issueType.locator("option").allTextContents(), [
          "Choose issue type",
          "Task",
          "Bug",
        ]);
        await issueType.selectOption("10001");
        await form.getByRole("button", { name: "Continue", exact: true }).press("Enter");
        await form.getByRole("button", { name: "Connect", exact: true }).waitFor();
        assert.match(
          await form.locator(".tracker-setup-ready").innerText(),
          /Studio delivery.*Task.*Website launch/s,
        );
        assert.equal(
          await form
            .getByLabel("Connection name (optional)", { exact: true })
            .isVisible(),
          false,
        );
        const readyCapture = `.local/integration-tabs-qa/${device}-jira-destination-ready.png`;
        await form.screenshot({ path: readyCapture });
        screenshots.push(readyCapture);
        await form.getByText("Advanced options", { exact: true }).press("Enter");
        await form
          .getByLabel("Connection name (optional)", { exact: true })
          .fill(`Jira review ${device}`);
        await form.getByRole("button", { name: "Back", exact: true }).click();
        assert.equal(
          await form
            .getByRole("combobox", { name: "Issue type", exact: true })
            .inputValue(),
          "10001",
        );
        await form.getByRole("button", { name: "Continue", exact: true }).press("Enter");
        await form.getByRole("button", { name: "Connect", exact: true }).waitFor();
        await form.getByText("Advanced options", { exact: true }).press("Enter");
        assert.equal(
          await form
            .getByLabel("Connection name (optional)", { exact: true })
            .inputValue(),
          `Jira review ${device}`,
        );
        let loseResponse = true;
        const completionKeys: string[] = [];
        await page.route("**/api/trackers.oauthComplete", async (route) => {
          completionKeys.push(route.request().postDataJSON().idempotencyKey);
          if (!loseResponse) return route.continue();
          loseResponse = false;
          const response = await route.fetch();
          assert.equal(response.status(), 200);
          await route.abort("failed");
        });
        await form.getByRole("button", { name: "Connect", exact: true }).click();
        await form.getByRole("alert").filter({ hasText: "Connection failed" }).waitFor();
        assert.equal(
          await db
            .one("SELECT count(*)::int n FROM tracker_connections WHERE project_id=$1", [
              project.id,
            ])
            .then((row) => row.n),
          1,
        );
        const pollsBeforeRetry = pollCount;
        await form.getByRole("button", { name: "Connect", exact: true }).click();
        await form.waitFor({ state: "detached" });
        await page.unroute("**/api/trackers.oauthComplete");
        await page
          .getByRole("heading", { name: `Jira review ${device}`, exact: true })
          .waitFor();
        assert.equal(completionKeys.length, 2);
        assert.ok(completionKeys[0]);
        assert.equal(completionKeys[0], completionKeys[1]);
        assert.equal(pollCount, pollsBeforeRetry);
        const connections = await db.query(
          "SELECT * FROM tracker_connections WHERE project_id=$1",
          [project.id],
        );
        assert.equal(connections.length, 1);
        assert.equal(connections[0].health, "healthy");
        assert.equal(connections[0].configuration.targetId, "123");
        assert.equal(connections[0].configuration.issueTypeId, "10001");
        assert.equal(connections[0].configuration.cloudId, cloudId);
        const browserEvidence = (await page.content()) + responseBodies.join("");
        for (const secret of [
          "synthetic-jira-ui-access",
          "synthetic-jira-ui-refresh",
          "synthetic-poll-secret",
          "synthetic-installation-key",
        ])
          assert.equal(browserEvidence.includes(secret), false);
        assert.ok(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        );
        checks.push(
          `${device}: missing broker is actionable; consent starts without IDs, pending checks disable in-flight controls, local expiry and real broker-poll HTTP410 both offer a working restart, named site/project/type choices retain Back drafts, completion retries one canonical healthy connection without exposing credentials`,
        );
        await context.close();
      }
      assert.deepEqual(errors, []);
      assert.equal(pacing.stats.overflow, 0);
      await writeFile(
        ".local/jira-consent-first-qa-receipt.json",
        JSON.stringify(
          {
            checks,
            screenshots,
            pageErrors: errors,
            apiPacing: pacing.stats,
            brokerAndProvider: "Synthetic transports only; no live account grant",
          },
          null,
          2,
        ),
      );
    } finally {
      globalThis.fetch = originalFetch;
      await browser?.close();
      if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
      await pg.close();
    }
  },
);
