import { finalizeWebmMetadata } from "./video/video-metadata.js";
import { VIDEO_MAX_BYTES, VIDEO_MAX_MS, recordingOptions } from "./video/video-media.js";
import { putVideoDraft } from "./video-draft-store.js";
import {
  recordingDefaults,
  requireMicrophonePermission,
  captureMicrophone,
  audioAccessError,
} from "./recordings/audio-access.js";

const port = chrome.runtime.connect({ name: "feedbacks-video-offscreen" });
let capture = null;

async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw Error(response?.error || "Recording context is unavailable.");
  return response.data;
}

function elapsed(current) {
  return Math.max(
    0,
    Math.min(
      VIDEO_MAX_MS,
      (current.stoppedAt || current.pausedAt || performance.now()) -
        current.startedAt -
        current.pausedMs,
    ),
  );
}

function publish(current, state, extra = {}) {
  current.state = state;
  port.postMessage({
    sourceTabId: current.sourceTabId,
    reviewId: current.reviewId,
    state,
    elapsedMs: Math.round(current.startedAt ? elapsed(current) : 0),
    ...extra,
  });
}

function closeInterval(current) {
  if (!current.openInterval) return;
  const end = Math.min(VIDEO_MAX_MS, Date.now() - current.debugStarted);
  if (end > current.openInterval.sourceStartMs)
    current.mediaIntervals.push({ ...current.openInterval, sourceEndMs: end });
  current.openInterval = null;
}

function release(current) {
  clearInterval(current.heartbeat);
  clearTimeout(current.limit);
  current.stream?.getTracks().forEach((track) => track.stop());
  current.microphone?.getTracks().forEach((track) => track.stop());
  current.tabAudioTracks?.forEach((track) => track.stop());
  if (current.audioContext) void current.audioContext.close();
}

async function start(message) {
  if (capture && ["starting", "recording", "paused", "stopping"].includes(capture.state))
    throw Error("Another tab video is already recording.");
  const current = {
    sourceTabId: message.sourceTabId,
    reviewId: message.reviewId,
    debugStarted: message.debugStarted,
    streamId: message.streamId,
    options: recordingDefaults(message.options),
    state: "starting",
    startedAt: 0,
    stoppedAt: 0,
    pausedAt: 0,
    pausedMs: 0,
    mediaIntervals: [],
    openInterval: null,
    chunks: [],
    bytes: 0,
  };
  capture = current;
  publish(current, "starting");
  try {
    if (current.options.microphone) await requireMicrophonePermission();
    let stream = await navigator.mediaDevices.getUserMedia({
      video: {
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: current.streamId,
          maxFrameRate: 24,
        },
      },
      audio: current.options.tabAudio
        ? {
            mandatory: {
              chromeMediaSource: "tab",
              chromeMediaSourceId: current.streamId,
            },
          }
        : false,
    });
    current.stream = stream;
    if (current.options.tabAudio && !stream.getAudioTracks().length)
      throw audioAccessError("tab-audio-missing");
    if (stream.getAudioTracks().length) {
      current.audioContext = new AudioContext();
      current.audioContext
        .createMediaStreamSource(new MediaStream(stream.getAudioTracks()))
        .connect(current.audioContext.destination);
      await current.audioContext.resume();
    }
    if (current.options.microphone) {
      current.microphone = await captureMicrophone();
      current.audioContext ||= new AudioContext();
      const destination = current.audioContext.createMediaStreamDestination();
      if (stream.getAudioTracks().length)
        current.audioContext
          .createMediaStreamSource(new MediaStream(stream.getAudioTracks()))
          .connect(destination);
      current.audioContext
        .createMediaStreamSource(current.microphone)
        .connect(destination);
      await current.audioContext.resume();
      current.tabAudioTracks = stream.getAudioTracks();
      stream = new MediaStream([
        stream.getVideoTracks()[0],
        ...destination.stream.getAudioTracks(),
      ]);
      current.stream = stream;
    }
    const videoTrack = stream.getVideoTracks()[0];
    if ("contentHint" in videoTrack) videoTrack.contentHint = "detail";
    const recorder = new MediaRecorder(
      stream,
      recordingOptions(stream.getAudioTracks().length > 0),
    );
    current.recorder = recorder;
    recorder.onerror = () => {
      current.failed = true;
      stop();
    };
    recorder.ondataavailable = (event) => {
      if (!event.data.size) return;
      current.bytes += event.data.size;
      if (current.bytes > VIDEO_MAX_BYTES) {
        current.failed = true;
        stop();
        return;
      }
      current.chunks.push(event.data);
    };
    recorder.onpause = () =>
      publish(current, "paused", {
        sourceAtMs: current.mediaIntervals.at(-1)?.sourceEndMs,
      });
    recorder.onresume = () => publish(current, "recording");
    recorder.onstop = () => void finalize(current);
    videoTrack.addEventListener("ended", () => stop(), { once: true });
    current.startedAt = performance.now();
    current.videoStartWall = Date.now();
    current.openInterval = {
      sourceStartMs: Math.min(
        VIDEO_MAX_MS,
        current.videoStartWall - current.debugStarted,
      ),
      outputStartMs: 0,
    };
    recorder.start(1000);
    current.limit = setTimeout(() => stop(), VIDEO_MAX_MS);
    current.heartbeat = setInterval(() => publish(current, current.state), 10000);
    publish(current, "recording");
  } catch (error) {
    release(current);
    await send({ type: "sessionDiscard" }).catch(() => {});
    publish(current, "idle", { error: error.message, audioCode: error.audioCode });
    capture = null;
  }
}

