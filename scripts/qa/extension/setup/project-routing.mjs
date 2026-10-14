import assert from "node:assert/strict";

export async function verifyProjectRouting({
  context,
  page,
  control,
  worker,
  post,
  auth,
  access,
  results,
  toFixture,
}) {
  const origin = "https://new-project.example.test";
  const project = (
    await post(
      "projects.create",
      { name: "New website project", origins: [origin] },
      auth,
    )
  ).data;
  await context.route(`${origin}/**`, (route) =>
    route.fulfill({ contentType: "text/html", body: "<h1>New website</h1>" }),
  );
  await page.bringToFront();
  await page.goto(origin);
  await control.reload();
  await control.locator("#review-controls:visible").waitFor();
  await control.locator("#routing-hint:visible").waitFor();
  assert.match(
    await control.locator("#routing-hint").innerText(),
    /reconnect in Settings/,
  );
  assert.doesNotMatch(
    await control.locator("#routing").innerText(),
    /New website project/,
  );

  // The old pairing must retain its original project snapshot. Only a newly
  // approved connection in this disposable sandbox receives the added project.
  const previousAccounts = await worker.evaluate(
    async () => (await chrome.storage.local.get("accounts")).accounts,
  );
  const request = (await post("pairing.request", { name: "Synthetic project refresh" }))
    .data;
  await post("pairing.approve", { pairingId: request.pairingId }, auth);
  const paired = (
    await post("pairing.poll", {
      pairingId: request.pairingId,
      deviceSecret: request.deviceSecret,
    })
  ).data;
  assert.equal(paired.status, "approved");
  try {
    await worker.evaluate(
      ({ server, token }) =>
        chrome.storage.local.set({ accounts: { [server]: { token } } }),
      { server: access.url, token: paired.token },
    );
    await control.reload();
    await control
      .locator("#routing")
      .filter({ hasText: "Reviewing New website project" })
      .waitFor();
    assert.equal(await control.locator("#routing-hint").isVisible(), false);
    assert.equal(await control.locator("#project").inputValue(), project.id);
  } finally {
    await worker.evaluate(
      (accounts) => chrome.storage.local.set({ accounts }),
      previousAccounts,
    );
    await toFixture();
    await control.reload();
    await control.locator("#review-controls:visible").waitFor();
  }
  assert.equal(await control.locator("#routing-hint").isVisible(), false);
  results.projectRouting = {
    staleConnectionHint: true,
    approvedReconnectMatchesOrigin: true,
  };
}
