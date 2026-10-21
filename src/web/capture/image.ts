export type CaptureImage = {
  dataUrl: string;
  width: number;
  height: number;
  method: "screen_capture" | "image_import";
  surface?: "window" | "monitor" | "browser" | "unknown";
  capturedAt?: string;
};
export type Mask = { x: number; y: number; width: number; height: number };
export type CapturePoint = { id: string; body: string; x: number; y: number };

export async function loadImage(dataUrl: string) {
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  if (!image.naturalWidth || !image.naturalHeight) throw Error("The image is empty.");
  return image;
}

function canvasFor(width: number, height: number) {
  const canvas = document.createElement("canvas");
  const scale = Math.min(
    1,
    8000 / Math.max(width, height),
    Math.sqrt(40_000_000 / (width * height)),
  );
  canvas.width = Math.max(1, Math.floor(width * scale));
  canvas.height = Math.max(1, Math.floor(height * scale));
  return canvas;
}

function encoded(canvas: HTMLCanvasElement) {
  const dataUrl = canvas.toDataURL("image/webp", 0.9);
  if (dataUrl.length > 13_982_000)
    throw Error("The screenshot is too large. Import a smaller image.");
  return dataUrl;
}

export async function importCapture(file: File): Promise<CaptureImage> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 10 * 1024 * 1024)
    throw Error("Choose a PNG, JPEG or WebP image up to 10 MB.");
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    const canvas = canvasFor(image.naturalWidth, image.naturalHeight);
    canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
    return {
      dataUrl: encoded(canvas),
      width: canvas.width,
      height: canvas.height,
      method: "image_import",
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function captureWindow(signal?: AbortSignal): Promise<CaptureImage> {
  // Keep this call in the button's activation. Do not request audio or attach a debugger.
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: false,
  });
  const video = document.createElement("video");
  const track = stream.getVideoTracks()[0];
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    if (signal?.aborted) throw Error("Capture page was closed.");
    if (!track) throw Error("No video track was received.");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await Promise.race([
      (async () => {
        const frame = new Promise<void>((resolve) => {
          if (video.requestVideoFrameCallback)
            video.requestVideoFrameCallback(() => resolve());
          else video.addEventListener("loadeddata", () => resolve(), { once: true });
        });
        await video.play();
        await frame;
      })(),
      new Promise<never>((_, reject) => {
        track.addEventListener(
          "ended",
          () => reject(Error("Capture stopped. Choose a window again.")),
          { once: true },
        );
        timeout = setTimeout(
          () =>
            reject(
              Error(
                "The window did not provide an image. Try again or import a screenshot.",
              ),
            ),
          15000,
        );
        abort = () => reject(Error("Capture page was closed."));
        signal?.addEventListener("abort", abort, { once: true });
      }),
    ]);
    const canvas = canvasFor(video.videoWidth, video.videoHeight);
    if (!video.videoWidth || !video.videoHeight)
      throw Error("No image was received from that window.");
    canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
    const selected = track.getSettings().displaySurface;
    return {
      dataUrl: encoded(canvas),
      width: canvas.width,
      height: canvas.height,
      method: "screen_capture",
      capturedAt: new Date().toISOString(),
      surface:
        selected === "window" || selected === "monitor" || selected === "browser"
          ? selected
          : "unknown",
    };
  } finally {
    clearTimeout(timeout);
    if (abort) signal?.removeEventListener("abort", abort);
    stream.getTracks().forEach((item) => item.stop());
    video.pause();
    video.srcObject = null;
  }
}

export async function approvedImage(
  image: CaptureImage,
  masks: Mask[],
  points: CapturePoint[],
) {
  const source = await loadImage(image.dataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000";
  for (const mask of masks)
    ctx.fillRect(
      Math.floor(mask.x * canvas.width),
      Math.floor(mask.y * canvas.height),
      Math.ceil(mask.width * canvas.width) + 1,
      Math.ceil(mask.height * canvas.height) + 1,
    );
  const radius = Math.max(12, Math.min(image.width, image.height) * 0.018);
  points.forEach((point, index) => {
    const x = point.x * canvas.width,
      y = point.y * canvas.height;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = "#17324d";
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = Math.max(2, radius / 6);
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `bold ${radius}px sans-serif`;
    ctx.fillText(String(index + 1), x, y);
  });
  return encoded(canvas).split(",")[1];
}
