import React from "react";
import { Icon } from "../icons.js";
import { eventTitle } from "./diagnostics-panel.js";
import { formatRecordingTime, type Recording, type RecordingChannel } from "./model.js";

export type MediaMode = "replay" | "video";

type TimelineMark = {
  atMs: number;
  type: RecordingChannel | "point";
  label: string;
  error: boolean;
  count: number;
  position: number;
  requestId?: string;
};

export function recordingTimelineMarks(
  recording: Recording,
  annotationFrames: { annotation: { id: string; body: string; atMs: number } }[],
): TimelineMark[] {
  const marks = new Map<string, TimelineMark>();
  for (const event of recording.events) {
    if (!["activity", "console", "network", "performance"].includes(event.type)) continue;
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
}

export function RecordingTimeline({
  recording,
  marks,
  cursorMs,
  mediaMode,
  replayReady,
  videoAvailable,
  videoGap,
  videoMuted,
  playing,
  togglePlayback,
  toggleMute,
  enterFullscreen,
  seek,
  selectMark,
}: {
  recording: Recording;
  marks: TimelineMark[];
  cursorMs: number;
  mediaMode: MediaMode;
  replayReady: boolean;
  videoAvailable: boolean;
  videoGap: boolean;
  videoMuted: boolean;
  playing: boolean;
  togglePlayback: () => void;
  toggleMute: () => void;
  enterFullscreen: () => void;
  seek: (atMs: number) => void;
  selectMark: (mark: TimelineMark) => void;
}) {
  return (
    <div className="recording-timeline">
      <div className="recording-playback-actions">
        <button
          type="button"
          disabled={mediaMode === "replay" ? !replayReady : !videoAvailable || videoGap}
          onClick={togglePlayback}
        >
          {playing ? `Pause ${mediaMode}` : `Play ${mediaMode}`}
        </button>
        {mediaMode === "video" && videoAvailable && (
          <>
            <button
              type="button"
              className="recording-icon-button"
              aria-label={videoMuted ? "Unmute video" : "Mute video"}
              title={videoMuted ? "Unmute video" : "Mute video"}
              onClick={toggleMute}
            >
              <Icon name={videoMuted ? "volumeOff" : "volume"} />
            </button>
            <button
              type="button"
              className="recording-icon-button"
              aria-label="Full screen video"
              title="Full screen video"
              onClick={enterFullscreen}
            >
              <Icon name="expand" />
            </button>
          </>
        )}
      </div>
      <label htmlFor="thread-recording-timeline" className="sr-only">
        Session position
      </label>
      <input
        id="thread-recording-timeline"
        type="range"
        min="0"
        max={Math.max(recording.durationMs, 1)}
        step="100"
        value={cursorMs}
        onChange={(event) => seek(Number(event.target.value))}
        aria-valuetext={`${formatRecordingTime(cursorMs)} of ${formatRecordingTime(recording.durationMs)} in the recorded session`}
      />
      <div className="recording-timeline-marks" aria-label="Events on recording timeline">
        {marks.map((mark, index) => (
          <button
            key={`${mark.type}-${mark.position}-${index}`}
            type="button"
            className="recording-timeline-mark"
            data-channel={mark.type}
            data-error={mark.error}
            data-align={
              mark.position < 35 ? "start" : mark.position > 165 ? "end" : "center"
            }
            style={{ left: `${mark.position / 2}%` }}
            aria-label={`${mark.type} at ${formatRecordingTime(mark.atMs)}: ${mark.label}`}
            onClick={() => selectMark(mark)}
          >
            <span className="recording-mark-tooltip" role="tooltip">
              <strong>
                {formatRecordingTime(mark.atMs)} ·{" "}
                {mark.type === "point"
                  ? "Comment"
                  : mark.type.charAt(0).toUpperCase() + mark.type.slice(1)}
              </strong>
              <span>
                {mark.label}
                {mark.count > 1 ? ` · ${mark.count} events` : ""}
              </span>
            </span>
          </button>
        ))}
      </div>
      <output htmlFor="thread-recording-timeline" title="Recorded session time">
        {formatRecordingTime(cursorMs)} / {formatRecordingTime(recording.durationMs)}
      </output>
    </div>
  );
}
