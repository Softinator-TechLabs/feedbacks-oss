import assert from "node:assert/strict";

export async function verifyCaptureSafety({
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
  inspectReview,
}) {
  await page.bringToFront();
  await send({ type: "popupAction", tabId: id, action: "stop" });
  fixture.mode = "hover";
  await toFixture();
  await exposeReviewRoot();
  // Canceled captures must never restore UI over a newer point's pixels.
  await send({ type: "activate", tabId: id });
  await worker.evaluate(async (tabId) => {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const send = chrome.runtime.sendMessage.bind(chrome.runtime);
        chrome.runtime.sendMessage = async (message, ...rest) => {
          if (message.type !== "freezeView") return send(message, ...rest);
          globalThis.__captureToken = message.key;
          const result = await new Promise((resolve) => {
            globalThis.__captureFailures ??= new Map();
            globalThis.__captureFailures.set(message.key, resolve);
          });
          globalThis.__captureSettled ??= new Set();
          globalThis.__captureSettled.add(message.key);
          return result;
        };
      },
    });
  }, id);
  const selectedToken = () =>
    worker.evaluate(
      async (tabId) =>
        (
          await chrome.scripting.executeScript({
            target: { tabId },
            func: () => globalThis.__captureToken,
          })
        )[0].result,
      id,
    );
  const waitCaptureToken = async (previous = null) => {
    for (let attempt = 0; attempt < 50; attempt++) {
      const token = await selectedToken();
      if (token && token !== previous) return token;
      await page.waitForTimeout(50);
    }
    throw Error("Point capture did not start");
  };
  const failPointCapture = (token) =>
    worker.evaluate(
      async ({ tabId, token }) => {
        const [entry] = await chrome.scripting.executeScript({
          target: { tabId },
          func: (token) => {
            const resolve = globalThis.__captureFailures?.get(token);
            if (!resolve) return false;
            globalThis.__captureFailures.delete(token);
            resolve({ ok: false, error: "Synthetic capture failure" });
            return true;
          },
          args: [token],
        });
        return entry.result;
      },
      { tabId: id, token },
    );
  const waitCaptureSettled = async (token) => {
    for (let attempt = 0; attempt < 50; attempt++) {
      const settled = await worker.evaluate(
        async ({ tabId, token }) => {
          const [entry] = await chrome.scripting.executeScript({
            target: { tabId },
            func: (token) => globalThis.__captureSettled?.has(token) || false,
            args: [token],
          });
          return entry.result;
        },
        { tabId: id, token },
      );
      if (settled) return;
      await page.waitForTimeout(50);
    }
    throw Error("Canceled point capture did not settle");
  };
  const cancelPoint = () =>
    worker.evaluate(async (tabId) => {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          [...globalThis.__feedbacksQaRoot.querySelectorAll(".point-menu button")]
            .find((b) => b.textContent === "Cancel")
            .click();
        },
      });
    }, id);
  await page.getByRole("heading", { name: "Controlled page" }).click({ button: "right" });
  await waitReview((state) => state.ready);
  const oldToken = await waitCaptureToken();
  await worker.evaluate(
    async ({ id, token }) =>
      chrome.tabs.sendMessage(id, { type: "preparePointImage", pointToken: token }),
    { id, token: oldToken },
  );
  await cancelPoint();
  await page.getByRole("heading", { name: "Controlled page" }).click({ button: "right" });
  await waitReview((state) => state.ready);
  const currentToken = await waitCaptureToken(oldToken);
  assert.notEqual(oldToken, currentToken);
  await worker.evaluate(
    async ({ id, currentToken }) =>
      chrome.tabs.sendMessage(id, {
        type: "preparePointImage",
        pointToken: currentToken,
      }),
    { id, currentToken },
  );
  assert.equal(await failPointCapture(oldToken), true);
  await waitCaptureSettled(oldToken);
  assert.doesNotMatch((await inspectReview()).tip, /Synthetic capture failure/);
  const retainedHidden = await worker.evaluate(
    async ({ id, oldToken, currentToken }) => {
      await chrome.tabs.sendMessage(id, {
        type: "pointImageCaptured",
        pointToken: oldToken,
      });
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: id },
        func: () => globalThis.__feedbacksQaRoot.host.style.opacity,
      });
      await chrome.tabs.sendMessage(id, {
        type: "pointImageCaptured",
        pointToken: currentToken,
      });
      return result;
    },
    { id, oldToken, currentToken },
  );
  assert.equal(retainedHidden, "0");
  await page.keyboard.type("Keep my comment after image failure");
  assert.equal(await failPointCapture(currentToken), true);
  await waitReview((state) => state.tip.includes("Synthetic capture failure"));
  await worker.evaluate(async (tabId) => {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        [...globalThis.__feedbacksQaRoot.querySelectorAll(".point-menu button")]
          .find((b) => b.textContent === "Save point")
          .click();
      },
    });
  }, id);
  await waitReview((state) => state.points === 1);
  const failedDraft = await worker.evaluate(
    async (tabId) =>
      (
        await chrome.scripting.executeScript({
          target: { tabId },
          func: () =>
            globalThis.__feedbacksQaRoot.querySelector(".draft-section").textContent,
        })
      )[0].result,
    id,
  );
  assert.match(failedDraft, /Keep my comment after image failure/);
  assert.match(failedDraft, /No original image/);
  results.captureFailure = { textRetained: true, canceledCaptureCannotRevealNewUI: true };
  await send({ type: "popupAction", tabId: id, action: "stop" });
  await toFixture();
  await exposeReviewRoot();
  await send({ type: "enableInstant", tabId: id });
  await page.locator("#hover-host").hover();
  await page.locator("#hover-menu").click({ button: "right" });
  const autoStarted = await worker.evaluate(async (tabId) => {
    const [entry] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () =>
        Boolean(globalThis.feedbacksReviewActive || globalThis.__feedbacksInstantRoot),
    });
    return entry.result;
  }, id);
  assert.equal(
    autoStarted,
    false,
    "All-site access must not start review on right-click",
  );
  results.allSitePregrant = { autoStarted };
  await send({ type: "disableInstant" });
}
