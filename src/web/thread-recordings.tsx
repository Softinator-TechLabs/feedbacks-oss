import React, { useEffect, useMemo, useRef, useState } from "react";
import type { Replayer } from "@rrweb/replay";
import "@rrweb/replay/dist/style.css";
import { installReplayResourcePolicy } from "./replay-policy.js";
import { api, ApiError, errorText, uid, type Thread } from "./api.js";
import {
  clampTime,
  consoleAt,
  entriesAt,
  entriesThrough,
  formatRecordingTime,
  mapRecordingToVideoTime,
  mapVideoToRecordingTime,
  networkExchanges,
  prepareReplayEvents,
  recordingAnnotation,
  type Recording,
  type RecordingChannel,
  type RecordingSummary,
  type NetworkExchange,
} from "./recording-model.js";
import "./thread-recordings.css";

type MediaMode = "replay" | "video";
type DiagnosticTab =
  | "everything"
  | "activity"
  | "console"
  | "network"
  | "performance"
  | "environment";
type EvidenceScope = "playhead" | "all";
const tabs: { id: DiagnosticTab; label: string }[] = [
  { id: "everything", label: "Everything" },
  { id: "activity", label: "Activity" },
  { id: "console", label: "Console" },
  { id: "network", label: "Network" },
  { id: "performance", label: "Performance" },
  { id: "environment", label: "Environment" },
];

