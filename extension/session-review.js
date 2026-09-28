// Local pre-send review. Page evidence is text-only outside the isolated DOM player.
export function sourceToVideo(atMs, video) {
  if (!video?.segments?.length)
    return atMs + (video?.offsetMs || 0) >= 0 ? atMs + (video?.offsetMs || 0) : null;
  const s = video.segments.find((s) => atMs >= s.sourceStartMs && atMs <= s.sourceEndMs);
  return s ? s.outputStartMs + atMs - s.sourceStartMs : null;
}
export function videoToSource(atMs, video) {
  if (!video?.segments?.length) return Math.max(0, atMs - (video?.offsetMs || 0));
  const s = [...video.segments]
    .reverse()
    .find(
      (s) =>
        atMs >= s.outputStartMs &&
        atMs <= s.outputStartMs + s.sourceEndMs - s.sourceStartMs,
    );
  return s ? s.sourceStartMs + atMs - s.outputStartMs : null;
}
export const networkKey = (event) => event.data?.requestId || `event-${event.seq}`;
export function reviewState(events, atMs) {
  let console = [];
  const network = new Map();
  const activity = [];
  for (const e of events
    .filter((e) => e.atMs <= atMs)
    .sort((a, b) => a.atMs - b.atMs || a.seq - b.seq)) {
    if (e.type === "console") {
      if (e.data?.level === "clear") console = [];
      else console.push(e);
    }
    if (e.type === "activity") activity.push(e);
    if (e.type === "network") {
      const key = networkKey(e);
      const prior = network.get(key);
      network.set(key, {
        ...e,
        atMs: prior?.atMs ?? e.atMs,
        data: { ...prior?.data, ...e.data },
      });
    }
  }
  return { console, network: [...network.values()], activity };
}
const text = (value) =>
  typeof value === "string" ? value : (JSON.stringify(value) ?? "");
export function eventLabel(e) {
  const d = e.data || {},
    target = d.target || d;
  const name =
    target.label ||
    target.name ||
    target.id ||
    target.testId ||
    target.role ||
    target.tag ||
    "page";
  if (e.type === "activity") {
    if (d.action === "click")
      return `Click ${name} at (${d.x ?? "?"}, ${d.y ?? "?"}) · button ${d.button ?? 0}`;
    if (d.action === "input")
      return `Type in ${name}: ${d.valueMasked ? "[masked]" : d.value !== undefined ? text(d.value) : d.checked !== undefined ? (d.checked ? "checked" : "unchecked") : "[value unavailable]"}${d.valueTruncated ? " [truncated]" : ""}`;
    return `${d.action || "Activity"} ${name}`;
  }
  if (e.type === "console")
    return `${d.level || "log"}: ${text(d.args ?? d.message ?? d.text ?? d)}`;
  return `${d.method || ""} ${d.url || d.requestId || "Request"} · ${d.error ? "failed: " + text(d.error) : (d.status ?? d.phase ?? "pending")}`;
}
const resource =
  /^(?:src|srcset|href|xlink:href|poster|action|formaction|data|background|content|srcdoc)$/i;
