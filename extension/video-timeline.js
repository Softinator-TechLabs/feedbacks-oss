export function trimBoundary(side, value, start, end, duration) {
  const gap = Math.min(0.1, duration);
  const min = side === "start" ? 0 : start + gap;
  const max = side === "start" ? end - gap : duration;
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}
export function formatTime(seconds) {
  const ticks = Math.round(Math.max(0, Number.isFinite(seconds) ? seconds : 0) * 10);
  return `${Math.floor(ticks / 600)}:${String(Math.floor(ticks / 10) % 60).padStart(2, "0")}.${ticks % 10}`;
}

export function createVideoTimeline({ onChange, onError }) {
  const $ = (id) => document.getElementById(id);
  const video = $("preview"),
    track = $("trim-track");
  let duration = 0,
    start = 0,
    end = 0,
    source,
    output = false,
    locked = false;
  let pendingSeek = null,
    animation,
    thumbnailVideo,
    generation = 0;
  const current = () =>
    Math.max(0, Math.min(duration, video.currentTime + (output ? start : 0)));
  function render() {
    if (!duration) return;
    for (const [side, value] of [
      ["start", start],
      ["end", end],
    ]) {
      const handle = $(`trim-${side}-handle`);
      handle.style.left = `${(value / duration) * 100}%`;
      handle.setAttribute(
        "aria-valuemin",
        String(side === "start" ? 0 : start + Math.min(0.1, duration)),
      );
      handle.setAttribute(
        "aria-valuemax",
        String(side === "start" ? end - Math.min(0.1, duration) : duration),
      );
      handle.setAttribute("aria-valuenow", String(value));
      handle.setAttribute("aria-valuetext", formatTime(value));
      $(`trim-${side}`).value = String(Math.round(value * 1000) / 1000);
      $(`trim-${side}-label`).textContent = formatTime(value);
    }
    $("trim-selection").style.left = `${(start / duration) * 100}%`;
    $("trim-selection").style.width = `${((end - start) / duration) * 100}%`;
    $("trim-duration").textContent = `${formatTime(end - start)} selected`;
    $("trim-total").textContent = formatTime(duration);
    progress();
  }
  function progress() {
    if (!duration) return;
    const time = current();
    $("trim-seek").value = String(time);
    $("trim-playhead").style.left = `${(time / duration) * 100}%`;
    $("trim-current").textContent = formatTime(time);
  }
  function seek(time, original = false) {
    video.pause();
    if (original && output) {
      output = false;
      pendingSeek = time;
      video.src = source;
    } else if (video.readyState < 1) pendingSeek = time;
    else video.currentTime = Math.max(0, time - (output ? start : 0));
    progress();
  }
  function change(side, value) {
    if (locked || !duration) return;
    const time = trimBoundary(side, value, start, end, duration);
    if (side === "start") start = time;
    else end = time;
    onChange();
    seek(side === "start" ? start : Math.max(start, end - 0.04), true);
    render();
  }
  function pointerTime(event) {
    const rect = track.getBoundingClientRect();
    return Math.max(
      0,
      Math.min(duration, ((event.clientX - rect.left) / rect.width) * duration),
    );
  }
  for (const side of ["start", "end"]) {
    const handle = $(`trim-${side}-handle`);
    let dragging = false;
    handle.onpointerdown = (event) => {
      if (locked || !duration) return;
      event.preventDefault();
      event.stopPropagation();
      dragging = true;
      handle.focus();
      handle.setPointerCapture(event.pointerId);
      change(side, pointerTime(event));
    };
    handle.onpointermove = (event) => {
      if (dragging) change(side, pointerTime(event));
    };
    handle.onpointerup = handle.onpointercancel = () => {
      dragging = false;
    };
    handle.onkeydown = (event) => {
      const step = event.shiftKey ? 1 : 0.1;
      const value = side === "start" ? start : end;
      const next = {
        ArrowLeft: value - step,
        ArrowRight: value + step,
        Home: 0,
        End: duration,
      }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      change(side, next);
    };
    $(`trim-${side}`).onchange = (event) => change(side, Number(event.target.value));
  }
  track.onpointerdown = (event) => {
    if (locked || !duration) return;
    seek(Math.max(start, Math.min(end, pointerTime(event))));
  };
  $("trim-seek").oninput = (event) =>
    seek(Math.max(start, Math.min(end, Number(event.target.value))));
  $("trim-play").onclick = async () => {
    if (locked || !duration) return;
    if (!video.paused) {
      video.pause();
      return;
    }
    if (current() < start || current() >= end - 0.1)
      video.currentTime = output ? 0 : start;
    try {
      await video.play();
    } catch (error) {
      onError(error.message);
    }
  };
  const playIcon = $("trim-play-icon"),
    pauseIcon = $("trim-pause-icon");
  video.addEventListener("play", () => {
    playIcon.toggleAttribute("hidden", true);
    pauseIcon.toggleAttribute("hidden", false);
    $("trim-play").setAttribute("aria-label", "Pause selection");
    $("trim-play").title = "Pause selection";
    if (current() < start || current() >= end) video.currentTime = output ? 0 : start;
    cancelAnimationFrame(animation);
    const tick = () => {
      progress();
      if (current() >= end) {
        video.pause();
        video.currentTime = output ? end - start : end;
      }
      if (!video.paused) animation = requestAnimationFrame(tick);
    };
    animation = requestAnimationFrame(tick);
  });
  video.addEventListener("pause", () => {
    cancelAnimationFrame(animation);
    progress();
    playIcon.toggleAttribute("hidden", false);
    pauseIcon.toggleAttribute("hidden", true);
    $("trim-play").setAttribute("aria-label", "Play selection");
    $("trim-play").title = "Play selection";
  });
  video.addEventListener("timeupdate", () => {
    if (!video.paused && current() >= end) {
      video.pause();
      video.currentTime = output ? end - start : end;
    }
    progress();
  });
  video.addEventListener("loadedmetadata", () => {
    if (pendingSeek !== null) {
      video.currentTime = pendingSeek;
      pendingSeek = null;
    }
    progress();
  });
  function stopThumbnails() {
    generation++;
    if (thumbnailVideo) {
      thumbnailVideo.removeAttribute("src");
      thumbnailVideo.load();
      thumbnailVideo = null;
    }
  }
  function thumbnails() {
    stopThumbnails();
    const token = generation,
      canvas = $("trim-thumbnails"),
      ctx = canvas.getContext("2d");
    canvas.width = 960;
    canvas.height = 80;
    ctx.clearRect(0, 0, 960, 80);
    const reader = document.createElement("video");
    thumbnailVideo = reader;
    reader.muted = true;
    reader.preload = "auto";
    let index = 0;
    const draw = () => {
      if (token !== generation) return;
      ctx.drawImage(reader, index * 120, 0, 120, 80);
      index++;
      if (index < 8)
        reader.currentTime = Math.min(duration - 0.05, (duration * index) / 8);
      else stopThumbnails();
    };
    reader.onloadeddata = draw;
    reader.onseeked = draw;
    reader.src = source;
  }
  return {
    load(url, seconds) {
      stopThumbnails();
      source = url;
      duration = seconds;
      start = 0;
      end = seconds;
      output = false;
      pendingSeek = null;
      $("trim-seek").max = String(seconds);
      render();
      thumbnails();
    },
    applied() {
      video.pause();
      output = true;
      pendingSeek = null;
    },
    isOriginal() {
      return !output;
    },
    original() {
      seek(start, true);
    },
    reset() {
      start = 0;
      end = duration;
      output = false;
      pendingSeek = null;
      render();
    },
    lock(value) {
      locked = value;
      for (const id of [
        "trim-start-handle",
        "trim-end-handle",
        "trim-play",
        "trim-seek",
        "trim-start",
        "trim-end",
      ])
        $(id).disabled = value;
    },
    clear() {
      video.pause();
      cancelAnimationFrame(animation);
      stopThumbnails();
      duration = 0;
    },
  };
}
