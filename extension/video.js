import { createVideoTimeline } from "./video-timeline.js";
import {
  VIDEO_MAX_BYTES,
  VIDEO_MAX_MS,
  recordingOptions,
  exportVideo,
} from "./video-media.js";
const $ = (id) => document.getElementById(id);
const sourceTabId = Number(new URL(location.href).searchParams.get("sourceTabId"));
const maxBytes = VIDEO_MAX_BYTES;
const maxMs = VIDEO_MAX_MS;
let tabAudioTracks = [];
let microphone,
  audioContext,
  originalFrame,
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
  pausedAt = 0,
  pausedMs = 0,
  tooLarge = false,
  recordingFailed = false;
let thread,
  uploadKey,
  serverOrigin,
  target,
  createAttempt,
  createKey = crypto.randomUUID();
const port = chrome.runtime.connect({ name: "feedbacks-video" });
let connected = true;
// Keep the MV3 worker's recorder binding alive during recording AND local editing.
// Opening a port alone does not extend the worker idle timeout.
const heartbeat = setInterval(() => {
  if (connected) port.postMessage({ heartbeat: true });
}, 10000);
const recordingElapsed = () => (pausedAt || performance.now()) - startedAt - pausedMs;
function publishState(state) {
  if (connected) port.postMessage({ state });
}
function pauseOrResume() {
  if (recorder?.state === "recording") {
    pausedAt = performance.now();
    recorder.pause();
    $("pause").textContent = "Resume recording";
    status("Paused. Resume or stop to review.");
    publishState("paused");
  } else if (recorder?.state === "paused") {
    pausedMs += performance.now() - pausedAt;
    pausedAt = 0;
    recorder.resume();
    $("pause").textContent = "Pause recording";
    status("Recording this tab.");
    publishState("recording");
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
function clearPreview() {
  blob = null;
  editsPending = false;
  $("send").disabled = false;
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
  originalFrame = null;
  timeline.clear();
  $("editing").hidden = true;
  document.body?.classList.remove("has-recording");
  $("start").textContent = "Start recording";
}
function stop() {
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
  status(error.message);
}

$("start").onclick = async () => {
  if (!connected) {
    status("Open a new recorder from the current review.");
    return;
  }
  $("start").disabled = true;
  // Keep the native picker in the click gesture. It is the capture consent step.
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        displaySurface: "browser",
        width: { ideal: 1600, max: 1600 },
        height: { ideal: 900, max: 900 },
        frameRate: { ideal: 24, max: 24 },
      },
      audio: $("tab-audio").checked,
      systemAudio: "exclude",
      surfaceSwitching: "exclude",
      selfBrowserSurface: "exclude",
      monitorTypeSurfaces: "exclude",
    });
    if (!connected)
      throw Error("Review ended. Open a new recorder from the current review.");
    if (stream.getVideoTracks()[0]?.getSettings().displaySurface !== "browser")
      throw Error("Choose a Chrome tab in the picker, then try again.");
    if ($("tab-audio").checked && !stream.getAudioTracks().length)
      throw Error(
        "Tab audio was not shared. Enable Share tab audio in Chrome’s picker, or turn Tab audio off.",
      );
    if ($("microphone").checked) {
      microphone = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      if (!connected) throw Error("Review ended. Open a new recorder.");
      audioContext = new AudioContext();
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
    recorder.onstop = () => {
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
      $("start").disabled = !connected;
      $("audio-options").disabled = false;
      $("stop").hidden = true;
      $("pause").hidden = true;
      if (tooLarge || recordingFailed || !chunks.length) {
        clearPreview();
        publishState("idle");
        status(
          tooLarge
            ? "Recording exceeded 40 MiB. Try a shorter clip."
            : recordingFailed
              ? "Recording failed. Try again."
              : "No video was recorded.",
        );
        return;
      }
      blob = new Blob(chunks, { type: "video/webm" });
      originalBlob = blob;
      originalDuration = durationMs;
      originalUrl = URL.createObjectURL(originalBlob);
      previewUrl = URL.createObjectURL(blob);
      $("preview").src = previewUrl;
      $("preview").hidden = false;
      $("review").hidden = false;
      $("editing").hidden = false;
      document.body?.classList.add("has-recording");
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
    };
    stream.getVideoTracks()[0].addEventListener("ended", stop, { once: true });
    startedAt = performance.now();
    pausedAt = 0;
    pausedMs = 0;
    recorder.start(1000);
    $("start").disabled = true;
    $("stop").hidden = false;
    $("pause").hidden = false;
    $("pause").textContent = "Pause recording";
    publishState("recording");
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
$("discard").onclick = () => {
  stop();
  clearPreview();
  publishState("idle");
  status("Recording discarded.");
};

$("send").onclick = async () => {
  if (!blob || !$("comment").value.trim()) {
    status("Review the video and write a comment before sending.");
    return;
  }
  $("send").disabled = true;
  try {
    $("editing").hidden = true;
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
      }
      thread = await send(createAttempt);
      $("comment").readOnly = true;
      $("start").hidden = true;
      $("discard").hidden = true;
      $("thread").href = `${serverOrigin}/threads/${thread.id}`;
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
    const result = await send({
      type: "videoUpload",
      server: serverOrigin,
      input: {
        threadId: thread.id,
        revision: thread.revision,
        videoBase64,
        durationMs,
        idempotencyKey: uploadKey,
      },
    });
    thread = result.thread;
    $("thread").href = `${serverOrigin}/threads/${thread.id}`;
    clearPreview();
    $("start").hidden = true;
    $("send").hidden = true;
    $("thread").hidden = false;
    status("Video shared with the project.");
    publishState("sent");
  } catch (error) {
    if (error.code === "CONFLICT" && thread) {
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
    status(`${error.message} Keep this tab open and retry Send video.`);
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
      $("start").disabled = !connected;
      $("audio-options").disabled = false;
    })
    .catch((error) => status(error.message));
window.addEventListener("pagehide", () => {
  exportController?.abort();
  stop();
});
const cropValues = () =>
  ["crop-left", "crop-top", "crop-width", "crop-height"].map((id) => Number($(id).value));
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
    const edited = await exportVideo({
      url: originalUrl,
      start,
      end,
      crop: cropValues(),
      signal: exportController.signal,
      onProgress: (percent) =>
        status(`Preparing edited video · ${percent}% · keep this tab open`),
    });
    URL.revokeObjectURL(previewUrl);
    blob = edited;
    durationMs = Math.round((end - start) * 1000);
    previewUrl = URL.createObjectURL(blob);
    timeline.applied();
    $("preview").src = previewUrl;
    $("edit-state").textContent = "Edits applied · ready to send";
    editsPending = false;
    status("Edits applied. Preview the video before sending.");
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
  status("Original recording restored.");
};

