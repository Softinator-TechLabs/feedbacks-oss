import test from "node:test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import express from "express";
import { chromium } from "playwright";
import { PGlite } from "@electric-sql/pglite";
import { Database } from "../src/server/db.js";
import { migrate } from "../src/server/migrations.js";
import { Operations } from "../src/server/operations.js";
import { registerPublicIntakeRoutes } from "../src/server/http/public-intake-routes.js";

test(
  "permanent widget supports desktop/mobile keyboard, explicit contact and element-only context",
  { skip: process.env.FEEDBACKS_RECORDING_BROWSER_SMOKE !== "1" },
  async () => {
    const pg = new PGlite(),
      db = new Database(pg as any);
    const config: any = {
      appOrigin: "http://127.0.0.1",
      production: false,
      turnstileSiteKey: "synthetic",
      turnstileSecretKey: "synthetic-secret",
    };
    const app = express();
    app.set("trust proxy", 0);
    registerPublicIntakeRoutes(app, db, config);
    app.get("/widget.js", (_req, res) =>
      res.sendFile(path.resolve("public/widget.js"), { dotfiles: "allow" }),
    );
    app.get("/widget.css", (_req, res) =>
      res.sendFile(path.resolve("public/widget.css"), { dotfiles: "allow" }),
    );
    app.use((error: any, _req: any, res: any, _next: any) =>
      res
        .status(error.status ?? 500)
        .json({ ok: false, error: { message: error.message } }),
    );
    const service = app.listen(0, "127.0.0.1");
    const host = express();
    let snippet = "";
    host.get("/", (_req, res) =>
      res.send(
        `<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic intake host</title><body><h1>Synthetic product page</h1><button id="target">Private DOM text must not be captured</button><input value="PRIVATE FORM VALUE">${snippet}</body></html>`,
      ),
    );
    const website = host.listen(0, "127.0.0.1");
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    const originalFetch = globalThis.fetch;
    try {
      await Promise.all([
        new Promise<void>((resolve) => service.once("listening", resolve)),
        new Promise<void>((resolve) => website.once("listening", resolve)),
      ]);
      config.appOrigin = `http://127.0.0.1:${(service.address() as any).port}`;
      const origin = `http://127.0.0.1:${(website.address() as any).port}`;
      await migrate(db);
      const ops = new Operations(db, {} as any, config),
        owner = await ops.auth.bootstrap(
          "owner@example.test",
          "Owner",
          "Correct-Horse-Battery-123",
        );
      const project = await ops.executeOperation(owner, "projects.create", {
        name: "Synthetic website",
        origins: [origin],
      });
      const intake = await ops.executeOperation(owner, "intake.save", {
        projectId: project.id,
        revision: 0,
        enabled: true,
        config: {
          origins: [origin],
          collectContact: true,
          label: "Website feedback",
          position: "left",
          color: "forest",
        },
      });
      snippet = intake.snippet;
      globalThis.fetch = ((url: any, init: any) =>
        String(url).includes("challenges.cloudflare.com/turnstile")
          ? Promise.resolve(new Response(JSON.stringify({ success: true })))
          : originalFetch(url, init)) as typeof fetch;
      browser = await chromium.launch({ headless: true });
      await mkdir(".local/intake-qa", { recursive: true });
      for (const [width, height, device] of [
        [1280, 900, "desktop"],
        [390, 844, "mobile"],
      ] as const) {
        const page = await browser.newPage({ viewport: { width, height } });
        await page.route("https://challenges.cloudflare.com/**", (route) =>
          route.fulfill({
            contentType: "application/javascript",
            body: 'window.turnstile={render:()=>1,getResponse:()=>"synthetic-challenge",reset:()=>{}}',
          }),
        );
        await page.goto(`${origin}/?private=query#private`);
        const launcher = page.getByRole("button", {
          name: "Website feedback",
          exact: true,
        });
        await launcher.waitFor();
        await launcher.focus();
        await page.keyboard.press("Enter");
        await page.getByLabel("Your name (optional)").waitFor();
        assert.equal(
          await page
            .getByLabel("Your name (optional)")
            .evaluate((node) => node === document.activeElement),
          true,
        );
        await page.keyboard.press("Escape");
        assert.equal(
          await launcher.evaluate((node) => node === document.activeElement),
          true,
        );
        await launcher.click();
        await page
          .getByRole("button", { name: "Choose an element (optional)", exact: true })
          .click();
        await page.locator("#target").click();
        await page
          .getByText("Selected button. Only its tag and viewport position will be sent.")
          .waitFor();
        await page
          .getByLabel("Feedback", { exact: true })
          .fill(`Synthetic ${device} report`);
        await page.getByLabel("Email (optional)").fill(`${device}@example.test`);
        await page.getByRole("button", { name: "Send feedback", exact: true }).click();
        await page
          .getByRole("alert")
          .getByText("Choose whether to share your email, or leave it empty.")
          .waitFor();
        await page
          .getByLabel("Share this email with the website team so they can contact me.")
          .check();
        await page.screenshot({ path: `.local/intake-qa/${device}.png`, fullPage: true });
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          true,
        );
        await page.getByRole("button", { name: "Send feedback", exact: true }).click();
        await page.getByText("Feedback sent. You can close this form.").waitFor();
        await page.close();
      }
      const threads = await db.query("SELECT data FROM threads WHERE project_id=$1", [
        project.id,
      ]);
      assert.equal(threads.length, 2);
      for (const { data } of threads) {
        assert.equal(data.context.url, `${origin}/`);
        assert.equal(data.context.intake.element.tag, "button");
        assert.ok(!JSON.stringify(data).includes("Private DOM text"));
        assert.ok(!JSON.stringify(data).includes("PRIVATE FORM VALUE"));
      }
    } finally {
      globalThis.fetch = originalFetch;
      await browser?.close();
      await Promise.all([
        new Promise<void>((resolve) => service.close(() => resolve())),
        new Promise<void>((resolve) => website.close(() => resolve())),
      ]);
      await pg.close();
    }
  },
);
