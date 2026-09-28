// One renderer for editing, full-resolution previews, local exports and uploads.
const insertedImages = new Map();
export function clearPreparedShapes() {
  insertedImages.clear();
}
export async function prepareShapes(shapes) {
  await Promise.all(
    shapes
      .filter((shape) => shape.tool === "image")
      .map(async (shape) => {
        if (insertedImages.has(shape.source)) return;
        if (!/^data:image\/(png|jpeg|webp);base64,/.test(shape.source || ""))
          throw Error("An inserted image is invalid. Remove it and try again.");
        const image = new Image();
        image.src = shape.source;
        await image.decode();
        insertedImages.set(shape.source, image);
      }),
  );
}
export function shapeRectangle(shape) {
  const a = shape.points[0],
    b = shape.points.at(-1);
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.max(2, Math.abs(b.x - a.x)),
    height: Math.max(2, Math.abs(b.y - a.y)),
  };
}
export function drawShape(shape, ctx, width) {
  const s = shape,
    a = s.points[0],
    b = s.points.at(-1);
  ctx.save();
  ctx.strokeStyle = s.origin === "element" ? "#2370b5" : "#b92332";
  ctx.fillStyle = s.tool === "redact" ? "#202c37" : "#b92332";
  ctx.lineWidth =
    s.origin === "element" ? Math.max(2, width / 700) : Math.max(3, width / 450);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (s.tool === "point" || s.tool === "steps") {
    if (s.tool === "point" && s.markerStyle === "none") {
      ctx.restore();
      return;
    }
    const scale = { small: 1, medium: 1.35, large: 1.8 }[s.markerSize] || 1;
    const radius =
      s.tool === "point" ? Math.max(8, width / 190) * scale : Math.max(12, width / 120);
    if (s.tool === "point" && s.markerStyle === "arrow") {
      ctx.strokeStyle = "#c73732";
      ctx.lineWidth = Math.max(2, width / 700) * scale;
      ctx.beginPath();
      ctx.moveTo(a.x - radius * 1.4, a.y - radius * 1.4);
      ctx.lineTo(a.x, a.y);
      ctx.moveTo(a.x - radius * 0.85, a.y);
      ctx.lineTo(a.x, a.y);
      ctx.lineTo(a.x, a.y - radius * 0.85);
      ctx.stroke();
      ctx.restore();
      return;
    }
    ctx.beginPath();
    ctx.arc(a.x, a.y, radius, 0, Math.PI * 2);
    if (s.unlabeled || s.markerStyle === "ring") {
      ctx.strokeStyle = "#c73732";
      ctx.lineWidth = Math.max(2, width / 750);
      ctx.stroke();
      ctx.restore();
      return;
    }
    if (s.tool === "point" && s.markerStyle === "dot") {
      ctx.fillStyle = "rgba(199, 55, 50, 0.72)";
      ctx.fill();
      ctx.restore();
      return;
    }
    ctx.fillStyle = s.tool === "steps" ? "#b92332" : "rgba(23, 50, 77, 0.78)";
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.font = `600 ${radius * (s.tool === "point" ? 1.2 : 1.35)}px system-ui`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(s.number || 1), a.x, a.y);
  } else if (s.tool === "text" || s.tool === "sticker") {
    ctx.font = `600 ${Math.max(s.tool === "sticker" ? 40 : 22, width / 55)}px system-ui`;
    ctx.fillText(s.text, a.x, a.y);
  } else if (s.tool === "image") {
    const image = insertedImages.get(s.source);
    if (!image) {
      ctx.restore();
      throw Error("An inserted image is not ready. Reopen this screenshot.");
    }
    const r = shapeRectangle(s);
    ctx.drawImage(image, r.x, r.y, r.width, r.height);
  } else if (s.tool === "blur") {
    const r = shapeRectangle(s);
    const patch = new OffscreenCanvas(Math.ceil(r.width), Math.ceil(r.height));
    const surface = patch.getContext("2d");
    surface.drawImage(
      ctx.canvas,
      r.x,
      r.y,
      r.width,
      r.height,
      0,
      0,
      patch.width,
      patch.height,
    );
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.width, r.height);
    ctx.clip();
    ctx.filter = `blur(${Math.max(8, width / 90)}px)`;
    ctx.drawImage(patch, r.x, r.y);
  } else if (s.tool === "redact" || s.tool === "highlighter") {
    const r = shapeRectangle(s);
    if (s.tool === "highlighter") {
      ctx.fillStyle = "#ffe047";
      ctx.globalAlpha = 0.4;
    }
    ctx.fillRect(r.x, r.y, r.width, r.height);
  } else if (s.tool === "rectangle") ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
  else {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    for (const p of s.points.slice(1)) ctx.lineTo(p.x, p.y);
    ctx.stroke();
    if (s.tool === "arrow") {
      const angle = Math.atan2(b.y - a.y, b.x - a.x),
        len = Math.max(16, width / 65);
      ctx.beginPath();
      ctx.moveTo(b.x - len * Math.cos(angle - 0.5), b.y - len * Math.sin(angle - 0.5));
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(b.x - len * Math.cos(angle + 0.5), b.y - len * Math.sin(angle + 0.5));
      ctx.stroke();
    }
  }
  ctx.restore();
}
export function paintScreenshot(surface, source, shapes, width, height) {
  surface.clearRect(0, 0, width, height);
  surface.drawImage(source, 0, 0);
  for (const shape of shapes) drawShape(shape, surface, width);
}
