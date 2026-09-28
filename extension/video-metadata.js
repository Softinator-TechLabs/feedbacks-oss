import { VIDEO_MAX_BYTES, VIDEO_MAX_MS } from "./video-media.js";

// The package is bundled as a local extension script before video.js runs.
// MediaRecorder omits WebM duration metadata; keep the measured recording clock.
export async function finalizeWebmMetadata(blob, durationMs, options = {}) {
  const { signal, fix = globalThis.__feedbacksFixWebmDuration } = options;
  if (!(blob instanceof Blob) || !blob.type.startsWith("video/webm"))
    throw Error("The local recording is not WebM video.");
  if (!Number.isInteger(durationMs) || durationMs < 1 || durationMs > VIDEO_MAX_MS)
    throw Error("The measured video duration is invalid.");
  if (blob.size > VIDEO_MAX_BYTES)
    throw Error("Video exceeds 40 MiB. Try a shorter clip.");
  if (signal?.aborted) throw Error("Export cancelled. Original recording kept.");
  if (typeof fix !== "function")
    throw Error("Local video metadata repair is unavailable. Reload this recorder.");
  const repaired = await fix(blob, durationMs, { logger: false });
  if (signal?.aborted) throw Error("Export cancelled. Original recording kept.");
  if (!(repaired instanceof Blob) || !repaired.type.startsWith("video/webm"))
    throw Error("Could not finalize the WebM recording.");
  if (repaired.size > VIDEO_MAX_BYTES)
    throw Error("Video exceeds 40 MiB after finalization. Try a shorter clip.");
  return repaired;
}
