import { sourceToVideo } from "./review-model.js";

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
      filename: `${frame.annotationId ? "comment" : "frame"}-${frame.atMs}.png`,
      recordingFrame: {
        recordingId,
        atMs: frame.atMs,
        ...(frame.videoTimeMs !== undefined ? { videoTimeMs: frame.videoTimeMs } : {}),
        ...(frame.annotationId ? { annotationId: frame.annotationId } : {}),
      },
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

// Annotation source times stay immutable. Recompute only the output video time
// after an edit, and omit comments whose source moment was removed from the clip.
export function mapAnnotationFrames(items, video, durationMs = Infinity) {
  return items.flatMap((item) => {
    const videoTimeMs = video ? sourceToVideo(item.atMs, video) : undefined;
    if (video && (videoTimeMs === null || videoTimeMs < 0 || videoTimeMs > durationMs))
      return [];
    return [
      {
        ...item,
        annotationId: item.id,
        key: `annotation-${item.id}`,
        ...(video ? { videoTimeMs } : { videoTimeMs: undefined }),
      },
    ];
  });
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