function evidenceText(value: unknown): string {
  if (value === undefined || value === null || value === "") return "Not captured";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function eventTitle(type: RecordingChannel, data: unknown): string {
  if (!data || typeof data !== "object") return type;
  const entry = data as Record<string, unknown>;
  if (type === "console")
    return `${String(entry.level ?? "log")} · ${Array.isArray(entry.args) ? entry.args.map((part) => (typeof part === "string" ? part : evidenceText(part))).join(" ") : evidenceText(entry.message)}`;
  if (type === "network")
    return `${String(entry.method ?? "Request")} ${String(entry.url ?? "URL unavailable")} · ${String(entry.phase ?? "event")}${typeof entry.status === "number" ? ` · ${entry.status}` : ""}`;
  if (type === "activity") return activityTitle(entry);
  if (type === "performance")
    return `${String(entry.name ?? entry.entryType ?? "Performance entry")}${typeof entry.durationMs === "number" ? ` · ${Math.round(entry.durationMs)} ms` : ""}`;
  return String(entry.name ?? entry.entryType ?? type);
}

function activityTitle(entry: Record<string, unknown>): string {
  const action = String(entry.action ?? "activity");
  const target = entry.label ?? entry.id ?? entry.testId ?? entry.role ?? entry.tag;
  const name = target ? String(target) : "";
  if (action === "loading")
    return `Loading: ${String(entry.phase || "page")} · ${String(entry.url || "")}`;
  if (action === "annotation")
    return `Comment: ${String(entry.body || "Screenshot comment")}`;
  if (action === "input") {
    const inputType = String(entry.inputType ?? "");
    const verb =
      typeof entry.checked === "boolean" || inputType.startsWith("delete")
        ? "Changed"
        : inputType.toLowerCase().includes("paste")
          ? "Pasted into"
          : "Typed in";
    return `${verb} ${name || "a field"}`;
  }
  if (action === "click") return `Clicked ${name || "page"}`;
  if (action === "navigation") return `Visited ${String(entry.url || name || "page")}`;
  if (action === "visibility")
    return entry.state === "hidden" ? "Page hidden" : "Page visible";
  if (action === "scroll") return `Scrolled ${name || "page"}`;
  return `${action.charAt(0).toUpperCase()}${action.slice(1)}${name ? ` ${name}` : ""}`;
}

function activityDetail(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const entry = data as Record<string, unknown>;
  if (entry.action !== "input") return "";
  if (typeof entry.checked === "boolean") return entry.checked ? "Checked" : "Unchecked";
  if (entry.valueMasked === true) return "Value hidden";
  if ("value" in entry)
    return `Value: ${String(entry.value) || "(empty)"}${entry.valueTruncated ? " (truncated)" : ""}`;
  return "";
}

function environmentSummary(value: unknown): string {
  if (!value || typeof value !== "object") return "Browser details captured at start";
  const entry = value as Record<string, unknown>;
  const viewport = entry.viewport as Record<string, unknown> | undefined;
  const size =
    typeof viewport?.width === "number" && typeof viewport.height === "number"
      ? `${viewport.width} × ${viewport.height}`
      : "";
  const userAgent = typeof entry.userAgent === "string" ? entry.userAgent : "";
  const browser =
    typeof entry.browser === "string"
      ? entry.browser
      : (userAgent.match(/(?:Chrome|Firefox|Edg|Safari)\/[\d.]+/)?.[0] ?? "Browser");
  return [browser, size].filter(Boolean).join(" · ");
}

function NetworkDetail({ exchange }: { exchange: NetworkExchange }) {
  return (
    <div className="recording-network-detail" aria-label="Network request and response">
      <p>
        <strong>{exchange.method || "Request"}</strong>{" "}
        <span className="recording-break">{exchange.url || "URL unavailable"}</span>
      </p>
      {exchange.status !== undefined && <p>Status: {exchange.status}</p>}
      {exchange.status === undefined && !exchange.error && (
        <p>Response has not appeared at this point.</p>
      )}
      {exchange.error !== undefined && <p>Error: {evidenceText(exchange.error)}</p>}
      <div className="recording-payload-grid">
        <section>
          <h4>Request headers</h4>
          <pre>{evidenceText(exchange.requestHeaders)}</pre>
        </section>
        <section>
          <h4>Request body</h4>
          <pre>{evidenceText(exchange.requestBody)}</pre>
        </section>
        <section>
          <h4>Response headers</h4>
          <pre>{evidenceText(exchange.responseHeaders)}</pre>
        </section>
        <section>
          <h4>Response body</h4>
          <pre>{evidenceText(exchange.responseBody)}</pre>
        </section>
      </div>
    </div>
  );
}

type FrameAsset = {
  id: string;
  url: string;
  recordingFrame: {
    recordingId: string;
    atMs: number;
    videoTimeMs?: number;
    annotationId?: string;
  };
};
type PendingFrame = {
  imageBase64: string;
  atMs: number;
  videoTimeMs: number;
  key: string;
  revision?: number;
};

export function ThreadRecordings({
  thread,
  canWrite = false,
  onSaved,
  onAnnotateFrame,
}: {
  thread: Thread;
  canWrite?: boolean;
  onSaved?: (saved: Thread) => void;
  onAnnotateFrame?: (frame: {
    imageBase64: string;
    recordingFrame: { recordingId: string; atMs: number; videoTimeMs: number };
  }) => void;
}) {
  const [summaries, setSummaries] = useState<RecordingSummary[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [recording, setRecording] = useState<Recording | null>(null);
  const [listing, setListing] = useState(true);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [permissionMissing, setPermissionMissing] = useState(false);
  const [reload, setReload] = useState(0);
  const [mediaMode, setMediaMode] = useState<MediaMode>("replay");
  const [diagnosticTab, setDiagnosticTab] = useState<DiagnosticTab>("everything");
  const [evidenceScope, setEvidenceScope] = useState<EvidenceScope>("all");
  const [everythingPage, setEverythingPage] = useState(0);
  const [followPlayback, setFollowPlayback] = useState(true);
  const [cursorMs, setCursorMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [replayError, setReplayError] = useState("");
  const [replayReady, setReplayReady] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState("");
  const [videoReady, setVideoReady] = useState(false);
  const [frameBusy, setFrameBusy] = useState(false);
  const [frameError, setFrameError] = useState("");
  const [savedFrame, setSavedFrame] = useState<FrameAsset | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<Replayer | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const cursorRef = useRef(0);
  const replayStartRef = useRef(0);
  const replayClockRef = useRef<{ atMs: number; startedAt: number } | null>(null);
  const requestSerial = useRef(0);
  const pendingVideoSeekRef = useRef<number | null>(null);
  const selectedVideoGapRef = useRef(false);
  const videoSeekAttemptsRef = useRef(0);
  const pendingFrameRef = useRef<PendingFrame | null>(null);
  const eventListRef = useRef<HTMLOListElement>(null);
  const followedEventRef = useRef<number | null>(null);

  useEffect(() => {
    let current = true;
    setListing(true);
    setListError("");
    setPermissionMissing(false);
    api<{ items: RecordingSummary[] }>("recordings.list", { threadId: thread.id })
      .then(({ items }) => {
        if (!current) return;
        setSummaries(items);
        setSelectedId((previous) =>
          items.some((item) => item.id === previous) ? previous : (items[0]?.id ?? ""),
        );
      })
      .catch((error: unknown) => {
        if (!current) return;
        setPermissionMissing(
          error instanceof ApiError &&
            (error.status === 403 || error.code === "FORBIDDEN"),
        );
        setListError(errorText(error));
      })
      .finally(() => {
        if (current) setListing(false);
      });
    return () => {
      current = false;
    };
  }, [thread.id, reload]);

  useEffect(() => {
    const serial = ++requestSerial.current;
    setRecording(null);
    setDetailError("");
    setCursorMs(0);
    cursorRef.current = 0;
    setPlaying(false);
    replayClockRef.current = null;
    setMediaMode("replay");
    setDiagnosticTab("everything");
    setEvidenceScope("all");
    setEverythingPage(0);
    setFollowPlayback(true);
    followedEventRef.current = null;
    setSelectedRequest("");
    setVideoReady(false);
    setFrameError("");
    setSavedFrame(null);
    pendingVideoSeekRef.current = null;
    selectedVideoGapRef.current = false;
    pendingFrameRef.current = null;
    if (!selectedId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    api<{ recording: Recording }>("recordings.get", { recordingId: selectedId })
      .then(({ recording: value }) => {
        if (serial === requestSerial.current) {
          setRecording(value);
          setMediaMode(value.video ? "video" : "replay");
        }
      })
      .catch((error: unknown) => {
        if (serial === requestSerial.current) setDetailError(errorText(error));
      })
      .finally(() => {
        if (serial === requestSerial.current) setLoading(false);
      });
  }, [selectedId, reload]);

  const replayEvents = useMemo(
    () => (recording ? prepareReplayEvents(recording.events) : []),
    [recording],
  );
  const replayStoppedAtMs =
    recording?.environment &&
    typeof recording.environment === "object" &&
    "replayStoppedAtMs" in recording.environment &&
    typeof recording.environment.replayStoppedAtMs === "number" &&
    Number.isFinite(recording.environment.replayStoppedAtMs)
      ? recording.environment.replayStoppedAtMs
      : null;
  const replayExpired = replayStoppedAtMs !== null && cursorMs >= replayStoppedAtMs;
  const exchanges = useMemo(
    () => (recording ? networkExchanges(recording.events) : []),
    [recording],
  );
  const reachedExchanges = useMemo(
    () => (recording ? networkExchanges(recording.events, cursorMs) : []),
    [recording, cursorMs],
  );
  const videoAsset = recording?.video
    ? thread.assets.find(
        (asset) =>
          asset.id === recording.video?.assetId && asset.contentType.startsWith("video/"),
      )
    : undefined;
  const standaloneVideos = thread.assets.filter(
    (asset) => asset.contentType.startsWith("video/") && asset.id !== videoAsset?.id,
  );
  const linkedFrames = (
    thread.assets as Array<
      Thread["assets"][number] & { recordingFrame?: FrameAsset["recordingFrame"] }
    >
  ).filter(
    (asset) =>
      !!recording &&
      !!asset.recordingFrame &&
      asset.recordingFrame.recordingId === recording.id &&
      asset.contentType.startsWith("image/"),
  );
  const displayedFrame =
    savedFrame?.recordingFrame.recordingId === recording?.id
      ? savedFrame
      : linkedFrames.filter((frame) => !frame.recordingFrame?.annotationId).length
        ? (linkedFrames
            .filter((frame) => !frame.recordingFrame?.annotationId)
            .at(-1) as FrameAsset)
        : null;
  const annotationFrames = linkedFrames.flatMap((frame) => {
    const embedded = recordingAnnotation(recording?.events || [], frame.recordingFrame!);
    const point = thread.context?.annotations?.find(
      (item) => item.id === frame.recordingFrame?.annotationId,
    );
    const annotation =
      embedded ??
      (point
        ? {
            id: point.id,
            body: point.body,
            atMs: frame.recordingFrame!.atMs,
          }
        : null);
    return annotation ? [{ frame, annotation }] : [];
  });

  useEffect(() => {
    setReplayError("");
    setReplayReady(false);
    playerRef.current?.destroy();
    playerRef.current = null;
    if (
      mediaMode !== "replay" ||
      !stageRef.current ||
      !recording ||
      replayEvents.length < 2
    )
      return;
    const stage = stageRef.current;
    let active = true;
    let observer: ResizeObserver | undefined;
    void (async () => {
      try {
        const { Replayer } = await import("@rrweb/replay");
        if (!active) return;
        // rrweb constructs a sandboxed iframe; the event copy has all remote resource references removed.
        const player = new Replayer(
          replayEvents as ConstructorParameters<typeof Replayer>[0],
          {
            root: stage,
            loadTimeout: 0,
            skipInactive: false,
            triggerFocus: false,
            showWarning: false,
            mouseTail: false,
          },
        );
        playerRef.current = player;
        const frame = stage.querySelector("iframe");
        if (!frame) throw new Error("Replay sandbox frame is unavailable");
        installReplayResourcePolicy(frame);
        frame.setAttribute("aria-hidden", "true");
        player.on("fullsnapshot-rebuilded", () => installReplayResourcePolicy(frame));
        const replayStart =
          Number(replayEvents[0]?.timestamp ?? 0) - Date.parse(recording.startedAt);
        replayStartRef.current = Number.isFinite(replayStart)
          ? Math.max(0, replayStart)
          : 0;
        player.pause(Math.max(0, cursorRef.current - replayStartRef.current));
        const fit = () => {
          const frame = stage.querySelector("iframe");
          const wrapper = stage.querySelector<HTMLElement>(".replayer-wrapper");
          const width = Number(frame?.getAttribute("width"));
          const height = Number(frame?.getAttribute("height"));
          if (!wrapper || !width || !height) return;
          const scale = Math.min(1, stage.clientWidth / width);
          wrapper.style.width = `${width}px`;
          wrapper.style.height = `${height}px`;
          wrapper.style.transform = `scale(${scale})`;
          stage.style.height = `${Math.max(220, height * scale)}px`;
        };
        fit();
        observer = new ResizeObserver(fit);
        observer.observe(stage);
        player.on("resize", fit);
        setReplayReady(true);
      } catch {
        playerRef.current?.destroy();
        playerRef.current = null;
        if (active)
          setReplayError(
            "Replay could not be loaded. The diagnostic events are still available below.",
          );
      }
    })();
    return () => {
      active = false;
      observer?.disconnect();
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, [recording, replayEvents, mediaMode]);

  useEffect(() => {
    if (!playing || mediaMode !== "replay") return;
    if (!replayClockRef.current)
      replayClockRef.current = { atMs: cursorRef.current, startedAt: performance.now() };
    const timer = window.setInterval(() => {
      const player = playerRef.current;
      if (!player || !recording) return;
      const clock = replayClockRef.current;
      if (!clock) return;
      const next = clampTime(
        clock.atMs + performance.now() - clock.startedAt,
        recording.durationMs,
      );
      cursorRef.current = next;
      setCursorMs(next);
      if (next >= recording.durationMs) {
        player.pause();
        replayClockRef.current = null;
        setPlaying(false);
      }
    }, 150);
    return () => window.clearInterval(timer);
  }, [playing, mediaMode, recording]);

  useEffect(() => {
    if (mediaMode !== "video" || !recording?.video || !videoRef.current) return;
    if (videoRef.current.readyState >= HTMLMediaElement.HAVE_METADATA)
      alignVideo(cursorRef.current);
  }, [mediaMode, recording]);

  function alignVideo(atMs: number) {
    const video = videoRef.current;
    if (!video || !recording?.video) return;
    const output = mapRecordingToVideoTime(atMs, recording.video);
    setVideoReady(false);
    if (output === null) {
      selectedVideoGapRef.current = true;
      pendingVideoSeekRef.current = null;
      video.pause();
      return;
    }
    selectedVideoGapRef.current = false;
    pendingVideoSeekRef.current = atMs;
    videoSeekAttemptsRef.current = 0;
    try {
      video.currentTime = output / 1000;
    } catch {
      setFrameError("The video could not seek to that moment.");
      return;
    }
    checkVideoFrame(video);
  }

  function checkVideoFrame(video: HTMLVideoElement) {
    if (
      !recording?.video ||
      selectedVideoGapRef.current ||
      video.seeking ||
      video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
    )
      return;
    const mapped = mapVideoToRecordingTime(video.currentTime * 1000, recording.video);
    const target = pendingVideoSeekRef.current;
    if (mapped === null || (target !== null && Math.abs(mapped - target) > 250)) {
      setVideoReady(false);
      const expected =
        target === null ? null : mapRecordingToVideoTime(target, recording.video);
      if (expected !== null && videoSeekAttemptsRef.current < 3) {
        videoSeekAttemptsRef.current += 1;
        video.currentTime = expected / 1000;
      }
      return;
    }
    pendingVideoSeekRef.current = null;
    setVideoReady(true);
    cursorRef.current = clampTime(mapped, recording.durationMs);
    setCursorMs(cursorRef.current);
  }

  function seek(atMs: number) {
    if (!recording) return;
    const next = clampTime(atMs, recording.durationMs);
    cursorRef.current = next;
    setCursorMs(next);
    if (mediaMode === "replay" && playerRef.current) {
      if (playing) replayClockRef.current = { atMs: next, startedAt: performance.now() };
      const offset = Math.max(0, next - replayStartRef.current);
      if (playing) playerRef.current.play(offset);
      else playerRef.current.pause(offset);
    }
    if (mediaMode === "video" && recording.video && videoRef.current) {
      alignVideo(next);
    }
  }

  function chooseMedia(next: MediaMode) {
    playerRef.current?.pause();
    videoRef.current?.pause();
    setPlaying(false);
    replayClockRef.current = null;
    setVideoReady(false);
    setMediaMode(next);
  }

  function captureCurrentFrame(): PendingFrame | null {
    const video = videoRef.current;
    if (
      !recording?.video ||
      !video ||
      !videoReady ||
      video.seeking ||
      video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
      !video.videoWidth ||
      !video.videoHeight
    ) {
      setFrameError("Wait for the video frame to finish loading before saving it.");
      return null;
    }
    video.pause();
    const videoTimeMs = Math.round(video.currentTime * 1000);
    const mapped = mapVideoToRecordingTime(videoTimeMs, recording.video);
    if (mapped === null) {
      setVideoReady(false);
      setFrameError(
        "This video frame is outside the retained recording timeline. Seek to a retained frame and try again.",
      );
      return null;
    }
    const atMs = clampTime(mapped, recording.durationMs);
    cursorRef.current = atMs;
    setCursorMs(atMs);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas is unavailable");
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageBase64 = canvas.toDataURL("image/png");
      if (
        !imageBase64.startsWith("data:image/png;base64,") ||
        imageBase64.length > 13_982_000
      )
        throw new Error("The frame is too large to attach");
      return { imageBase64, atMs, videoTimeMs, key: uid() };
    } catch (error) {
      setFrameError(
        error instanceof Error
          ? `Could not capture this frame: ${error.message}.`
          : "Could not capture this frame.",
      );
      return null;
    }
  }

  function annotateCurrentFrame() {
    if (!recording || !onAnnotateFrame) return;
    const frame = captureCurrentFrame();
    if (!frame) return;
    onAnnotateFrame({
      imageBase64: frame.imageBase64,
      recordingFrame: {
        recordingId: recording.id,
        atMs: frame.atMs,
        videoTimeMs: frame.videoTimeMs,
      },
    });
  }

  async function saveCurrentFrame() {
    const frame = captureCurrentFrame();
    if (!frame || !recording) return;
    let pending = pendingFrameRef.current;
    if (
      !pending ||
      Math.abs(pending.atMs - frame.atMs) > 250 ||
      Math.abs(pending.videoTimeMs - frame.videoTimeMs) > 250
    ) {
      pending = frame;
      pendingFrameRef.current = pending;
    }
    setFrameBusy(true);
    setFrameError("");
    try {
      if (pending.revision === undefined) {
        const latest = await api<Thread>("threads.get", { threadId: thread.id });
        pending.revision = latest.revision;
      }
      const result = await api<{ asset: FrameAsset; thread: Thread }>("assets.upload", {
        threadId: thread.id,
        revision: pending.revision,
        imageBase64: pending.imageBase64,
        rendition: "screenshot",
        idempotencyKey: pending.key,
        recordingFrame: {
          recordingId: recording.id,
          atMs: pending.atMs,
          videoTimeMs: pending.videoTimeMs,
        },
      });
      pendingFrameRef.current = null;
      setSavedFrame(result.asset);
      onSaved?.(result.thread);
    } catch (error) {
      if (error instanceof ApiError && error.code === "CONFLICT") {
        pendingFrameRef.current = null;
        setFrameError(
          "This thread changed while saving. The frame was not attached; seek to it and try again.",
        );
      } else
        setFrameError(
          `Frame was not attached: ${errorText(error)} You can retry from this moment.`,
        );
    } finally {
      setFrameBusy(false);
    }
  }

  const visibleExchanges = evidenceScope === "all" ? exchanges : reachedExchanges;
  const activeRequest = reachedExchanges.find((item) => item.key === selectedRequest);
  const videoGap =
    mediaMode === "video" &&
    recording?.video &&
    mapRecordingToVideoTime(cursorMs, recording.video) === null;
  const canSaveFrame =
    canWrite &&
    mediaMode === "video" &&
    !!videoAsset &&
    !!recording?.video &&
    videoReady &&
    !videoGap &&
    !frameBusy;
  const eventType =
    diagnosticTab === "activity" ||
    diagnosticTab === "console" ||
    diagnosticTab === "performance"
      ? diagnosticTab
      : null;
  const visibleEvents =
    recording && eventType
      ? evidenceScope === "all"
        ? entriesAt(recording.events, eventType)
        : eventType === "console"
          ? consoleAt(recording.events, cursorMs)
          : entriesThrough(recording.events, eventType, cursorMs)
      : [];
  const totalEvents =
    recording && eventType ? entriesAt(recording.events, eventType).length : 0;
  const combinedEvents = useMemo(
    () =>
      recording?.events
        .filter((event) =>
          ["activity", "console", "network", "performance"].includes(event.type),
        )
        .sort((a, b) => a.atMs - b.atMs || a.seq - b.seq) ?? [],
    [recording],
  );
  const reachedEventCount = useMemo(() => {
    let low = 0;
    let high = combinedEvents.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (combinedEvents[middle].atMs <= cursorMs) low = middle + 1;
      else high = middle;
    }
    return low;
  }, [combinedEvents, cursorMs]);
  const visibleCombinedEvents =
    evidenceScope === "all" ? combinedEvents : combinedEvents.slice(0, reachedEventCount);
  const everythingPageSize = 200;
  const maxEverythingPage = Math.max(
    0,
    Math.ceil((visibleCombinedEvents.length + 1) / everythingPageSize) - 1,
  );
  const shownEverythingPage = Math.min(everythingPage, maxEverythingPage);
  const everythingPageStart = shownEverythingPage * everythingPageSize;
  const pageEvents = visibleCombinedEvents.slice(
    Math.max(0, everythingPageStart - 1),
    everythingPageStart === 0
      ? everythingPageSize - 1
      : everythingPageStart + everythingPageSize - 1,
  );
  const visibleCount = eventType
    ? visibleEvents.length
    : diagnosticTab === "everything"
      ? visibleCombinedEvents.length + 1
      : diagnosticTab === "network"
        ? visibleExchanges.length
        : 0;
  const totalCount = eventType
    ? totalEvents
    : diagnosticTab === "everything"
      ? combinedEvents.length + 1
      : diagnosticTab === "network"
        ? exchanges.length
        : 0;
  const latestMoment = combinedEvents[reachedEventCount - 1] ?? null;
  const activeEventSeq = visibleEvents
    .filter((event) => event.atMs <= cursorMs)
    .at(-1)?.seq;
  const activeEverythingSeq = latestMoment?.seq;
  const activeExchangeKey = visibleExchanges
    .filter((exchange) => exchange.atMs <= cursorMs)
    .at(-1)?.key;

  useEffect(() => {
    if (diagnosticTab !== "everything") return;
    setEverythingPage(Math.floor(reachedEventCount / everythingPageSize));
  }, [reachedEventCount, diagnosticTab, evidenceScope, selectedId]);

  useEffect(() => {
    if (!playing || !followPlayback || !latestMoment) return;
    if (followedEventRef.current === latestMoment.seq) return;
    followedEventRef.current = latestMoment.seq;
    if (diagnosticTab !== "everything")
      setDiagnosticTab(latestMoment.type as DiagnosticTab);
    setEvidenceScope("all");
    if (latestMoment.type === "network") {
      const data = latestMoment.data as Record<string, unknown> | null;
      if (typeof data?.requestId === "string") setSelectedRequest(data.requestId);
    }
  }, [playing, followPlayback, latestMoment, diagnosticTab]);

  useEffect(() => {
    const list = eventListRef.current;
    if (!list) return;
    const current = list.querySelector<HTMLElement>('[aria-current="true"]');
    if (!current) return;
    const listBounds = list.getBoundingClientRect();
    const rowBounds = current.getBoundingClientRect();
    const centerDelta =
      rowBounds.top + rowBounds.height / 2 - (listBounds.top + listBounds.height / 2);
    if (Math.abs(centerDelta) > 8) list.scrollTop += centerDelta;
  }, [
    activeEventSeq,
    activeEverythingSeq,
    activeExchangeKey,
    diagnosticTab,
    evidenceScope,
  ]);

  const timelineMarks = useMemo(() => {
    if (!recording) return [];
    const marks = new Map<
      string,
      {
        atMs: number;
        type: RecordingChannel | "point";
        label: string;
        error: boolean;
        count: number;
        position: number;
        requestId?: string;
      }
    >();
    for (const event of recording.events) {
      if (!["activity", "console", "network", "performance"].includes(event.type))
        continue;
      const position = Math.round((event.atMs / Math.max(1, recording.durationMs)) * 200);
      const key = `${event.type}:${position}`;
      const data = event.data as Record<string, unknown> | null;
      const error =
        data?.level === "error" ||
        !!data?.error ||
        (typeof data?.status === "number" && data.status >= 400);
      const prior = marks.get(key);
      if (prior) {
        prior.count++;
        prior.error ||= error;
      } else {
        marks.set(key, {
          atMs: event.atMs,
          type: event.type,
          label: eventTitle(event.type, event.data),
          error,
          count: 1,
          position: Math.max(0, Math.min(200, position)),
          requestId: typeof data?.requestId === "string" ? data.requestId : undefined,
        });
      }
    }
    for (const { annotation } of annotationFrames) {
      marks.set(`point:${annotation.id}`, {
        atMs: annotation.atMs,
        type: "point",
        label: annotation.body,
        error: false,
        count: 1,
        position: Math.max(
          0,
          Math.min(
            200,
            Math.round((annotation.atMs / Math.max(1, recording.durationMs)) * 200),
          ),
        ),
      });
    }
    return [...marks.values()]
      .sort(
        (a, b) =>
          Number(b.type === "point") - Number(a.type === "point") || a.atMs - b.atMs,
      )
      .slice(0, 600);
  }, [recording, thread.assets, thread.context?.annotations]);
  return (
    <section className="thread-recordings" aria-labelledby="thread-recordings-heading">
      <div className="recording-heading">
        <h2 id="thread-recordings-heading">
          {!listing && !listError && summaries.length === 0 && standaloneVideos.length
            ? "Video feedback"
            : "Session recording"}
        </h2>
        {!listing && !listError && summaries.length > 1 && (
          <span className="recording-count">{summaries.length}</span>
        )}
      </div>
      {listing && (
        <p className="muted" role="status">
          Loading recordings…
        </p>
      )}
      {!listing && listError && (
        <div className="recording-state" role="status">
          <p>
            {permissionMissing
              ? "Recording access is not enabled for this account."
              : `Recordings could not load: ${listError}`}
          </p>
          {!permissionMissing && (
            <button type="button" onClick={() => setReload((n) => n + 1)}>
              Retry recordings
            </button>
          )}
        </div>
      )}
      {!listing &&
        !listError &&
        summaries.length === 0 &&
        standaloneVideos.length === 0 && (
          <p className="muted recording-empty">
            No session recording was shared with this thread.
          </p>
        )}
      {!listing &&
        summaries.length === 0 &&
        standaloneVideos.map((asset) => (
          <video
            key={asset.id}
            id={`asset-${asset.id}`}
            className="recording-standalone-video"
            controls
            preload="metadata"
            src={asset.url}
            aria-label="Tab video feedback"
          />
        ))}
      {!listing && !listError && summaries.length > 0 && (
        <>
          {summaries.length > 1 && (
            <>
              <label className="recording-select-label" htmlFor="thread-recording-select">
                Recording
              </label>
              <select
                id="thread-recording-select"
                value={selectedId}
                onChange={(event) => setSelectedId(event.target.value)}
              >
                {summaries.map((item, index) => (
                  <option key={item.id} value={item.id}>
                    {new Date(item.startedAt).toLocaleString()} ·{" "}
                    {item.mode === "video" ? "Video + session" : "Session"} ·{" "}
                    {formatRecordingTime(item.durationMs)} · {index + 1}
                  </option>
                ))}
              </select>
            </>
          )}
          {loading && (
            <p className="muted" role="status">
              Loading recording…
            </p>
          )}
          {detailError && (
            <div className="recording-state" role="alert">
              <p>Recording could not load: {detailError}</p>
              <button type="button" onClick={() => setReload((n) => n + 1)}>
                Retry
              </button>
            </div>
          )}
          {recording && (
            <>
              <div className="recording-meta">
                <span className="recording-break">{recording.url}</span>
                <span>{recording.eventCount ?? recording.events.length} events</span>
              </div>
              <div className="recording-coverage" aria-label="Capture coverage">
                {recording.coverage.map((item, index) => (
                  <span
                    key={`${item.channel}-${index}`}
                    className={`recording-coverage-item recording-coverage-${item.status}`}
                    title={item.detail ?? undefined}
                  >
                    {item.channel}: {item.status}
                    {item.detail ? (
                      <span className="sr-only"> · {item.detail}</span>
                    ) : null}
                  </span>
                ))}
              </div>
              {recording.coverage.some((item) => item.status !== "complete") && (
                <details className="recording-coverage-notes">
                  <summary>What is missing from this capture?</summary>
                  <ul>
                    {recording.coverage
                      .filter((item) => item.status !== "complete")
                      .map((item, index) => (
                        <li key={`${item.channel}-${index}`}>
                          <strong>{item.channel}</strong>: {item.detail || item.status}
                        </li>
                      ))}
                  </ul>
                </details>
              )}
              <p className="recording-privacy">
                Privacy:{" "}
                {recording.privacy.maskInputs ? "inputs masked" : "input masking off"} ·{" "}
                {recording.privacy.maskText ? "page text masked" : "page text included"} ·{" "}
                {recording.privacy.networkBodies
                  ? "network bodies included"
                  : "network bodies omitted"}
              </p>
              <div className="recording-timeline">
                <button
                  type="button"
                  disabled={
                    mediaMode === "replay" ? !replayReady : !videoAsset || !!videoGap
                  }
                  onClick={() => {
                    if (mediaMode === "video") {
                      const video = videoRef.current;
                      if (!video) return;
                      if (video.paused) void video.play();
                      else video.pause();
                      return;
                    }
                    const player = playerRef.current;
                    if (!player) return;
                    if (playing) {
                      player.pause();
                      replayClockRef.current = null;
                      setPlaying(false);
                    } else {
                      setDiagnosticTab("everything");
                      setEvidenceScope("all");
                      replayClockRef.current = {
                        atMs: cursorRef.current,
                        startedAt: performance.now(),
                      };
                      player.play(
                        Math.max(0, cursorRef.current - replayStartRef.current),
                      );
                      setFollowPlayback(true);
                      setPlaying(true);
                    }
                  }}
                >
                  {playing ? `Pause ${mediaMode}` : `Play ${mediaMode}`}
                </button>
                <label htmlFor="thread-recording-timeline" className="sr-only">
                  Recording position
                </label>
                <input
                  id="thread-recording-timeline"
                  type="range"
                  min="0"
                  max={Math.max(recording.durationMs, 1)}
                  step="100"
                  value={cursorMs}
                  onChange={(event) => seek(Number(event.target.value))}
                  aria-valuetext={`${formatRecordingTime(cursorMs)} of ${formatRecordingTime(recording.durationMs)}`}
                />
                <div
                  className="recording-timeline-marks"
                  aria-label="Events on recording timeline"
                >
                  {timelineMarks.map((mark, index) => (
                    <button
                      key={`${mark.type}-${mark.position}-${index}`}
                      type="button"
                      className="recording-timeline-mark"
                      data-channel={mark.type}
                      data-error={mark.error}
                      data-align={
                        mark.position < 35
                          ? "start"
                          : mark.position > 165
                            ? "end"
                            : "center"
                      }
                      style={{ left: `${mark.position / 2}%` }}
                      aria-label={`${mark.type} at ${formatRecordingTime(mark.atMs)}: ${mark.label}`}
                      onClick={() => {
                        setFollowPlayback(false);
                        setDiagnosticTab(
                          mark.type === "network"
                            ? "network"
                            : mark.type === "console"
                              ? "console"
                              : mark.type === "performance"
                                ? "performance"
                                : "activity",
                        );
                        if (mark.requestId) setSelectedRequest(mark.requestId);
                        setEvidenceScope("all");
                        seek(mark.atMs);
                      }}
                    >
                      <span className="recording-mark-tooltip" role="tooltip">
                        <strong>
                          {formatRecordingTime(mark.atMs)} ·{" "}
                          {mark.type === "point"
                            ? "Comment"
                            : tabs.find((tab) => tab.id === mark.type)?.label}
                        </strong>
                        <span>
                          {mark.label}
                          {mark.count > 1 ? ` · ${mark.count} events` : ""}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
                <output htmlFor="thread-recording-timeline">
                  {formatRecordingTime(cursorMs)} /{" "}
                  {formatRecordingTime(recording.durationMs)}
                </output>
              </div>
              <div className="recording-workspace">
                <div
                  className="recording-media"
                  id={videoAsset ? `asset-${videoAsset.id}` : undefined}
                >
                  <div
                    className="recording-media-switch"
                    role="group"
                    aria-label="Recording media"
                  >
                    {replayEvents.length >= 2 && (
                      <button
                        type="button"
                        aria-pressed={mediaMode === "replay"}
                        onClick={() => chooseMedia("replay")}
                      >
                        Replay
                      </button>
                    )}
                    {recording.video && (
                      <button
                        type="button"
                        aria-pressed={mediaMode === "video"}
                        onClick={() => chooseMedia("video")}
                      >
                        Video
                      </button>
                    )}
                  </div>
                  <div className="recording-media-content">
                    {mediaMode === "replay" && (
                      <>
                        {replayEvents.length < 2 ? (
                          <p className="recording-state">
                            Replay was not captured. Check coverage and the diagnostic
                            evidence.
                          </p>
                        ) : (
                          <>
                            <div
                              className="recording-stage"
                              ref={stageRef}
                              hidden={replayExpired}
                              role="img"
                              aria-label="Sandboxed page replay"
                            />
                            {replayExpired && (
                              <p className="recording-state" role="status">
                                DOM capture ended at{" "}
                                {formatRecordingTime(replayStoppedAtMs!)}. This later
                                moment has no page reconstruction. Use the video or
                                diagnostic events for the remaining recording.
                              </p>
                            )}
                            {replayError && <p role="alert">{replayError}</p>}
                            <p className="recording-footnote">
                              Captured page resources are withheld during replay. Layout
                              may differ from the original page.
                            </p>
                          </>
                        )}
                      </>
                    )}
                    {mediaMode === "video" &&
                      (videoAsset && recording.video ? (
                        <>
                          <video
                            ref={videoRef}
                            controls
                            preload="metadata"
                            src={videoAsset.url}
                            aria-label="Linked recording video"
                            onPlay={(event) => {
                              selectedVideoGapRef.current = false;
                              checkVideoFrame(event.currentTarget);
                              setDiagnosticTab("everything");
                              setEvidenceScope("all");
                              setFollowPlayback(true);
                              setPlaying(true);
                            }}
                            onPause={() => setPlaying(false)}
                            onLoadedMetadata={() => alignVideo(cursorRef.current)}
                            onLoadedData={(event) => checkVideoFrame(event.currentTarget)}
                            onCanPlay={(event) => checkVideoFrame(event.currentTarget)}
                            onSeeking={() => setVideoReady(false)}
                            onSeeked={(event) => checkVideoFrame(event.currentTarget)}
                            onTimeUpdate={(event) => {
                              if (
                                !recording.video ||
                                selectedVideoGapRef.current ||
                                pendingVideoSeekRef.current !== null ||
                                event.currentTarget.seeking
                              )
                                return;
                              const mapped = mapVideoToRecordingTime(
                                event.currentTarget.currentTime * 1000,
                                recording.video,
                              );
                              if (mapped !== null) {
                                cursorRef.current = clampTime(
                                  mapped,
                                  recording.durationMs,
                                );
                                setCursorMs(cursorRef.current);
                                if (
                                  event.currentTarget.readyState >=
                                  HTMLMediaElement.HAVE_CURRENT_DATA
                                )
                                  setVideoReady(true);
                              }
                            }}
                          />
                          {canWrite && (
                            <div className="recording-frame-actions">
                              <button
                                type="button"
                                disabled={!canSaveFrame}
                                onClick={() => void saveCurrentFrame()}
                              >
                                {frameBusy ? "Saving frame…" : "Save frame"}
                              </button>
                              {onAnnotateFrame && (
                                <button
                                  type="button"
                                  disabled={!canSaveFrame}
                                  onClick={annotateCurrentFrame}
                                >
                                  Annotate frame
                                </button>
                              )}
                              <span>
                                Choose a moment in the activity or timeline, then save or
                                mark its frame on this thread.
                              </span>
                            </div>
                          )}
                          {frameError && (
                            <p className="recording-frame-error" role="alert">
                              {frameError}
                            </p>
                          )}
                          {displayedFrame && (
                            <div className="recording-saved-frame" role="status">
                              <a
                                href={displayedFrame.url}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                <img
                                  src={displayedFrame.url}
                                  alt={`Saved frame at ${formatRecordingTime(displayedFrame.recordingFrame.atMs)}`}
                                  loading="lazy"
                                />
                                <span>
                                  Saved frame at{" "}
                                  {formatRecordingTime(
                                    displayedFrame.recordingFrame.atMs,
                                  )}
                                </span>
                              </a>
                            </div>
                          )}
                          <p className="recording-footnote">
                            {videoGap
                              ? "No video frame matches this moment because this section was removed from the video."
                              : "Video and events share the recorded timeline. Removed video sections have no matching frame."}
                          </p>
                        </>
                      ) : (
                        <p className="recording-state">
                          The linked video is unavailable with this thread.
                        </p>
                      ))}
                  </div>
                </div>
                <div className="recording-diagnostics">
                  <div
                    className="recording-tabs"
                    role="group"
                    aria-label="Recording diagnostics"
                  >
                    {tabs.map((item) => (
                      <button
                        type="button"
                        key={item.id}
                        aria-pressed={diagnosticTab === item.id}
                        onClick={() => {
                          setFollowPlayback(false);
                          setDiagnosticTab(item.id);
                        }}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                  {diagnosticTab !== "environment" && (
                    <button
                      type="button"
                      className="recording-follow"
                      aria-pressed={followPlayback}
                      onClick={() => setFollowPlayback((value) => !value)}
                    >
                      {followPlayback ? "Following playback" : "Follow playback"}
                    </button>
                  )}
                  {diagnosticTab !== "environment" && (
                    <div className="recording-scope">
                      <div role="group" aria-label="Event range">
                        <button
                          type="button"
                          aria-pressed={evidenceScope === "playhead"}
                          onClick={() => setEvidenceScope("playhead")}
                        >
                          At playhead
                        </button>
                        <button
                          type="button"
                          aria-pressed={evidenceScope === "all"}
                          onClick={() => setEvidenceScope("all")}
                        >
                          All events
                        </button>
                      </div>
                      <p>
                        {evidenceScope === "playhead"
                          ? `${visibleCount} of ${totalCount} through ${formatRecordingTime(cursorMs)}`
                          : `${totalCount} total · Select a row to jump`}
                      </p>
                    </div>
                  )}
                  <div className="recording-tab-content">
                    {diagnosticTab === "everything" && (
                      <div className="recording-everything-wrap">
                        <ol
                          className="recording-events recording-everything"
                          ref={eventListRef}
                        >
                          {shownEverythingPage === 0 && (
                            <li>
                              <button
                                type="button"
                                aria-current={!activeEverythingSeq ? "true" : undefined}
                                onClick={() => {
                                  setDiagnosticTab("environment");
                                  seek(0);
                                }}
                              >
                                <time>0:00.0</time>
                                <span>
                                  <span
                                    className="recording-event-tag"
                                    data-channel="environment"
                                  >
                                    Environment
                                  </span>
                                  {environmentSummary(recording.environment)}
                                </span>
                              </button>
                            </li>
                          )}
                          {pageEvents.map((event) => (
                            <li key={event.seq}>
                              <button
                                type="button"
                                aria-current={
                                  activeEverythingSeq === event.seq ? "true" : undefined
                                }
                                onClick={() => seek(event.atMs)}
                              >
                                <time>{formatRecordingTime(event.atMs)}</time>
                                <span>
                                  <span
                                    className="recording-event-tag"
                                    data-channel={event.type}
                                  >
                                    {event.type}
                                  </span>
                                  {eventTitle(event.type, event.data)}
                                  {event.type === "activity" &&
                                    activityDetail(event.data) && (
                                      <small className="recording-event-detail">
                                        {activityDetail(event.data)}
                                      </small>
                                    )}
                                </span>
                              </button>
                            </li>
                          ))}
                        </ol>
                        {maxEverythingPage > 0 && (
                          <div className="recording-event-pages">
                            <button
                              type="button"
                              disabled={shownEverythingPage === 0}
                              onClick={() => {
                                setFollowPlayback(false);
                                setEverythingPage(shownEverythingPage - 1);
                              }}
                            >
                              Earlier
                            </button>
                            <span>
                              {everythingPageStart + 1}–
                              {Math.min(
                                visibleCombinedEvents.length + 1,
                                everythingPageStart + everythingPageSize,
                              )}{" "}
                              of {visibleCombinedEvents.length + 1}
                            </span>
                            <button
                              type="button"
                              disabled={shownEverythingPage === maxEverythingPage}
                              onClick={() => {
                                setFollowPlayback(false);
                                setEverythingPage(shownEverythingPage + 1);
                              }}
                            >
                              Later
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                    {eventType &&
                      (visibleEvents.length ? (
                        <ol className="recording-events" ref={eventListRef}>
                          {visibleEvents.map((event) => (
                            <li key={event.seq}>
                              <button
                                type="button"
                                aria-current={
                                  activeEventSeq === event.seq ? "true" : undefined
                                }
                                onClick={() => seek(event.atMs)}
                              >
                                <time>{formatRecordingTime(event.atMs)}</time>
                                <span>
                                  {eventTitle(eventType, event.data)}
                                  {eventType === "activity" &&
                                    activityDetail(event.data) && (
                                      <small className="recording-event-detail">
                                        {activityDetail(event.data)}
                                      </small>
                                    )}
                                </span>
                              </button>
                            </li>
                          ))}
                        </ol>
                      ) : (
                        <p className="recording-state">
                          {evidenceScope === "playhead" && totalEvents > 0
                            ? `No ${diagnosticTab} events at this point. Play or seek forward, or choose All events to jump.`
                            : `No ${diagnosticTab} events were captured.`}
                        </p>
                      ))}
                    {diagnosticTab === "network" &&
                      (visibleExchanges.length ? (
                        <div className="recording-network">
                          <ol className="recording-events" ref={eventListRef}>
                            {visibleExchanges.map((item) => (
                              <li key={item.key}>
                                <button
                                  type="button"
                                  aria-expanded={selectedRequest === item.key}
                                  aria-current={
                                    activeExchangeKey === item.key ? "true" : undefined
                                  }
                                  onClick={() => {
                                    setSelectedRequest(item.key);
                                    seek(item.atMs);
                                  }}
                                >
                                  <time>{formatRecordingTime(item.atMs)}</time>
                                  <span>
                                    <strong>{item.method || "Request"}</strong>{" "}
                                    {reachedExchanges.find(
                                      (current) => current.key === item.key,
                                    )?.status ?? "—"}{" "}
                                    <span className="recording-break">
                                      {item.url || "URL unavailable"}
                                    </span>
                                  </span>
                                </button>
                              </li>
                            ))}
                          </ol>
                          {activeRequest && <NetworkDetail exchange={activeRequest} />}
                        </div>
                      ) : (
                        <p className="recording-state">
                          {evidenceScope === "playhead" && exchanges.length > 0
                            ? "No network requests at this point. Play or seek forward, or choose All events to jump."
                            : "No network events were captured."}
                        </p>
                      ))}
                    {diagnosticTab === "environment" && (
                      <div className="recording-environment">
                        <h3>Browser environment</h3>
                        <pre>{evidenceText(recording.environment)}</pre>
                        <h3>Capture notes</h3>
                        <ul>
                          {recording.coverage.map((item, index) => (
                            <li key={`${item.channel}-${index}`}>
                              <strong>{item.channel}</strong>: {item.status}
                              {item.detail ? ` · ${item.detail}` : ""}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
