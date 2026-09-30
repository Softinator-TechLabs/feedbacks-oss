import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { chromium } from "playwright";
import { Database } from "../dist/server/db.js";
import { migrate } from "../dist/server/migrations.js";
import { Operations } from "../dist/server/operations.js";
import { createApp } from "../dist/server/app.js";
import { LocalAssets } from "../dist/server/assets.js";

const pg = new PGlite(),
  db = new Database(pg);
const directory = await mkdtemp(path.join(tmpdir(), "feedbacks-apps-qa-"));
const pem = generateKeyPairSync("rsa", { modulusLength: 2048 })
  .privateKey.export({ type: "pkcs8", format: "pem" })
  .toString();
const config = {
  production: false,
  appOrigin: "http://127.0.0.1",
  organizationId: randomUUID(),
  trustProxyHops: 0,
  githubApps: [
    {
      id: "101",
      name: "Team A private App",
      slug: "team-a-feedbacks",
      owners: ["first-team"],
      privateKey: pem,
    },
  ],
};
const store = new LocalAssets(directory),
  nativeFetch = globalThis.fetch;
let server,
  browser,
  conversionCount = 0,
  crossSiteCallbackCookie;
const info = {
  id: 303,
  name: "Team B private App",
  slug: "team-b-feedbacks",
  owner: { login: "second-team", type: "Organization" },
  permissions: { metadata: "read", issues: "write" },
  events: [],
};
globalThis.fetch = async (url, init) => {
  const u = new URL(String(url));
  if (u.origin === "https://api.github.com") {
    if (u.pathname.startsWith("/app-manifests/")) {
      conversionCount++;
      return Response.json({ ...info, pem });
    }
    if (u.pathname === "/app") {
      const jwt = String(init.headers.Authorization).slice(7).split(".");
      const id = JSON.parse(Buffer.from(jwt[1], "base64url").toString()).iss;
      return Response.json(
        id === "101"
          ? {
              ...info,
              id: 101,
              name: "Team A private App",
              slug: "team-a-feedbacks",
              owner: { login: "first-team", type: "Organization" },
            }
          : info,
      );
    }
    if (u.pathname.endsWith("/installation")) return Response.json({ id: 444 });
    if (u.pathname.endsWith("/access_tokens"))
      return Response.json({ token: "synthetic-installation-token" });
    throw new Error("Unexpected synthetic GitHub call");
  }
  assert.equal(
    u.origin,
    config.appOrigin,
    "Server network must remain loopback or mocked GitHub",
  );
  return nativeFetch(url, init);
};
try {
  await migrate(db);
  const ops = new Operations(db, store, config);
  const owner = await ops.auth.bootstrap(
    "owner@example.test",
    "Synthetic owner",
    "Synthetic-Owner-Password-123",
  );
  const p = await ops.executeOperation(owner, "projects.create", {
    name: "Synthetic Team B",
    origins: ["https://example.test"],
    repositoryUrl: "https://github.com/second-team/enterprise",
  });
  const member = await ops.executeOperation(owner, "members.create", {
    name: "Synthetic maintainer",
    email: "member@example.test",
    password: "Synthetic-Member-Password-123",
    grants: [{ projectId: p.id, role: "maintainer" }],
  });
  await db.query("UPDATE users SET must_change_password=false WHERE id=$1", [member.id]);
  server = createApp(config, db, store).listen(0, "127.0.0.1");
  await once(server, "listening");
  config.appOrigin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    reducedMotion: "reduce",
  });
  const login = await context.request.post(config.appOrigin + "/api/auth.login", {
    headers: { Origin: config.appOrigin },
    data: { email: "owner@example.test", password: "Synthetic-Owner-Password-123" },
  });
  assert.equal(login.status(), 200);
  assert.equal((await context.cookies())[0].sameSite, "Strict");
  const errors = [];
  await context.route("**/*", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (url.origin === config.appOrigin) {
      if (url.pathname === "/api/github-app/setup-callback")
        crossSiteCallbackCookie = (await request.allHeaders()).cookie;
      return route.continue();
    }
    if (url.origin === "https://github.com" && request.method() === "POST") {
      const manifest = JSON.parse(
        new URLSearchParams(request.postData()).get("manifest"),
      );
      assert.equal(manifest.public, false);
      assert.deepEqual(manifest.default_permissions, {
        metadata: "read",
        issues: "write",
      });
      assert.equal(url.pathname, "/organizations/second-team/settings/apps/new");
      const callback =
        config.appOrigin +
        "/api/github-app/setup-callback?state=" +
        encodeURIComponent(url.searchParams.get("state")) +
        "&code=" +
        "a".repeat(40);
      return route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><h1>Synthetic GitHub approval</h1><a href="${callback}">Approve private App</a>`,
      });
    }
    return route.abort();
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(config.appOrigin + "/help");
  await page.getByRole("link", { name: "Manage integrations", exact: true }).click();
  await page.getByRole("heading", { name: "Integrations", exact: true }).waitFor();
  await page.getByText("1 configured connection · 1 active", { exact: true }).waitFor();
  assert.equal(await page.getByText("GitLab", { exact: true }).count(), 0);
  await page.getByRole("link", { name: "Manage GitHub", exact: true }).click();
  await page.getByRole("heading", { name: "Configured Apps (1)", exact: true }).waitFor();
  await page.getByRole("button", { name: "Add GitHub account", exact: true }).click();
  const storage = page.getByRole("combobox", { name: "Store credentials" });
  await storage.selectOption("environment");
  assert.equal(
    await page.getByRole("button", { name: "Continue to GitHub", exact: true }).count(),
    0,
  );
  await page.getByRole("link", { name: "Environment setup steps ↗" }).waitFor();
  await storage.selectOption("feedbacks");
  await page
    .getByRole("textbox", { name: "GitHub organization name" })
    .fill("second-team");
  await page.getByRole("button", { name: "Continue to GitHub", exact: true }).click();
  await page.getByRole("link", { name: "Approve private App" }).waitFor();
  assert.equal(new URL(page.url()).origin, "https://github.com");
  await page.getByRole("link", { name: "Approve private App" }).click();
  await page.getByRole("heading", { name: "Configured Apps (2)", exact: true }).waitFor();
  assert.equal(
    crossSiteCallbackCookie,
    undefined,
    "Strict session must not accompany GitHub cross-site navigation",
  );
  assert.equal(conversionCount, 1);
  assert.match(page.url(), /setup=connected&appId=303$/);
  assert.ok(!page.url().includes("code="));
  assert.equal((await db.query("SELECT * FROM github_managed_apps")).length, 1);
  const row = page.locator(".github-apps-list > li").filter({
    has: page.getByRole("heading", { name: "Team B private App", exact: true }),
  });
  await row.getByText("Manage App", { exact: true }).click();
  await row.getByRole("textbox", { name: "App name" }).fill("Team B review App");
  await row.getByRole("button", { name: "Save name", exact: true }).click();
  await page.getByRole("heading", { name: "Team B review App", exact: true }).waitFor();
  await page.goto(config.appOrigin + `/projects/${p.id}/github`);
  const selector = page.getByRole("combobox", { name: /^GitHub App/ });
  await selector.selectOption("303");
  await page.getByRole("button", { name: "Save App", exact: true }).click();
  await page.getByRole("button", { name: "Connect project", exact: true }).click();
  await page.getByRole("button", { name: "Disconnect all", exact: true }).waitFor();
  await page
    .getByRole("textbox", { name: /^Add another repository/ })
    .fill("https://github.com/second-team/core");
  await page.getByRole("button", { name: "Add repository", exact: true }).click();
  await page.getByText("second-team/core", { exact: true }).waitFor();
  const inputBox = await page
      .getByRole("textbox", { name: /^Add another repository/ })
      .boundingBox(),
    buttonBox = await page
      .getByRole("button", { name: "Add repository", exact: true })
      .boundingBox();
  assert.ok(Math.abs(inputBox.y + inputBox.height - buttonBox.y - buttonBox.height) < 1);
  await page.goto(config.appOrigin + "/github-apps");
  const managed = page.locator(".github-apps-list > li").filter({
    has: page.getByRole("heading", { name: "Team B review App", exact: true }),
  });
  await managed.getByText("Manage App", { exact: true }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await managed.getByRole("button", { name: "Disconnect App", exact: true }).click();
  await page
    .getByRole("heading", { name: "Disconnected Apps (1)", exact: true })
    .waitFor();
  await page
    .locator(".github-apps-list > li")
    .filter({
      has: page.getByRole("heading", { name: "Team B review App", exact: true }),
    })
    .getByText("Manage App", { exact: true })
    .click();
  await page.getByRole("button", { name: "Reconnect App", exact: true }).click();
  await page.getByRole("heading", { name: "Configured Apps (2)", exact: true }).waitFor();
  await page
    .getByRole("link", { name: "Install on repositories ↗", exact: true })
    .first()
    .waitFor();
  const screenshots = path.resolve(".local/github-onboarding/screenshots");
  await mkdir(screenshots, { recursive: true });
  const cookies = await context.cookies();
  for (const [width, height, theme] of [
    [1280, 900, "light"],
    [390, 844, "light"],
    [1280, 900, "dark"],
    [390, 844, "dark"],
  ]) {
    const view = await browser.newContext({
      viewport: { width, height },
      reducedMotion: "reduce",
      colorScheme: theme,
    });
    await view.addCookies(cookies);
    await view.addInitScript(
      (value) => localStorage.setItem("feedbacks-theme", value),
      theme,
    );
    await view.route("**/*", (route) =>
      new URL(route.request().url()).origin === config.appOrigin
        ? route.continue()
        : route.abort(),
    );
    const screen = await view.newPage();
    screen.on("pageerror", (error) => errors.push(error.message));
    await screen.goto(config.appOrigin + "/github-apps");
    await screen
      .getByRole("heading", { name: "Configured Apps (2)", exact: true })
      .waitFor();
    await screen.getByRole("button", { name: "Add GitHub account", exact: true }).click();
    const accountType = screen.getByRole("combobox", { name: "Account type" });
    await accountType.selectOption("personal");
    await screen.getByRole("textbox", { name: "GitHub username", exact: true }).waitFor();
    await accountType.selectOption("organization");
    const help = screen.getByText("How it works · three steps", { exact: true });
    await help.focus();
    await screen.keyboard.press("Enter");
    assert.equal(await help.evaluate((element) => element.parentElement.open), true);
    const demo = screen.locator('feedbacks-demo[step="github"]');
    await demo.scrollIntoViewIfNeeded();
    await demo.locator(".sequence .active").waitFor();
    assert.equal(await demo.locator(".step").count(), 3);
    assert.match(await demo.locator(".caption").innerText(), /Add GitHub account/);
    assert.equal(
      await screen.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
      `No overflow at ${width}/${theme}`,
    );
    await screen.evaluate(() => window.scrollTo(0, 0));
    await screen.screenshot({
      path: path.join(screenshots, `apps-${width}-${theme}.png`),
      fullPage: true,
    });
    await screen.getByRole("link", { name: "← Integrations", exact: true }).click();
    await screen.getByRole("heading", { name: "Integrations", exact: true }).waitFor();
    await screen
      .getByText("2 configured connections · 2 active", { exact: true })
      .waitFor();
    assert.equal(
      await screen.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    await screen.screenshot({
      path: path.join(screenshots, `integrations-${width}-${theme}.png`),
      fullPage: true,
    });
    await view.close();
  }
  await page.goto(config.appOrigin + "/github-apps?setup=failed");
  await page
    .getByRole("alert")
    .filter({ hasText: "GitHub setup could not be completed" })
    .waitFor();
  const memberContext = await browser.newContext();
  await memberContext.request.post(config.appOrigin + "/api/auth.login", {
    headers: { Origin: config.appOrigin },
    data: { email: "member@example.test", password: "Synthetic-Member-Password-123" },
  });
  const memberPage = await memberContext.newPage();
  await memberPage.goto(config.appOrigin + "/github-apps");
  await memberPage
    .getByRole("alert")
    .filter({ hasText: "Server owner access" })
    .waitFor();
  assert.equal(
    await memberPage.getByRole("combobox", { name: "Store credentials" }).count(),
    0,
  );
  await memberPage.goto(config.appOrigin + "/integrations");
  await memberPage
    .getByRole("alert")
    .filter({ hasText: "Server owner access" })
    .waitFor();
  assert.equal(
    await memberPage.getByRole("link", { name: "Manage GitHub", exact: true }).count(),
    0,
  );
  await memberContext.close();
  assert.deepEqual(errors, []);
  await context.close();
  console.log(
    "Integrations/GitHub Apps browser QA passed: common owner hub, real cross-site callback with Strict cookies; private manifest approval; both storage choices; two repositories, management/reconnect, direct walkthrough, keyboard, owner denial, desktop/mobile light/dark. GitHub responses and data are synthetic; no real App created.",
  );
} finally {
  globalThis.fetch = nativeFetch;
  if (browser) await browser.close();
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  await pg.close();
  await rm(directory, { recursive: true, force: true });
}
