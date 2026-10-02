import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { build } from "esbuild";
import { chromium } from "playwright";

const enabled = process.env.FEEDBACKS_RECORDING_BROWSER_SMOKE === "1";
for (const surface of ["editor", "video"])
  for (const destination of ["background", "thread"])
    test(
      `${surface}: delayed background failure and retry to ${destination}`,
      { skip: !enabled },
      async () => {
        const browser = await chromium.launch({ headless: true, channel: "chromium" });
        const bundle = await build({
          entryPoints: [`extension/${surface}.js`],
          bundle: true,
          write: false,
          format: "iife",
        });
        const html = (await readFile(`extension/${surface}.html`, "utf8")).replace(
          /<script[^>]*>[\s\S]*?<\/script>/g,
          "",
        );
        const events: any[] = [];
        const errors: string[] = [];
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        page.on("pageerror", (error) => errors.push(error.message));
        await page.exposeFunction("report", (event: any) => events.push(event));
        await page.route("https://capture.test/**", (route) =>
          route.fulfill({
            contentType: "text/html",
            body: route.request().url().includes("/threads/")
              ? "<h1>Shared thread</h1>"
              : html,
          }),
        );
        await page.goto(
          `https://capture.test/${surface}.html?sourceTabId=10&draftId=11111111-1111-4111-8111-111111111111`,
        );
        await page.addScriptTag({ content: "globalThis.__name = value => value;" });
        for (const file of [
          "appearance.css",
          "capture-triage.css",
          `${surface}.css`,
          ...(surface === "video" ? ["session-review.css"] : []),
        ])
          await page.addStyleTag({ path: `extension/${file}` });
        await page.evaluate(() => {
          const w = window as any;
          w.fail = true;
          w.sourceClosed = false;
          w.pending = new Promise((resolve) => (w.release = resolve));
          const canvas = document.createElement("canvas");
          canvas.width = 640;
          canvas.height = 360;
          const ctx = canvas.getContext("2d")!;
          ctx.fillStyle = "#17324d";
          ctx.fillRect(0, 0, 640, 360);
          ctx.fillStyle = "white";
          ctx.font = "24px sans-serif";
          ctx.fillText("Synthetic review", 40, 80);
          w.draft = {
            id: "draft",
            sourceTabId: 10,
            projectId: "project",
            server: "https://capture.test",
            body: "Synthetic review",
            context: { url: "https://page.test", viewport: { width: 640, height: 360 } },
            image: canvas.toDataURL(),
            toolState: [],
            imageRevision: 0,
          };
          let thread: any;
          w.chrome = {
            runtime: {
              connect: () => ({
                postMessage() {},
                onMessage: { addListener() {} },
                onDisconnect: { addListener() {} },
              }),
              onMessage: { addListener() {} },
              sendMessage: async (message: any) => {
                await w.report(["request", message.type]);
                let data: any = {};
                if (message.type === "draft") data = structuredClone(w.draft);
                if (message.type === "draftProjects")
                  data = {
                    items: [
                      {
                        id: "project",
                        name: "Fixture project",
                        origins: ["https://page.test"],
                        permissions: { canWrite: true },
                      },
                    ],
                  };
                if (message.type === "saveDraft")
                  Object.assign(w.draft, { body: message.body });
                if (message.type === "videoContext")
                  data = {
                    sourceTabId: 10,
                    projectId: "project",
                    reviewId: "review",
                    project: { name: "Fixture project" },
                    url: "https://page.test",
                    server: "https://capture.test",
                    viewport: { width: 640, height: 360 },
                  };
                if (message.type === "videoCreate") {
                  thread = { id: "shared", revision: 1 };
                  data = thread;
                }
                if (message.type === "submit" || message.type === "videoUpload") {
                  w.uploadStarted = true;
                  await w.pending;
                  if (w.fail) {
                    w.draft.frozen = true;
                    w.draft.thread = { id: "shared", revision: 1 };
                    return { ok: false, error: "Synthetic upload interrupted" };
                  }
                  data =
                    message.type === "submit"
                      ? { url: "https://capture.test/threads/shared" }
                      : { asset: { id: "video" }, thread: { ...thread, revision: 2 } };
                }
                return { ok: true, data };
              },
            },
            storage: {
              onChanged: { addListener() {} },
              local: {
                get: async () => ({}),
                set: async () => {},
                remove: async () => {},
              },
            },
            tabs: {
              getCurrent: async () => ({ id: 20, windowId: 2 }),
              get: async () => {
                if (w.sourceClosed) throw Error("Closed");
                return { id: 10, windowId: 1 };
              },
              update: async (id: number) => w.report(["focus", id]),
              remove: async (id: number) => w.report(["close", id]),
            },
            windows: { update: async (id: number) => w.report(["window", id]) },
          };
        });
        if (surface === "video") {
          const storeBundle = await build({
            entryPoints: ["extension/video-draft-store.js"],
            bundle: true,
            write: false,
            format: "iife",
            globalName: "videoStore",
          });
          await page.addScriptTag({ content: storeBundle.outputFiles[0].text });
          await page.evaluate(async () => {
            const w = window as any;
            const canvas = document.createElement("canvas");
            canvas.width = 320;
            canvas.height = 180;
            canvas.getContext("2d")!.fillRect(0, 0, 320, 180);
            const stream = canvas.captureStream(10);
            const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
            const chunk = new Promise<Blob>(
              (resolve) => (recorder.ondataavailable = (event) => resolve(event.data)),
            );
            recorder.start();
            await new Promise<void>((resolve) =>
              requestAnimationFrame(() => {
                canvas.getContext("2d")!.fillRect(1, 1, 100, 100);
                resolve();
              }),
            );
            recorder.stop();
            const blob = await chunk;
            stream.getTracks().forEach((track) => track.stop());
            await w.videoStore.putVideoDraft("11111111-1111-4111-8111-111111111111", {
              blob,
              sourceTabId: 10,
              reviewId: "review",
              durationMs: 1000,
              videoStartWall: Date.now(),
            });
          });
        }
        try {
          await page.addScriptTag({ content: bundle.outputFiles[0].text });
          await page.locator("#send:not([disabled])").waitFor();
          if (surface === "video")
            await page.locator("#comment").fill("Synthetic video review");
          await mkdir(".local/capture-send-qa", { recursive: true });
          for (const theme of ["light", "dark"]) {
            await page.evaluate(
              (theme) => (document.documentElement.dataset.feedbacksTheme = theme),
              theme,
            );
            for (const width of [1440, 390]) {
              await page.setViewportSize({ width, height: 900 });
              assert.equal(
                await page.evaluate(
                  () => document.documentElement.scrollWidth <= innerWidth,
                ),
                true,
                `${surface} ${theme} ${width} overflow`,
              );
              const background = page.locator(
                surface === "editor" ? "#send-background-header" : "#send-background",
              );
              await background.focus();
              assert.equal(
                await background.evaluate((el) => el === document.activeElement),
                true,
              );
              await page.screenshot({
                path: `.local/capture-send-qa/${surface}-${theme}-${width}.png`,
                fullPage: true,
              });
            }
          }
          await page
            .locator(
              surface === "editor" ? "#send-background-header" : "#send-background",
            )
            .click();
          await page.waitForFunction(() =>
            document.querySelector("#send")!.hasAttribute("disabled"),
          );
          assert.equal(await page.locator("#send-background").isDisabled(), true);
          await page.waitForFunction(() => (window as any).uploadStarted === true);
          assert.equal(page.url().includes("/threads/"), false);
          assert.deepEqual(
            events.filter((event) => event[0] === "focus"),
            [["focus", 10]],
          );
          assert.equal(
            events.some((event) => event[0] === "close"),
            false,
          );
          await page.evaluate(() => (window as any).release());
          await page
            .locator("#status")
            .filter({ hasText: "Synthetic upload interrupted" })
            .waitFor();
          await page.locator("#send:not([disabled])").waitFor();
          assert.deepEqual(events.filter((event) => event[0] === "focus").at(-1), [
            "focus",
            20,
          ]);
          assert.equal(
            events.some((event) => event[0] === "close"),
            false,
          );
          await page.evaluate(() => {
            const w = window as any;
            w.fail = false;
            w.pending = new Promise((resolve) => (w.release = resolve));
          });
          await page
            .locator(destination === "background" ? "#send-background" : "#send")
            .click();
          await page.locator("#send[disabled]").waitFor();
          assert.equal(
            events.some((event) => event[0] === "close"),
            false,
          );
          await page.evaluate(() => (window as any).release());
          if (destination === "background") {
            await assertEventually(() => events.some((event) => event[0] === "close"));
            assert.deepEqual(
              events.filter((event) => event[0] === "close"),
              [["close", 20]],
            );
            if (surface === "editor")
              assert.equal(await page.locator("#completion").isVisible(), false);
          } else {
            await page.waitForURL("https://capture.test/threads/shared");
            await page.getByRole("heading", { name: "Shared thread" }).waitFor();
            assert.equal(
              events.some((event) => event[0] === "close"),
              false,
            );
          }
          if (surface === "video")
            assert.equal(events.filter((event) => event[1] === "videoCreate").length, 1);
          assert.equal(errors.length, 0, errors.join("\n"));
        } finally {
          await browser.close();
        }
      },
    );

async function assertEventually(check: () => boolean) {
  for (let attempts = 0; attempts < 100; attempts++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.ok(check());
}
