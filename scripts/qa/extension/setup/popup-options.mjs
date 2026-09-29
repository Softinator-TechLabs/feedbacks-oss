import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

export async function verifyPopupOptions({
  context,
  control,
  extensionId,
  access,
  worker,
  send,
  page,
  tabId,
  root,
  toFixture,
}) {
  await toFixture();
  await mkdir(join(root, ".local/remaining-todos-qa"), { recursive: true });
  await control.reload();
  await control.locator("#review-controls:visible").waitFor();
  await control.locator("#settings").hover();
  assert.equal(
    await control.getByRole("tooltip").isVisible(),
    true,
    "Packaged popup icon help appears without a hover delay",
  );
  assert.equal(await control.getByRole("tooltip").textContent(), "Settings");
  await control.screenshot({
    path: join(root, ".local/remaining-todos-qa/instant-popup-tooltip.png"),
  });
  await control.locator("#capture").hover();
  assert.equal(await control.getByRole("tooltip").isVisible(), false);
  const appPage = await context.newPage();
  try {
    await appPage.goto(new URL("/privacy", access.url).href);
    await appPage.locator(".theme-switch").hover();
    assert.equal(
      await appPage.getByRole("tooltip").isVisible(),
      true,
      "Built app icon help appears without a hover delay",
    );
    assert.match(await appPage.getByRole("tooltip").textContent(), /Switch to .* mode/);
    await appPage.screenshot({
      path: join(root, ".local/remaining-todos-qa/instant-app-tooltip.png"),
    });
  } finally {
    await appPage.close();
  }
  const fullCaptureButton = await control.locator("#capture").boundingBox();
  assert.ok(
    fullCaptureButton && fullCaptureButton.y + fullCaptureButton.height < 600,
    "Primary capture actions should fit without scrolling in a compact popup",
  );
  assert.equal(await control.locator(".access-status").getAttribute("open"), null);
  await control.locator("body").screenshot({
    path: join(root, ".local/remaining-todos-qa/access-status.png"),
  });
  await control.emulateMedia({ colorScheme: "dark" });
  await control.locator("body").screenshot({
    path: join(root, ".local/remaining-todos-qa/popup-dark.png"),
  });
  await control.emulateMedia({ colorScheme: "light" });
  assert.equal(
    await control.locator("#capture-full").isVisible(),
    true,
    "Full page remains directly available beside video",
  );
  assert.equal(await control.locator("#record-video").isVisible(), true);
  assert.equal(await control.locator("#record-session").count(), 0);
  assert.equal(await control.locator(".page-overview").getAttribute("open"), null);
  assert.equal(await control.locator(".more-actions").getAttribute("open"), null);
  const toolsSummary = await control.locator(".more-actions > summary").boundingBox();
  assert.ok(
    toolsSummary && toolsSummary.y + toolsSummary.height < 600,
    "Connected popup's collapsed controls should fit Chrome's popup height",
  );
  const optionsOpened = context.waitForEvent("page");
  await control.locator("#settings").click();
  const options = await optionsOpened;
  await options.waitForURL(`chrome-extension://${extensionId}/options.html`);
  await options.locator("#connection-status").filter({ hasText: "Connected" }).waitFor();
  assert.equal(await options.locator("#server").inputValue(), access.url);
  assert.equal(await options.locator("#capture-marker-style").inputValue(), "ring");
  await options.locator("#capture-marker-style").selectOption("none");
  await options.waitForFunction(
    async () =>
      (await chrome.storage.local.get("reviewDefaults")).reviewDefaults
        ?.captureMarkerStyle === "none",
  );
  assert.equal(
    (await send({ type: "settings" })).reviewDefaults.captureMarkerStyle,
    "none",
  );
  await options.locator("#capture-marker-size").selectOption("large");
  await options.waitForFunction(
    async () =>
      (await chrome.storage.local.get("reviewDefaults")).reviewDefaults
        ?.captureMarkerSize === "large",
  );
  await options.locator("#capture-marker-style").selectOption("ring");
  await options.locator("#capture-marker-size").selectOption("small");
  const assignedShortcut = await worker.evaluate(
    async () =>
      (await chrome.commands.getAll()).find(
        (command) => command.name === "_execute_action",
      )?.shortcut,
  );
  await options
    .locator("#opening-shortcut")
    .filter({
      hasText: assignedShortcut
        ? `Start / resume review: ${assignedShortcut}`
        : "No shortcut assigned",
    })
    .waitFor();
  assert.equal(
    await options.locator("#customize-shortcuts").innerText(),
    "Change shortcut",
  );

  await options.locator("#review-shortcuts").uncheck();
  await options.waitForFunction(
    async () =>
      (await chrome.storage.local.get("reviewShortcuts")).reviewShortcuts === false,
  );
  assert.equal((await send({ type: "settings" })).reviewShortcuts, false);
  await options.locator("#review-shortcuts").check();
  await options.waitForFunction(
    async () =>
      (await chrome.storage.local.get("reviewShortcuts")).reviewShortcuts === true,
  );
  await page.bringToFront();
  const defaultsTabId = await tabId();
  const navigationDefault = options.locator('[data-review-default="navigationLocked"]');
  await navigationDefault.focus();
  await navigationDefault.press("Space");
  await options.locator("#message").filter({ hasText: "Defaults saved" }).waitFor();
  await options.waitForFunction(
    () =>
      document.activeElement ===
      document.querySelector('[data-review-default="navigationLocked"]'),
  );
  assert.equal((await send({ type: "settings" })).reviewDefaults.navigationLocked, false);
  await page.bringToFront();
  // A new default must not silently change a review already in progress.
  assert.equal(
    (await send({ type: "popupAction", tabId: defaultsTabId, action: "state" }))
      .navigationLocked,
    true,
  );
  await page.bringToFront();
  await send({ type: "popupAction", tabId: defaultsTabId, action: "stop" });
  await send({ type: "activate", tabId: defaultsTabId });
  assert.equal(
    (await send({ type: "popupAction", tabId: defaultsTabId, action: "state" }))
      .navigationLocked,
    false,
  );
  await navigationDefault.check();
  await options.locator("#message").filter({ hasText: "Defaults saved" }).waitFor();
  await options.waitForFunction(
    () => !document.querySelector('[data-review-default="navigationLocked"]').disabled,
  );
  await Promise.all([
    send({ type: "saveReviewPreferences", reviewDefaults: { showPins: false } }),
    send({ type: "saveReviewPreferences", reviewDefaults: { showResolved: true } }),
  ]);
  const savedDefaults = (await send({ type: "settings" })).reviewDefaults;
  assert.equal(savedDefaults.showPins, false);
  assert.equal(savedDefaults.showResolved, true);
  await send({
    type: "saveReviewPreferences",
    reviewDefaults: { showPins: true, showResolved: false },
  });
  await page.bringToFront();
  await send({ type: "popupAction", tabId: defaultsTabId, action: "stop" });
  await send({ type: "activate", tabId: defaultsTabId });
  assert.equal(
    (await send({ type: "popupAction", tabId: defaultsTabId, action: "state" }))
      .navigationLocked,
    true,
  );

  await send({
    type: "saveReviewPreferences",
    reviewDefaults: {
      navigationLocked: false,
      highlightEnabled: false,
      clickIndicators: false,
      recordingNavigationLocked: true,
      recordingHighlightEnabled: true,
      recordingClickIndicators: true,
    },
  });
  await page.bringToFront();
  await send({ type: "popupAction", tabId: defaultsTabId, action: "stop" });
  await send({ type: "activate", tabId: defaultsTabId });
  const recordingPreferenceState = async (state) => {
    await worker.evaluate(
      ({ tabId, state }) =>
        chrome.tabs.sendMessage(tabId, { type: "recordingState", state }),
      { tabId: defaultsTabId, state },
    );
    return send({ type: "popupAction", tabId: defaultsTabId, action: "state" });
  };
  // Opening the popup again must retain this review's recording defaults too.
  await send({
    type: "saveReviewPreferences",
    reviewDefaults: {
      recordingNavigationLocked: false,
      recordingHighlightEnabled: false,
    },
  });
  await send({ type: "activate", tabId: defaultsTabId });
  for (const state of ["recording", "paused"]) {
    const controls = await recordingPreferenceState(state);
    assert.equal(controls.navigationLocked, true);
    assert.equal(
      controls.highlightEnabled,
      false,
      "recording suppresses element hover highlights",
    );
    assert.equal(controls.clickIndicators, true);
  }
  const restoredPreferences = await recordingPreferenceState("idle");
  assert.equal(restoredPreferences.navigationLocked, false);
  assert.equal(restoredPreferences.highlightEnabled, false);
  assert.equal(restoredPreferences.clickIndicators, false);
  await send({
    type: "saveReviewPreferences",
    reviewDefaults: {
      navigationLocked: true,
      highlightEnabled: true,
      clickIndicators: true,
      recordingNavigationLocked: false,
      recordingHighlightEnabled: false,
      recordingClickIndicators: true,
    },
  });
  await send({ type: "popupAction", tabId: defaultsTabId, action: "stop" });
  await send({ type: "activate", tabId: defaultsTabId });
  await options.reload();
  await options.locator("#connection-status").filter({ hasText: "Connected" }).waitFor();
  assert.equal(
    await options.locator('[data-review-default="navigationLocked"]').isChecked(),
    true,
  );
  await options.locator("#defaults").scrollIntoViewIfNeeded();
  await options.screenshot({
    path: join(root, ".local/remaining-todos-qa/review-defaults-desktop.png"),
  });
  await options.evaluate(() => scrollTo(0, 0));
  await options.screenshot({
    path: join(root, ".local/remaining-todos-qa/settings.png"),
    fullPage: true,
  });
  const shortcutsOpened = context.waitForEvent("page");
  await options.locator("#customize-shortcuts").click();
  const shortcuts = await shortcutsOpened;
  await shortcuts.waitForURL("chrome://extensions/shortcuts");
  await shortcuts.close();
  const accessOpened = context.waitForEvent("page");
  await options.locator("#manage-access").click();
  const permissions = await accessOpened;
  await permissions.waitForURL(`chrome://extensions/?id=${extensionId}`);
  await permissions.close();
  await options.setViewportSize({ width: 390, height: 844 });
  await options.evaluate(() => scrollTo(0, 0));
  assert.equal(
    await options.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
  await options.screenshot({
    path: join(root, ".local/remaining-todos-qa/settings-mobile.png"),
    fullPage: true,
  });
  await options.locator("#defaults").scrollIntoViewIfNeeded();
  await options.screenshot({
    path: join(root, ".local/remaining-todos-qa/review-defaults-mobile.png"),
  });
  await options.close();
  await page.bringToFront();
}
