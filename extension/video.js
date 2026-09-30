import { prepareCaptureOrigins } from "./session/session-origins.js";
import {
  recordingDefaults,
  captureMicrophone,
  audioAccessError,
} from "./recordings/audio-access.js";
import {
  createSessionReview,
  reviewTime,
  uploadReviewFrames,
  videoTrimState,
  mapAnnotationFrames,
} from "./session-review.js";
import {
  captureHandleMatches,
  videoSegments,
  clipRecording,
  canKeepReplayPrefix,
  captureOrigins,
} from "./session/session-capture.js";
import { createVideoTimeline } from "./video/video-timeline.js";
import { createCaptureHealth } from "./video/capture-health.js";
import { createCropControls } from "./video/crop-controls.js";
import { finalizeWebmMetadata } from "./video/video-metadata.js";
import { uploadVideoWithProgress } from "./video-upload.js";
import { getVideoDraft, deleteVideoDraft } from "./video-draft-store.js";
import {
  VIDEO_MAX_BYTES,
  VIDEO_MAX_MS,
  recordingOptions,
  exportVideo,
} from "./video/video-media.js";
const $ = (id) => document.getElementById(id);
const recorderUrl = new URL(location.href);
const sourceTabId = Number(recorderUrl.searchParams.get("sourceTabId"));
const draftId = recorderUrl.searchParams.get("draftId");
const autoStart = recorderUrl.searchParams.get("autoStart") === "1";
let captureDefaults = {},
  pendingTabError;
// Stream IDs expire quickly; consume the one-use ID before server context loads.
const pendingTabStream = autoStart
  ? chrome.storage.local
      .get("videoRecordingOptions")
      .then(async (saved) => {
        captureDefaults = recordingDefaults(saved.videoRecordingOptions);
        const result = await chrome.runtime.sendMessage({
          type: "videoStreamId",
          sourceTabId,
        });
        if (!result.ok) throw Error(result.error);
        const streamId = result.data.streamId;
        return navigator.mediaDevices.getUserMedia({
          video: {
            mandatory: {
              chromeMediaSource: "tab",
              chromeMediaSourceId: streamId,
              maxFrameRate: 24,
            },
          },
          audio: captureDefaults.tabAudio
            ? {
                mandatory: {
                  chromeMediaSource: "tab",
                  chromeMediaSourceId: streamId,
                },
              }
            : false,
        });
      })
      .catch((error) => {
        pendingTabError = error;
        return null;
      })
  : null;
const maxBytes = VIDEO_MAX_BYTES;
const maxMs = VIDEO_MAX_MS;
let tabAudioTracks = [];
let inspector, debugStopped, submittedCapture;
let savedFrames = [];
let annotationItems = [],
  annotationFrames = [],
  annotationsRecordingId,
  reviewGeneration = 0;
function reviewVideoMapping() {
  return {
    offsetMs: debugSession.started - videoStartWall,
    ...(!debugAligned
      ? {
          segments: videoSegments(
            mediaIntervals,
            appliedTrim?.start || 0,
            appliedTrim?.end || originalDuration,
          ),
        }
      : {}),
  };
}
async function loadRecordingAnnotations() {
  if (!debugSession || annotationsRecordingId === debugStopped?.recording.id) return;
  const recordingId = debugStopped?.recording.id;
  const generation = reviewGeneration;
  const result = await send({ type: "recordingAnnotations" });
  if (generation !== reviewGeneration)
    throw Error("The recording changed. Review it before sending.");
  if (!recordingId || result.recordingId !== recordingId)
    throw Error("Screenshot comments belong to another recording. Reload this review.");
  annotationItems = result.items;
  annotationsRecordingId = recordingId;
}
function renderSavedFrames() {
  const root = $("saved-frames");
  root.replaceChildren();
  root.hidden = !savedFrames.length;
  for (const frame of savedFrames) {
    const row = document.createElement("div"),
      img = document.createElement("img"),
      label = document.createElement("span"),
      remove = document.createElement("button");
    img.src = frame.imageBase64;
    img.alt = `Saved video frame at ${reviewTime(frame.atMs)}`;
    img.width = 160;
    label.textContent = `Frame at ${reviewTime(frame.atMs)} · shared when you send`;
    remove.textContent = "Remove";
    remove.disabled = !!createAttempt;
    remove.onclick = () => {
      if (createAttempt) return;
      savedFrames = savedFrames.filter((f) => f !== frame);
      renderSavedFrames();
    };
    row.append(img, label, remove);
    root.append(row);
  }
}
function saveReviewFrame(atMs, videoTimeMs) {
  try {
    if (createAttempt) throw Error("Frame selection is frozen for this submission.");
    if (savedFrames.length >= 5)
      throw Error("You can save up to 5 frames per recording.");
    const video = $("preview");
    if (video.seeking || video.readyState < 2)
      throw Error("Wait for this frame to finish seeking, then save it.");
    video.pause();
    const canvas = document.createElement("canvas"),
      ratio = Math.min(1, 1280 / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * ratio);
    canvas.height = Math.round(video.videoHeight * ratio);
    canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageBase64 = canvas.toDataURL("image/png");
    if (imageBase64.length > 2800000)
      throw Error("This frame exceeds the local frame limit.");
    savedFrames.push({
      atMs: Math.round(atMs),
      videoTimeMs: Math.round(videoTimeMs),
      imageBase64,
      key: crypto.randomUUID(),
    });
    renderSavedFrames();
    status("Frame saved locally. It will be shared with the recording when you send.");
  } catch (error) {
    status(error.message);
  }
}
async function refreshDebugReview() {
  if (!debugSession || !debugStop) return;
  const generation = reviewGeneration;
  debugStopped = await debugStop;
  if (generation !== reviewGeneration) return;
  await loadRecordingAnnotations();
  if (generation !== reviewGeneration) return;
  const segments = videoSegments(
    mediaIntervals,
    appliedTrim?.start || 0,
    appliedTrim?.end || originalDuration,
  );
  const video = reviewVideoMapping();
  if (!createAttempt)
    annotationFrames = mapAnnotationFrames(annotationItems, video, durationMs);
  const recording = !debugAligned
    ? clipRecording(debugStopped.recording, segments, {
        keepReplayPrefix: canKeepReplayPrefix({
          offsetMs: debugSession.started - videoStartWall,
          segments,
        }),
      })
    : debugStopped.recording;
  inspector?.dispose();
  inspector = createSessionReview($("capture-inspector"), {
    recording,
    videoElement: $("preview"),
    video,
    timelineStartMs: appliedTrim?.start || 0,
    timelineDurationMs: originalDuration,
    onFrame: saveReviewFrame,
    annotations: annotationFrames,
  });
}

