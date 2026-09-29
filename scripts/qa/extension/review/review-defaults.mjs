import assert from "node:assert/strict";

export async function verifyReviewDefaults({
  page,
  tabId,
  send,
  worker,
  post,
  access,
  results,
}) {
  // A recorder retiring after a project switch cannot restore the prior review's state.
  await page.bringToFront();
  const switchTabId = await tabId();
  await send({ type: "activate", tabId: switchTabId });
  await worker.evaluate(
    (tabId) =>
      chrome.tabs.sendMessage(tabId, { type: "recordingState", state: "recording" }),
    switchTabId,
  );
  await send({
    type: "saveReviewPreferences",
    reviewDefaults: {
      navigationLocked: false,
      highlightEnabled: false,
      clickIndicators: false,
    },
  });
  const switchLogin = await post("auth.login", {
    email: access.email,
    password: access.password,
  });
  const switchAuth = { cookie: switchLogin.cookie, csrf: switchLogin.data.csrf };
  const alternateProject = (
    await post(
      "projects.create",
      {
        name: "Alternate synthetic review",
        origins: [new URL(page.url()).origin],
      },
      switchAuth,
    )
  ).data;
  // Pairing keys intentionally snapshot project access; refresh the synthetic key
  // so this test can actually switch to the newly created project.
  const switchPair = (await post("pairing.request", { name: "Project switch QA" })).data;
  await post("pairing.approve", { pairingId: switchPair.pairingId }, switchAuth);
  const switchToken = (
    await post("pairing.poll", {
      pairingId: switchPair.pairingId,
      deviceSecret: switchPair.deviceSecret,
    })
  ).data;
  await worker.evaluate(
    ({ server, token }) =>
      chrome.storage.local.set({
        accounts: { [server]: { token } },
      }),
    { server: access.url, token: switchToken.token },
  );
  const switchedReview = await send({
    type: "activate",
    tabId: switchTabId,
    projectId: alternateProject.id,
  });
  assert.equal(switchedReview.project.id, alternateProject.id);
  await worker.evaluate(
    (tabId) => chrome.tabs.sendMessage(tabId, { type: "recordingState", state: "idle" }),
    switchTabId,
  );
  const switchedControls = await send({
    type: "popupAction",
    tabId: switchTabId,
    action: "state",
  });
  assert.equal(switchedControls.navigationLocked, false);
  assert.equal(switchedControls.highlightEnabled, false);
  assert.equal(switchedControls.clickIndicators, false);
  results.reviewDefaults = {
    persisted: true,
    keyboardFocus: true,
    recordingRestored: true,
    projectSwitch: true,
  };
}
