import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

export async function verifySetup({ context, worker, post, access, extensionId, root }) {
  // Exercise setup before pairing, using the real background route and page bridge.
  // The temporary manifest above grants test access; native prompts are separate.
  const setupPage = await context.newPage();
  const setupLogin = await post("auth.login", {
    email: access.email,
    password: access.password,
  });
  const setupCookieSplit = setupLogin.cookie.indexOf("=");
  await context.addCookies([
    {
      name: setupLogin.cookie.slice(0, setupCookieSplit),
      value: setupLogin.cookie.slice(setupCookieSplit + 1),
      url: access.url,
    },
  ]);
  await setupPage.goto(`${access.url}/help`);
  await setupPage.getByRole("button", { name: "Set in extension", exact: true }).click();
  await setupPage
    .getByText("Open the pinned Feedbacks icon on this page to detect the server.", {
      exact: false,
    })
    .waitFor();
  const [setupTab] = await worker.evaluate(
    (url) => chrome.tabs.query({ url }),
    `${access.url}/help`,
  );
  const setupOptions = await context.newPage();
  await setupOptions.goto(`chrome-extension://${extensionId}/options.html`);
  const detect = () =>
    setupOptions.evaluate(
      (tabId) => chrome.runtime.sendMessage({ type: "detectServer", tabId }),
      setupTab.id,
    );
  assert.equal(
    (await detect()).data.status,
    "unavailable",
    "HTTP needs explicit local opt-in",
  );
  // Model a previously saved local-server opt-in; fresh HTTP setup stays manual.
  await worker.evaluate(() => chrome.storage.local.set({ allowLocal: true }));
  assert.equal((await detect()).data.status, "set");
  const initialSetup = await worker.evaluate(() => chrome.storage.local.get(null));
  assert.equal(initialSetup.server, access.url);
  assert.equal(initialSetup.serverDraft, access.url);
  assert.equal(initialSetup.pair, undefined);
  assert.equal(initialSetup.accounts, undefined);
  await setupOptions.close();
  await setupPage.bringToFront();
  const openedOptionsPromise = context.waitForEvent("page");
  await setupPage.getByRole("button", { name: "Set in extension", exact: true }).click();
  await setupPage
    .getByText("Server set. Continue in extension Settings to connect.", {
      exact: true,
    })
    .waitFor();
  const openedOptions = await openedOptionsPromise;
  await openedOptions.waitForURL(`chrome-extension://${extensionId}/options.html`);
  await openedOptions.waitForFunction(
    (server) => document.getElementById("server").value === server,
    access.url,
  );
  await openedOptions.close();
  const setupOutput = join(root, "output/playwright/server-setup");
  await mkdir(setupOutput, { recursive: true });
  for (const [name, width, height] of [
    ["desktop", 1440, 1000],
    ["mobile", 390, 844],
  ]) {
    await setupPage.setViewportSize({ width, height });
    const button = setupPage.getByRole("button", {
      name: "Set in extension",
      exact: true,
    });
    await button.focus();
    await button.scrollIntoViewIfNeeded();
    assert.equal(
      await setupPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    await setupPage.screenshot({ path: join(setupOutput, `${name}.png`) });
  }
  await worker.evaluate(() =>
    chrome.storage.local.set({
      server: "https://saved.example.test",
      serverDraft: "https://saved.example.test",
    }),
  );
  await setupPage.getByRole("button", { name: "Set in extension", exact: true }).click();
  await setupPage
    .getByText("The extension already has a server or an address in progress.", {
      exact: false,
    })
    .waitFor();
  assert.equal(
    (await worker.evaluate(() => chrome.storage.local.get("server"))).server,
    "https://saved.example.test",
  );
  await setupPage.close();
  await context.clearCookies();
  await worker.evaluate(() => chrome.storage.local.clear());
  console.log(
    "Setup detection, local opt-in, page handoff, saved-server protection and responsive layout passed.",
  );
}