let captureHandle,
  debugSession,
  debugStop,
  videoStartWall,
  debugAligned = true,
  uploadedVideo;
let mediaIntervals = [],
  openInterval,
  appliedTrim = null;
function closeMediaInterval() {
  if (!openInterval || !debugSession) return;
  const end = Math.min(300000, Date.now() - debugSession.started);
  if (end > openInterval.sourceStartMs)
    mediaIntervals.push({ ...openInterval, sourceEndMs: end });
  openInterval = null;
}
let microphone,
  audioContext,
  originalBlob,
  originalDuration,
  originalUrl,
  exportController;
let stream,
  recorder,
  timer,
  previewUrl,
  blob,
  durationMs,
  startedAt,
  stoppedAt = 0,
  pausedAt = 0,
  pausedMs = 0,
  tooLarge = false,
  recordingFailed = false,
  preparingVideo = false;
async function showReview() {
  originalUrl = URL.createObjectURL(originalBlob);
  previewUrl = URL.createObjectURL(blob);
  $("preview").src = previewUrl;
  $("preview").hidden = false;
  $("review").hidden = false;
  $("editing").hidden = false;
  $("trim-playback").hidden = false;
  $("video-edit-tools").hidden = false;
  document.body?.classList.add("has-recording");
  $("start").hidden = !!draftId;
  $("start").textContent = "Record again";
  $("timer").textContent =
    `${(durationMs / 1000).toFixed(1)} seconds · ${(blob.size / 1024 / 1024).toFixed(1)} MiB`;
  ["crop-left", "crop-top", "crop-width", "crop-height"].forEach(
    (id, i) => ($(id).value = i < 2 ? "0" : "100"),
  );
  $("trim-start").value = "0";
  $("trim-end").value = (durationMs / 1000).toFixed(3);
  timeline.load(originalUrl, originalDuration / 1000);
  $("edit-state").textContent = "";
  $("discard").hidden = false;
  publishState("ready");
  status("Review the recording, then send or discard it.");
  void refreshDebugReview().catch((error) => status(error.message));
}
async function loadDraft() {
  const draft = await getVideoDraft(draftId);
  if (!draft || draft.sourceTabId !== sourceTabId || draft.reviewId !== target.reviewId)
    throw Error(
      "This video draft is unavailable. Start a new recording from the website.",
    );
  blob = originalBlob = draft.blob;
  durationMs = originalDuration = draft.durationMs;
  videoStartWall = draft.videoStartWall;
  mediaIntervals = draft.mediaIntervals || [];
  debugAligned = mediaIntervals.length <= 1;
  startedAt = performance.now() - durationMs;
  stoppedAt = performance.now();
  let capture = await send({ type: "sessionStatus" });
  if (
    capture?.active &&
    capture?.recording?.id === draft.recordingId &&
    capture.target?.sourceTabId === sourceTabId &&
    capture.target?.reviewId === target.reviewId
  )
    capture = await send({ type: "sessionStop" }).catch(() => capture);
  if (
    capture?.active === false &&
    capture?.recording?.id === draft.recordingId &&
    capture.target?.sourceTabId === sourceTabId &&
    capture.target?.reviewId === target.reviewId
  ) {
    debugSession = { started: draft.debugStarted };
    debugStop = Promise.resolve(capture);
    debugStopped = capture;
    $("debug-status").textContent =
      "Session activity, console, network and replay are ready for review.";
  } else {
    $("debug-status").textContent = draft.diagnosticError
      ? `Session diagnostics could not finish: ${draft.diagnosticError}. The video draft is still here.`
      : "Session diagnostics are unavailable in this browser. The video draft is still here.";
  }
  await showReview();
  if (draft.videoWarning)
    status(`${draft.videoWarning}. Review the video before sending.`);
}
let thread,
  uploadKey,
  serverOrigin,
  target,
  createAttempt,
  createKey = crypto.randomUUID();
