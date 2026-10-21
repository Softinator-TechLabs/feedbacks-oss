import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { chromium } from "playwright";
import { build } from "esbuild";
import sharp from "sharp";
import { Database } from "../src/server/db.js";
import { migrate } from "../src/server/migrations.js";
import { Operations } from "../src/server/operations.js";
import { createApp } from "../src/server/app.js";
import { nativeReport } from "./fixtures/native-diagnostics.js";

const enabled = process.env.FEEDBACKS_APP_CAPTURE_BROWSER === "1";
test(
  "extension-free app capture recovers uncertain uploads, masks pixels, and installs a real origin-scoped widget",
  { skip: !enabled, timeout: 90000 },
  async () => {
    const pg = new PGlite();
    const db = new Database(pg as any);
    const objects = new Map<string, Buffer>();
    const store = {
      put: async (key: string, bytes: Buffer) => {
        objects.set(key, bytes);
      },
      get: async (key: string) => objects.get(key)!,
      remove: async (key: string) => {
        objects.delete(key);
      },
    };
    const config: any = {
      appOrigin: "http://127.0.0.1",
      production: false,
      organizationId: "00000000-0000-4000-8000-000000000001",
      turnstileSiteKey: "1x00000000000000000000AA",
      turnstileSecretKey: "1x0000000000000000000000000000000AA",
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: any, options: any) =>
      String(url).includes("challenges.cloudflare.com/turnstile/v0/siteverify")
        ? new Response(JSON.stringify({ success: true }), {
            headers: { "Content-Type": "application/json" },
          })
        : originalFetch(url, options)) as typeof fetch;
    let server: any, host: any, browser: any;
    try {
      await migrate(db);
      const ops = new Operations(db, store, config);
      const owner = await ops.auth.bootstrap(
        "owner@example.test",
        "Owner",
        "Correct-Horse-Battery-123",
      );
      let snippet = "";
      host = createServer((_req, res) => {
        res.setHeader("Content-Type", "text/html");
        res.end(`<h1>Synthetic customer website</h1>${snippet}${snippet}`);
      }).listen(0, "127.0.0.1");
      await new Promise<void>((resolve) => host.once("listening", resolve));
      const hostOrigin = `http://127.0.0.1:${host.address().port}`;
      const project = await ops.executeOperation(owner, "projects.create", {
        name: "Synthetic app review",
        origins: [hostOrigin],
      });
      const widget = await ops.executeOperation(owner, "guestProjectLinks.create", {
        projectId: project.id,
        label: "Synthetic host",
        widget: true,
        maxSubmissions: 2,
      });
      server = createApp(config, db, store).listen(0, "127.0.0.1");
      await new Promise<void>((resolve) => server.once("listening", resolve));
      const base = (config.appOrigin = `http://127.0.0.1:${server.address().port}`);
      snippet = widget.widgetSnippet.replace('src="http://127.0.0.1/', `src="${base}/`);
      const bundle = await build({
        stdin: {
          contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {api} from './src/web/api.ts'; import {AppCapturePage} from './src/web/capture/index.tsx'; import {ProjectSettings} from './src/web/projects/settings.tsx'; import {ContextPanel} from './src/web/threads/context.tsx'; import './src/web/styles.css'; const login=await api('auth.login',{email:'owner@example.test',password:'Correct-Horse-Battery-123'}); const project=await api('projects.get',{projectId:${JSON.stringify(project.id)}}); createRoot(document.getElementById('root')).render(location.search.includes('settings') ? <ProjectSettings project={project} actor={login.actor} onSaved={()=>{}}/> : location.search.includes('context') ? <ContextPanel context={(await api('threads.get',{threadId:new URL(location.href).searchParams.get('threadId')})).context}/> : <AppCapturePage project={project} userId={login.actor.userId}/>);`,
          resolveDir: process.cwd(),
          loader: "tsx",
        },
        bundle: true,
        write: false,
        outdir: ".local/app-capture-test",
        format: "esm",
        jsx: "automatic",
        loader: { ".woff2": "empty" },
      });
      const js = bundle.outputFiles.find((file) => file.path.endsWith(".js"))!.text;
      const css = bundle.outputFiles.find((file) => file.path.endsWith(".css"))!.text;
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      await page.addInitScript("globalThis.__name = value => value;");
      const errors: string[] = [];
      page.on("pageerror", (error: Error) => errors.push(error.message));
      await page.route(`${base}/qa*`, (route: any) =>
        route.fulfill({
          contentType: "text/html",
          body: `<html><head><style>${css}</style></head><body><main style="padding:24px"><div id="root"></div></main><script type="module">${js.replace(/<\/script/gi, "<\\/script")}</script></body></html>`,
        }),
      );
      await page.goto(`${base}/qa`);
      await page.getByRole("heading", { name: "App screenshot", exact: true }).waitFor();
      const source = await sharp(
        Buffer.from(
          `<svg width="800" height="450" xmlns="http://www.w3.org/2000/svg"><rect width="800" height="450" fill="white"/><rect width="800" height="70" fill="#17324d"/><text x="24" y="43" fill="white" font-family="sans-serif" font-size="23">Synthetic finance app — test fixture</text><text x="24" y="112" fill="#17324d" font-family="sans-serif" font-size="22">Invoice review</text><rect x="24" y="142" width="752" height="222" fill="#f2f5f7"/><text x="48" y="178" fill="#17324d" font-family="sans-serif" font-size="18">Customer and invoice details</text><rect x="650" y="388" width="126" height="42" rx="6" fill="#17324d"/><text x="691" y="415" fill="white" font-family="sans-serif" font-size="18">Save</text></svg>`,
        ),
      )
        .png()
        .toBuffer();
      await page
        .getByLabel("Import screenshot", { exact: true })
        .setInputFiles({ name: "synthetic.png", mimeType: "image/png", buffer: source });
      await page.getByLabel("App name", { exact: true }).fill("Synthetic finance app");
      await page.getByLabel("Platform", { exact: true }).selectOption("linux");
      await page
        .getByRole("button", { name: "Add point at center", exact: true })
        .click();
      await page.getByLabel("Point 1", { exact: true }).fill("Make Save easier to find");
      await page.getByText("Hide an area with coordinates", { exact: true }).click();
      await page.getByRole("button", { name: "Add hidden area", exact: true }).click();
      await page
        .getByLabel("Feedback", { exact: true })
        .fill("Synthetic screenshot review");
      await page.getByText("OS diagnostics (optional)", { exact: true }).click();
      await page.getByLabel("Import OS diagnostics JSON").setInputFiles({
        name: "invalid.json",
        mimeType: "application/json",
        buffer: Buffer.from("not json"),
      });
      await page.getByRole("alert").filter({ hasText: "not valid JSON" }).waitFor();
      await page.getByLabel("Import OS diagnostics JSON").setInputFiles({
        name: "synthetic-os.json",
        mimeType: "application/json",
        buffer: Buffer.from(
          JSON.stringify({
            ok: true,
            data: {
              ...nativeReport(),
              processName: "X".repeat(120),
              events: [{ ...nativeReport().events[0], eventId: "9".repeat(80) }],
            },
          }),
        ),
      });
      await page.getByText("Review events (1)", { exact: true }).click();
      const nativeMessage = page.getByLabel("Event 1 message", { exact: true });
      assert.ok(!(await nativeMessage.inputValue()).includes("synthetic-secret"));
      await page.getByRole("button", { name: "Send feedback", exact: true }).click();
      await page
        .getByRole("alert")
        .filter({ hasText: "Review the diagnostic snapshot" })
        .waitFor();
      assert.equal(
        (await db.one("SELECT count(*)::integer AS total FROM threads")).total,
        0,
      );
      const approval = page.getByRole("checkbox", {
        name: "Include this reviewed diagnostic snapshot",
        exact: true,
      });
      await approval.check();
      await nativeMessage.fill("Synthetic app failure after reviewing private details");
      assert.equal(
        await approval.isChecked(),
        false,
        "editing must clear diagnostic approval",
      );
      await approval.check();
      await mkdir(".impeccable/review", { recursive: true });
      await page.screenshot({ path: ".impeccable/review/desktop.png", fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: ".impeccable/review/mobile.png", fullPage: true });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      let interrupted = false;
      await page.route("**/api/assets.upload", async (route: any) => {
        if (!interrupted) {
          interrupted = true;
          await route.fetch();
          await route.abort();
        } else await route.continue();
      });
      await page.getByRole("button", { name: "Send feedback", exact: true }).click();
      await page.getByRole("button", { name: "Retry Send", exact: true }).waitFor();
      await page.getByRole("alert").filter({ hasText: "Connection failed" }).waitFor();
      const rows = await db.query("SELECT id,object_key FROM assets");
      assert.equal(rows.length, 1);
      const { data: pixels, info } = await sharp(objects.get(rows[0].object_key)!)
        .raw()
        .toBuffer({ resolveWithObject: true });
      const masked = (200 * info.width + 250) * info.channels;
      assert.ok(
        pixels[masked] < 8 && pixels[masked + 1] < 8 && pixels[masked + 2] < 8,
        "private region must be black in uploaded pixels",
      );
      await page.reload();
      await page.getByRole("button", { name: "Retry Send", exact: true }).click();
      await page.getByText("Feedback sent.", { exact: false }).waitFor();
      assert.equal(
        (await db.one("SELECT count(*)::integer AS total FROM threads")).total,
        1,
      );
      assert.equal(
        (await db.one("SELECT count(*)::integer AS total FROM assets")).total,
        1,
      );
      const native = (await db.one("SELECT data FROM threads")).data;
      assert.equal(native.context.source, "app_capture");
      assert.equal(native.context.url, undefined);
      assert.equal(native.context.appCapture.platform, "linux");
      assert.equal(
        native.context.nativeDiagnostics.trust,
        "untrusted_native_diagnostics",
      );
      assert.equal(
        native.context.nativeDiagnostics.events[0].message,
        "Synthetic app failure after reviewing private details",
      );
      await page.goto(
        `${base}/qa?context&threadId=${(await db.one("SELECT id FROM threads")).id}`,
      );
      await page.getByText("OS diagnostic snapshot (1 event)", { exact: true }).click();
      await page.getByText("Review events (1)", { exact: true }).click();
      await page
        .getByText("Synthetic app failure after reviewing private details", {
          exact: true,
        })
        .waitFor();
      await page.screenshot({
        path: ".impeccable/review/native-diagnostics-thread-mobile.png",
        fullPage: true,
      });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
        "long native identifiers must wrap in thread context",
      );
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.screenshot({
        path: ".impeccable/review/native-diagnostics-thread-desktop.png",
        fullPage: true,
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${base}/qa?capture`);
      await page.getByRole("heading", { name: "App screenshot", exact: true }).waitFor();
      await page.evaluate(() => {
        const state = window as any;
        state.captureCalls = 0;
        state.stoppedCaptureTracks = 0;
        Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", {
          configurable: true,
          value: async () => {
            if (state.captureCalls++ === 0)
              throw new DOMException("Synthetic denial", "NotAllowedError");
            const canvas = document.createElement("canvas");
            canvas.width = 640;
            canvas.height = 360;
            const context = canvas.getContext("2d")!;
            const stream = canvas.captureStream(20);
            const track = stream.getVideoTracks()[0];
            const timer = setInterval(() => {
              context.fillStyle = "#17324d";
              context.fillRect(0, 0, 640, 360);
              context.fillStyle = "white";
              context.fillText(String(Date.now()), 20, 20);
            }, 30);
            const stop = track.stop.bind(track);
            track.stop = () => {
              clearInterval(timer);
              state.stoppedCaptureTracks++;
              stop();
            };
            Object.defineProperty(track, "getSettings", {
              value: () => ({ displaySurface: "window" }),
            });
            return stream;
          },
        });
      });
      await page.getByRole("button", { name: "Capture window", exact: true }).click();
      await page.getByRole("alert").filter({ hasText: "cancelled or denied" }).waitFor();
      await page.getByRole("button", { name: "Capture window", exact: true }).click();
      await page
        .getByRole("img", { name: "Screenshot of the selected app", exact: true })
        .waitFor();
      assert.equal(await page.evaluate(() => (window as any).stoppedCaptureTracks), 1);
      assert.equal(
        (await db.one("SELECT count(*)::integer AS total FROM threads")).total,
        1,
        "capture and denial must not submit a thread",
      );
      await page
        .getByRole("button", { name: "Discard local capture", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Confirm Discard local capture", exact: true })
        .click();
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.goto(`${base}/qa?settings#widget`);
      await page.getByRole("tab", { name: "Website widget", exact: true }).waitFor();
      await page.getByRole("heading", { name: "Website widget", exact: true }).waitFor();
      await page.getByLabel("Installation label").fill("Browser installed widget");
      await page
        .getByRole("button", { name: "Create installation snippet", exact: true })
        .click();
      await page.getByRole("textbox", { name: /Copy this script/ }).waitFor();
      await page.screenshot({
        path: ".impeccable/review/widget-install-desktop.png",
        fullPage: true,
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({
        path: ".impeccable/review/widget-install-mobile.png",
        fullPage: true,
      });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      // A fresh context has no extension, login, or team cookies on the customer host.
      const visitor = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const hostPage = await visitor.newPage();
      await hostPage.route(
        "https://challenges.cloudflare.com/turnstile/**",
        (route: any) =>
          route.fulfill({
            contentType: "application/javascript",
            body: 'window.turnstile={render:()=>1,getResponse:()=>"synthetic-challenge",reset:()=>{}}',
          }),
      );
      await hostPage.goto(`${hostOrigin}/checkout?token=synthetic-secret#fragment`);
      await hostPage
        .getByRole("button", { name: "Send feedback", exact: true })
        .waitFor();
      assert.equal(
        await hostPage.locator(".feedbacks-widget").count(),
        1,
        "duplicate script must mount once",
      );
      await hostPage.getByRole("button", { name: "Send feedback", exact: true }).click();
      await hostPage.getByLabel("Your name", { exact: true }).fill("Synthetic visitor");
      await hostPage
        .getByLabel("Feedback", { exact: true })
        .fill("Checkout is confusing");
      await hostPage.screenshot({
        path: ".impeccable/review/widget-host-mobile.png",
        fullPage: true,
      });
      await hostPage
        .getByRole("button", { name: "Send feedback", exact: true })
        .last()
        .click();
      await hostPage.getByRole("status").filter({ hasText: "Feedback sent" }).waitFor();
      const received = await db.one(
        "SELECT data FROM threads WHERE data->'context'->>'source'='widget'",
      );
      assert.equal(received.data.body, "Checkout is confusing");
      assert.equal(received.data.context.url, `${hostOrigin}/checkout`);
      assert.equal(received.data.context.viewport.width, 390);
      assert.equal(errors.length, 0, errors.join("\n"));
    } finally {
      globalThis.fetch = originalFetch;
      await browser?.close();
      for (const service of [server, host])
        if (service) {
          service.closeAllConnections();
          await new Promise<void>((resolve) => service.close(resolve));
        }
      await pg.close();
    }
  },
);
