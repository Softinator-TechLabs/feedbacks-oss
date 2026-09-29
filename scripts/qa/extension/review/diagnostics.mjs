import assert from "node:assert/strict";
import { join } from "node:path";

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
  const diagnosticIndex = diagnosticDraft?.diagnostics?.console?.findIndex((entry) =>
    entry.message.includes("PRIVATE-123"),
  );
  if (diagnosticIndex < 0) throw Error("Synthetic console message was not captured");
  const editor = await context.newPage();
  await editor.goto(`chrome-extension://${extensionId}/editor.html`);
  await editor.locator("#diagnostics-review summary").click();
  const messageField = editor.getByRole("textbox", {
    name: `Console message ${diagnosticIndex + 1}`,
  });
  await messageField.waitFor();
  await messageField.evaluate((element) => {
    const start = element.value.indexOf("PRIVATE-123");
    element.setSelectionRange(start, start + "PRIVATE-123".length);
  });
  await editor.locator("[data-diagnostic-mask]").nth(diagnosticIndex).click();
  await editor.getByText("Selected text masked in the local draft.").waitFor();
  await editor.reload();
  const masked = await draft();
  results.diagnostics = {
    persisted:
      !masked.diagnostics.console[diagnosticIndex].message.includes("PRIVATE-123"),
    marker: masked.diagnostics.console[diagnosticIndex].message.includes("[redacted]"),
  };
  await editor.locator("#body").fill("Synthetic diagnostics masking browser check.");
  await editor.locator("#diagnostics-review summary").click();
  await editor.locator("#include-diagnostics").check();
  await editor.locator("#send").click();
  await editor.getByText("Feedback sent").waitFor();
  const threadUrl = await editor.locator("#thread").getAttribute("href");
  const threadId = threadUrl?.match(/[0-9a-f-]{36}/)?.[0];
  if (!threadId) throw Error("Submitted feedback lacks a thread link");
  const saved = (await post("threads.get", { threadId }, auth)).data;
  const serialized = JSON.stringify(saved);
  results.diagnostics.submitted =
    !serialized.includes("PRIVATE-123") && serialized.includes("masked");
  results.diagnostics.draftCleared = !(await draft());
}
