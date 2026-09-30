import { createSessionReview } from "../extension/session-review.js";

const durationMs = 10000;
const clamp = (value, max = 1) => Math.max(0, Math.min(max, Number(value) || 0));
// Fictional Good Form browser evidence. The inspector itself is the shipped
// extension renderer, bundled locally for every walkthrough surface.
const events = [
  [
    0,
    "activity",
    { action: "loading", phase: "page ready", url: "/products/studio-chair" },
  ],
  [300, "network", { method: "GET", url: "/products/studio-chair", status: 200 }],
  [650, "performance", { name: "First contentful paint", durationMs: 640 }],
  [950, "network", { method: "GET", url: "/media/studio-chair.png", status: 200 }],
  [1200, "activity", { action: "mousemove", label: "Order summary" }],
  [1500, "activity", { action: "input", label: "Quantity", value: "1" }],
  [1750, "activity", { action: "focus", label: "Place order" }],
  [
    2000,
    "activity",
    { action: "click", label: "Place order", x: 780, y: 292, button: 0 },
  ],
  [2250, "console", { level: "log", message: "Submitting checkout" }],
  [
    2500,
    "network",
    { requestId: "checkout", method: "POST", url: "/api/checkout", phase: "request" },
  ],
  [2900, "performance", { name: "Checkout interaction", durationMs: 120 }],
  [3300, "console", { level: "log", message: "Waiting for checkout response" }],
  [
    3600,
    "activity",
    { action: "loading", phase: "checkout pending", url: "/api/checkout" },
  ],
  [
    4000,
    "network",
    {
      requestId: "checkout",
      method: "POST",
      url: "/api/checkout",
      phase: "response",
      status: 503,
      durationMs: 1500,
    },
  ],
  [4500, "console", { level: "warn", message: "Checkout service unavailable" }],
  [
    5000,
    "console",
    { level: "error", message: "Unable to place order: checkout returned 503" },
  ],
  [5600, "performance", { name: "Checkout request", durationMs: 1500 }],
  [6200, "activity", { action: "mousemove", label: "Checkout error" }],
  [7000, "console", { level: "log", message: "Order form remains available for retry" }],
  [7600, "network", { method: "GET", url: "/api/cart", status: 200 }],
  [8200, "activity", { action: "focus", label: "Order summary" }],
  [9000, "console", { level: "log", message: "Cart preserved after failed checkout" }],
].map(([atMs, type, data], seq) => ({ seq, atMs, type, data }));