export function safeReplay(value, key = "") {
  if (typeof value === "string")
    return resource.test(key)
      ? key.includes("href")
        ? "#"
        : "data:,"
      : value
          .replace(/(?:url\s*\([^)]*\)|@import\s+[^;]+;?)/gi, "/* unavailable */")
          .replace(
            /(?:https?:|blob:|file:|\/\/)[^\s"'<>)};]+/gi,
            "[resource unavailable]",
          );
  if (Array.isArray(value)) return value.map((v) => safeReplay(v, key));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([k]) => !/^on/i.test(k))
      .map(([k, v]) => [
        k,
        k === "tagName" && /^(script|iframe|object|embed|base|meta|link)$/i.test(v)
          ? "div"
          : safeReplay(v, k),
      ]),
  );
}
export function reviewTime(ms) {
  return `${Math.floor(ms / 60000)}:${((ms / 1000) % 60).toFixed(1).padStart(4, "0")}`;
}
export function createSessionReview(
  root,
  { recording, videoElement, video, onFrame } = {},
) {
  let at = 0,
    playing = false,
    previous = 0,
    animation,
    selected = "activity",
    disposed = false,
    allEvents = false,
    detailEvent,
    pendingSeek = null,
    selectedGap = false,
    eventPage = 0;
  const token = crypto.randomUUID();
  const make = (tag, label, cls) => {
    const n = document.createElement(tag);
    if (label) n.textContent = label;
    if (cls) n.className = cls;
    return n;
  };
  root.hidden = false;
  root.replaceChildren();
  root.classList.add("session-review");
  root.append(make("h2", "Review before sending"));
  root.append(
    make(
      "p",
      "Play or scrub the capture. Select an event to inspect its moment. Nothing is shared until you send.",
      "hint",
    ),
  );
  root.append(
    make(
      "p",
      recording.privacy?.maskInputs
        ? "Input values were masked during capture. Passwords and credentials are always removed from debug data."
        : "Ordinary typed values are included. Passwords and credentials are always removed from debug data.",
      "hint",
    ),
  );
  let frame;
  const replayStatus = make("p", "", "hint");
  if (!videoElement) {
    frame = make("iframe");
    frame.title = "Captured page replay";
    frame.className = "session-replay";
    frame.src = `session-replay.html#${token}`;
    root.append(frame, replayStatus);
    replayStatus.textContent = "Loading local DOM replay…";
  }
  const toolbar = make("div", null, "review-toolbar"),
    play = make("button", "Play"),
    range = make("input"),
    clock = make("output");
  play.type = "button";
  range.type = "range";
  range.min = "0";
  range.max = String(recording.durationMs);
  range.step = "10";
  range.value = "0";
  range.setAttribute("aria-label", "Captured context timeline");
  toolbar.append(play, range, clock);
  root.append(toolbar);
  const gap = make("p", "", "hint");
  root.append(gap);
  let saveFrameButton;
  if (videoElement && onFrame) {
    const save = make("button", "Save this frame");
    saveFrameButton = save;
    save.type = "button";
    save.onclick = () => {
      const source = videoToSource(videoElement.currentTime * 1000, video);
      if (selectedGap || pendingSeek !== null || source === null) {
        gap.textContent =
          "Seek to a retained video moment and wait for the frame before saving.";
        return;
      }
      onFrame(source, videoElement.currentTime * 1000);
    };
    toolbar.append(save);
  }
  const tabs = make("div", null, "review-tabs");
  tabs.setAttribute("role", "tablist");
  const buttons = {};
  for (const channel of ["activity", "console", "network"]) {
    const b = make("button", channel[0].toUpperCase() + channel.slice(1));
    b.type = "button";
    b.setAttribute("role", "tab");
    b.onclick = () => {
      selected = channel;
      eventPage = 0;
      detailEvent = null;
      details.hidden = true;
      render();
    };
    buttons[channel] = b;
    tabs.append(b);
  }
  root.append(tabs);
  const modeLabel = make("label", null, "review-mode"),
    mode = make("input");
  mode.type = "checkbox";
  modeLabel.append(
    mode,
    document.createTextNode(" Browse all events (including later errors)"),
  );
  root.append(modeLabel);
  mode.onchange = () => {
    allEvents = mode.checked;
    eventPage = 0;
    details.hidden = true;
    detailEvent = null;
    render();
  };
  const content = make("div", null, "review-events");
  content.setAttribute("aria-label", "Captured events");
  root.append(content);
  const details = make("pre", null, "review-detail");
  details.hidden = true;
  root.append(details);
  function replay(message) {
    frame?.contentWindow?.postMessage({ token, ...message }, "*");
  }
  function render() {
    range.value = String(at);
    clock.textContent = `${reviewTime(at)} / ${reviewTime(recording.durationMs)}`;
    const state = reviewState(recording.events, at);
    const rows =
      selected === "activity" || allEvents
        ? recording.events.filter((e) => e.type === selected)
        : state[selected];
    for (const [channel, b] of Object.entries(buttons)) {
      const count =
        channel === "activity" || allEvents
          ? recording.events.filter((e) => e.type === channel).length
          : state[channel].length;
      b.textContent = `${channel[0].toUpperCase() + channel.slice(1)} (${count})`;
      b.setAttribute("aria-selected", String(channel === selected));
    }
    content.replaceChildren();
    if (!rows.length)
      content.append(
        make(
          "p",
          selected === "activity"
            ? "No activity captured."
            : "No events at this time. Scrub forward to inspect later events.",
          "hint",
        ),
      );
    eventPage = Math.min(eventPage, Math.max(0, Math.ceil(rows.length / 200) - 1));
    for (const e of rows.slice(eventPage * 200, (eventPage + 1) * 200)) {
      const b = make("button", `${reviewTime(e.atMs)}  ${eventLabel(e)}`, "review-event");
      b.type = "button";
      b.dataset.seq = String(e.seq);
      b.dataset.future = String(e.atMs > at);
      if (e.data?.level === "error" || e.data?.error || e.data?.status >= 400)
        b.classList.add("review-error");
      b.onclick = () => {
        seek(e.atMs);
        detailEvent = e;
        render();
      };
      content.append(b);
    }
    if (detailEvent) {
      const visible =
        detailEvent.type === "network"
          ? state.network.find((e) => networkKey(e) === networkKey(detailEvent))
          : detailEvent.atMs <= at
            ? detailEvent
            : null;
      details.hidden = !visible;
      details.textContent = visible ? JSON.stringify(visible.data, null, 2) : "";
    }
    if (rows.length > 200) {
      const pagination = make("div", null, "review-toolbar"),
        prev = make("button", "Earlier events"),
        next = make("button", "Later events");
      prev.type = next.type = "button";
      prev.disabled = eventPage === 0;
      next.disabled = (eventPage + 1) * 200 >= rows.length;
      prev.onclick = () => {
        eventPage--;
        render();
      };
      next.onclick = () => {
        eventPage++;
        render();
      };
      pagination.append(
        prev,
        make(
          "span",
          `${eventPage * 200 + 1}–${Math.min(rows.length, (eventPage + 1) * 200)} of ${rows.length}`,
        ),
        next,
      );
      content.append(pagination);
    }
  }
  function seek(value, fromMedia = false) {
    at = Math.max(0, Math.min(recording.durationMs, value));
    if (videoElement && !fromMedia) {
      const ms = sourceToVideo(at, video);
      selectedGap = ms === null;
      if (saveFrameButton) saveFrameButton.disabled = selectedGap;
      if (selectedGap) {
        pause();
        pendingSeek = null;
      }
      gap.textContent =
        ms === null ? "This moment is outside the retained video intervals." : "";
      if (ms !== null && Math.abs(videoElement.currentTime * 1000 - ms) > 40) {
        pendingSeek = ms;
        videoElement.currentTime = ms / 1000;
      }
    }
    replay({ type: "seek", atMs: at });
    render();
  }
  function tick(now) {
    if (disposed || !playing) return;
    if (!videoElement && now - previous >= 100) {
      seek(at + Math.min(250, now - previous));
      previous = now;
      if (at >= recording.durationMs) pause();
    }
    animation = requestAnimationFrame(tick);
  }
  function pause() {
    playing = false;
    play.textContent = "Play";
    videoElement?.pause();
    cancelAnimationFrame(animation);
  }
  play.onclick = () => {
    if (playing) {
      pause();
      return;
    }
    if (at >= recording.durationMs) seek(0);
    playing = true;
    play.textContent = "Pause";
    if (videoElement) void videoElement.play().catch(() => pause());
    previous = performance.now();
    animation = requestAnimationFrame(tick);
  };
  range.oninput = () => {
    pause();
    seek(Number(range.value));
  };
  const onTime = () => {
    if (selectedGap) return;
    if (pendingSeek !== null) {
      if (Math.abs(videoElement.currentTime * 1000 - pendingSeek) > 100) return;
      pendingSeek = null;
    }
    const value = videoToSource(videoElement.currentTime * 1000, video);
    if (value !== null) seek(value, true);
  };
  const onPause = () => {
    playing = false;
    play.textContent = "Play";
  };
  const onPlay = () => {
    if (selectedGap) {
      selectedGap = false;
      if (saveFrameButton) saveFrameButton.disabled = false;
      gap.textContent = "";
      onTime();
    }
    playing = true;
    play.textContent = "Pause";
  };
  videoElement?.addEventListener("play", onPlay);
  videoElement?.addEventListener("seeked", onTime);
  videoElement?.addEventListener("timeupdate", onTime);
  videoElement?.addEventListener("pause", onPause);
  const receive = (e) => {
    if (e.source !== frame?.contentWindow || e.data?.token !== token) return;
    if (e.data.type === "ready")
      replay({
        type: "load",
        events: recording.events
          .filter((e) => e.type === "replay")
          .map((e) => ({
            ...e.data,
            timestamp: Date.parse(recording.startedAt) + e.atMs,
          })),
        startedAt: Date.parse(recording.startedAt),
      });
    if (e.data.type === "loaded") {
      replayStatus.textContent =
        "Local DOM reconstruction. External resources and resource-bearing styles are withheld; layout may differ. Media pixels are unavailable here; use a video recording for exact pixels.";
      seek(at);
    }
    if (e.data.type === "error")
      replayStatus.textContent = `DOM replay unavailable: ${e.data.message}`;
  };
  window.addEventListener("message", receive);
  render();
  return {
    seek,
    dispose() {
      disposed = true;
      pause();
      window.removeEventListener("message", receive);
      videoElement?.removeEventListener("play", onPlay);
      videoElement?.removeEventListener("seeked", onTime);
      videoElement?.removeEventListener("timeupdate", onTime);
      videoElement?.removeEventListener("pause", onPause);
      root.replaceChildren();
      root.hidden = true;
    },
  };
}

