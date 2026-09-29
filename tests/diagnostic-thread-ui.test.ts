import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdir } from "node:fs/promises";
import { build } from "esbuild";
import { chromium } from "playwright";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DiagnosticEvidencePanel,
  type DiagnosticEvidenceSummary,
} from "../src/web/threads/diagnostic-evidence.js";

const threadId = "11111111-1111-4111-8111-111111111111";
const evidenceId = "22222222-2222-4222-8222-222222222222";
const pendingId = "33333333-3333-4333-8333-333333333333";
const olderId = "66666666-6666-4666-8666-666666666666";
const fileId = "44444444-4444-4444-8444-444444444444";
const startedAt = "2026-09-29T08:00:00.000Z";
const complete = {
  id: evidenceId,
  threadId,
  projectId: "55555555-5555-4555-8555-555555555555",
  status: "complete",
  startedAt,
  createdAt: startedAt,
  totalBytes: 5_242_900,
  fileCount: 1,
  coverage: { dom: "partial", console: "unavailable", network: "stopped" },
};
const pending = {
  ...complete,
  id: pendingId,
  status: "pending",
  totalBytes: 0,
  fileCount: 0,
  coverage: { dom: "partial", network: "unavailable" },
};
const older = { ...complete, id: olderId, totalBytes: 4096 };

test("thread diagnostics render only small summaries before a user selects evidence", () => {
  const html = renderToStaticMarkup(
    React.createElement(DiagnosticEvidencePanel, {
      threadId,
      summaries: [complete, pending] as DiagnosticEvidenceSummary[],
      totalCount: 3,
    }),
  );
  assert.match(html, /Captured diagnostics/);
  assert.match(html, /Pending/);
  assert.match(html, /Partial/);
  assert.match(html, /Show older diagnostics/);
  assert.doesNotMatch(html, /Download captured diagnostics/);
  assert.doesNotMatch(html, /<script>window\.pwned/);
});

