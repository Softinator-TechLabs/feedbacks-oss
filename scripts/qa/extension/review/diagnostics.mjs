import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

export async function verifyDiagnostics({
  page,
  fixture,
  toFixture,
  exposeReviewRoot,
  send,
  id,
  root,
  worker,
  context,
  extensionId,
  draft,
  post,
  auth,
  results,
  access,
}) {
  fixture.mode = "short";
  await toFixture();
  await exposeReviewRoot();
  await send({ type: "activate", tabId: id });
  await send({ type: "popupAction", tabId: id, action: "show-controls" });
  await page.screenshot({
    path: join(root, ".local/remaining-todos-qa/page-controls-desktop.png"),
  });
  await page.setViewportSize({ width: 390, height: 650 });
  await page.screenshot({
    path: join(root, ".local/remaining-todos-qa/page-controls-mobile.png"),
  });
  await page.setViewportSize({ width: 900, height: 650 });
  const clickPageControl = async (label) =>
    worker.evaluate(
      async ({ tabId, label }) => {
        const [entry] = await chrome.scripting.executeScript({
          target: { tabId },
          args: [label],
          func: (label) => {
            const root = globalThis.__feedbacksQaRoot;
            const button = [...root.querySelectorAll("button")].find(
              (node) => node.textContent === label,
            );
            if (!button || button.disabled) return false;
            button.click();
            return true;
          },
        });
        return entry.result;
      },
      { tabId: id, label },
    );
  for (let attempt = 0; attempt < 30; attempt++) {
    if (await clickPageControl("Start diagnostics")) break;
    await page.waitForTimeout(100);
  }
  for (let attempt = 0; attempt < 30; attempt++) {
    if ((await send({ type: "diagnostics", tabId: id, action: "status" })).active) break;
    await page.waitForTimeout(100);
  }
  assert.equal(
    (await send({ type: "diagnostics", tabId: id, action: "status" })).active,
    true,
  );
  const commentsOpened = context.waitForEvent("page");
  assert.equal(await clickPageControl("Page comments"), true);
  const commentsTab = await commentsOpened;
  await commentsTab.waitForURL(
    (url) => url.pathname.startsWith("/projects/") && url.searchParams.has("url"),
  );
  assert.equal(
    new URL(commentsTab.url()).searchParams.get("url"),
    new URL(page.url()).origin + new URL(page.url()).pathname,
  );
  await commentsTab.close();
  await page.bringToFront();
  await page.evaluate(() =>
    console.warn("Synthetic card token PRIVATE-123 should be masked"),
  );
  await send({ type: "popupAction", tabId: id, action: "capture" });
  const diagnosticDraft = await draft();
  assert.ok(diagnosticDraft?.diagnosticEvidence?.evidenceId);
  assert.equal(diagnosticDraft.includeDiagnostics, true);
  const editor = await context.newPage();
  await editor.goto(`chrome-extension://${extensionId}/editor.html`);
  await editor.locator("#diagnostics-review summary").click();
  await editor.locator("#download-diagnostics").waitFor();
  results.diagnostics = {
    checked: await editor.locator("#include-diagnostics").isChecked(),
    download: await editor.locator("#download-diagnostics").isVisible(),
    boundedPreview:
      (await editor.locator(".diagnostic-sample").textContent()).length <= 3000,
  };
  await editor.evaluate(() => {
    Object.defineProperty(window, "showSaveFilePicker", {
      configurable: true,
      value: undefined,
    });
  });
  const localDownload = editor.waitForEvent("download");
  await editor.locator("#download-diagnostics").click();
  const localArchive = await localDownload;
  assert.match(localArchive.suggestedFilename(), /\.tar\.gz$/);
  const archiveBytes = gunzipSync(await readFile(await localArchive.path()));
  results.diagnostics.localArchive =
    archiveBytes.includes(Buffer.from("manifest.json")) &&
    archiveBytes.includes(Buffer.from("PRIVATE-123"));
  await editor.locator("#body").fill("Synthetic raw diagnostics browser check.");
  await editor.locator("#send").click();
  await editor.waitForURL("**/threads/*");
  const threadUrl = editor.url();
  const threadId = threadUrl?.match(/[0-9a-f-]{36}/)?.[0];
  if (!threadId) throw Error("Submitted feedback lacks a thread link");
  const saved = (await post("diagnostics.list", { threadId }, auth)).data;
  results.diagnostics.submitted =
    saved.total === 1 && saved.items[0].status === "complete";
  results.diagnostics.draftCleared = !(await draft());
}
