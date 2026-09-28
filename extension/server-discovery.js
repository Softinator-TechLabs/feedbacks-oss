// Runs in the active tab's isolated world after the user opens the extension.
// The page supplies identity only; it can never supply a different server URL.
export async function inspectFeedbacksPage() {
  try {
    const origin = location.origin;
    const response = await fetch(`${origin}/.well-known/feedbacks.json`, {
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(2000),
    });
    if (
      !response.ok ||
      !response.headers.get("content-type")?.includes("application/json")
    )
      return "";
    const identity = await response.json();
    if (identity.product !== "feedbacks" || identity.setupVersion !== 1) return "";
    if (!globalThis.__feedbacksSetupBridge) {
      globalThis.__feedbacksSetupBridge = true;
      let busy = false;
      window.addEventListener("feedbacks:set-server", async () => {
        if (busy || !navigator.userActivation.isActive) return;
        busy = true;
        let status = "unavailable";
        try {
          const result = await chrome.runtime.sendMessage({ type: "useDetectedServer" });
          if (result.ok) status = result.data.status;
        } catch {
          /* Extension may have been updated since the page opened. */
        } finally {
          busy = false;
        }
        window.dispatchEvent(
          new CustomEvent("feedbacks:server-result", { detail: status }),
        );
      });
    }
    return origin;
  } catch {
    return "";
  }
}

export async function probeFeedbacksServer(chrome, tabId) {
  try {
    const before = new URL((await chrome.tabs.get(tabId)).url);
    if (!["http:", "https:"].includes(before.protocol)) return "";
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: inspectFeedbacksPage,
    });
    const origin = results.find((result) => result.frameId === 0)?.result;
    const after = new URL((await chrome.tabs.get(tabId)).url);
    return origin === before.origin && origin === after.origin ? origin : "";
  } catch {
    return "";
  }
}

export function createServerSetup({ get, set, probe, normalize, defaultServer = "" }) {
  let queue = Promise.resolve();
  const run = (work) => {
    const result = queue.then(work);
    queue = result.catch(() => {});
    return result;
  };
  return {
    run,
    async detect(tabId) {
      const detected = await probe(tabId).catch(() => "");
      if (!detected) return { status: "unavailable" };
      return run(async () => {
        const state = await get();
        let origin;
        try {
          origin = normalize(detected, state.allowLocal === true);
        } catch {
          return { status: "unavailable" };
        }
        const server = state.server || defaultServer;
        if (server === origin && (!state.serverDraft || state.serverDraft === origin))
          return { status: "ready" };
        if (server || state.serverDraft || state.pair || state.pairIntent)
          return { status: "unchanged" };
        await set({ server: origin, serverDraft: origin });
        return { status: "set" };
      });
    },
  };
}
