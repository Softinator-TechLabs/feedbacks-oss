// Recorder pages own the media stream. The worker only routes explicit controls
// from the corresponding review tab; no page-world message bridge is exposed.
export function createRecordingControls({ chrome, sessionFor }) {
  const sessions = new Map();
  const notify = (sourceTabId, state) =>
    chrome.tabs
      .sendMessage(sourceTabId, { type: "recordingState", state })
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
    const entry = { port, recorderTabId: port.sender.tab.id, reviewId, state: "idle" };
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
      if (!["idle", "recording", "paused", "ready"].includes(message.state)) return;
      const started = message.state === "recording" && entry.state === "idle";
      entry.state = message.state;
      void notify(sourceTabId, entry.state);
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
    state(sourceTabId, reviewId) {
      if (reviewId && sessions.get(sourceTabId)?.reviewId !== reviewId)
        retire(sourceTabId);
      return sessions.get(sourceTabId)?.state || "idle";
    },
  };
}
