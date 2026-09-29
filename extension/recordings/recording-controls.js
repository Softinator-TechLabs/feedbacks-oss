// Capture can run in Chrome's hidden offscreen document; only Stop opens review.
export function createRecordingControls({ chrome, sessionFor, startCapture }) {
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
  const notify = (sourceTabId, state, elapsedMs = 0, error) =>
    chrome.tabs
      .sendMessage(sourceTabId, {
        type: "recordingState",
        mode: "video",
        state,
        elapsedMs,
        ...(error ? { error } : {}),
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
    const hidden = port.name === "feedbacks-video-offscreen";
    if (!hidden && (port.name !== "feedbacks-video" || !port.sender?.tab?.id)) return;
    let url;
    try {
      url = new URL(port.sender.url);
    } catch {
      return;
    }
    const base = new URL(
      chrome.runtime.getURL(hidden ? "offscreen-video.html" : "video.html"),
    );
    if (
      url.protocol !== base.protocol ||
      url.host !== base.host ||
      url.pathname !== base.pathname
    )
      return;
    const sourceTabId = hidden ? null : Number(url.searchParams.get("sourceTabId"));
    const reviewId = hidden ? null : url.searchParams.get("reviewId");
    if (!hidden && (!Number.isSafeInteger(sourceTabId) || sourceTabId <= 0 || !reviewId))
      return;
    let entry;
    if (hidden) {
      const pending = [...sessions.values()].filter(
        (candidate) => candidate.hidden && !candidate.port && !candidate.recorderTabId,
      );
      if (pending.length !== 1) {
        port.disconnect();
        return;
      }
      entry = pending[0];
      entry.port = port;
      if (entry.startConfig) port.postMessage({ action: "start", ...entry.startConfig });
    } else {
      const previous = sessions.get(sourceTabId);
      if (
        previous?.hidden &&
        previous.state === "ready" &&
        (previous.recorderTabId === port.sender.tab.id ||
          (!previous.recorderTabId &&
            previous.draftId === url.searchParams.get("draftId"))) &&
        previous.reviewId === reviewId
      ) {
        entry = previous;
        entry.recorderTabId = port.sender.tab.id;
        entry.port = port;
        entry.hidden = false;
      } else if (previous) {
        port.disconnect();
        return;
      } else {
        entry = {
          port,
          recorderTabId: port.sender.tab.id,
          reviewId,
          state: "idle",
          elapsedMs: 0,
          updatedAt: Date.now(),
        };
        sessions.set(sourceTabId, entry);
      }
    }
    const receive = (message) => {
      const id = hidden ? message?.sourceTabId : sourceTabId;
      if (hidden && (id !== entry?.sourceTabId || message?.reviewId !== entry.reviewId))
        return;
      if (!entry) return;
      if (sessions.get(id) !== entry || entry.port !== port) return;
      if (message.state === "sent") {
        retire(id);
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
      void notify(id, entry.state, elapsed(entry), message.error);
      if (started && !hidden)
        void chrome.tabs.update(id, { active: true }).catch(() => {});
      if (hidden && entry.state === "ready" && message.draftId && !entry.recorderTabId) {
        entry.draftId = message.draftId;
        void chrome.tabs
          .create({
            url: chrome.runtime.getURL(
              `video.html?sourceTabId=${id}&reviewId=${encodeURIComponent(entry.reviewId)}&draftId=${encodeURIComponent(message.draftId)}`,
            ),
            active: true,
          })
          .then((tab) => {
            if (sessions.get(id) === entry) entry.recorderTabId = tab.id;
          })
          .catch(() => {});
      }
    };
    port.onMessage.addListener(receive);
    port.onDisconnect.addListener(() => {
      if (!entry) return;
      const id = hidden ? entry.sourceTabId : sourceTabId;
      if (sessions.get(id) !== entry || entry.port !== port) return;
      if (hidden && entry.state === "ready") {
        entry.port = null;
        return;
      }
      finishControl(
        entry,
        Error("Recorder disconnected before the control was confirmed."),
      );
      sessions.delete(id);
      void notify(id, "idle");
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
      entry.port?.postMessage({ action: "stop" });
    } catch {}
    entry.port?.disconnect();
    void notify(sourceTabId, "idle");
  }
  return {
    async open(sender) {
      const session = await sessionFor(sender);
      const existing = sessions.get(sender.tab.id);
      if (existing?.reviewId === session.reviewId && existing.state !== "idle") {
        if (existing.recorderTabId)
          await chrome.tabs.update(existing.recorderTabId, { active: true });
        else if (existing.state === "ready" && existing.draftId) {
          const tab = await chrome.tabs.create({
            url: chrome.runtime.getURL(
              `video.html?sourceTabId=${sender.tab.id}&reviewId=${encodeURIComponent(session.reviewId)}&draftId=${encodeURIComponent(existing.draftId)}`,
            ),
            active: true,
          });
          existing.recorderTabId = tab.id;
        }
        return { state: existing.state };
      }
      if (
        startCapture &&
        [...sessions.entries()].some(
          ([tabId, item]) =>
            tabId !== sender.tab.id &&
            (item.state === "ready" ||
              (item.hidden &&
                ["starting", "recording", "paused", "stopping"].includes(item.state))),
        )
      )
        throw Error(
          "Review or discard the current tab recording before starting another.",
        );
      retire(sender.tab.id);
      if (startCapture) {
        const entry = {
          port: null,
          recorderTabId: null,
          sourceTabId: sender.tab.id,
          reviewId: session.reviewId,
          hidden: true,
          state: "starting",
          elapsedMs: 0,
          updatedAt: Date.now(),
        };
        sessions.set(sender.tab.id, entry);
        try {
          entry.startConfig = await startCapture(sender, session);
          if (entry.port && entry.startConfig)
            entry.port.postMessage({ action: "start", ...entry.startConfig });
        } catch (error) {
          if (sessions.get(sender.tab.id) === entry) retire(sender.tab.id);
          throw error;
        }
        return { state: "starting" };
      }
      await chrome.tabs.create({
        url: chrome.runtime.getURL(
          `video.html?sourceTabId=${sender.tab.id}&reviewId=${encodeURIComponent(session.reviewId)}&autoStart=1`,
        ),
        active: false,
      });
      return { state: "starting" };
    },
    async control(sender, action) {
      const session = await sessionFor(sender);
      if (!["pause", "resume", "stop"].includes(action))
        throw Error("Unknown recording control.");
      const entry = sessions.get(sender.tab.id);
      if (!entry || entry.reviewId !== session.reviewId)
        throw Error("Open the recorder to start a video.");
      if (!entry.port) throw Error("Wait for the recorder to become ready.");
      if (entry.pending) throw Error("Wait for the current recording control to finish.");
      if (action === "stop") {
        entry.port.postMessage({ action });
        if (!entry.hidden)
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
    reviewOwner(reviewTabId, sourceTabId, reviewId) {
      const entry = sessions.get(sourceTabId);
      if (!entry || entry.recorderTabId !== reviewTabId || entry.reviewId !== reviewId)
        throw Error("The video review belongs to another recording.");
      return sourceTabId;
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