test(
  "thread diagnostics stay summary-only until selection, then preview safely and reject an unauthorized archive",
  {
    skip: process.env.FEEDBACKS_DIAGNOSTIC_BROWSER_SMOKE !== "1",
  },
  async () => {
    const result = await build({
      stdin: {
        contents: `
        import React from "react";
        import { createRoot } from "react-dom/client";
        import "./src/web/styles.css";
        import "./src/web/theme.css";
        import "./src/web/threads/detail.css";
        import { DiagnosticEvidencePanel } from "./src/web/threads/diagnostic-evidence.tsx";
        createRoot(document.getElementById("root")).render(
          React.createElement(DiagnosticEvidencePanel, {
            threadId: ${JSON.stringify(threadId)},
            summaries: ${JSON.stringify([complete, pending])},
            totalCount: 3
          })
        );`,
        loader: "tsx",
        resolveDir: process.cwd(),
      },
      bundle: true,
      format: "iife",
      platform: "browser",
      write: false,
      outdir: "out",
    });
    const script = result.outputFiles.find((file) => file.path.endsWith(".js"))!.text;
    const css = result.outputFiles.find((file) => file.path.endsWith(".css"))!.text;
    const calls: Array<{ name: string; input: Record<string, any> }> = [];
    let archiveMode: "denied" | "html" | "gzip" = "denied";
    const server = createServer(async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      if (req.url === "/bundle.js") {
        res.setHeader("Content-Type", "text/javascript");
        res.end(script);
      } else if (req.url === "/bundle.css") {
        res.setHeader("Content-Type", "text/css");
        res.end(css);
      } else if (req.url === "/api/diagnostics.list") {
        calls.push({ name: "diagnostics.list", input: {} });
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            ok: true,
            data: { items: [complete, pending, older], total: 3, nextOffset: null },
          }),
        );
      } else if (req.url === "/api/diagnostics.describe") {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        calls.push({
          name: "diagnostics.describe",
          input: JSON.parse(Buffer.concat(chunks).toString("utf8")),
        });
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            ok: true,
            data: {
              evidence: complete,
              coverage: {
                dom: {
                  status: "partial",
                  observedCount: 1,
                  capturedBytes: 5_242_900,
                  reasons: ["frame_inaccessible"],
                },
                console: {
                  status: "unavailable",
                  observedCount: 0,
                  capturedBytes: 0,
                  reasons: ["debugger_unavailable"],
                },
              },
              files: [
                {
                  fileId,
                  kind: "dom",
                  mimeType: "text/html",
                  byteLength: 5_242_900,
                  sha256: "a".repeat(64),
                  chunks: [
                    { sequence: 0, byteLength: 2_097_152, sha256: "b".repeat(64) },
                  ],
                },
              ],
              total: 1,
              nextOffset: null,
            },
          }),
        );
      } else if (req.url === "/api/diagnostics.read") {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        calls.push({
          name: "diagnostics.read",
          input: JSON.parse(Buffer.concat(chunks).toString("utf8")),
        });
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            ok: true,
            data: {
              byteLength: 4096,
              encoding: "utf8",
              text: "<script>window.pwned = true</script>" + "x".repeat(7000),
              next: { sequence: 0, byteOffset: 4096 },
            },
          }),
        );
      } else if (req.url === `/api/diagnostics/${evidenceId}/archive`) {
        calls.push({ name: "archive", input: {} });
        if (archiveMode === "html") {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end("<p>Sign in again</p>");
        } else if (
          archiveMode === "gzip" &&
          req.headers.cookie?.includes("feedbacks_session=synthetic")
        ) {
          res.writeHead(200, { "Content-Type": "application/gzip" });
          res.end(Buffer.from("synthetic archive"));
        } else {
          res.writeHead(403, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: { code: "FORBIDDEN" } }));
        }
      } else {
        res.setHeader("Content-Type", "text/html");
        res.end(
          '<!doctype html><html><head><link rel="stylesheet" href="/bundle.css"></head><body><main id="root"></main><script src="/bundle.js"></script></body></html>',
        );
      }
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1200, height: 850 } });
      await page.context().addCookies([
        {
          name: "feedbacks_session",
          value: "synthetic",
          url: `http://127.0.0.1:${address.port}`,
        },
      ]);
      const downloads: string[] = [];
      page.on("download", (download) => downloads.push(download.suggestedFilename()));
      await page.goto(`http://127.0.0.1:${address.port}`, { waitUntil: "networkidle" });
      await page.getByRole("heading", { name: "Captured diagnostics" }).waitFor();
      assert.deepEqual(calls, [], "initial render must use thread summaries only");
      assert.match(await page.locator("#root").innerText(), /Pending/);
      assert.match(await page.locator("#root").innerText(), /Partial/);
      await page
        .getByRole("button", { name: /View captured diagnostics/ })
        .first()
        .click();
      await page.getByText("window.pwned = true").waitFor();
      assert.equal(await page.evaluate(() => (window as any).pwned), undefined);
      assert.equal(
        await page.locator("script").count(),
        1,
        "preview must not create an HTML script node",
      );
      assert.ok(
        (await page.locator(".diagnostic-evidence-preview pre").innerText()).length <=
          4096,
      );
      assert.match(await page.locator("#root").innerText(), /5 MiB/);
      assert.ok(calls.some((call) => call.name === "diagnostics.describe"));
      const selectedReads = calls
        .filter((call) => call.name === "diagnostics.read")
        .map((call) => call.input);
      assert.ok(selectedReads.length > 0);
      assert.ok(selectedReads.every((read) => read.limitBytes <= 32_768));
      await page.getByRole("button", { name: "Download captured diagnostics" }).click();
      await page
        .getByRole("alert")
        .getByText(/access|permission/i)
        .waitFor();
      assert.deepEqual(downloads, []);
      assert.equal(await page.locator(`a[href*="${evidenceId}/archive"]`).count(), 0);
      archiveMode = "html";
      await page.getByRole("button", { name: "Download captured diagnostics" }).click();
      await page
        .getByRole("alert")
        .getByText(/download failed/i)
        .waitFor({ timeout: 3000 });
      assert.deepEqual(downloads, []);
      archiveMode = "gzip";
      const successfulDownload = page.waitForEvent("download");
      await page.getByRole("button", { name: "Download captured diagnostics" }).click();
      assert.equal(
        (await successfulDownload).suggestedFilename(),
        `feedbacks-diagnostics-${evidenceId}.tar.gz`,
      );
      await page.getByRole("button", { name: "Show older diagnostics" }).click();
      await page
        .getByRole("button", { name: /View captured diagnostics · Complete · 4 KiB/ })
        .waitFor();
      assert.equal(calls.filter((call) => call.name === "diagnostics.list").length, 1);
      await mkdir(".local", { recursive: true });
      await page.screenshot({
        path: ".local/diagnostic-thread-desktop.png",
        fullPage: true,
      });
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(
        await page
          .getByRole("button", { name: "Download captured diagnostics" })
          .isVisible(),
        true,
      );
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      await page.screenshot({
        path: ".local/diagnostic-thread-compact.png",
        fullPage: true,
      });
      await page.evaluate(() => {
        document.documentElement.dataset.theme = "dark";
      });
      await page.screenshot({
        path: ".local/diagnostic-thread-compact-dark.png",
        fullPage: true,
      });
    } finally {
      await browser.close();
      server.close();
      await once(server, "close");
    }
  },
);
