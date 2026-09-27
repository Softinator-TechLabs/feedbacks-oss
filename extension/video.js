const $ = (id) => document.getElementById(id);
const sourceTabId = Number(new URL(location.href).searchParams.get("sourceTabId"));
const maxBytes = 8 * 1024 * 1024;
const maxMs = 30000;
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
  durationMs = 0;
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
  $("preview").removeAttribute("src");
  $("preview").hidden = true;
  $("review").hidden = true;
  $("discard").hidden = true;
  $("timer").textContent = "";
}
function stop() {
  if (recorder && recorder.state !== "inactive") recorder.stop();
  stream?.getTracks().forEach((track) => track.stop());
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
      video: { displaySurface: "browser" },
      audio: false,
      selfBrowserSurface: "exclude",
      monitorTypeSurfaces: "exclude",
    });
    if (!connected)
      throw Error("Review ended. Open a new recorder from the current review.");
    if (stream.getVideoTracks()[0]?.getSettings().displaySurface !== "browser")
      throw Error("Choose a Chrome tab in the picker, then try again.");
    const mimeType = ["video/webm;codecs=vp8", "video/webm"].find((type) =>
      MediaRecorder.isTypeSupported(type),
    );
    if (!mimeType) throw Error("This Chrome version cannot record WebM video.");
    clearPreview();
    tooLarge = false;
    recordingFailed = false;
    const chunks = [];
    let bytes = 0;
    recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 1500000 });
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
      clearInterval(timer);
      $("start").disabled = !connected;
      $("stop").hidden = true;
      $("pause").hidden = true;
      if (tooLarge || recordingFailed || !chunks.length) {
        clearPreview();
        publishState("idle");
        status(
          tooLarge
            ? "Recording exceeded 8 MiB. Try a shorter clip."
            : recordingFailed
              ? "Recording failed. Try again."
              : "No video was recorded.",
        );
        return;
      }
      blob = new Blob(chunks, { type: "video/webm" });
      previewUrl = URL.createObjectURL(blob);
      $("preview").src = previewUrl;
      $("preview").hidden = false;
      $("review").hidden = false;
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
    status("Recording this tab. Stop when the issue is visible.");
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
    })
    .catch((error) => status(error.message));
window.addEventListener("pagehide", stop);
