import assert from "node:assert/strict";
import { join } from "node:path";

export async function verifySharedPins({
  page,
  worker,
  id,
  send,
  results,
  root,
  post,
  auth,
  access,
  inlineThreadId,
  inlineThread,
  paired,
}) {
  const hoverComments = ["Make this heading **clearer**", "Repair this link"];
  const inspectPin = (body) =>
    worker.evaluate(
      async ({ tabId, body }) => {
        const [result] = await chrome.scripting.executeScript({
          target: { tabId },
          func: (body) => {
            const root = globalThis.__feedbacksQaRoot;
            const pin = [...(root?.querySelectorAll("button.pin") || [])].find((item) =>
              item.getAttribute("aria-label")?.includes(body),
            );
            if (!pin) return null;
            const rect = pin.getBoundingClientRect();
            return {
              x: rect.x + rect.width / 2,
              y: rect.y + rect.height / 2,
              preview: root.querySelector(".preview")?.textContent,
              link: root.querySelector(".preview a")?.getAttribute("href"),
              resolve: !!root.querySelector(".preview button.resolve-thread"),
              visible: getComputedStyle(pin).visibility !== "hidden",
            };
          },
          args: [body],
        });
        return result.result;
      },
      { tabId: id, body },
    );
  for (const comment of hoverComments) {
    let point;
    for (let attempt = 0; attempt < 30; attempt++) {
      point = await inspectPin(comment);
      if (point) break;
      await page.waitForTimeout(200);
    }
    assert.ok(point, `Saved point is not visible on its element: ${comment}`);
    await page.mouse.move(point.x, point.y);
    const hovered = await inspectPin(comment);
    assert.ok(hovered?.preview?.includes(comment));
    assert.match(hovered.preview, /just now|ago/);
    assert.equal(hovered.link, `${access.url}/threads/${inlineThreadId}`);
    assert.equal(hovered.resolve, true);
  }
  const firstPoint = await inspectPin(hoverComments[0]);
  await page.evaluate(({ x, y }) => {
    const menu = document.createElement("div");
    menu.id = "qa-covering-menu";
    menu.style.cssText = `position:fixed;left:${x - 40}px;top:${y - 40}px;width:80px;height:80px;background:white;z-index:1000`;
    document.body.append(menu);
  }, firstPoint);
  await page.mouse.move(firstPoint.x + 1, firstPoint.y + 1);
  // MutationObserver and the paint/occlusion frames may span more than 50 ms
  // on a busy CI browser. Wait for the actual state, not one assumed frame.
  for (let attempt = 0; attempt < 20; attempt++) {
    if ((await inspectPin(hoverComments[0]))?.visible === false) break;
    await page.waitForTimeout(50);
  }
  assert.equal((await inspectPin(hoverComments[0]))?.visible, false);
  await page.locator("#qa-covering-menu").evaluate((menu) => menu.remove());
  await page.mouse.move(firstPoint.x + 2, firstPoint.y + 2);
  for (let attempt = 0; attempt < 20; attempt++) {
    if ((await inspectPin(hoverComments[0]))?.visible === true) break;
    await page.waitForTimeout(50);
  }
  assert.equal((await inspectPin(hoverComments[0]))?.visible, true);
  await page.mouse.move(800, 400);
  await page.waitForTimeout(200);
  await page.mouse.move(firstPoint.x, firstPoint.y);
  for (let attempt = 0; attempt < 20; attempt++) {
    if ((await inspectPin(hoverComments[0]))?.resolve) break;
    await page.waitForTimeout(50);
  }
  await page.screenshot({
    path: join(root, ".local/remaining-todos-qa/inline-comment-hover.png"),
  });
  const resolveClick = await worker.evaluate(async (tabId) => {
    const [entry] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const control = globalThis.__feedbacksQaRoot.querySelector(
          ".preview button.resolve-thread",
        );
        const before = {
          found: !!control,
          disabled: control?.disabled,
          action: typeof control?.onclick,
        };
        control?.click();
        return before;
      },
    });
    return entry.result;
  }, id);
  assert.equal(resolveClick.found, true);
  assert.equal(resolveClick.disabled, false);
  for (let attempt = 0; attempt < 30; attempt++) {
    const current = (await post("threads.get", { threadId: inlineThreadId }, auth)).data;
    if (
      current.annotationStates?.[inlineThread.context.annotations[0].id]?.state ===
      "resolved"
    )
      break;
    await page.waitForTimeout(100);
  }
  assert.equal(
    (await post("threads.get", { threadId: inlineThreadId }, auth)).data.annotationStates[
      inlineThread.context.annotations[0].id
    ].state,
    "resolved",
  );
  assert.equal(
    (await post("threads.get", { threadId: inlineThreadId }, auth)).data.work.state,
    "open",
    "Resolving one pin must leave the thread and other points open",
  );
  const overview = await send({ type: "pageOverview", tabId: id, scope: "page" });
  assert.ok(overview.summary.points.resolved >= 1);
  assert.equal(new URL(overview.url).searchParams.get("url"), page.url());
  assert.equal(new URL(overview.url).pathname, `/projects/${inlineThread.projectId}`);
  const teammate = (
    await post(
      "members.create",
      {
        name: "Team reviewer",
        email: "reviewer@example.test",
        password: "Synthetic-Reviewer-Pass-123",
        grants: [{ projectId: inlineThread.projectId, role: "reviewer" }],
      },
      auth,
    )
  ).data;
  assert.ok(teammate.id);
  const teammateLogin = await post("auth.login", {
    email: "reviewer@example.test",
    password: "Synthetic-Reviewer-Pass-123",
  });
  const teammateAuth = {
    cookie: teammateLogin.cookie,
    csrf: teammateLogin.data.csrf,
  };
  const teammatePairing = (await post("pairing.request", { name: "Team browser" })).data;
  await post("pairing.approve", { pairingId: teammatePairing.pairingId }, teammateAuth);
  const teammateToken = (
    await post("pairing.poll", {
      pairingId: teammatePairing.pairingId,
      deviceSecret: teammatePairing.deviceSecret,
    })
  ).data.token;
  await send({ type: "popupAction", tabId: id, action: "stop" });
  await worker.evaluate(
    ({ server, token }) =>
      chrome.storage.local.set({
        accounts: { [server]: { token } },
      }),
    { server: access.url, token: teammateToken },
  );
  await send({ type: "activate", tabId: id });
  await send({ type: "popupAction", tabId: id, action: "resolved" });
  let teammatePin;
  for (let attempt = 0; attempt < 30; attempt++) {
    teammatePin = await inspectPin(hoverComments[0]);
    if (teammatePin?.visible) break;
    await page.waitForTimeout(100);
  }
  assert.ok(teammatePin?.visible, "A teammate should see the published point");
  await page.mouse.move(teammatePin.x, teammatePin.y);
  for (let attempt = 0; attempt < 30; attempt++) {
    teammatePin = await inspectPin(hoverComments[0]);
    if (teammatePin?.link) break;
    await page.waitForTimeout(100);
  }
  assert.equal(teammatePin?.resolve, false);
  assert.equal(teammatePin?.link, `${access.url}/threads/${inlineThreadId}`);
  results.inlineReview.teammateCanRead = true;
  await page.setViewportSize({ width: 390, height: 650 });
  await page.waitForTimeout(200);
  const publishedMobile = await inspectPin(hoverComments[0]);
  assert.ok(
    publishedMobile?.visible,
    "A uniquely matched shared pin follows its element across screen sizes",
  );
  assert.ok(publishedMobile.x < 390);
  results.inlineReview.sharedResponsive = true;
  await page.setViewportSize({ width: 900, height: 650 });
  await send({ type: "popupAction", tabId: id, action: "stop" });
  await worker.evaluate(
    ({ server, token }) =>
      chrome.storage.local.set({
        accounts: { [server]: { token } },
      }),
    { server: access.url, token: paired.token },
  );
  results.inlineReview.hoverComments = hoverComments;

  return teammateAuth;
}