const port = chrome.runtime.connect({ name: "feedbacks-video" });
let connected = true,
  nativeState = "idle";
const recordingElapsed = () =>
  Number.isFinite(startedAt)
    ? Math.max(
        0,
        Math.min(
          maxMs,
          (stoppedAt || pausedAt || performance.now()) - startedAt - pausedMs,
        ),
      )
    : 0;
function publishState(state = nativeState, heartbeat = false) {
  nativeState = state;
  document.body.classList.toggle(
    "recording-active",
    ["starting", "recording", "paused", "stopping"].includes(state),
  );
  const elapsedMs = ["idle", "starting"].includes(state)
    ? 0
    : Math.round(recordingElapsed());
  if (connected)
    port.postMessage({
      state,
      elapsedMs,
      ...(state === "paused" && mediaIntervals.length
        ? { sourceAtMs: mediaIntervals[mediaIntervals.length - 1].sourceEndMs }
        : {}),
      ...(heartbeat ? { heartbeat: true } : {}),
    });
}
// The elapsed snapshot restores an accurate dock after source-page navigation.
// Port traffic also keeps the MV3 binding alive while recording and reviewing.
const heartbeat = setInterval(() => publishState(nativeState, true), 10000);
const captureHealth = createCaptureHealth({
  $,
  send,
  getState: () => ({ debugSession, nativeState }),
});
function pauseOrResume() {
  if (recorder?.state === "recording") {
    pausedAt = performance.now();
    closeMediaInterval();
    recorder.pause();
    if (debugSession) {
      debugAligned = false;
      $("debug-status").textContent =
        "Video pause recorded. Diagnostics will follow the kept video intervals; DOM replay is omitted after pauses.";
    }
    $("pause").textContent = "Resume recording";
    status("Paused. Resume or stop to review.");
  } else if (recorder?.state === "paused") {
    pausedMs += performance.now() - pausedAt;
    pausedAt = 0;
    if (debugSession)
      openInterval = {
        sourceStartMs: Math.min(300000, Date.now() - debugSession.started),
        outputStartMs: Math.round(recordingElapsed()),
      };
    recorder.resume();
    $("pause").textContent = "Pause recording";
    status("Recording this tab.");
  }
}
port.onMessage.addListener(({ action }) => {
  if (action === "stop") stop();
  if (action === "pause" && recorder?.state === "recording") pauseOrResume();
  if (action === "resume" && recorder?.state === "paused") pauseOrResume();
});
port.onDisconnect.addListener(() => {
  connected = false;
  clearInterval(heartbeat);
  $("start").disabled = true;
  stop();
  if (blob || !thread)
    status("Review connection closed. Review the saved recording here.");
});

