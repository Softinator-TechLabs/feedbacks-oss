import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function verifyCaptureTriage({
  context,
  worker,
  post,
  auth,
  access,
  extensionId,
  root,
  page,
  toFixture,
  tabId,
  send,
  results,
}) {
  const project = (
    await post(
      "projects.create",
      { name: "Capture assignment QA", origins: ["https://example.com"] },
      auth,
    )
  ).data;
  const other = (
    await post(
      "projects.create",
      { name: "Other capture project", origins: ["https://example.com"] },
      auth,
    )
  ).data;
  const pairing = (await post("pairing.request", { name: "Capture triage QA" })).data;
  await post("pairing.approve", { pairingId: pairing.pairingId }, auth);
  const paired = (
    await post("pairing.poll", {
      pairingId: pairing.pairingId,
      deviceSecret: pairing.deviceSecret,
    })
  ).data;
  assert.equal(paired.status, "approved");
  await worker.evaluate(
    ({ server, token }) =>
      chrome.storage.local.set({ accounts: { [server]: { token } } }),
    { server: access.url, token: paired.token },
  );
  let developer;
  for (let index = 1; index <= 99; index++) {
    const suffix = String(index).padStart(3, "0");
    const member = (
      await post(
        "members.create",
        {
          name: `Developer ${suffix}`,
          email: `capture-${suffix}@example.test`,
          password: "Synthetic-Capture-Password-123",
          grants: [{ projectId: project.id, role: "reviewer" }],
        },
        auth,
      )
    ).data;
    if (index === 99) developer = member;
  }
  const directory = join(root, ".local/capture-triage-qa");
  await mkdir(directory, { recursive: true });
  const waitDraft = async (predicate) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const draft = await worker.evaluate(
        async () => (await chrome.storage.local.get("draft")).draft,
      );
      if (predicate(draft)) return;
      await page.waitForTimeout(50);
    }
    throw Error("Capture draft did not reach its expected saved state");
  };
  const selectDeveloper = async (editor) => {
    const picker = editor.getByRole("combobox", { name: "Search project members" });
    await editor.getByRole("button", { name: "Assign to", exact: true }).waitFor();
    await editor.locator(".capture-assignee-trigger:not([disabled])").waitFor();
    await editor.getByRole("button", { name: "Assign to", exact: true }).click();
    await editor.getByRole("listbox").locator("[data-member]").nth(9).waitFor();
    assert.equal(await editor.getByRole("listbox").locator("[data-member]").count(), 10);
    const firstPage = await editor
      .locator("[data-member]")
      .evaluateAll((items) => items.map((item) => item.dataset.member));
    await editor.getByRole("button", { name: "More", exact: true }).click();
    await editor.getByRole("listbox").locator("[data-member]").nth(9).waitFor();
    assert.equal(await editor.getByRole("listbox").locator("[data-member]").count(), 10);
    const secondPage = await editor
      .locator("[data-member]")
      .evaluateAll((items) => items.map((item) => item.dataset.member));
    assert.ok(secondPage.every((id) => !firstPage.includes(id)));
    await editor.getByRole("button", { name: "Previous", exact: true }).click();
    await editor.getByRole("listbox").locator("[data-member]").nth(9).waitFor();
    assert.deepEqual(
      await editor
        .locator("[data-member]")
        .evaluateAll((items) => items.map((item) => item.dataset.member)),
      firstPage,
    );
    await picker.fill("dEvElOpEr 099");
    await editor.getByRole("option", { name: "Developer 099", exact: true }).waitFor();
    assert.equal(await editor.getByRole("listbox").locator("[data-member]").count(), 1);
    await picker.press("ArrowDown");
    await picker.press("Enter");
    assert.match(
      await editor.getByRole("button", { name: "Assign to", exact: true }).textContent(),
      /Developer 099/,
    );
    assert.equal(
      await editor
        .getByRole("button", { name: "Assign to", exact: true })
        .getAttribute("aria-expanded"),
      "false",
    );
    await editor.getByLabel("Priority", { exact: true }).selectOption("high");
  };
  await toFixture();
  const sourceTabId = await tabId();
  await send({ type: "activate", tabId: sourceTabId, projectId: project.id });
  for (const previous of context.pages())
    if (previous.url().startsWith(`chrome-extension://${extensionId}/editor.html`))
      await previous.close();
  await send({ type: "popupAction", tabId: sourceTabId, action: "capture" });
  const editor =
    context
      .pages()
      .find((item) =>
        item.url().startsWith(`chrome-extension://${extensionId}/editor.html`),
      ) || (await context.waitForEvent("page"));
  await editor.waitForURL(`chrome-extension://${extensionId}/editor.html*`);
  await editor.locator("#project").selectOption(project.id);
  await selectDeveloper(editor);
  const assigneeButton = editor.getByRole("button", { name: "Assign to", exact: true });
  await assigneeButton.press("ArrowDown");
  assert.equal(
    await editor.getByRole("combobox", { name: "Search project members" }).isVisible(),
    true,
  );
  await editor.getByText("Feedbacks", { exact: true }).click();
  assert.equal(await assigneeButton.getAttribute("aria-expanded"), "false");
  await assigneeButton.click();
  await editor.getByRole("option", { name: "Unassigned", exact: true }).click();
  assert.equal(await assigneeButton.locator("span").first().textContent(), "Unassigned");
  await selectDeveloper(editor);
  await editor.locator("#body").fill("Synthetic assigned screenshot");
  await waitDraft(
    (draft) =>
      draft?.triage?.priority === "high" &&
      draft.triageName === "Developer 099" &&
      draft.body === "Synthetic assigned screenshot",
  );
  await editor.reload();
  await editor.locator(".capture-assignee-trigger:not([disabled])").waitFor();
  const reopenedDraft = await worker.evaluate(async () => {
    const { draft } = await chrome.storage.local.get("draft");
    return {
      triage: draft?.triage,
      name: draft?.triageName,
    };
  });
  assert.equal(
    await editor
      .getByRole("button", { name: "Assign to", exact: true })
      .locator("span")
      .first()
      .textContent(),
    "Developer 099",
    JSON.stringify(reopenedDraft),
  );
  assert.equal(await editor.getByLabel("Priority", { exact: true }).inputValue(), "high");
  await editor.locator("#project").selectOption(other.id);
  await editor.locator(".capture-assignee-trigger:not([disabled])").waitFor();
  assert.equal(
    await editor
      .getByRole("button", { name: "Assign to", exact: true })
      .locator("span")
      .first()
      .textContent(),
    "Unassigned",
  );
  await editor.getByRole("button", { name: "Assign to", exact: true }).click();
  const otherMembers = (
    await post("members.list", { projectId: other.id, assignees: { limit: 10 } }, auth)
  ).data;
  await editor
    .locator("[data-member]")
    .nth(otherMembers.items.length - 1)
    .waitFor();
  assert.equal(
    await editor.getByRole("listbox").locator("[data-member]").count(),
    otherMembers.items.length,
  );
  assert.equal(
    await editor
      .getByRole("listbox")
      .getByText(/Developer/)
      .count(),
    0,
  );
  await editor.getByRole("combobox", { name: "Search project members" }).press("Escape");
  await editor.locator("#project").selectOption(project.id);
  await selectDeveloper(editor);
  for (const [name, width, height] of [
    ["desktop", 1440, 900],
    ["mobile", 390, 844],
  ]) {
    await editor.setViewportSize({ width, height });
    await editor.getByRole("button", { name: "Assign to", exact: true }).click();
    await editor.getByRole("listbox").locator("[data-member]").nth(9).waitFor();
    await editor.screenshot({
      path: join(directory, `screenshot-${name}.png`),
      fullPage: true,
    });
    assert.ok(
      await editor.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    );
    await editor
      .getByRole("combobox", { name: "Search project members" })
      .press("Escape");
  }
  await worker.evaluate(() => {
    const original = globalThis.fetch;
    let lose = true;
    globalThis.fetch = async (...args) => {
      const response = await original(...args);
      if (
        lose &&
        String(args[0]).endsWith("/api/threads.create") &&
        JSON.parse(args[1]?.body || "{}").body === "Synthetic assigned screenshot"
      ) {
        lose = false;
        await response.clone().text();
        throw Error("Synthetic lost capture acknowledgement");
      }
      return response;
    };
  });
  await editor.locator("#send").click();
  await editor.getByRole("button", { name: "Retry Send", exact: true }).first().waitFor();
  assert.equal(await editor.getByLabel("Priority", { exact: true }).isDisabled(), true);
  assert.equal(
    await editor.getByRole("button", { name: "Assign to", exact: true }).isDisabled(),
    true,
  );
  await editor.locator("#send").click();
  await waitDraft((draft) => !draft);
  const screenshots = (await post("threads.list", { projectId: project.id }, auth)).data
    .items;
  const screenshot = screenshots.find(
    (item) => item.body === "Synthetic assigned screenshot",
  );
  assert.ok(screenshot);
  assert.equal(screenshots.filter((item) => item.body === screenshot.body).length, 1);
  assert.equal(screenshot.workPlan.priority, "high");
  const screenshotAssignments = (
    await post(
      "assignments.delegations",
      { projectId: project.id, threadId: screenshot.id },
      auth,
    )
  ).data;
  assert.equal(screenshotAssignments.total, 1);
  assert.equal(screenshotAssignments.items[0].userId, developer.id);
  await editor.close();

  await page.bringToFront();
  await send({ type: "activate", tabId: sourceTabId, projectId: project.id });
  const localDraft = await worker.evaluate(async (sourceTabId) => {
    const { sessions } = await chrome.storage.local.get("sessions");
    return { sourceTabId, reviewId: sessions[sourceTabId].reviewId };
  }, sourceTabId);
  // Real MediaRecorder bytes exercise the packaged video editor without taking
  // a desktop recording or changing the shipped extension's permissions.
  const recorderControl = await context.newPage();
  await recorderControl.goto(`chrome-extension://${extensionId}/popup.html`);
  await recorderControl.bringToFront();
  const draftId = await recorderControl.evaluate(async (target) => {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 180;
    document.body.append(canvas);
    const paint = canvas.getContext("2d");
    paint.fillStyle = "#345";
    paint.fillRect(0, 0, 320, 180);
    const stream = canvas.captureStream(20);
    const recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8" });
    const chunks = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    const stopped = new Promise((resolve) => {
      recorder.onstop = resolve;
    });
    const videoStartWall = Date.now();
    recorder.start(100);
    const timer = setInterval(() => {
      paint.fillStyle = `hsl(${Date.now() % 360},50%,50%)`;
      paint.fillRect(0, 0, 320, 180);
    }, 40);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    recorder.stop();
    await stopped;
    clearInterval(timer);
    stream.getTracks().forEach((track) => track.stop());
    const id = crypto.randomUUID();
    const { putVideoDraft } = await import("./video-draft-store.js");
    await import("./webm-duration.js");
    const { finalizeWebmMetadata } = await import("./video/video-metadata.js");
    const durationMs = Date.now() - videoStartWall;
    const blob = await finalizeWebmMetadata(
      new Blob(chunks, { type: "video/webm" }),
      durationMs,
    );
    await putVideoDraft(id, {
      ...target,
      blob,
      durationMs,
      videoStartWall,
    });
    return id;
  }, localDraft);
  const videoBytes = await recorderControl.evaluate(async (id) => {
    const { getVideoDraft } = await import("./video-draft-store.js");
    return [...new Uint8Array(await (await getVideoDraft(id)).blob.arrayBuffer())];
  }, draftId);
  await writeFile(join(directory, "synthetic.webm"), Buffer.from(videoBytes));
  const video = await context.newPage();
  await video.goto(
    `chrome-extension://${extensionId}/video.html?sourceTabId=${sourceTabId}&reviewId=${localDraft.reviewId}&draftId=${draftId}`,
  );
  await video
    .locator("#review:not([hidden])")
    .waitFor()
    .catch(async (error) => {
      throw Error(
        `${error.message}\nVideo status: ${await video.locator("#status").textContent()}`,
      );
    });
  await selectDeveloper(video);
  await video.locator("#comment").fill("Synthetic assigned video");
  await video.locator("#debug-context").uncheck();
  await video.setViewportSize({ width: 390, height: 844 });
  await video.getByRole("button", { name: "Assign to", exact: true }).click();
  await video.getByRole("listbox").locator("[data-member]").nth(9).waitFor();
  await video.screenshot({ path: join(directory, "video-mobile.png"), fullPage: true });
  assert.ok(
    await video.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  );
  await video.getByRole("combobox", { name: "Search project members" }).press("Escape");
  await worker.evaluate(() => {
    const original = globalThis.fetch;
    let lose = true;
    globalThis.fetch = async (...args) => {
      const response = await original(...args);
      if (
        lose &&
        String(args[0]).endsWith("/api/threads.create") &&
        JSON.parse(args[1]?.body || "{}").body === "Synthetic assigned video"
      ) {
        lose = false;
        await response.clone().text();
        throw Error("Synthetic lost video acknowledgement");
      }
      return response;
    };
  });
  await video.locator("#send-background").click();
  await video.getByRole("button", { name: "Retry Send video", exact: true }).waitFor();
  assert.equal(
    await worker.evaluate(
      async (tabId) =>
        (
          await chrome.scripting.executeScript({
            target: { tabId },
            func: () => globalThis.feedbacksReviewActive,
          })
        )[0].result,
      sourceTabId,
    ),
    false,
  );
  assert.equal(await page.locator("#feedbacks-review-root").count(), 0);
  assert.equal(await video.getByLabel("Priority", { exact: true }).isDisabled(), true);
  assert.equal(
    await video.getByRole("button", { name: "Assign to", exact: true }).isDisabled(),
    true,
  );
  const videoClosed = video.waitForEvent("close");
  await video.locator("#send-background").click();
  // A successful retry closes the real packaged review tab after the video is confirmed.
  await videoClosed;
  assert.equal(
    await worker.evaluate(
      async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id,
    ),
    sourceTabId,
  );
  const videos = (await post("threads.list", { projectId: project.id }, auth)).data.items;
  const createdVideo = videos.find((item) => item.body === "Synthetic assigned video");
  assert.ok(createdVideo);
  assert.equal(videos.filter((item) => item.body === createdVideo.body).length, 1);
  assert.equal(createdVideo.workPlan.priority, "high");
  const videoAssignments = (
    await post(
      "assignments.delegations",
      { projectId: project.id, threadId: createdVideo.id },
      auth,
    )
  ).data;
  assert.equal(videoAssignments.total, 1);
  assert.equal(videoAssignments.items[0].userId, developer.id);
  const uploaded = (await post("threads.get", { threadId: createdVideo.id }, auth)).data;
  assert.ok(uploaded.assets.some((asset) => asset.contentType === "video/webm"));
  results.captureTriage = {
    members: (
      await post(
        "members.list",
        { projectId: project.id, assignees: { limit: 10 } },
        auth,
      )
    ).data.total,
    maxVisible: 10,
    search: true,
    keyboard: true,
    projectReset: true,
    persistedDraft: true,
    screenshot: true,
    video: true,
    backgroundVideo: true,
    reviewOffDuringRetry: true,
    frozenRetry: true,
    duplicateThreads: 0,
    duplicateAssignments: 0,
  };
  if (!video.isClosed()) await video.close();
  await recorderControl.close();
}