// Retain dispatched input and successful receipts so partial submissions retry exactly.
export async function uploadReviewFrames(
  frames,
  thread,
  recordingId,
  upload,
  refreshThread,
) {
  for (const frame of frames) {
    const inputForThread = () => ({
      threadId: thread.id,
      revision: thread.revision,
      imageBase64: frame.imageBase64,
      rendition: "screenshot",
      filename: `frame-${frame.atMs}.png`,
      recordingFrame: { recordingId, atMs: frame.atMs, videoTimeMs: frame.videoTimeMs },
      idempotencyKey: frame.key,
    });
    frame.input ||= inputForThread();
    if (!frame.result) {
      try {
        frame.result = await upload(frame.input);
      } catch (error) {
        if (error.code !== "CONFLICT" || !refreshThread) throw error;
        // An explicit pre-commit revision rejection is safe to rebase. Ambiguous
        // transport errors retain the exact dispatched input and idempotency key.
        thread = await refreshThread(thread.id);
        frame.key = crypto.randomUUID();
        frame.input = inputForThread();
        frame.result = await upload(frame.input);
      }
    }
    thread = frame.result.thread;
  }
  return thread;
}

export function videoTrimState(
  startSeconds,
  endSeconds,
  originalDuration,
  intervalCount,
) {
  const start = Math.round(startSeconds * 1000),
    end = Math.round(endSeconds * 1000);
  const appliedTrim = start > 0 || end < originalDuration ? { start, end } : null;
  return { appliedTrim, debugAligned: !appliedTrim && intervalCount <= 1 };
}