async function send(message) {
  const result = await chrome.runtime.sendMessage(message);
  if (!result.ok) throw Object.assign(Error(result.error), { code: result.code });
  return result.data;
}
function status(message) {
  $("status").textContent = message;
}
function videoSendProgress(phase, percent = 0) {
  const button = $("send");
  const progress = $("upload-progress");
  const meter = $("upload-meter");
  const label = $("upload-label");
  progress.hidden = phase === "idle";
  meter.value = percent;
  button.style.setProperty("--send-progress", `${percent}%`);
  button.setAttribute("aria-busy", String(phase !== "idle" && phase !== "complete"));
  if (phase === "uploading") {
    button.textContent = `Sending ${percent}%`;
    label.textContent = `Video sent to server · ${percent}%`;
  } else if (phase === "confirming") {
    button.textContent = "Confirming video…";
    label.textContent = "Video transferred · waiting for server confirmation";
  } else if (phase === "evidence") {
    button.textContent = "Sharing activity…";
    label.textContent = "Video uploaded · sharing timeline and saved frames";
  } else if (phase === "complete") {
    button.textContent = "Video sent";
    label.textContent = "Video and selected evidence shared";
  } else {
    button.textContent = "Send video";
    button.style.removeProperty("--send-progress");
    label.textContent = "";
  }
}
async function uploadVideo(input) {
  const saved = await chrome.storage.local.get(["server", "accounts"]);
  const token = saved.accounts?.[serverOrigin]?.token;
  if (!token || saved.server !== serverOrigin || typeof XMLHttpRequest !== "function")
    return send({ type: "videoUpload", server: serverOrigin, input });
  return uploadVideoWithProgress({
    server: serverOrigin,
    token,
    input,
    onProgress: ({ phase, percent }) => videoSendProgress(phase, percent),
  });
}
function clearPreview() {
  reviewGeneration++;
  $("capture-health").hidden = true;
  inspector?.dispose();
  inspector = null;
  savedFrames = [];
  annotationItems = [];
  annotationFrames = [];
  annotationsRecordingId = undefined;
  renderSavedFrames();
  blob = null;
  editsPending = false;
  $("send").disabled = false;
  videoSendProgress("idle");
  durationMs = 0;
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
  $("preview").removeAttribute("src");
  $("preview").hidden = true;
  $("review").hidden = true;
  $("discard").hidden = true;
  $("timer").textContent = "";
  if (originalUrl) URL.revokeObjectURL(originalUrl);
  originalUrl = null;
  originalBlob = null;
  cropControls.resetFrame();
  timeline.clear();
  $("editing").hidden = true;
  $("trim-playback").hidden = true;
  $("video-edit-tools").hidden = true;
  document.body?.classList.remove("has-recording");
  $("start").textContent = "Start recording";
}
function stop() {
  if (recorder && recorder.state !== "inactive") {
    stoppedAt ||= pausedAt || performance.now();
    publishState("stopping");
  }
  captureHealth.stop();
  $("capture-health").hidden = true;
  closeMediaInterval();
  if (debugSession && !debugStop)
    debugStop = send({ type: "sessionStop" }).catch((error) => {
      $("debug-status").textContent = error.message;
      throw error;
    });
  if (recorder && recorder.state !== "inactive") recorder.stop();
  stream?.getTracks().forEach((track) => track.stop());
  microphone?.getTracks().forEach((track) => track.stop());
  microphone = null;
  tabAudioTracks.forEach((track) => track.stop());
  tabAudioTracks = [];
  if (audioContext) {
    void audioContext.close();
    audioContext = null;
  }
  clearInterval(timer);
  $("stop").hidden = true;
  $("pause").hidden = true;
}
function startError(error) {
  stop();
  clearPreview();
  $("start").disabled = !connected;
  publishState("idle");
  if (autoStart) $("start").hidden = true;
  status(
    autoStart
      ? `${error.message} Return to the website and choose Record video again.`
      : error.message,
  );
  $("audio-recovery").hidden = !error.audioCode;
  if (autoStart)
    void chrome.tabs
      .getCurrent()
      .then((tab) => chrome.tabs.update(tab.id, { active: true }))
      .catch(() => {});
}

