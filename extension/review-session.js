import { diagnosticCollector } from "./diagnostics.js";
// Website routing and opt-in, document-start review. No page is sent to the
// service until the user opens Feedbacks or explicitly asks to add feedback.
export function createReviewController({ get, set, authenticated, defaultServer }) {
  const U = globalThis.FeedbacksUtil;
  const scriptId = "feedbacks-instant";
  let css;
  let instantSync = Promise.resolve();
  const activations = new Map();
  function originOf(url) {
    const u = new URL(U.safeUrl(url));
    if (
      u.hostname === "chromewebstore.google.com" ||
      (u.hostname === "chrome.google.com" && u.pathname.startsWith("/webstore"))
    )
      throw Error(
        "Chrome does not allow extensions on this page. Open a website instead.",
      );
    return u.origin;
  }
  async function activate(tabId, requestedProject, instantPoint = false) {
    if (activations.has(tabId)) return activations.get(tabId);
    const work = (async () => {
      const tab = await chrome.tabs.get(tabId),
        origin = originOf(tab.url);
      const state = await get(),
        server = state.server || defaultServer;
      const { items } = await authenticated("projects.list", {}, server);
      const writable = items.filter((p) => p.permissions.canWrite);
      const exact = writable.filter((p) => p.origins.includes(origin));
      const choices = exact.length
        ? exact
        : writable.filter((p) => p.captureMode === "any");
      const selected = requestedProject || state.siteProjects?.[`${server}|${origin}`];
      const project = choices.find((p) => p.id === selected) || choices[0];
      if (!project)
        throw Error(
          "No project available. Ask your owner for access to General or this website’s project.",
        );
      // activeTab is sufficient for explicit icon/context-menu activation.
      // Persistent website access is requested separately, by a user gesture.
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["utils.js", "frame-dom.js", "content.js"],
      });
      const current = await chrome.tabs.get(tabId);
      if (current.url !== tab.url) throw Error("The page changed. Open Feedbacks again.");
      const latest = await get();
      if (
        (latest.server || defaultServer) !== server ||
        !latest.accounts?.[server]?.token
      )
        throw Error("The connection changed. Open Feedbacks again.");
      const old = latest.sessions?.[tabId];
      const reusable =
        old?.server === server && old?.origin === origin && old?.projectId === project.id;
      if (old && !reusable)
        await chrome.scripting
          .executeScript({
            target: { tabId },
            world: "MAIN",
            func: diagnosticCollector,
            args: ["stop", old.reviewId],
          })
          .catch(() => {});
      const reviewId = reusable ? old.reviewId : crypto.randomUUID();
      await set({
        projectId: project.id,
        siteProjects: { ...latest.siteProjects, [`${server}|${origin}`]: project.id },
        sessions: {
          ...latest.sessions,
          [tabId]: { server, projectId: project.id, origin, reviewId },
        },
      });
      css ||= await (await fetch(chrome.runtime.getURL("content.css"))).text();
      const result = await chrome.tabs.sendMessage(tabId, {
        type: "activate",
        reviewShortcuts: state.reviewShortcuts !== false,
        project: {
          id: project.id,
          name: project.name,
          canResolve: project.permissions.canResolve,
        },
        css,
        instantPoint,
        reviewId,
      });
      if (result?.error) throw Error(result.error);
      await chrome.action.setBadgeBackgroundColor({ tabId, color: "#23734c" });
      await chrome.action.setBadgeText({ tabId, text: "ON" });
      await chrome.action.setTitle({
        tabId,
        title: `Feedbacks · ${project.name} · right-click to comment`,
      });
      return { project, choices, origin };
    })();
    activations.set(tabId, work);
    try {
      return await work;
    } finally {
      activations.delete(tabId);
    }
  }
  function syncInstant() {
    const work = instantSync.catch(() => {}).then(applyInstant);
    instantSync = work;
    return work;
  }
  async function applyInstant() {
    // All-site permission is only a pre-grant. It must never start review on
    // right-click; opening Feedbacks remains the user's explicit start action.
    if ((await get()).instantReview) await set({ instantReview: false });
    const registered = await chrome.scripting.getRegisteredContentScripts({
      ids: [scriptId],
    });
    if (registered.length)
      await chrome.scripting.unregisterContentScripts({ ids: [scriptId] });
    const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
    await Promise.all(
      tabs.map(async (tab) => {
        try {
          await chrome.tabs.sendMessage(tab.id, {
            type: "instantEnabled",
            enabled: false,
          });
        } catch {} // Chrome-protected pages and closing tabs cannot host content scripts.
      }),
    );
    return false;
  }
  async function enableInstant(tabId) {
    if (!(await chrome.permissions.contains({ origins: ["<all_urls>"] })))
      throw Error("Allow website access in Chrome first.");
    await set({ instantReview: false });
    await syncInstant();
    return {};
  }
  async function stop(tabId) {
    const state = await get(),
      sessions = { ...state.sessions };
    await chrome.scripting
      .executeScript({
        target: { tabId },
        world: "MAIN",
        func: diagnosticCollector,
        args: ["stop", sessions[tabId]?.reviewId],
      })
      .catch(() => {});
    delete sessions[tabId];
    await set({ sessions });
    await chrome.action.setBadgeText({ tabId, text: "" }).catch(() => {});
    return {};
  }
  return { activate, syncInstant, enableInstant, stop, originOf };
}
