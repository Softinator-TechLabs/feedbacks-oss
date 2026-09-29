export const VIDEO_MAX_MS = 300000;
export const VIDEO_MAX_BYTES = 40 * 1024 * 1024;
export function recordingOptions(audio = false) {
  const suffix = audio ? ",opus" : "";
  const mimeType = [
    `video/webm;codecs=vp9${suffix}`,
    `video/webm;codecs=vp8${suffix}`,
    "video/webm",
  ].find((type) => MediaRecorder.isTypeSupported(type));
  if (!mimeType) throw Error("This browser cannot record WebM video.");
  return { mimeType, videoBitsPerSecond: 1000000, audioBitsPerSecond: 64000 };
}
export function editRegion(values, width, height) {
  const [left, top, w, h] = values.map(Number);
  if (
    ![left, top, w, h].every(Number.isFinite) ||
    left < 0 ||
    top < 0 ||
    w <= 0 ||
    h <= 0 ||
    left + w > 100 ||
    top + h > 100
  )
    throw Error("Keep the crop inside the image, with a positive width and height.");
  const x = Math.floor((width * left) / 100),
    y = Math.floor((height * top) / 100);
  return {
    x,
    y,
    width: Math.max(2, Math.floor((width * w) / 100)),
    height: Math.max(2, Math.floor((height * h) / 100)),
  };
}
// Re-encode the selected interval locally. No dependency download or upload.
export async function exportVideo({ url, start, end, crop, signal, onProgress }) {
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end <= start ||
    end - start > VIDEO_MAX_MS / 1000
  )
    throw Error("Choose a valid start and end time, up to five minutes apart.");
  const video = document.createElement("video");
  video.playsInline = true;
  video.src = url;
  let stream, audio, recorder, tick, playbackStartedAt;
  const stop = () => {
    clearInterval(tick);
    video.pause();
    stream?.getTracks().forEach((track) => track.stop());
    if (audio) void audio.close();
    video.removeAttribute("src");
    video.load();
  };
  try {
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve;
      video.onerror = () => reject(Error("Could not open the original recording."));
    });
    if (signal.aborted) throw Error("Export cancelled.");
    const region = editRegion(crop, video.videoWidth, video.videoHeight);
    const canvas = document.createElement("canvas");
    canvas.width = region.width;
    canvas.height = region.height;
    const ctx = canvas.getContext("2d");
    const draw = () =>
      ctx.drawImage(
        video,
        region.x,
        region.y,
        region.width,
        region.height,
        0,
        0,
        canvas.width,
        canvas.height,
      );
    if (start > 0)
      await new Promise((resolve, reject) => {
        video.onseeked = resolve;
        video.onerror = () => reject(Error("Could not seek this recording."));
        video.currentTime = start;
      });
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA)
      await new Promise((resolve, reject) => {
        video.onloadeddata = resolve;
        video.onerror = () => reject(Error("Could not decode the selected video frame."));
      });
    if (signal.aborted) throw Error("Export cancelled.");
    draw();
    stream = canvas.captureStream(24);
    // Route original audio to the exported clip, never the speakers.
    audio = new AudioContext();
    const destination = audio.createMediaStreamDestination();
    audio.createMediaElementSource(video).connect(destination);
    await audio.resume();
    for (const track of destination.stream.getAudioTracks()) stream.addTrack(track);
    recorder = new MediaRecorder(stream, recordingOptions(true));
    const result = new Promise((resolve, reject) => {
      const chunks = [];
      let bytes = 0,
        error,
        sourceEnded = false,
        waitingForData = false,
        finishTimer;
      const stopRecorder = () => {
        if (recorder.state !== "inactive") recorder.stop();
      };
      const finish = () => {
        if (waitingForData || recorder.state === "inactive") return;
        if (chunks.length) return stopRecorder();
        // Chromium may still be encoding the first short clip frame. Keep the
        // canvas alive briefly and request buffered data before stopping.
        waitingForData = true;
        recorder.requestData();
        finishTimer = setTimeout(stopRecorder, 1200);
      };
      const abort = () => {
        error = Error("Export cancelled. Original recording kept.");
        stopRecorder();
      };
      signal.addEventListener("abort", abort, { once: true });
      recorder.ondataavailable = ({ data }) => {
        bytes += data.size;
        if (bytes > VIDEO_MAX_BYTES) {
          error = Error("Export exceeds 40 MiB. Trim a shorter clip.");
          stopRecorder();
        } else if (data.size) chunks.push(data);
        if (waitingForData && chunks.length) stopRecorder();
      };
      recorder.onerror = () => {
        error = Error("Video export failed. Original recording kept.");
        stopRecorder();
      };
      recorder.onstop = () => {
        clearTimeout(finishTimer);
        signal.removeEventListener("abort", abort);
        if (error || !chunks.length) reject(error || Error("No video was exported."));
        else resolve(new Blob(chunks, { type: "video/webm" }));
      };
      video.onended = () => {
        // A static MediaRecorder clip can contain only one encoded frame, while
        // its finalized metadata still describes the full recording duration.
        // Once that decoded frame reaches EOF, retain it for the requested tail.
        // Unknown or out-of-range durations do not authorize extending a clip.
        if (Number.isFinite(video.duration) && end <= video.duration) sourceEnded = true;
        else finish();
      };
      recorder.start(100);
      // The initial draw may have been consumed before MediaRecorder existed.
      // Publish it again after starting, including for a completely static clip.
      draw();
      stream.getVideoTracks()[0]?.requestFrame?.();
      tick = setInterval(() => {
        draw();
        stream.getVideoTracks()[0]?.requestFrame?.();
        const elapsed = performance.now() - playbackStartedAt;
        onProgress(
          Math.min(
            100,
            Math.round(
              (sourceEnded
                ? elapsed / ((end - start) * 1000)
                : (video.currentTime - start) / (end - start)) * 100,
            ),
          ),
        );
        if (sourceEnded ? elapsed >= (end - start) * 1000 : video.currentTime >= end)
          finish();
      }, 1000 / 24);
      if (signal.aborted) abort();
    });
    playbackStartedAt = performance.now();
    await video.play();
    return await result;
  } finally {
    if (recorder?.state !== "inactive" && recorder) recorder.stop();
    stop();
  }
}