let approvedRedirectOrigins = null;
for (const id of [
  "tab-audio",
  "microphone",
  "mask-inputs",
  "mask-text",
  "network-bodies",
]) {
  $(id).addEventListener("change", () => {
    const options = {
      tabAudio: $("tab-audio").checked,
      microphone: $("microphone").checked,
      maskInputs: $("mask-inputs").checked,
      maskText: $("mask-text").checked,
      networkBodies: $("network-bodies").checked,
    };
    void chrome.storage.local.set({ videoRecordingOptions: options }).catch(() => {});
  });
}
$("redirect-origins").oninput = () => {
  approvedRedirectOrigins = null;
};
$("authorize-redirects").onclick = async () => {
  try {
    approvedRedirectOrigins = await prepareCaptureOrigins(
      target,
      $("redirect-origins").value,
    );
    status("Redirect sites authorized. Start recording when ready.");
  } catch (error) {
    approvedRedirectOrigins = null;
    status(error.message);
  }
};
$("start").onclick = async () => {
  if (preparingVideo) return;
  if (!connected) {
    status("Open a new recorder from the current review.");
    return;
  }
  $("start").disabled = true;
  // Keep the native picker in the click gesture. It is the capture consent step.
  try {
    const allowedOrigins = $("debug-context").checked
      ? captureOrigins(
          target.origin || new URL(target.url).origin,
          $("redirect-origins").value,
        )
      : [];
    if (
      allowedOrigins.length > 1 &&
      JSON.stringify(approvedRedirectOrigins) !== JSON.stringify(allowedOrigins)
    )
      throw Error("Use Allow redirect sites before starting the recording.");
    startedAt = undefined;
    stoppedAt = pausedAt = pausedMs = 0;
    publishState("starting");
    stream = autoStart
      ? await pendingTabStream
      : await navigator.mediaDevices.getDisplayMedia({
          video: { displaySurface: "browser", frameRate: { ideal: 24, max: 24 } },
          audio: $("tab-audio").checked,
          systemAudio: "exclude",
          surfaceSwitching: "exclude",
          selfBrowserSurface: "exclude",
          monitorTypeSurfaces: "exclude",
        });
    if (!stream) throw pendingTabError || Error("Chrome could not capture this tab.");
    if (!connected)
      throw Error("Review ended. Open a new recorder from the current review.");
    if (
      !autoStart &&
      stream.getVideoTracks()[0]?.getSettings().displaySurface !== "browser"
    )
      throw Error("Choose a Chrome tab in the picker, then try again.");
    if (
      $("debug-context").checked &&
      !autoStart &&
      !captureHandleMatches(
        stream.getVideoTracks()[0]?.getCaptureHandle?.(),
        captureHandle?.handle,
        captureHandle?.origin,
      )
    )
      throw Error(
        "The selected video source could not be verified as the review tab. Select that exact tab, or turn off debug context to capture video only.",
      );
    if ($("tab-audio").checked && !stream.getAudioTracks().length)
      throw audioAccessError("tab-audio-missing");
    if (stream.getAudioTracks().length) {
      audioContext = new AudioContext();
      audioContext
        .createMediaStreamSource(new MediaStream(stream.getAudioTracks()))
        .connect(audioContext.destination);
      await audioContext.resume();
    }
    if ($("microphone").checked) {
      microphone = await captureMicrophone();
      if (!connected) throw Error("Review ended. Open a new recorder.");
      audioContext ||= new AudioContext();
      const destination = audioContext.createMediaStreamDestination();
      if (stream.getAudioTracks().length)
        audioContext
          .createMediaStreamSource(new MediaStream(stream.getAudioTracks()))
          .connect(destination);
      audioContext.createMediaStreamSource(microphone).connect(destination);
      await audioContext.resume();
      const videoTrack = stream.getVideoTracks()[0];
      tabAudioTracks = stream.getAudioTracks();
      const mixed = new MediaStream([videoTrack, ...destination.stream.getAudioTracks()]);
      stream = mixed;
    }
    if (debugSession) {
      await debugStop;
      await send({ type: "sessionDiscard" });
      debugSession = null;
      debugStop = null;
    }
    if ($("debug-context").checked) {
      debugSession = await send({
        type: "sessionStart",
        target: { ...target, allowedOrigins },
        mode: "video",
        privacy: {
          maskText: $("mask-text").checked,
          maskInputs: $("mask-inputs").checked,
          networkBodies: $("network-bodies").checked,
        },
      });
      debugStop = null;
      submittedCapture = null;
      savedFrames = [];
      renderSavedFrames();
      debugAligned = true;
      mediaIntervals = [];
      openInterval = null;
      appliedTrim = null;
      $("debug-status").textContent =
        "Debug session active · 5 minutes / 12 MiB maximum. Credentials are removed; inspect the video for private pixels.";
    }
    // Keep Chrome's source resolution and favor page text/detail over motion.
    const videoTrack = stream.getVideoTracks()[0];
    if ("contentHint" in videoTrack) videoTrack.contentHint = "detail";
    const options = recordingOptions(stream.getAudioTracks().length > 0);
    clearPreview();
    tooLarge = false;
    recordingFailed = false;
    const chunks = [];
    let bytes = 0;
    recorder = new MediaRecorder(stream, options);
    recorder.onerror = () => {
      recordingFailed = true;
      stop();
    };
    recorder.ondataavailable = (event) => {
      if (!event.data.size) return;
      bytes += event.data.size;
      if (bytes > maxBytes) {
        tooLarge = true;
        stop();
        return;
      }
      chunks.push(event.data);
    };
    const stoppedRecorder = recorder;
    recorder.onpause = () => {
      if (recorder === stoppedRecorder && recorder.state === "paused")
        publishState("paused");
    };
    recorder.onresume = () => {
      if (recorder === stoppedRecorder && recorder.state === "recording")
        publishState("recording");
    };
    recorder.onstop = async () => {
      if (recorder !== stoppedRecorder) return;
      preparingVideo = true;
      stoppedAt ||= pausedAt || performance.now();
      publishState("stopping");
      captureHealth.stop();
      durationMs = Math.max(1, Math.min(maxMs, Math.round(recordingElapsed())));
      stream?.getTracks().forEach((track) => track.stop());
      microphone?.getTracks().forEach((track) => track.stop());
      microphone = null;
      tabAudioTracks.forEach((track) => track.stop());
      tabAudioTracks = [];
      if (audioContext) {
        void audioContext.close();
        audioContext = null;
      }
      clearInterval(timer);
      $("start").disabled = true;
      $("stop").hidden = true;
      $("pause").hidden = true;
      try {
        if (tooLarge || recordingFailed || !chunks.length)
          throw Error(
            tooLarge
              ? "Recording exceeded 40 MiB. Try a shorter clip."
              : recordingFailed
                ? "Recording failed. Try again."
                : "No video was recorded.",
          );
        status("Finalizing the local video preview…");
        const raw = new Blob(chunks, { type: "video/webm" });
        const ready = await finalizeWebmMetadata(raw, durationMs);
        if (recorder !== stoppedRecorder) return;
        blob = ready;
        originalBlob = ready;
        originalDuration = durationMs;
        await showReview();
      } catch (error) {
        clearPreview();
        publishState("idle");
        status(
          error instanceof Error ? error.message : "Could not finalize the recording.",
        );
      } finally {
        preparingVideo = false;
        if (recorder === stoppedRecorder) {
          $("start").disabled = !connected;
          $("audio-options").disabled = false;
        }
      }
    };
    stream.getVideoTracks()[0].addEventListener("ended", stop, { once: true });
    startedAt = performance.now();
    pausedAt = 0;
    pausedMs = 0;
    videoStartWall = Date.now();
    if (debugSession)
      openInterval = {
        sourceStartMs: Math.min(300000, videoStartWall - debugSession.started),
        outputStartMs: 0,
      };
    recorder.start(1000);
    if (debugSession) $("debug-options").disabled = true;
    $("start").disabled = true;
    $("stop").hidden = false;
    $("pause").hidden = false;
    $("pause").textContent = "Pause recording";
    publishState("recording");
    captureHealth.start();
    $("audio-options").disabled = true;
    status("Recording. Highlight off · navigation allowed. Stop to review.");
    timer = setInterval(() => {
      const seconds = Math.ceil((maxMs - recordingElapsed()) / 1000);
      $("timer").textContent =
        `${recorder.state === "paused" ? "Paused · " : ""}${Math.max(0, seconds)} seconds remaining`;
      if (seconds <= 0) stop();
    }, 250);
  } catch (error) {
    startError(error);
  }
};
$("stop").onclick = stop;
$("pause").onclick = pauseOrResume;
$("discard").onclick = async () => {
  stop();
  clearPreview();
  if (draftId) await deleteVideoDraft(draftId).catch(() => {});
  publishState("idle");
  if (debugSession) {
    await debugStop;
    await send({ type: "sessionDiscard" });
    debugSession = null;
    debugStop = null;
    $("debug-options").disabled = false;
  }
  status("Recording discarded.");
};