function drawCrop() {
  const video = $("preview"),
    canvas = $("crop-preview");
  if (!video.videoWidth || !canvas.getContext) return;
  canvas.width = Math.min(760, video.videoWidth);
  canvas.height = Math.round((canvas.width * video.videoHeight) / video.videoWidth);
  const ctx = canvas.getContext("2d");
  if (timeline.isOriginal() && video.readyState >= 2) {
    originalFrame = document.createElement("canvas");
    originalFrame.width = canvas.width;
    originalFrame.height = canvas.height;
    originalFrame.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
  }
  if (!originalFrame) return;
  canvas.width = originalFrame.width;
  canvas.height = originalFrame.height;
  ctx.drawImage(originalFrame, 0, 0);
  const [l, t, w, h] = cropValues();
  const x = (l / 100) * canvas.width,
    y = (t / 100) * canvas.height;
  const width = (w / 100) * canvas.width,
    height = (h / 100) * canvas.height;
  ctx.fillStyle = "rgba(0,0,0,.5)";
  ctx.beginPath();
  ctx.rect(0, 0, canvas.width, canvas.height);
  ctx.rect(x, y, width, height);
  ctx.fill("evenodd");
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, width, height);
}
$("preview").onloadeddata = drawCrop;
$("preview").onseeked = drawCrop;
$("crop-editing").ontoggle = () => {
  if ($("crop-editing").open) {
    timeline.original();
    drawCrop();
  }
};
for (const id of ["crop-left", "crop-top", "crop-width", "crop-height"])
  $(id).oninput = () => {
    markEditsPending();
    timeline.original();
    drawCrop();
  };
let cropStart;
const cropPoint = (event) => {
  const rect = $("crop-preview").getBoundingClientRect();
  return [
    Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100)),
    Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100)),
  ];
};
$("crop-preview").onpointerdown = (event) => {
  if (exportController) return;
  timeline.original();
  cropStart = cropPoint(event);
  $("crop-preview").setPointerCapture(event.pointerId);
};
$("crop-preview").onpointermove = (event) => {
  if (!cropStart) return;
  const [x, y] = cropPoint(event),
    [sx, sy] = cropStart;
  const values = [
    Math.min(x, sx),
    Math.min(y, sy),
    Math.abs(x - sx),
    Math.abs(y - sy),
  ].map(Math.floor);
  ["crop-left", "crop-top", "crop-width", "crop-height"].forEach(
    (id, i) => ($(id).value = String(values[i])),
  );
  markEditsPending();
  drawCrop();
};
$("crop-preview").onpointerup = $("crop-preview").onpointercancel = () => {
  cropStart = null;
};

let editsPending = false;
function markEditsPending() {
  editsPending = true;
  $("send").disabled = true;
  $("edit-state").textContent = "Previewing your selection · Apply edits before sending";
}
const timeline = createVideoTimeline({ onChange: markEditsPending, onError: status });