function drawPage(ctx, chair, atMs, reducedMotion) {
  const text = (label, x, y, size = 22, color = "#20241e", weight = 400) => {
    ctx.fillStyle = color;
    ctx.font = `${weight} ${size}px system-ui, sans-serif`;
    ctx.fillText(label, x, y);
  };
  ctx.clearRect(0, 0, 1024, 420);
  ctx.fillStyle = "#fffdfa";
  ctx.fillRect(0, 0, 1024, 420);
  text("GOOD FORM", 36, 44, 22, "#20241e", 750);
  text("Furniture for everyday living", 660, 44, 18, "#596054");
  ctx.strokeStyle = "#dfe3da";
  ctx.beginPath();
  ctx.moveTo(28, 65);
  ctx.lineTo(996, 65);
  ctx.stroke();
  ctx.fillStyle = "#edf2e5";
  ctx.fillRect(36, 90, 440, 300);
  if (chair.complete && chair.naturalWidth) {
    const ratio = Math.min(410 / chair.naturalWidth, 282 / chair.naturalHeight);
    const w = chair.naturalWidth * ratio,
      h = chair.naturalHeight * ratio;
    ctx.drawImage(chair, 256 - w / 2, 240 - h / 2, w, h);
  }
  text("Studio chair", 526, 118, 32, "#20241e", 650);
  text("Natural oak · one chair", 526, 152, 20, "#596054");
  text("Order summary", 526, 207, 22, "#20241e", 650);
  text("Subtotal", 526, 244, 20, "#596054");
  text("$245.00", 855, 244, 22, "#20241e", 650);
  ctx.fillStyle = "#17324d";
  ctx.beginPath();
  ctx.roundRect(526, 268, 456, 50, 7);
  ctx.fill();
  text(
    atMs >= 2000 && atMs < 4000 ? "Placing order…" : "Place order",
    692,
    301,
    20,
    "#ffffff",
    600,
  );
  if (atMs >= 4000) {
    text("We couldn’t place your order.", 526, 350, 19, "#a43e17", 650);
    text("Please try again. Your cart is saved.", 526, 381, 18, "#596054");
  } else text("Secure checkout. Free delivery.", 526, 352, 18, "#596054");
  const waypoints = [
    [0, 500, 200],
    [1800, 780, 292],
    [2300, 780, 292],
    [4400, 760, 345],
    [6500, 830, 345],
    [10000, 600, 212],
  ];
  const end = waypoints.findIndex((point) => point[0] >= atMs);
  const a = waypoints[Math.max(0, end - 1)],
    b = waypoints[Math.max(0, end)];
  const t = clamp((atMs - a[0]) / Math.max(1, b[0] - a[0]));
  const ease = reducedMotion ? (t >= 1 ? 1 : 0) : 1 - Math.pow(1 - t, 3);
  const x = a[1] + (b[1] - a[1]) * ease,
    y = a[2] + (b[2] - a[2]) * ease;
  if (atMs >= 2000 && atMs <= 2400 && !reducedMotion) {
    const pulse = (atMs - 2000) / 400;
    ctx.strokeStyle = `rgba(220,69,44,${1 - pulse})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(780, 292, 10 + pulse * 24, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = "#20241e";
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 25);
  ctx.lineTo(7, 18);
  ctx.lineTo(12, 29);
  ctx.lineTo(17, 26);
  ctx.lineTo(12, 16);
  ctx.lineTo(23, 16);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

export function mountRecording(
  screen,
  { onSeek, onPlay, onPause, base = "/learn/" } = {},
) {
  let disposed = false,
    settingClock = false,
    current = 0,
    playing = false,
    lastUpdate = -Infinity,
    seekNotified = false;
  const notifySeek = (ms) => {
    seekNotified = true;
    onSeek?.(ms);
  };
  const root = document.createElement("div");
  root.className = "recording-demo";
  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = `${base}recording-review.css`;
  const canvas = document.createElement("canvas");
  canvas.className = "recording-page";
  canvas.width = 1024;
  canvas.height = 420;
  canvas.setAttribute("role", "img");
  canvas.setAttribute(
    "aria-label",
    "Good Form checkout recording: Place order is clicked, checkout fails and a console error is captured.",
  );
  const inspectorRoot = document.createElement("div");
  inspectorRoot.className = "recording-inspector";
  root.append(stylesheet, canvas, inspectorRoot);
  screen.append(root);
  const ctx = canvas.getContext("2d"),
    chair = new Image();
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const draw = () => {
    if (!disposed) drawPage(ctx, chair, current, motion.matches);
  };
  chair.onload = draw;
  chair.src = `${base}studio-chair.webp`;
  motion.addEventListener("change", draw);

  // The real renderer expects media events. This adapter owns no timer: parent
  // paint is the sole clock, and only renderer interactions notify callbacks.
  const media = new EventTarget();
  Object.defineProperties(media, {
    duration: { value: durationMs / 1000 },
    paused: { get: () => !playing },
    currentTime: {
      get: () => current / 1000,
      set: (seconds) => {
        if (disposed) return;
        current = clamp(seconds * 1000, durationMs);
        draw();
        media.dispatchEvent(new Event("seeked"));
        media.dispatchEvent(new Event("timeupdate"));
        if (!settingClock) notifySeek(current);
      },
    },
  });
  media.pause = () => {
    if (disposed) return;
    playing = false;
    media.dispatchEvent(new Event("pause"));
    if (!settingClock) onPause?.();
  };
  media.play = async () => {
    if (disposed) return;
    playing = true;
    media.dispatchEvent(new Event("play"));
    if (!settingClock) onPlay?.();
  };
  const inspector = createSessionReview(inspectorRoot, {
    recording: {
      durationMs,
      events,
      environment: { browser: "Chrome", viewport: { width: 1024, height: 420 } },
      privacy: { maskInputs: true },
    },
    videoElement: media,
    video: { offsetMs: 0 },
  });
  // A native media seek within 40ms is intentionally skipped by the inspector.
  // Keep that small-distance interaction connected to the parent clock too.
  const startUserSeek = () => {
    seekNotified = false;
  };
  const finishUserSeek = (event) => {
    if (
      disposed ||
      seekNotified ||
      !event.target.closest?.(".review-event, .review-timeline-mark, input[type=range]")
    )
      return;
    current = Number(inspectorRoot.querySelector("input[type=range]").value);
    draw();
    notifySeek(current);
  };
  for (const type of ["click", "input"]) {
    inspectorRoot.addEventListener(type, startUserSeek, true);
    inspectorRoot.addEventListener(type, finishUserSeek);
  }
  draw();
  return {
    paint(progress, isPlaying = false) {
      if (disposed) return;
      const next = clamp(progress) * durationMs;
      const changed = playing !== isPlaying;
      const seek = next < current || Math.abs(next - current) > 250;
      settingClock = true;
      current = next;
      if (changed) {
        playing = isPlaying;
        media.dispatchEvent(new Event(playing ? "play" : "pause"));
      }
      draw();
      if (
        changed ||
        seek ||
        Math.abs(current - lastUpdate) >= 100 ||
        current === durationMs
      ) {
        lastUpdate = current;
        media.dispatchEvent(new Event("timeupdate"));
      }
      settingClock = false;
    },
    seek(ms) {
      if (disposed) return;
      media.pause();
      const target = events.find((event) => event.atMs === clamp(ms, durationMs));
      if (target) {
        const all = [...inspectorRoot.querySelectorAll('[role="tab"]')].find((button) =>
          button.textContent.startsWith("Everything"),
        );
        all?.click();
        const row = inspectorRoot.querySelector(
          `.review-event[data-seq="${target.seq}"]`,
        );
        if (row) {
          row.click();
          return;
        }
      }
      settingClock = true;
      inspector.seek(clamp(ms, durationMs));
      settingClock = false;
      current = clamp(ms, durationMs);
      draw();
      notifySeek(current);
    },
    dispose() {
      if (disposed) return;
      settingClock = true;
      inspector.dispose();
      disposed = true;
      chair.onload = null;
      motion.removeEventListener("change", draw);
      for (const type of ["click", "input"]) {
        inspectorRoot.removeEventListener(type, startUserSeek, true);
        inspectorRoot.removeEventListener(type, finishUserSeek);
      }
      root.remove();
    },
  };
}