$("send").onclick = async () => {
  if (!blob || !$("comment").value.trim()) {
    status("Review the video and write a comment before sending.");
    return;
  }
  $("send").disabled = true;
  videoSendProgress("uploading", 0);
  try {
    // Snapshot the local comments before sessionSubmit consumes the worker capture.
    if (debugSession && !submittedCapture) {
      debugStopped = await debugStop;
      await loadRecordingAnnotations();
      if (!createAttempt)
        annotationFrames = mapAnnotationFrames(
          annotationItems,
          reviewVideoMapping(),
          durationMs,
        );
    }
    $("editing").hidden = true;
    $("trim-playback").hidden = true;
    $("video-edit-tools").hidden = true;
    $("start").hidden = true;
    $("discard").hidden = true;
    if (!thread) {
      if (!createAttempt) {
        createAttempt = Object.freeze({
          type: "videoCreate",
          sourceTabId,
          server: serverOrigin,
          target,
          body: $("comment").value,
          idempotencyKey: createKey,
        });
        $("comment").readOnly = true;
        renderSavedFrames();
      }
      thread = await send(createAttempt);
      $("comment").readOnly = true;
      $("start").hidden = true;
      $("discard").hidden = true;
      $("thread").href = `${serverOrigin}/threads/${thread.id}`;
      $("thread").textContent = "Open draft feedback · video pending";
      $("thread").hidden = false;
      status("Comment saved. Uploading the video now.");
    }
    uploadKey ||= crypto.randomUUID();
    const videoBase64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(Error("Could not read the recording."));
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
    const result =
      uploadedVideo ||
      (await uploadVideo({
        threadId: thread.id,
        revision: thread.revision,
        videoBase64,
        durationMs,
        idempotencyKey: uploadKey,
      }));
    uploadedVideo = result;
    thread = result.thread;
    videoSendProgress("evidence", 100);
    if (debugSession) {
      await debugStop;
      const segments = videoSegments(
        mediaIntervals,
        appliedTrim?.start || 0,
        appliedTrim?.end || originalDuration,
      );
      if (!segments.length)
        throw Error(
          "No debug interval overlaps the video. Discard the debug session and send video only.",
        );
      if (!debugAligned && !submittedCapture)
        await send({
          type: "sessionCoverage",
          channel: "video",
          detail:
            "Measured pause/trim segments map the original recording clock to edited video. Only diagnostics inside retained source intervals are shared.",
        });
      const capture =
        submittedCapture ||
        (await send({
          type: "sessionSubmit",
          body: $("comment").value,
          thread,
          video: {
            assetId: result.asset.id,
            offsetMs: debugSession.started - videoStartWall,
            ...(!debugAligned ? { segments } : {}),
          },
          clipReplay: !debugAligned,
          keepReplayPrefix: canKeepReplayPrefix({
            offsetMs: debugSession.started - videoStartWall,
            segments,
          }),
        }));
      submittedCapture = capture;
      thread = capture.thread;
      thread = await uploadReviewFrames(
        [...annotationFrames, ...savedFrames],
        thread,
        capture.recording.id,
        (input) => send({ type: "sessionFrameUpload", server: serverOrigin, input }),
        (threadId) => send({ type: "videoThread", server: serverOrigin, threadId }),
      );
      await send({
        type: "recordingAnnotationsClear",
        recordingId: capture.recording.id,
      }).catch(() => {});
      debugSession = null;
      $("debug-status").textContent = "Debug context shared with this thread.";
    }
    $("thread").href = `${serverOrigin}/threads/${thread.id}`;
    $("thread").textContent = "Open feedback with recording";
    clearPreview();
    if (draftId) await deleteVideoDraft(draftId).catch(() => {});
    document.body.classList.add("video-complete");
    $("start").hidden = true;
    $("send").hidden = true;
    $("thread").hidden = false;
    status("Video shared with the project.");
    publishState("sent");
    videoSendProgress("complete", 100);
  } catch (error) {
    if (blob) {
      $("editing").hidden = false;
      $("trim-playback").hidden = false;
      $("video-edit-tools").hidden = false;
    }
    if (error.code === "CONFLICT" && thread && !submittedCapture) {
      try {
        thread = await send({
          type: "videoThread",
          server: serverOrigin,
          threadId: thread.id,
        });
        uploadKey = crypto.randomUUID();
        status("The thread changed. Its latest revision is loaded. Retry Send video.");
        return;
      } catch {
        /* Show the original conflict below. */
      }
    }
    status(
      `${submittedCapture ? "Video and diagnostics are shared; saved frames are still pending. " : uploadedVideo ? "Video reached the draft feedback; timeline evidence and screenshot points are still pending. " : thread ? "Draft feedback was created; video and evidence are still pending. " : ""}${error.message} Keep this tab open and retry Send video.`,
    );
    videoSendProgress("idle");
    $("send").textContent = "Retry Send video";
  } finally {
    $("send").disabled = false;
  }
};

