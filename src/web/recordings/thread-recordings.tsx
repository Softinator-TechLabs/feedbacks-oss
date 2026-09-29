import React, { useEffect, useMemo, useRef, useState } from "react";
import type { Replayer } from "@rrweb/replay";
import "@rrweb/replay/dist/style.css";
import { installReplayResourcePolicy } from "./replay-policy.js";
import { api, ApiError, errorText, uid, type Thread } from "../api.js";
import {
  clampTime,
  formatRecordingTime,
  mapRecordingToVideoTime,
  mapVideoToRecordingTime,
  prepareReplayEvents,
  recordingAnnotation,
  type Recording,
  type RecordingSummary,
} from "./model.js";
import {
  RecordingDiagnostics,
  type DiagnosticTab,
  type EvidenceScope,
} from "./diagnostics-panel.js";
import {
  RecordingTimeline,
  recordingTimelineMarks,
  type MediaMode,
} from "./recording-timeline.js";
import {
  RecordingFrameControls,
  RecordingReplayStage,
  RecordingVideoStage,
  type FrameAsset,
} from "./recording-media.js";
import "./thread-recordings.css";

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
  const [followPlayback, setFollowPlayback] = useState(true);
  const [cursorMs, setCursorMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [videoMuted, setVideoMuted] = useState(false);
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
  const playerShellRef = useRef<HTMLElement>(null);
  const cursorRef = useRef(0);
  const replayStartRef = useRef(0);
  const replayClockRef = useRef<{ atMs: number; startedAt: number } | null>(null);
  const requestSerial = useRef(0);
  const pendingVideoSeekRef = useRef<number | null>(null);
  const selectedVideoGapRef = useRef(false);
  const videoSeekAttemptsRef = useRef(0);
  const pendingFrameRef = useRef<PendingFrame | null>(null);

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
    setFollowPlayback(true);
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

  const timelineMarks = useMemo(
    () => (recording ? recordingTimelineMarks(recording, annotationFrames) : []),
    [recording, thread.assets, thread.context?.annotations],
  );

  return (
    <section
      className="thread-recordings"
      ref={playerShellRef}
      aria-labelledby="thread-recordings-heading"
    >
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
              <RecordingTimeline
                recording={recording}
                marks={timelineMarks}
                cursorMs={cursorMs}
                mediaMode={mediaMode}
                replayReady={replayReady}
                videoAvailable={!!videoAsset}
                videoGap={!!videoGap}
                videoMuted={videoMuted}
                playing={playing}
                togglePlayback={() => {
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
                    player.play(Math.max(0, cursorRef.current - replayStartRef.current));
                    setFollowPlayback(true);
                    setPlaying(true);
                  }
                }}
                toggleMute={() => {
                  const video = videoRef.current;
                  if (!video) return;
                  video.muted = !video.muted;
                  setVideoMuted(video.muted);
                }}
                enterFullscreen={() => void playerShellRef.current?.requestFullscreen()}
                seek={seek}
                selectMark={(mark) => {
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
              />
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
                      <RecordingReplayStage
                        stageRef={stageRef}
                        eventsAvailable={replayEvents.length >= 2}
                        replayExpired={replayExpired}
                        stoppedAtMs={replayStoppedAtMs}
                        error={replayError}
                      />
                    )}
                    {mediaMode === "video" &&
                      (videoAsset && recording.video ? (
                        <>
                          <RecordingVideoStage
                            videoRef={videoRef}
                            src={videoAsset.url}
                            gap={!!videoGap}
                            onPlay={(video) => {
                              selectedVideoGapRef.current = false;
                              checkVideoFrame(video);
                              setDiagnosticTab("everything");
                              setEvidenceScope("all");
                              setFollowPlayback(true);
                              setPlaying(true);
                            }}
                            onPause={() => setPlaying(false)}
                            onLoadedMetadata={() => alignVideo(cursorRef.current)}
                            onFrameReady={checkVideoFrame}
                            onSeeking={() => setVideoReady(false)}
                            onTimeUpdate={(video) => {
                              if (
                                !recording.video ||
                                selectedVideoGapRef.current ||
                                pendingVideoSeekRef.current !== null ||
                                video.seeking
                              )
                                return;
                              const mapped = mapVideoToRecordingTime(
                                video.currentTime * 1000,
                                recording.video,
                              );
                              if (mapped !== null) {
                                cursorRef.current = clampTime(
                                  mapped,
                                  recording.durationMs,
                                );
                                setCursorMs(cursorRef.current);
                                if (
                                  video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
                                )
                                  setVideoReady(true);
                              }
                            }}
                          />
                          <RecordingFrameControls
                            canWrite={canWrite}
                            canSaveFrame={canSaveFrame}
                            frameBusy={frameBusy}
                            onSave={() => void saveCurrentFrame()}
                            onAnnotate={
                              onAnnotateFrame ? annotateCurrentFrame : undefined
                            }
                            error={frameError}
                            displayedFrame={displayedFrame}
                            videoGap={!!videoGap}
                          />
                        </>
                      ) : (
                        <p className="recording-state">
                          The linked video is unavailable with this thread.
                        </p>
                      ))}
                  </div>
                </div>

                <RecordingDiagnostics
                  recording={recording}
                  cursorMs={cursorMs}
                  seek={seek}
                  playing={playing}
                  followPlayback={followPlayback}
                  setFollowPlayback={setFollowPlayback}
                  diagnosticTab={diagnosticTab}
                  setDiagnosticTab={setDiagnosticTab}
                  evidenceScope={evidenceScope}
                  setEvidenceScope={setEvidenceScope}
                  selectedRequest={selectedRequest}
                  setSelectedRequest={setSelectedRequest}
                />
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