function setPaused(current, pause) {
  if (pause && current.recorder?.state === "recording") {
    current.pausedAt = performance.now();
    closeInterval(current);
    current.recorder.pause();
  } else if (!pause && current.recorder?.state === "paused") {
    current.pausedMs += performance.now() - current.pausedAt;
    current.pausedAt = 0;
    current.openInterval = {
      sourceStartMs: Math.min(VIDEO_MAX_MS, Date.now() - current.debugStarted),
      outputStartMs: Math.round(elapsed(current)),
    };
    current.recorder.resume();
  }
}

function stop() {
  const current = capture;
  if (!current || !["recording", "paused"].includes(current.state)) return;
  current.stoppedAt = current.pausedAt || performance.now();
  closeInterval(current);
  publish(current, "stopping");
  if (current.recorder.state !== "inactive") current.recorder.stop();
}

async function finalize(current) {
  release(current);
  try {
    if (current.failed || !current.chunks.length)
      throw Error(
        current.failed
          ? "Video exceeded the 40 MiB limit or the recorder failed."
          : "No video was recorded.",
      );
    const durationMs = Math.max(1, Math.min(VIDEO_MAX_MS, Math.round(elapsed(current))));
    const raw = new Blob(current.chunks, { type: "video/webm" });
    let blob = raw;
    let videoWarning;
    try {
      blob = await finalizeWebmMetadata(raw, durationMs);
    } catch (error) {
      // MediaRecorder's original WebM remains locally reviewable and retryable.
      videoWarning = `Duration metadata could not be repaired: ${error.message}`;
    }
    const debugStop = await send({ type: "sessionStop" }).catch((error) => ({
      error: error.message,
    }));
    const draftId = crypto.randomUUID();
    await putVideoDraft(draftId, {
      blob,
      durationMs,
      videoStartWall: current.videoStartWall,
      mediaIntervals: current.mediaIntervals,
      debugStarted: current.debugStarted,
      recordingId: debugStop?.recording?.id,
      diagnosticError: debugStop?.error,
      videoWarning,
      sourceTabId: current.sourceTabId,
      reviewId: current.reviewId,
    });
    publish(current, "ready", { draftId });
  } catch (error) {
    await send({ type: "sessionDiscard" }).catch(() => {});
    publish(current, "idle", { error: error.message });
  } finally {
    capture = null;
  }
}

let readyTimer;
port.onMessage.addListener((message) => {
  if (message.action === "start") {
    clearInterval(readyTimer);
    void start(message);
  }
  if (message.action === "stop") stop();
  if (message.action === "pause" && capture) setPaused(capture, true);
  if (message.action === "resume" && capture) setPaused(capture, false);
});
port.onDisconnect.addListener(() => {
  clearInterval(readyTimer);
  stop();
});
// A port may connect before this module has installed its message listener.
// Confirm readiness before the worker sends the one-use stream configuration.
port.postMessage({ action: "ready" });
readyTimer = setInterval(() => port.postMessage({ action: "ready" }), 500);