if (!Number.isInteger(sourceTabId) || sourceTabId <= 0)
  status("Open this page from the Feedbacks popup.");
else
  send({ type: "videoContext", sourceTabId })
    .then((result) => {
      const { project, url, server } = result;
      if (!project) throw Error("Project access is no longer available.");
      target = Object.freeze({
        sourceTabId: result.sourceTabId,
        projectId: result.projectId,
        reviewId: result.reviewId,
        server,
        url,
        viewport: Object.freeze({ ...result.viewport }),
        routeFingerprint: result.routeFingerprint,
      });
      serverOrigin = server;
      $("target").textContent = `${project.name} · ${url}`;
      $("redirect-origins").value = (result.allowedOrigins || []).slice(1).join(", ");
      approvedRedirectOrigins = result.allowedOrigins || null;
      $("start").disabled = !connected;
      $("audio-options").disabled = false;
      return (
        autoStart || draftId
          ? Promise.resolve()
          : send({ type: "videoCaptureHandle", target })
      )
        .then((value) => {
          captureHandle = value;
        })
        .catch((error) => {
          if (autoStart) return;
          $("debug-context").checked = false;
          $("debug-status").textContent = error.message;
        })
        .then(async () => {
          if (draftId) return loadDraft();
          if (autoStart) await pendingTabStream;
          else if (chrome.storage?.local) {
            const saved = await chrome.storage.local.get("videoRecordingOptions");
            captureDefaults = recordingDefaults(saved.videoRecordingOptions);
          } else return;
          for (const [key, id] of Object.entries({
            tabAudio: "tab-audio",
            microphone: "microphone",
            maskInputs: "mask-inputs",
            maskText: "mask-text",
            networkBodies: "network-bodies",
          }))
            if (typeof captureDefaults[key] === "boolean")
              $(id).checked = captureDefaults[key];
          if (autoStart) $("start").click();
        });
    })
    .catch((error) => status(error.message));
