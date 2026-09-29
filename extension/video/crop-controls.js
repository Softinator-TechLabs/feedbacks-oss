export function createCropControls({ $, timeline, onChange, getExportController }) {
  let originalFrame = null;
  let cropStart;
  const values = () =>
    ["crop-left", "crop-top", "crop-width", "crop-height"].map((id) =>
      Number($(id).value),
    );

  function draw() {
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
    const [l, t, w, h] = values();
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

  $("preview").onloadeddata = draw;
  $("preview").onseeked = draw;
  $("crop-editing").ontoggle = () => {
    if ($("crop-editing").open) {
      timeline.original();
      draw();
    }
  };
  for (const id of ["crop-left", "crop-top", "crop-width", "crop-height"])
    $(id).oninput = () => {
      onChange();
      timeline.original();
      draw();
    };
  const cropPoint = (event) => {
    const rect = $("crop-preview").getBoundingClientRect();
    return [
      Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100)),
      Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100)),
    ];
  };
  $("crop-preview").onpointerdown = (event) => {
    if (getExportController()) return;
    timeline.original();
    cropStart = cropPoint(event);
    $("crop-preview").setPointerCapture(event.pointerId);
  };
  $("crop-preview").onpointermove = (event) => {
    if (!cropStart) return;
    const [x, y] = cropPoint(event),
      [sx, sy] = cropStart;
    const next = [
      Math.min(x, sx),
      Math.min(y, sy),
      Math.abs(x - sx),
      Math.abs(y - sy),
    ].map(Math.floor);
    ["crop-left", "crop-top", "crop-width", "crop-height"].forEach(
      (id, i) => ($(id).value = String(next[i])),
    );
    onChange();
    draw();
  };
  $("crop-preview").onpointerup = $("crop-preview").onpointercancel = () => {
    cropStart = null;
  };

  return { values, resetFrame: () => (originalFrame = null) };
}
