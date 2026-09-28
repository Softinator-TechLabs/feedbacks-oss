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
  const result = (entry) => ({
    state: entry.state,
    elapsedMs: elapsed(entry),
    ...(Number.isFinite(entry.sourceAtMs) ? { sourceAtMs: entry.sourceAtMs } : {}),
  });
  function finishControl(entry, error) {
    const pending = entry.pending;
    if (!pending) return;
    clearTimeout(pending.timer);
    entry.pending = null;
    if (error) pending.reject(error);
    else pending.resolve(result(entry));
  }
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
      if (Number.isFinite(message.sourceAtMs))
        entry.sourceAtMs = Math.max(0, Math.min(300000, message.sourceAtMs));
      else if (["idle", "starting"].includes(message.state)) delete entry.sourceAtMs;
      entry.state = message.state;
      if (entry.state === "recording") entry.recoveringPause = false;
      if (entry.pending?.state === entry.state) finishControl(entry);
      else if (entry.pending && !["recording", "paused"].includes(entry.state))
        finishControl(entry, Error("Recording ended before the control was confirmed."));
      void notify(sourceTabId, entry.state, elapsed(entry));
      if (started) void chrome.tabs.update(sourceTabId, { active: true }).catch(() => {});
    });
    port.onDisconnect.addListener(() => {
      if (sessions.get(sourceTabId) !== entry) return;
      finishControl(
        entry,
        Error("Recorder disconnected before the control was confirmed."),
      );
      sessions.delete(sourceTabId);
      void notify(sourceTabId, "idle");
    });
  });
  function retire(sourceTabId) {
    const entry = sessions.get(sourceTabId);
    if (!entry) return;
    finishControl(
      entry,
      Error("Review ended before the recording control was confirmed."),
    );
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
      if (entry.pending) throw Error("Wait for the current recording control to finish.");
      if (action === "stop") {
        entry.port.postMessage({ action });
        await chrome.tabs.update(entry.recorderTabId, { active: true });
        return result(entry);
      }
      const desired = action === "pause" ? "paused" : "recording";
      if (entry.state === desired && !entry.recoveringPause) return result(entry);
      if (entry.recoveringPause && action !== "resume")
        throw Error("Wait for recording to recover from the unconfirmed pause.");
      if (!["recording", "paused"].includes(entry.state))
        throw Error("Start recording before using this control.");
      return new Promise((resolve, reject) => {
        entry.pending = {
          state: desired,
          resolve,
          reject,
          timer: setTimeout(() => {
            // A throttled recorder can receive Pause after this timeout. Port
            // commands are ordered, so enqueue Resume even if its last reported
            // state is still recording; otherwise that late Pause could stick.
            finishControl(
              entry,
              Error("Recorder did not confirm the control. Try again."),
            );
            if (action === "pause" && sessions.get(sender.tab.id) === entry) {
              entry.recoveringPause = true;
              try {
                entry.port.postMessage({ action: "resume" });
              } catch {}
            }
          }, 5000),
        };
        try {
          entry.port.postMessage({ action });
        } catch (error) {
          finishControl(entry, error);
        }
      });
    },
    info(sourceTabId) {
      const entry = sessions.get(sourceTabId);
      return entry ? { ...result(entry), reviewId: entry.reviewId } : null;
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