window.addEventListener("pagehide", () => {
  exportController?.abort();
  stop();
});
$("apply-edit").onclick = async () => {
  if (!originalBlob || createAttempt) return;
  const start = Number($("trim-start").value),
    end = Number($("trim-end").value);
  if (end > originalDuration / 1000 || start < 0 || end <= start) {
    status("Choose a start and end within the original recording.");
    return;
  }
  exportController = new AbortController();
  $("apply-edit").disabled = true;
  $("send").disabled = true;
  $("start").disabled = true;
  $("discard").disabled = true;
  $("reset-edit").disabled = true;
  $("cancel-edit").hidden = false;
  $("preview").pause();
  timeline.lock(true);
  for (const id of ["crop-left", "crop-top", "crop-width", "crop-height"])
    $(id).disabled = true;
  try {
    const exported = await exportVideo({
      url: originalUrl,
      start,
      end,
      crop: cropControls.values(),
      signal: exportController.signal,
      onProgress: (percent) =>
        status(`Preparing edited video · ${percent}% · keep this tab open`),
    });
    status("Finalizing edited video metadata…");
    const editedDurationMs = Math.round((end - start) * 1000);
    const edited = await finalizeWebmMetadata(exported, editedDurationMs, {
      signal: exportController.signal,
    });
    URL.revokeObjectURL(previewUrl);
    blob = edited;
    if (debugSession) {
      ({ appliedTrim, debugAligned } = videoTrimState(
        start,
        end,
        originalDuration,
        mediaIntervals.length,
      ));
      $("debug-status").textContent = debugAligned
        ? "Full video selected. Debug context uses the original recording clock."
        : canKeepReplayPrefix({
              offsetMs: debugSession.started - videoStartWall,
              segments: videoSegments(mediaIntervals, start, end),
            })
          ? "The video tail was trimmed. Session replay remains available through the retained beginning."
          : "Measured pause/trim intervals remain aligned; diagnostics outside them and DOM replay are omitted.";
    }
    durationMs = editedDurationMs;
    previewUrl = URL.createObjectURL(blob);
    timeline.applied();
    $("preview").src = previewUrl;
    $("edit-state").textContent = "Edits applied · ready to send";
    editsPending = false;
    savedFrames = [];
    renderSavedFrames();
    await refreshDebugReview();
    status(
      "Edits applied. Preview the video before sending. Saved frames were cleared because the video changed.",
    );
  } catch (error) {
    status(error.message);
  } finally {
    exportController = null;
    $("apply-edit").disabled = false;
    timeline.lock(false);
    for (const id of ["crop-left", "crop-top", "crop-width", "crop-height"])
      $(id).disabled = false;
    $("send").disabled = editsPending;
    $("start").disabled = !connected;
    $("discard").disabled = false;
    $("reset-edit").disabled = false;
    $("cancel-edit").hidden = true;
  }
};
$("cancel-edit").onclick = () => exportController?.abort();
$("reset-edit").onclick = () => {
  if (!originalBlob || createAttempt) return;
  blob = originalBlob;
  appliedTrim = null;
  debugAligned = mediaIntervals.length <= 1;
  durationMs = originalDuration;
  URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(blob);
  $("preview").src = previewUrl;
  $("trim-start").value = "0";
  $("trim-end").value = (originalDuration / 1000).toFixed(3);
  ["crop-left", "crop-top", "crop-width", "crop-height"].forEach(
    (id, i) => ($(id).value = i < 2 ? "0" : "100"),
  );
  timeline.reset();
  editsPending = false;
  $("send").disabled = false;
  $("edit-state").textContent = "";
  savedFrames = [];
  renderSavedFrames();
  void refreshDebugReview().catch((error) => status(error.message));
  status("Original recording restored.");
};

let editsPending = false;
function markEditsPending() {
  editsPending = true;
  $("send").disabled = true;
  $("edit-state").textContent = "Previewing your selection · Apply edits before sending";
}
const timeline = createVideoTimeline({ onChange: markEditsPending, onError: status });
$("video-size").onclick = () => {
  const large = document.body.classList.toggle("video-large");
  $("video-size").textContent = large ? "Smaller video" : "Larger video";
  $("video-size").setAttribute("aria-pressed", String(large));
};
$("review-layout").onclick = () => {
  const beside = $("review-layout").getAttribute("aria-pressed") !== "true";
  $("review-layout").setAttribute("aria-pressed", String(beside));
  $("review-layout").textContent = beside ? "Inspector below" : "Inspector beside";
  $("review-layout").closest(".review-workspace").dataset.layout = beside
    ? "side"
    : "stack";
};
const cropControls = createCropControls({
  $,
  timeline,
  onChange: markEditsPending,
  getExportController: () => exportController,
});
