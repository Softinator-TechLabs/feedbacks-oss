import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";

test(
  "packaged pre-send replay keeps page layout but issues no captured resource requests",
  {
    skip: process.env.FEEDBACKS_RECORDING_BROWSER_SMOKE !== "1",
  },
  async () => {
    const extension = resolve(
      process.env.FEEDBACKS_REPLAY_EXTENSION_DIR || "dist/extension/unpacked",
    );
    assert.ok(
      existsSync(join(extension, "rrweb-replay.js")),
      "build the extension first",
    );
    const profile = mkdtempSync(join(tmpdir(), "feedbacks-replay-extension-"));
    const context = await chromium.launchPersistentContext(profile, {
      channel: "chromium",
      headless: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    try {
      const worker =
        context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
      const extensionId = new URL(worker.url()).host;
      const page = await context.newPage();
      const requests: string[] = [];
      const pageErrors: string[] = [];
      page.on("request", (request) => requests.push(request.url()));
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.goto(`chrome-extension://${extensionId}/options.html`, {
        waitUntil: "domcontentloaded",
      });
      const startedAt = Date.parse("2026-01-01T00:00:00Z");
      const messages = await page.evaluate(async (start) => {
        const snapshot = {
          type: 0,
          id: 1,
          childNodes: [
            {
              type: 2,
              id: 2,
              tagName: "html",
              attributes: {},
              childNodes: [
                {
                  type: 2,
                  id: 3,
                  tagName: "head",
                  attributes: {},
                  childNodes: [
                    {
                      type: 2,
                      id: 6,
                      tagName: "style",
                      attributes: {},
                      childNodes: [
                        {
                          type: 3,
                          id: 7,
                          isStyle: true,
                          textContent:
                            "body{color:#123456;background:u\\72l('/probe-resource')}",
                        },
                      ],
                    },
                    {
                      type: 2,
                      id: 18,
                      tagName: "link",
                      attributes: {
                        rel: "stylesheet",
                        href: "https://example.test/site.css",
                        _cssText: "body{font-size:19px;background:url('/probe-link')}",
                      },
                      childNodes: [],
                    },
                  ],
                },
                {
                  type: 2,
                  id: 4,
                  tagName: "body",
                  attributes: {},
                  childNodes: [
                    { type: 3, id: 5, textContent: "Extension replay proof" },
                    {
                      type: 2,
                      id: 16,
                      tagName: "video",
                      attributes: {
                        class: "captured-hero",
                        rr_mediaState: "played",
                        rr_mediaCurrentTime: 0,
                        poster: "https://example.test/poster.webp",
                      },
                      childNodes: [
                        {
                          type: 2,
                          id: 17,
                          tagName: "source",
                          attributes: { src: "https://example.test/hero.webm" },
                          childNodes: [],
                        },
                      ],
                    },
                    {
                      type: 2,
                      id: 8,
                      tagName: "script",
                      attributes: {},
                      childNodes: [
                        {
                          type: 3,
                          id: 9,
                          textContent: "parent.__capturedScriptRan=true",
                        },
                      ],
                    },
                    {
                      type: 2,
                      id: 10,
                      tagName: "svg",
                      attributes: {},
                      childNodes: [
                        {
                          type: 2,
                          id: 11,
                          tagName: "rect",
                          attributes: {
                            fill: "u\\72l('/probe-fill')",
                            width: "10",
                            height: "10",
                          },
                          childNodes: [],
                        },
                        {
                          type: 2,
                          id: 13,
                          tagName: "image",
                          attributes: { href: "data:," },
                          childNodes: [
                            {
                              type: 2,
                              id: 14,
                              tagName: "set",
                              attributes: {
                                attributeName: "href",
                                to: "/probe-smil",
                                begin: "0s",
                              },
                              childNodes: [],
                            },
                          ],
                        },
                      ],
                    },
                    {
                      type: 2,
                      id: 20,
                      tagName: "iframe",
                      attributes: {},
                      childNodes: [],
                    },
                  ],
                },
              ],
            },
          ],
        };
        const frame = document.createElement("iframe");
        frame.src = "session-replay.html#browser-proof";
        document.body.append(frame);
        const received: string[] = [];
        await new Promise<void>((done, fail) => {
          const timer = window.setTimeout(() => fail(Error("Replay did not load")), 5000);
          window.addEventListener("message", (message) => {
            if (
              message.source !== frame.contentWindow ||
              message.data?.token !== "browser-proof"
            )
              return;
            received.push(message.data.type);
            if (message.data.type === "ready")
              frame.contentWindow?.postMessage(
                {
                  token: "browser-proof",
                  type: "load",
                  startedAt: start,
                  events: [
                    {
                      type: 4,
                      timestamp: start,
                      data: { href: "https://example.test", width: 640, height: 360 },
                    },
                    {
                      type: 2,
                      timestamp: start + 100,
                      data: { node: snapshot, initialOffset: { top: 0, left: 0 } },
                    },
                    {
                      type: 3,
                      timestamp: start + 150,
                      data: {
                        source: 8,
                        id: 6,
                        adds: [{ rule: "body{background:url('/probe-rule')}" }],
                      },
                    },
                    {
                      type: 3,
                      timestamp: start + 160,
                      data: {
                        source: 0,
                        adds: [],
                        removes: [],
                        attributes: [],
                        texts: [
                          {
                            id: 7,
                            value: "body{color:#123456;background:u\\72l('/probe-text')}",
                          },
                        ],
                      },
                    },
                    {
                      type: 3,
                      timestamp: start + 170,
                      data: {
                        source: 0,
                        adds: [
                          {
                            parentId: 6,
                            nextId: null,
                            node: {
                              type: 3,
                              id: 15,
                              isStyle: true,
                              textContent: "body{background:u\\72l('/probe-added-text')}",
                            },
                          },
                        ],
                        removes: [],
                        attributes: [],
                        texts: [],
                      },
                    },
                    {
                      type: 3,
                      timestamp: start + 180,
                      data: { source: 7, id: 16, type: 0 },
                    },
                    {
                      type: 3,
                      timestamp: start + 190,
                      data: {
                        source: 0,
                        adds: [
                          {
                            parentId: 20,
                            nextId: null,
                            node: { type: 0, id: 21, childNodes: [] },
                          },
                        ],
                        removes: [],
                        attributes: [],
                        texts: [],
                      },
                    },
                  ],
                },
                "*",
              );
            if (message.data.type === "loaded" || message.data.type === "error") {
              window.clearTimeout(timer);
              frame.contentWindow?.postMessage(
                { token: "browser-proof", type: "seek", atMs: 200 },
                "*",
              );
              done();
            }
          });
        });
        return received;
      }, startedAt);
      assert.deepEqual(messages, ["ready", "loaded"]);
      const inner = page
        .frameLocator('iframe[src^="session-replay.html"]')
        .locator(".replayer-wrapper iframe");
      await page.waitForFunction(() => document.querySelector("iframe") !== null);
      await inner.evaluate(
        (node: HTMLIFrameElement) =>
          new Promise<void>((done) => {
            if (
              node.contentDocument?.body?.textContent?.includes("Extension replay proof")
            )
              done();
            else window.setTimeout(done, 500);
          }),
      );
      const frame = await inner.evaluate((node: HTMLIFrameElement) => ({
        sandbox: node.getAttribute("sandbox"),
        viewportFits: (() => {
          const root = document.getElementById("replay")!;
          const rect = root.getBoundingClientRect();
          return rect.bottom <= innerHeight + 1 && rect.right <= innerWidth + 1;
        })(),
        text: node.contentDocument?.body?.textContent,
        color: node.contentWindow?.getComputedStyle(node.contentDocument!.body).color,
        fontSize: node.contentWindow?.getComputedStyle(node.contentDocument!.body)
          .fontSize,
        executed:
          (window as Window & { __capturedScriptRan?: boolean }).__capturedScriptRan ===
          true,
        media: node.contentDocument?.querySelector(".captured-hero")?.tagName,
        mediaPlaceholder: node.contentDocument
          ?.querySelector(".captured-hero")
          ?.getAttribute("data-feedbacks-media"),
      }));
      assert.equal(frame.sandbox, "allow-same-origin");
      assert.equal(
        frame.viewportFits,
        true,
        "the entire captured viewport fits the preview",
      );
      assert.match(frame.text ?? "", /Extension replay proof/);
      assert.equal(frame.color, "rgb(18, 52, 86)");
      assert.equal(frame.fontSize, "19px");
      assert.equal(frame.executed, false);
      assert.equal(frame.media, "DIV");
      assert.match(frame.mediaPlaceholder ?? "", /Video pixels unavailable/);
      assert.deepEqual(pageErrors, []);
      assert.ok(requests.some((request) => request.endsWith("/rrweb-replay.css")));
      assert.ok(
        !requests.some((request) => request.includes("/probe-")),
        `captured resource request: ${requests.join(", ")}`,
      );
    } finally {
      await context.close();
      rmSync(profile, { recursive: true, force: true });
    }
  },
);
