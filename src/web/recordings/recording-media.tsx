import React from "react";
import { formatRecordingTime } from "./model.js";

export type FrameAsset = {
  id: string;
  url: string;
  recordingFrame: {
    recordingId: string;
    atMs: number;
    videoTimeMs?: number;
    annotationId?: string;
  };
};

export function RecordingReplayStage({
  stageRef,
  eventsAvailable,
  replayExpired,
  stoppedAtMs,
  error,
}: {
  stageRef: React.RefObject<HTMLDivElement | null>;
  eventsAvailable: boolean;
  replayExpired: boolean;
  stoppedAtMs: number | null;
  error: string;
}) {
  if (!eventsAvailable)
    return (
      <p className="recording-state">
        Replay was not captured. Check coverage and the diagnostic evidence.
      </p>
    );
  return (
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
          DOM capture ended at {formatRecordingTime(stoppedAtMs!)}. This later moment has
          no page reconstruction. Use the video or diagnostic events for the remaining
          recording.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <p className="recording-footnote">
        Captured page resources are withheld during replay. Layout may differ from the
        original page.
      </p>
    </>
  );
}

export function RecordingVideoStage({
  videoRef,
  src,
  gap,
  onPlay,
  onPause,
  onLoadedMetadata,
  onFrameReady,
  onSeeking,
  onTimeUpdate,
  onTogglePlayback,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  src: string;
  gap: boolean;
  onPlay: (video: HTMLVideoElement) => void;
  onPause: () => void;
  onLoadedMetadata: () => void;
  onFrameReady: (video: HTMLVideoElement) => void;
  onSeeking: () => void;
  onTimeUpdate: (video: HTMLVideoElement) => void;
  onTogglePlayback: () => void;
}) {
  return (
    <div className="recording-video-stage">
      <video
        ref={videoRef}
        preload="metadata"
        src={src}
        aria-label="Linked recording video"
        tabIndex={0}
        onClick={(event) => {
          event.currentTarget.focus({ preventScroll: true });
          onTogglePlayback();
        }}
        onKeyDown={(event) => {
          if (event.key === " " || event.key === "Enter") {
            event.preventDefault();
            onTogglePlayback();
          }
        }}
        onPlay={(event) => onPlay(event.currentTarget)}
        onPause={onPause}
        onEnded={onPause}
        onLoadedMetadata={onLoadedMetadata}
        onLoadedData={(event) => onFrameReady(event.currentTarget)}
        onCanPlay={(event) => onFrameReady(event.currentTarget)}
        onSeeking={onSeeking}
        onSeeked={(event) => onFrameReady(event.currentTarget)}
        onTimeUpdate={(event) => onTimeUpdate(event.currentTarget)}
      />
      {gap && (
        <div className="recording-video-gap" role="status">
          No video frame was retained at this session moment. Select another point on the
          timeline.
        </div>
      )}
    </div>
  );
}

export function RecordingFrameControls({
  canWrite,
  canSaveFrame,
  frameBusy,
  onSave,
  onAnnotate,
  error,
  displayedFrame,
  videoGap,
}: {
  canWrite: boolean;
  canSaveFrame: boolean;
  frameBusy: boolean;
  onSave: () => void;
  onAnnotate?: () => void;
  error: string;
  displayedFrame: FrameAsset | null;
  videoGap: boolean;
}) {
  return (
    <>
      {canWrite && (
        <div className="recording-frame-actions">
          <button type="button" disabled={!canSaveFrame} onClick={onSave}>
            {frameBusy ? "Saving frame…" : "Save frame"}
          </button>
          {onAnnotate && (
            <button type="button" disabled={!canSaveFrame} onClick={onAnnotate}>
              Annotate frame
            </button>
          )}
          <span>
            Choose a moment in the activity or timeline, then save or mark its frame on
            this thread.
          </span>
        </div>
      )}
      {error && (
        <p className="recording-frame-error" role="alert">
          {error}
        </p>
      )}
      {displayedFrame && (
        <div className="recording-saved-frame" role="status">
          <a href={displayedFrame.url} target="_blank" rel="noopener noreferrer">
            <img
              src={displayedFrame.url}
              alt={`Saved frame at ${formatRecordingTime(displayedFrame.recordingFrame.atMs)}`}
              loading="lazy"
            />
            <span>
              Saved frame at {formatRecordingTime(displayedFrame.recordingFrame.atMs)}
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
  );
}
