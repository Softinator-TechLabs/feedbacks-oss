import { verifySelectionGeometry } from "./selection-geometry.mjs";
import assert from "node:assert/strict";
import { join } from "node:path";

export async function verifySelectedText({
  page,
  fixture,
  toFixture,
  exposeReviewRoot,
  send,
  id,
  worker,
  draft,
  results,
  waitReview,
  root,
  context,
  extensionId,
  post,
  auth,
  access,
}) {
  fixture.mode = "short";
  await toFixture();
  await exposeReviewRoot();
  await send({ type: "activate", tabId: id });
  const review = (operation, value) =>
    worker.evaluate(
      async ({ tabId, operation, value }) => {
        const [entry] = await chrome.scripting.executeScript({
          target: { tabId },
          func: (operation, value) => {
            const root = globalThis.__feedbacksQaRoot;
            const action = root.querySelector(".text-selection-action");
            const menu = root.querySelector(".point-menu");
            if (operation === "action") {
              const r = action.getBoundingClientRect();
              return {
                visible: !action.classList.contains("hidden"),
                x: r.x + r.width / 2,
                y: r.y + r.height / 2,
              };
            }
            if (operation === "save") {
              menu.querySelector("textarea").value = value;
              [...menu.querySelectorAll("button")]
                .find((button) => button.textContent === "Save suggestion")
                .click();
            }
            if (operation === "cancel")
              [...menu.querySelectorAll("button")]
                .find((button) => button.textContent === "Cancel")
                .click();
            if (operation === "stale") {
              document.querySelector("h1").firstChild.textContent = "Changed page";
              action.click();
            }
            return {
              heading: menu.querySelector("strong").textContent,
              original: menu.querySelector("blockquote").textContent,
              replacement: menu.querySelector("textarea").value,
              selection: String(getSelection()),
              tip: root.querySelector(".point-tip").textContent,
              notice: root.querySelector(".notice").textContent,
            };
          },
          args: [operation, value ?? null],
        });
        return entry.result;
      },
      { tabId: id, operation, value },
    );
  const select = (selector) =>
    page.evaluate((selector) => {
      const range = document.createRange();
      range.selectNodeContents(document.querySelector(selector));
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    }, selector);
  const waitAction = async (visible) => {
    for (let n = 0; n < 40; n++) {
      const state = await review("action");
      if (state.visible === visible) return state;
      await page.waitForTimeout(100);
    }
    throw Error(`Suggest edit visibility did not become ${visible}`);
  };
  assert.equal((await review("action")).visible, false);
  // A real mouse selection exposes the action; ordinary hover does not.
  await page.locator("h1").hover();
  assert.equal((await review("action")).visible, false);
  await page.locator("h1").dblclick({ position: { x: 40, y: 15 } });
  const action = await waitAction(true);
  await page.mouse.click(action.x, action.y);
  await waitReview((state) => state.ready && state.frozen);
  const before = await review("state");
  assert.equal(before.heading, "Suggest a text edit");
  assert.match(before.original, /Controlled/);
  assert.equal(before.replacement, before.original);
  assert.equal(before.selection, "", "native selection must be cleared before capture");
  await review("save", before.original);
  await waitReview((state) => /Change the suggested text/.test(state.tip));
  assert.match((await review("state")).tip, /Change the suggested text/);
  await page.screenshot({
    path: join(root, ".local/remaining-todos-qa/text-edit-selection-desktop.png"),
  });
  await review("save", "Reviewed page");
  await waitReview((state) => state.points === 1);
  assert.equal(
    await page.locator("h1").textContent(),
    "Controlled page",
    "suggestions must not edit the reviewed website",
  );
  await page.evaluate(() => {
    const div = document.createElement("div");
    div.innerHTML =
      '<input id="edit-input" value="Private draft"><div id="edit-content" contenteditable="true">Editable draft</div><span id="edit-private" data-feedbacks-private>Excluded text</span><div style="opacity:0"><span id="edit-invisible">Invisible text</span></div><p id="edit-delete">Remove this sentence</p>';
    document.querySelector("main").append(div);
  });
  for (const selector of ["#edit-content", "#edit-private", "#edit-invisible"]) {
    await select(selector);
    await page.waitForTimeout(150);
    await waitAction(false);
  }
  await page.locator("#edit-input").selectText();
  await page.waitForTimeout(150);
  await waitAction(false);
  await select("h1");
  await waitAction(true);
  await review("stale");
  await page.waitForTimeout(100);
  assert.match((await review("state")).notice, /selected text changed/i);
  await page.locator("h1").evaluate((node) => (node.textContent = "Controlled page"));
  await select("#edit-delete");
  const deletionAction = await waitAction(true);
  // Keyboard activation uses the same control, with the selection retained.
  await worker.evaluate(async (tabId) => {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () =>
        globalThis.__feedbacksQaRoot.querySelector(".text-selection-action").focus(),
    });
  }, id);
  await page.keyboard.press("Enter");
  await waitReview((state) => state.ready && state.frozen);
  assert.equal((await review("state")).original, "Remove this sentence");
  await review("save", "");
  await waitReview((state) => state.points === 2);
  await worker.evaluate(async (tabId) => {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => globalThis.__feedbacksQaRoot.querySelector(".finalize-review").click(),
    });
    for (let i = 0; i < 100; i++) {
      const { draft } = await chrome.storage.local.get("draft");
      if (draft?.capturePages?.length === 2 && !draft.captureError) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw Error("Point originals did not reach the editor");
  }, id);
  const captured = await draft();
  assert.equal(captured.context.annotations[0].textEdit.replacement, "Reviewed page");
  assert.equal(captured.context.annotations[1].textEdit.replacement, "");
  assert.ok(
    captured.pageToolStates.every(
      (shapes) =>
        shapes.some((shape) => shape.origin === "text-selection") &&
        shapes.some((shape) => shape.origin === "element"),
    ),
  );
  for (const candidate of context
    .pages()
    .filter((p) => p.url().startsWith(`chrome-extension://${extensionId}/editor.html`)))
    await candidate.close();
  const editor = await context.newPage();
  const editorErrors = [];
  editor.on("pageerror", (error) => editorErrors.push(error.message));
  await editor.goto(`chrome-extension://${extensionId}/editor.html`);
  await editor.waitForFunction(
    () =>
      document.getElementById("canvas")?.width > 0 &&
      !document.getElementById("send").disabled,
  );
  assert.equal(
    await editor.locator("#point-notes textarea").first().inputValue(),
    "Reviewed page",
  );
  await editor.locator("#point-notes textarea").first().fill("Clearer reviewed page");
  await editor.waitForFunction(
    async () =>
      (await chrome.storage.local.get("draft")).draft.context.annotations[0].textEdit
        .replacement === "Clearer reviewed page",
  );
  assert.equal(
    await editor
      .getByRole("button", { name: "Show element outline", exact: true })
      .getAttribute("aria-pressed"),
    "false",
  );
  await editor.getByRole("button", { name: "Hide text selection", exact: true }).click();
  await editor.getByRole("button", { name: "Hide points", exact: true }).click();
  await editor.getByRole("button", { name: "Show element outline", exact: true }).click();
  assert.equal(
    await editor
      .getByRole("button", { name: "Show text selection", exact: true })
      .getAttribute("aria-pressed"),
    "false",
  );
  await editor.getByRole("button", { name: "Show text selection", exact: true }).click();
  await editor.getByRole("button", { name: "Show points", exact: true }).click();
  await editor.getByRole("button", { name: "Hide element outline", exact: true }).click();
  const count = (await draft()).pageToolStates[0].length;
  await editor.locator("#tools .more-tools summary").click();
  await editor.locator("#reset").click();
  await editor.locator("#undo").click();
  await editor.waitForTimeout(500);
  assert.equal(
    (await draft()).toolState.length,
    count,
    "reset and undo preserve captured evidence",
  );
  await editor.screenshot({
    path: join(root, ".local/remaining-todos-qa/text-edit-editor-desktop.png"),
  });
  await editor.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await editor.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
    false,
  );
  await editor.screenshot({
    path: join(root, ".local/remaining-todos-qa/text-edit-editor-mobile.png"),
    fullPage: true,
  });
  await worker.evaluate(() => {
    globalThis.qaSelectionFetch = globalThis.fetch;
    globalThis.qaSelectionFailed = false;
    globalThis.fetch = (...args) => {
      if (
        !globalThis.qaSelectionFailed &&
        String(args[0]).includes("/api/assets.upload")
      ) {
        globalThis.qaSelectionFailed = true;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ok: false,
              error: { code: "UNAVAILABLE", message: "Synthetic interrupted upload" },
            }),
            { status: 503, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      return globalThis.qaSelectionFetch(...args);
    };
  });
  await editor.locator("#send-header").click();
  await editor
    .waitForFunction(
      () => document.querySelector("#send-header span")?.textContent === "Retry Send",
      { timeout: 30000 },
    )
    .catch(async (error) => {
      const state = await editor.evaluate(() => ({
        status: document.getElementById("status").textContent,
        send: document.getElementById("send-header").textContent,
        completion: document.getElementById("completion-title").textContent,
      }));
      const workerState = await worker.evaluate(async () => ({
        failed: globalThis.qaSelectionFailed,
        frozen: (await chrome.storage.local.get("draft")).draft?.frozen,
      }));
      throw Error(
        `${error.message} ${JSON.stringify({ state, workerState, editorErrors })}`,
      );
    });
  assert.equal((await draft()).frozen, true);
  await editor.getByRole("button", { name: "Hide text selection", exact: true }).click();
  await editor.getByRole("button", { name: "Show text selection", exact: true }).click();
  await worker.evaluate(() => {
    globalThis.fetch = globalThis.qaSelectionFetch;
  });
  await editor.locator("#send-header").click();
  await editor.getByText("Feedback sent", { exact: true }).waitFor({ timeout: 120000 });
  const url = await editor.locator("#thread").getAttribute("href");
  const threadId = url.match(/[0-9a-f-]{36}/)[0];
  const thread = (await post("threads.get", { threadId }, auth)).data;
  assert.equal(thread.context.annotations[0].textEdit.original, before.original);
  assert.equal(
    thread.context.annotations[0].textEdit.replacement,
    "Clearer reviewed page",
  );
  assert.equal(thread.context.annotations[1].textEdit.replacement, "");
  assert.ok(
    thread.assets.every(
      (asset) =>
        asset.rendition === "screenshot" &&
        asset.markings.some((mark) => mark.origin === "text-selection"),
    ),
  );
  const listed = (
    await post(
      "threads.list",
      { projectId: thread.projectId, search: "Clearer reviewed page" },
      auth,
    )
  ).data;
  assert.ok(
    listed.items.some((item) => item.id === threadId),
    "search must include suggested copy",
  );
  const issue = (await post("threads.issueDraft", { threadId }, auth)).data;
  assert.match(issue.body, /Clearer reviewed page/);
  const split = auth.cookie.indexOf("=");
  await context.addCookies([
    {
      name: auth.cookie.slice(0, split),
      value: auth.cookie.slice(split + 1),
      url: access.url,
      sameSite: "Strict",
    },
  ]);
  const viewer = await context.newPage();
  await viewer.goto(url);
  await viewer.getByRole("heading", { name: "Review on the page" }).waitFor();
  assert.equal(await viewer.locator(".review-text-edit").count(), 2);
  await viewer.getByRole("button", { name: "Expand all", exact: true }).click();
  await viewer.getByText("Remove selected text", { exact: true }).waitFor();
  const image = viewer.locator(".review-point-figure").first();
  const preview = image.locator(".review-image-open");
  await image.getByRole("button", { name: "Expand image", exact: true }).click();
  const expanded = viewer.getByRole("dialog");
  assert.equal((await preview.locator(".review-text-selection").count()) > 0, true);
  assert.equal(await preview.locator(".review-element-outline").count(), 0);
  await expanded
    .getByRole("button", { name: "Hide text selection", exact: true })
    .click();
  assert.equal(await preview.locator(".review-text-selection").count(), 0);
  assert.equal(await preview.locator(".review-image-pin").count(), 1);
  await expanded
    .getByRole("button", { name: "Show element outline", exact: true })
    .click();
  assert.equal(await preview.locator(".review-element-outline").count(), 1);
  await expanded.getByRole("button", { name: "Hide points", exact: true }).click();
  assert.equal(await preview.locator(".review-image-pin").count(), 0);
  assert.equal(
    (await viewer
      .locator(".review-point-figure")
      .nth(1)
      .locator(".review-text-selection")
      .count()) > 0,
    true,
    "image visibility is independent",
  );
  await expanded
    .getByRole("button", { name: "Show text selection", exact: true })
    .click();
  await expanded.getByRole("button", { name: "Close", exact: true }).click();
  await viewer.setViewportSize({ width: 1200, height: 900 });
  await viewer.locator(".review-evidence").screenshot({
    path: join(root, ".local/remaining-todos-qa/text-edit-thread-desktop.png"),
  });
  await viewer.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await viewer.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
    false,
  );
  await viewer.locator(".review-evidence").screenshot({
    path: join(root, ".local/remaining-todos-qa/text-edit-thread-mobile.png"),
  });
  await viewer.setViewportSize({ width: 1200, height: 900 });
  await image.getByRole("button", { name: "Expand image", exact: true }).click();
  const markup = viewer.getByRole("dialog");
  await markup.getByRole("button", { name: "Edit annotations", exact: true }).click();
  assert.equal(await viewer.locator("dialog[open]").count(), 1);
  await markup.getByRole("button", { name: "Hide text selection", exact: true }).click();
  await markup.getByRole("button", { name: "Show text selection", exact: true }).click();
  await markup.getByRole("button", { name: "Hide element outline", exact: true }).click();
  await markup.getByRole("button", { name: "Show element outline", exact: true }).click();
  await markup.getByRole("button", { name: "Show points", exact: true }).click();
  await markup.getByRole("button", { name: "Hide points", exact: true }).click();
  await markup.getByRole("button", { name: "Cancel", exact: true }).click();
  await markup.getByRole("button", { name: "Close", exact: true }).click();
  await viewer.goto(
    `${access.url}/projects/${thread.projectId}?search=Clearer%20reviewed%20page`,
  );
  const listPreview = viewer.locator(".thread-text-edit-preview");
  await listPreview.getByText("Clearer reviewed page", { exact: false }).waitFor();
  assert.match(await listPreview.textContent(), /Original:.*Suggested:/);
  await viewer.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await viewer.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
    false,
  );
  await viewer.locator(".thread-list").screenshot({
    path: join(root, ".local/remaining-todos-qa/text-edit-list-mobile.png"),
  });
  await page.bringToFront();
  const geometry = await verifySelectionGeometry(worker, id);
  results.selectedText = {
    ...geometry,
    submissionRetryLayers: true,
    replyEditorLayers: true,
    listBeforeAfter: true,
    mouseSelection: true,
    keyboardActivation: true,
    editableExcluded: true,
    staleSelectionRejected: true,
    deletion: true,
    editorReplacementSaved: true,
    independentLayers: true,
    rawScreenshotRendition: true,
    search: true,
    issueHandoff: true,
    responsive: true,
  };
  await viewer.close();
  await editor.close();
  await page.setViewportSize({ width: 900, height: 650 });
}
