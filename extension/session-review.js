import {
  sourceToVideo,
  videoToSource,
  networkKey,
  reviewState,
  eventLabel,
  reviewTime,
} from "./session/review-model.js";
export {
  sourceToVideo,
  videoToSource,
  networkKey,
  reviewState,
  eventLabel,
  safeReplay,
  reviewTime,
} from "./session/review-model.js";
export {
  uploadReviewFrames,
  mapAnnotationFrames,
  videoTrimState,
} from "./session/review-frames.js";

export function createSessionReview(
  root,
  {
    recording,
    videoElement,
    video,
    onFrame,
    annotations = [],
    timelineStartMs = 0,
    timelineDurationMs,
  } = {},
) {
  let at = 0,
    playing = false,
    previous = 0,
    animation,
    selected = "everything",
    disposed = false,
    allEvents = true,
    detailEvent,
    pendingSeek = null,
    selectedGap = false,
    eventPage = 0,
    focusedSeq = null,
    followPlayback = true,
    lastAutoScrollSeq = null,
    annotationDialog;
  const token = crypto.randomUUID();
  const channels = ["activity", "console", "network", "performance"];
  const allCaptureEvents = recording.events
    .filter((event) => channels.includes(event.type))
    .sort((a, b) => a.atMs - b.atMs || a.seq - b.seq);
  const environmentEvent = {
    seq: -1,
    atMs: 0,
    type: "environment",
    data: recording.environment,
  };
  const everythingEvents = [environmentEvent, ...allCaptureEvents];
  const byChannel = Object.fromEntries(
    channels.map((channel) => [
      channel,
      allCaptureEvents.filter((event) => event.type === channel),
    ]),
  );
  const make = (tag, label, cls) => {
    const n = document.createElement(tag);
    if (label) n.textContent = label;
    if (cls) n.className = cls;
    return n;
  };
  function openAnnotation(annotation) {
    if (disposed) return;
    pause();
    annotationDialog?.close();
    annotationDialog?.remove();
    const dialog = make("dialog", null, "review-annotation-dialog"),
      title = make("h3", `Screenshot comment at ${reviewTime(annotation.atMs)}`),
      close = make("button", "Close screenshot"),
      img = make("img"),
      body = make("p", annotation.body);
    dialog.setAttribute("aria-label", title.textContent);
    close.type = "button";
    close.autofocus = true;
    close.onclick = () => dialog.close();
    img.src = annotation.imageBase64;
    img.alt = `Captured screenshot at ${reviewTime(annotation.atMs)}`;
    dialog.append(title, close, img, body);
    dialog.addEventListener(
      "close",
      () => {
        dialog.remove();
        if (annotationDialog === dialog) annotationDialog = null;
      },
      { once: true },
    );
    document.body.append(dialog);
    annotationDialog = dialog;
    dialog.showModal();
  }
  root.hidden = false;
  root.replaceChildren();
  root.classList.add("session-review");
  root.setAttribute("role", "region");
  root.setAttribute("aria-label", "Recorded moments");
  const guide = make("details", null, "review-guide");
  guide.append(make("summary", "About this capture"));
  guide.append(
    make(
      "p",
      "Play or scrub the capture. Select an event to inspect its moment. Nothing is shared until you send.",
      "hint",
    ),
  );
  guide.append(
    make(
      "p",
      recording.privacy?.maskInputs
        ? "Input values were masked during capture. Passwords and credentials are always removed from debug data."
        : "Ordinary typed values are included. Passwords and credentials are always removed from debug data.",
      "hint",
    ),
  );
  let coverage;
  if (recording.coverage?.length) {
    coverage = make("details", null, "review-coverage");
    const gaps = recording.coverage.filter((c) => c.status !== "complete");
    coverage.append(
      make(
        "summary",
        `Capture coverage${gaps.length ? ` · ${gaps.length} limitations` : ""}`,
      ),
    );
    for (const c of recording.coverage)
      coverage.append(
        make("p", `${c.channel}: ${c.status}${c.detail ? ` — ${c.detail}` : ""}`, "hint"),
      );
  }
  let frame, timelineStrip, timelinePlayhead;
  let videoDurationMs = recording.durationMs;
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
  const editTimeline = videoElement ? document.querySelector("#editing .timeline") : null;
  play.type = "button";
  range.type = "range";
  range.min = "0";
  range.max = String(recording.durationMs);
  range.step = "10";
  range.value = "0";
  range.setAttribute(
    "aria-label",
    videoElement ? "Video and event timeline" : "Captured context timeline",
  );
  toolbar.append(play, range, clock);
  if (!editTimeline) root.append(toolbar);
  if (videoElement) {
    const strip = make("div", null, "review-timeline-events");
    timelineStrip = strip;
    strip.setAttribute("aria-label", "Events on the video timeline");
    videoDurationMs =
      timelineDurationMs ||
      (video?.segments?.length
        ? Math.max(
            ...video.segments.map(
              (segment) =>
                segment.outputStartMs + segment.sourceEndMs - segment.sourceStartMs,
            ),
          )
        : Number.isFinite(videoElement.duration)
          ? videoElement.duration * 1000
          : recording.durationMs);
    const grouped = new Map();
    for (const event of allCaptureEvents) {
      const videoAtMs = sourceToVideo(event.atMs, video);
      if (videoAtMs === null) continue;
      const position = Math.min(
        200,
        Math.max(
          0,
          Math.round(
            ((videoAtMs + timelineStartMs) / Math.max(1, videoDurationMs)) * 200,
          ),
        ),
      );
      const key = `${event.type}:${position}`;
      const group = grouped.get(key);
      if (group) {
        group.count++;
        if (event.data?.level === "error" || event.data?.status >= 400)
          group.error = true;
      } else
        grouped.set(key, {
          event,
          position,
          count: 1,
          error: event.data?.level === "error" || event.data?.status >= 400,
        });
    }
    for (const { event, position, count, error } of grouped.values()) {
      const mark = make("button", null, "review-timeline-mark");
      const kind =
        event.type === "activity"
          ? event.data?.action === "click"
            ? "Click"
            : event.data?.action === "input"
              ? "Typing"
              : "Activity"
          : event.type === "console"
            ? `Console ${event.data?.level === "warn" ? "warning" : event.data?.level || "log"}`
            : event.type === "performance"
              ? "Performance"
              : error
                ? "Network failure"
                : "Network";
      mark.type = "button";
      mark.setAttribute(
        "aria-label",
        `${kind} at ${reviewTime(event.atMs)}${count > 1 ? `, ${count} events` : ""}`,
      );
      mark.title = `${kind} · ${reviewTime(event.atMs)} · ${eventLabel(event)}${count > 1 ? ` · ${count} events` : ""}`;
      const tooltip = make("span", mark.title, "review-mark-tooltip");
      tooltip.setAttribute("role", "tooltip");
      mark.append(tooltip);
      mark.dataset.channel = event.type;
      mark.dataset.error = String(error);
      mark.style.left = `${position / 2}%`;
      mark.onclick = () => {
        pause();
        selected = event.type;
        allEvents = true;
        mode.checked = true;
        detailEvent = event;
        focusedSeq = event.seq;
        lastAutoScrollSeq = null;
        eventPage = Math.floor(
          byChannel[event.type].findIndex((item) => item.seq === event.seq) / 200,
        );
        seek(event.atMs);
      };
      strip.append(mark);
    }
    if (editTimeline) {
      const lane = editTimeline.querySelector(".timeline-rail");
      lane.append(strip);
      timelinePlayhead = make("div", null, "review-timeline-playhead");
      timelinePlayhead.setAttribute("aria-hidden", "true");
      lane.append(timelinePlayhead);
    } else root.append(strip);
  }
  const gap = make("p", "", "hint");
  gap.hidden = true;
  root.append(gap);
  if (annotations.length) {
    const notes = make("section", null, "review-annotations");
    notes.setAttribute("aria-label", "Screenshot comments");
    notes.append(make("h3", `Screenshot comments (${annotations.length})`));
    for (const annotation of annotations) {
      const card = make("article", null, "review-annotation"),
        jump = make("button"),
        img = make("img"),
        content = make("div"),
        moment = make("button", `Jump to ${reviewTime(annotation.atMs)}`);
      jump.type = moment.type = "button";
      jump.setAttribute("aria-label", `View comment at ${reviewTime(annotation.atMs)}`);
      img.src = annotation.imageBase64;
      img.alt = `Screenshot for comment at ${reviewTime(annotation.atMs)}`;
      img.loading = "lazy";
      jump.append(img);
      content.append(make("p", annotation.body), moment);
      jump.onclick = () => openAnnotation(annotation);
      moment.onclick = () => {
        pause();
        seek(annotation.atMs);
      };
      card.append(jump, content);
      notes.append(card);
    }
    // Screenshot comments stay below the playback diagnostics.
    var annotationNotes = notes;
  }
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
        gap.hidden = false;
        return;
      }
      onFrame(source, videoElement.currentTime * 1000);
    };
    var frameAction = save;
  }
  const tabs = make("div", null, "review-tabs");
  tabs.setAttribute("role", "tablist");
  const buttons = {};
  for (const channel of ["everything", ...channels, "environment"]) {
    const b = make("button", channel[0].toUpperCase() + channel.slice(1));
    b.type = "button";
    b.setAttribute("role", "tab");
    b.onclick = () => {
      selected = channel;
      eventPage = 0;
      focusedSeq = null;
      lastAutoScrollSeq = null;
      detailEvent = null;
      details.hidden = true;
      details.open = false;
      render();
    };
    buttons[channel] = b;
    tabs.append(b);
  }
  root.append(tabs);
  const follow = make("button", "Following playback", "review-follow");
  follow.type = "button";
  follow.setAttribute("aria-pressed", "true");
  follow.onclick = () => {
    followPlayback = !followPlayback;
    follow.setAttribute("aria-pressed", String(followPlayback));
    follow.textContent = followPlayback ? "Following playback" : "Follow playback";
    if (followPlayback) {
      selected = "everything";
      focusedSeq = null;
      lastAutoScrollSeq = null;
      render();
    }
  };
  root.append(follow);
  const modeLabel = make("label", null, "review-mode"),
    mode = make("input");
  mode.type = "checkbox";
  mode.checked = allEvents;
  modeLabel.append(
    mode,
    document.createTextNode(" Browse all events (including later errors)"),
  );
  root.append(modeLabel);
  mode.onchange = () => {
    allEvents = mode.checked;
    eventPage = 0;
    details.hidden = true;
    details.open = false;
    detailEvent = null;
    render();
  };
  const content = make("div", null, "review-events");
  content.setAttribute("aria-label", "Captured events");
  root.append(content);
  const details = make("details", null, "review-detail");
  const detailSummary = make("summary", "Technical details");
  const detailBody = make("pre");
  details.append(detailSummary, detailBody);
  details.hidden = true;
  root.append(details);
  if (frameAction) root.append(frameAction);
  if (annotationNotes) root.append(annotationNotes);
  root.append(guide);
  if (coverage) root.append(coverage);
  function replay(message) {
    frame?.contentWindow?.postMessage({ token, ...message }, "*");
  }
  function render() {
    range.value = String(at);
    clock.textContent = `${reviewTime(at)} / ${reviewTime(recording.durationMs)}`;
    if (timelinePlayhead) {
      const videoAt = sourceToVideo(at, video);
      timelinePlayhead.hidden = videoAt === null;
      if (videoAt !== null)
        timelinePlayhead.style.left = `${Math.max(0, Math.min(100, ((videoAt + timelineStartMs) / Math.max(1, videoDurationMs)) * 100))}%`;
    }
    const cutoff = recording.environment?.replayStoppedAtMs;
    if (frame) {
      const unavailable = Number.isFinite(cutoff) && at >= cutoff;
      frame.hidden = unavailable;
      if (unavailable)
        replayStatus.textContent = `DOM replay ended at ${reviewTime(cutoff)}. Activity, console and network remain available on the timeline.`;
      else if (Number.isFinite(cutoff))
        replayStatus.textContent = `DOM replay is available before ${reviewTime(cutoff)}. See capture coverage for details.`;
    }
    const state =
      (["activity", "console", "network"].includes(selected) && !allEvents) ||
      detailEvent?.type === "network"
        ? reviewState(recording.events, at)
        : null;
    if (playing && followPlayback) {
      selected = "everything";
      focusedSeq = null;
    }
    const rows =
      selected === "everything"
        ? allEvents
          ? everythingEvents
          : everythingEvents.filter((event) => event.atMs <= at)
        : selected === "environment"
          ? [environmentEvent]
          : selected === "activity" || allEvents
            ? byChannel[selected]
            : selected === "performance"
              ? byChannel.performance.filter((event) => event.atMs <= at)
              : state[selected];
    for (const [channel, b] of Object.entries(buttons)) {
      const count =
        channel === "everything"
          ? everythingEvents.length
          : channel === "environment"
            ? 1
            : !allEvents && channel === selected && state
              ? state[channel].length
              : byChannel[channel].length;
      b.textContent = `${channel[0].toUpperCase() + channel.slice(1)} (${count})`;
      b.setAttribute("aria-selected", String(channel === selected));
    }
    const previousScrollTop = content.scrollTop;
    content.replaceChildren();
    if (!rows.length)
      content.append(
        make(
          "p",
          selected === "activity"
            ? "No activity captured."
            : selected === "console"
              ? "No console messages captured. Recording starts when you press Start; earlier DevTools messages are not copied. Logs, warnings and errors are included when observed."
              : "No events at this time. Scrub forward to inspect later events.",
          "hint",
        ),
      );
    if (playing && selected === "everything") {
      const reached = rows.findLastIndex((event) => event.atMs <= at);
      if (reached >= 0) eventPage = Math.floor(reached / 200);
    }
    if (focusedSeq !== null) {
      const focusedIndex = rows.findIndex((event) => event.seq === focusedSeq);
      if (focusedIndex >= 0) eventPage = Math.floor(focusedIndex / 200);
    }
    eventPage = Math.min(eventPage, Math.max(0, Math.ceil(rows.length / 200) - 1));
    const activeSeq = focusedSeq ?? rows.findLast((event) => event.atMs <= at)?.seq;
    for (const e of rows.slice(eventPage * 200, (eventPage + 1) * 200)) {
      const b = make("button", null, "review-event");
      b.type = "button";
      b.dataset.seq = String(e.seq);
      b.dataset.future = String(e.atMs > at);
      if (e.seq === activeSeq) b.setAttribute("aria-current", "true");
      b.append(make("time", reviewTime(e.atMs)));
      if (selected === "everything") {
        const tag = make("span", e.type, "review-event-tag");
        tag.dataset.channel = e.type;
        b.append(tag);
      }
      b.append(make("span", eventLabel(e), "review-event-label"));
      if (e.data?.level === "error" || e.data?.error || e.data?.status >= 400)
        b.classList.add("review-error");
      b.onclick = () => {
        focusedSeq = e.seq;
        lastAutoScrollSeq = null;
        seek(e.atMs);
        detailEvent = e;
        if (e.type === "environment") selected = "environment";
        render();
      };
      content.append(b);
    }
    content.scrollTop = previousScrollTop;
    if ((playing && followPlayback) || focusedSeq !== null) {
      const active = content.querySelector('[aria-current="true"]');
      if (active && activeSeq !== lastAutoScrollSeq) {
        const view = content.getBoundingClientRect();
        const row = active.getBoundingClientRect();
        const delta = row.top + row.height / 2 - (view.top + view.height / 2);
        if (Math.abs(delta) > 8)
          content.scrollTo({
            top: content.scrollTop + delta,
            behavior:
              playing && !window.matchMedia("(prefers-reduced-motion: reduce)").matches
                ? "smooth"
                : "instant",
          });
        lastAutoScrollSeq = activeSeq ?? null;
      }
    }
    if (detailEvent) {
      const visible =
        detailEvent.type === "network"
          ? (state || reviewState(recording.events, at)).network.find(
              (e) => networkKey(e) === networkKey(detailEvent),
            )
          : detailEvent.atMs <= at
            ? detailEvent
            : null;
      details.hidden = !visible;
      detailBody.textContent = visible ? JSON.stringify(visible.data, null, 2) : "";
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
      gap.hidden = !gap.textContent;
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
    focusedSeq = null;
    if (followPlayback) selected = "everything";
    playing = true;
    play.textContent = "Pause";
    if (videoElement) void videoElement.play().catch(() => pause());
    previous = performance.now();
    animation = requestAnimationFrame(tick);
  };
  range.oninput = () => {
    pause();
    focusedSeq = null;
    seek(Number(range.value));
  };
  const onVideoClick = () => play.click();
  videoElement?.addEventListener("click", onVideoClick);
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
      gap.hidden = true;
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
      timelineStrip?.remove();
      timelinePlayhead?.remove();
      annotationDialog?.close();
      annotationDialog?.remove();
      annotationDialog = null;
      pause();
      window.removeEventListener("message", receive);
      videoElement?.removeEventListener("play", onPlay);
      videoElement?.removeEventListener("seeked", onTime);
      videoElement?.removeEventListener("timeupdate", onTime);
      videoElement?.removeEventListener("pause", onPause);
      videoElement?.removeEventListener("click", onVideoClick);
      root.replaceChildren();
      root.hidden = true;
    },
  };
}
