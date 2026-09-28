// Recorder pages own the media stream. The worker only routes explicit controls
// from the corresponding review tab; no page-world message bridge is exposed.
export function createRecordingControls({ chrome, sessionFor }) {
  const sessions = new Map();
  const elapsed = (entry) =>
    Math.max(
      0,
      Math.min(
        300000,
        Math.round(
          entry.elapsedMs +
            (entry.state === "recording" ? Date.now() - entry.updatedAt : 0),
        ),
      ),
    );
  const notify = (sourceTabId, state, elapsedMs = 0) =>
    chrome.tabs
      .sendMessage(sourceTabId, {
        type: "recordingState",
        mode: "video",
        state,
        elapsedMs,
      })
      .catch(() => {});
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== "feedbacks-video" || !port.sender?.tab?.id) return;
    let url;
    try {
      url = new URL(port.sender.url);
    } catch {
      return;
    }
    const base = new URL(chrome.runtime.getURL("video.html"));
    if (
      url.protocol !== base.protocol ||
      url.host !== base.host ||
      url.pathname !== base.pathname
    )
      return;
    const sourceTabId = Number(url.searchParams.get("sourceTabId"));
    if (!Number.isSafeInteger(sourceTabId) || sourceTabId <= 0) return;
    const reviewId = url.searchParams.get("reviewId");
    if (!reviewId) return;
    const entry = {
      port,
      recorderTabId: port.sender.tab.id,
      reviewId,
      state: "idle",
      elapsedMs: 0,
      updatedAt: Date.now(),
    };
    const previous = sessions.get(sourceTabId);
    if (previous) {
      port.disconnect();
      return;
    }
    sessions.set(sourceTabId, entry);
    port.onMessage.addListener((message) => {
      if (sessions.get(sourceTabId) !== entry) return;
      if (message.state === "sent") {
        retire(sourceTabId);
        return;
      }
      if (
        !["idle", "starting", "recording", "paused", "stopping", "ready"].includes(
          message.state,
        )
      )
        return;
      const started =
        message.state === "recording" &&
        ["idle", "starting", "ready"].includes(entry.state);
      entry.elapsedMs = Number.isFinite(message.elapsedMs)
        ? Math.max(0, Math.min(300000, Math.round(message.elapsedMs)))
        : ["idle", "starting"].includes(message.state)
          ? 0
          : elapsed(entry);
      entry.updatedAt = Date.now();
      entry.state = message.state;
      void notify(sourceTabId, entry.state, elapsed(entry));
      if (started) void chrome.tabs.update(sourceTabId, { active: true }).catch(() => {});
    });
    port.onDisconnect.addListener(() => {
      if (sessions.get(sourceTabId) !== entry) return;
      sessions.delete(sourceTabId);
      void notify(sourceTabId, "idle");
    });
  });
  function retire(sourceTabId) {
    const entry = sessions.get(sourceTabId);
    if (!entry) return;
    sessions.delete(sourceTabId);
    try {
      entry.port.postMessage({ action: "stop" });
    } catch {}
    entry.port.disconnect();
    void notify(sourceTabId, "idle");
  }
  return {
    async open(sender) {
      const session = await sessionFor(sender);
      const existing = sessions.get(sender.tab.id);
      if (existing?.reviewId === session.reviewId) {
        await chrome.tabs.update(existing.recorderTabId, { active: true });
        return { state: existing.state };
      }
      retire(sender.tab.id);
      await chrome.tabs.create({
        url: chrome.runtime.getURL(
          `video.html?sourceTabId=${sender.tab.id}&reviewId=${encodeURIComponent(session.reviewId)}`,
        ),
      });
      return { state: "idle" };
    },
    async control(sender, action) {
      const session = await sessionFor(sender);
      if (!["pause", "resume", "stop"].includes(action))
        throw Error("Unknown recording control.");
      const entry = sessions.get(sender.tab.id);
      if (!entry || entry.reviewId !== session.reviewId)
        throw Error("Open the recorder to start a video.");
      entry.port.postMessage({ action });
      if (action === "stop")
        await chrome.tabs.update(entry.recorderTabId, { active: true });
      return {};
    },
    stop: retire,
    bindTarget(recorderTabId, target) {
      const entry = sessions.get(target.sourceTabId);
      if (
        !entry ||
        entry.recorderTabId !== recorderTabId ||
        entry.reviewId !== target.reviewId
      )
        throw Error("Open a new recorder from the review page.");
      entry.target ||= structuredClone(target);
      return structuredClone(entry.target);
    },
    target(recorderTabId, requested) {
      const entry = sessions.get(requested?.sourceTabId);
      if (
        !entry?.target ||
        entry.recorderTabId !== recorderTabId ||
        JSON.stringify(entry.target) !== JSON.stringify(requested)
      )
        throw Error("The recording context changed. Open a new recorder.");
      return structuredClone(entry.target);
    },
    async restore(tabId) {
      const entry = sessions.get(tabId);
      if (entry) await notify(tabId, entry.state, elapsed(entry));
    },
    state(sourceTabId, reviewId) {
      if (reviewId && sessions.get(sourceTabId)?.reviewId !== reviewId)
        retire(sourceTabId);
      return sessions.get(sourceTabId)?.state || "idle";
    },
  };
}
