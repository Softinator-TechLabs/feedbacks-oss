import React, { useEffect, useRef, useState } from "react";
import { api, errorText, uid, type Thread } from "./api.js";
import "./screenshot-markup.css";

type Asset = Thread["assets"][number];
type Point = { x: number; y: number };
type Stroke = { tool: "pencil" | "ellipse"; points: Point[] };
export type MarkupTarget =
  | {
      kind: "frame";
      imageBase64: string;
      recordingFrame: { recordingId: string; atMs: number; videoTimeMs: number };
    }
  | { kind: "asset"; asset: Asset };

function drawStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  width: number,
  height: number,
) {
  ctx.lineWidth = Math.max(3, Math.min(width, height) * 0.005);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#e36355";
  ctx.beginPath();
  if (stroke.tool === "ellipse") {
    const [first, last] = [stroke.points[0], stroke.points.at(-1)!];
    const left = Math.min(first.x, last.x) * width;
    const top = Math.min(first.y, last.y) * height;
    const radiusX = Math.max(2, (Math.abs(last.x - first.x) * width) / 2);
    const radiusY = Math.max(2, (Math.abs(last.y - first.y) * height) / 2);
    ctx.ellipse(left + radiusX, top + radiusY, radiusX, radiusY, 0, 0, Math.PI * 2);
  } else {
    ctx.moveTo(stroke.points[0].x * width, stroke.points[0].y * height);
    for (const point of stroke.points.slice(1))
      ctx.lineTo(point.x * width, point.y * height);
  }
  ctx.stroke();
}

export function ScreenshotMarkup({
  thread,
  target,
  onSaved,
  onClose,
}: {
  thread: Thread;
  target: MarkupTarget;
  onSaved: (thread: Thread) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const image = useRef<HTMLImageElement | null>(null);
  const drawing = useRef<Stroke | null>(null);
  const pending = useRef<{
    rawKey: string;
    editKey: string;
    pointId: string;
    rawRevision?: number;
    editRevision?: number;
    raw?: Asset;
  }>({
    rawKey: uid(),
    editKey: uid(),
    pointId: uid(),
  });
  const [tool, setTool] = useState<"pin" | "pencil" | "ellipse">(
    target.kind === "frame" ? "pin" : "pencil",
  );
  const [strokes, setStrokes] = useState<Stroke[]>(
    target.kind === "asset" ? (target.asset.markup ?? []) : [],
  );
  const [edited, setEdited] = useState(false);
  const [pin, setPin] = useState<Point | null>(null);
  const [body, setBody] = useState("");
  const [hiddenLayers, setHiddenLayers] = useState({
    points: false,
    element: true,
    text: false,
  });
  const evidence =
    target.kind === "asset" && target.asset.rendition === "screenshot"
      ? target.asset.markings || []
      : [];
  const layers = [
    {
      key: "points" as const,
      label: "points",
      present:
        evidence.some((mark) => mark.tool === "point") &&
        thread.context.captureMarker?.style !== "none",
    },
    {
      key: "element" as const,
      label: "element outline",
      present: evidence.some((mark) => mark.origin === "element"),
    },
    {
      key: "text" as const,
      label: "text selection",
      present: evidence.some((mark) => mark.origin === "text-selection"),
    },
  ];
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const sourceUrl =
    target.kind === "frame"
      ? target.imageBase64
      : target.asset.baseAssetId
        ? `/api/assets/${target.asset.baseAssetId}`
        : target.asset.url;

  useEffect(() => {
    dialog.current?.showModal();
    const base = new Image();
    base.onload = () => {
      image.current = base;
      const surface = canvas.current;
      if (!surface) return;
      const scale = Math.min(
        1,
        8000 / Math.max(base.naturalWidth, base.naturalHeight),
        Math.sqrt(40_000_000 / (base.naturalWidth * base.naturalHeight)),
      );
      surface.width = Math.max(1, Math.round(base.naturalWidth * scale));
      surface.height = Math.max(1, Math.round(base.naturalHeight * scale));
      setReady(true);
    };
    base.onerror = () => setError("This screenshot could not be opened for marking.");
    base.src = sourceUrl;
    return () => {
      base.onload = null;
      base.onerror = null;
      image.current = null;
    };
  }, [sourceUrl]);

  useEffect(() => {
    const surface = canvas.current;
    const base = image.current;
    const ctx = surface?.getContext("2d");
    if (!surface || !base || !ctx || !ready) return;
    ctx.clearRect(0, 0, surface.width, surface.height);
    ctx.drawImage(base, 0, 0, surface.width, surface.height);
    for (const stroke of strokes) drawStroke(ctx, stroke, surface.width, surface.height);
    if (drawing.current) drawStroke(ctx, drawing.current, surface.width, surface.height);
    for (const mark of evidence) {
      const layer =
        mark.origin === "element"
          ? "element"
          : mark.origin === "text-selection"
            ? "text"
            : null;
      if (!layer || hiddenLayers[layer]) continue;
      const { x, y, width, height } = mark.bounds;
      if (layer === "text") {
        ctx.fillStyle = "rgba(245, 197, 61, 0.3)";
        ctx.fillRect(
          x * surface.width,
          y * surface.height,
          width * surface.width,
          height * surface.height,
        );
      } else {
        ctx.strokeStyle = "#2370b5";
        ctx.lineWidth = Math.max(2, surface.width / 700);
        ctx.strokeRect(
          x * surface.width,
          y * surface.height,
          width * surface.width,
          height * surface.height,
        );
      }
    }
    const pins =
      target.kind === "asset" &&
      !hiddenLayers.points &&
      thread.context.captureMarker?.style !== "none"
        ? (target.asset.markings || [])
            .filter((mark) => mark.tool === "point" && mark.endpoints[0])
            .map((mark) => mark.endpoints[0])
        : [];
    if (pin) pins.push(pin);
    for (const point of pins) {
      const x = point.x * surface.width,
        y = point.y * surface.height;
      ctx.beginPath();
      ctx.arc(
        x,
        y,
        Math.max(9, Math.min(surface.width, surface.height) * 0.015),
        0,
        Math.PI * 2,
      );
      ctx.fillStyle = "rgba(227, 99, 85, 0.18)";
      ctx.fill();
      ctx.lineWidth = Math.max(3, Math.min(surface.width, surface.height) * 0.004);
      ctx.strokeStyle = "#e36355";
      ctx.stroke();
    }
  }, [ready, strokes, pin, target, hiddenLayers, thread.context.captureMarker?.style]);

  const normalized = (event: React.PointerEvent<HTMLCanvasElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    };
  };
  const changed = () => {
    pending.current.editKey = uid();
    pending.current.editRevision = undefined;
    setEdited(true);
    setError("");
  };
  async function save() {
    if (!ready || busy) return;
    if (target.kind === "frame" && (!pin || !body.trim())) {
      setError("Place a point on the frame and write its comment before saving.");
      return;
    }
    if (target.kind === "asset" && !edited) {
      setError("Draw or revise a mark before saving this screenshot.");
      return;
    }
    const surface = document.createElement("canvas");
    surface.width = canvas.current!.width;
    surface.height = canvas.current!.height;
    const ctx = surface.getContext("2d")!;
    ctx.drawImage(image.current!, 0, 0, surface.width, surface.height);
    for (const stroke of strokes) drawStroke(ctx, stroke, surface.width, surface.height);
    // Evidence is stored as geometry. Saving a reply must not bake the preview overlays.
    let imageBase64 = surface.toDataURL("image/png");
    if (imageBase64.length > 13_982_000)
      imageBase64 = surface.toDataURL("image/jpeg", 0.9);
    if (imageBase64.length > 13_982_000) {
      setError("Marked image is too large. Use fewer strokes or a smaller screenshot.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      let source = target.kind === "asset" ? target.asset : pending.current.raw;
      if (!source) {
        const latest = await api<Thread>("threads.get", { threadId: thread.id });
        pending.current.rawRevision ??= latest.revision;
        const raw = await api<{ asset: Asset; thread: Thread }>("assets.upload", {
          threadId: thread.id,
          revision: pending.current.rawRevision,
          rendition: "screenshot",
          imageBase64: target.kind === "frame" ? target.imageBase64 : "",
          recordingFrame: target.kind === "frame" ? target.recordingFrame : undefined,
          idempotencyKey: pending.current.rawKey,
        });
        source = raw.asset;
        pending.current.raw = source;
        onSaved(raw.thread);
      }
      const latest = await api<Thread>("threads.get", { threadId: thread.id });
      pending.current.editRevision ??= latest.revision;
      const result = await api<{ asset: Asset; thread: Thread }>("assets.upload", {
        threadId: thread.id,
        revision: pending.current.editRevision,
        replacesAssetId: source.id,
        rendition:
          target.kind === "frame"
            ? "screenshot"
            : source.rendition === "screenshot"
              ? "screenshot"
              : "annotated",
        imageBase64,
        markup: strokes,
        ...(target.kind === "frame" && pin
          ? { point: { id: pending.current.pointId, body: body.trim(), ...pin } }
          : {}),
        idempotencyKey: pending.current.editKey,
      });
      onSaved(result.thread);
      onClose();
    } catch (failure) {
      setError(`${errorText(failure)} The screenshot and marks are kept here for retry.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      className="screenshot-markup-dialog"
      aria-label={target.kind === "frame" ? "Annotate video frame" : "Mark screenshot"}
      onClose={onClose}
      onCancel={(event) => {
        if (busy) event.preventDefault();
      }}
    >
      <div className="screenshot-markup-heading">
        <div>
          <h2>
            {target.kind === "frame" ? "Annotate this frame" : "Mark this screenshot"}
          </h2>
          <p className="muted">
            Place a point or draw on the image. Save changes to update this thread.
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={onClose}
          aria-label="Close annotation editor"
        >
          ×
        </button>
      </div>
      <div className="screenshot-markup-tools" role="group" aria-label="Marking tools">
        {target.kind === "frame" && (
          <button
            type="button"
            aria-pressed={tool === "pin"}
            onClick={() => setTool("pin")}
          >
            Point
          </button>
        )}
        <button
          type="button"
          aria-pressed={tool === "pencil"}
          onClick={() => setTool("pencil")}
        >
          Pencil
        </button>
        <button
          type="button"
          aria-pressed={tool === "ellipse"}
          onClick={() => setTool("ellipse")}
        >
          Circle
        </button>
        <button
          type="button"
          disabled={!strokes.length || busy}
          onClick={() => {
            setStrokes((old) => old.slice(0, -1));
            changed();
          }}
        >
          Undo mark
        </button>
        <button
          type="button"
          disabled={!strokes.length || busy}
          onClick={() => {
            setStrokes([]);
            changed();
          }}
        >
          Clear marks
        </button>
      </div>
      {layers.some((layer) => layer.present) && (
        <div
          className="screenshot-markup-tools"
          role="group"
          aria-label="Screenshot evidence visibility"
        >
          {layers
            .filter((layer) => layer.present)
            .map((layer) => (
              <button
                type="button"
                key={layer.key}
                aria-pressed={!hiddenLayers[layer.key]}
                onClick={() =>
                  setHiddenLayers((current) => ({
                    ...current,
                    [layer.key]: !current[layer.key],
                  }))
                }
              >
                {hiddenLayers[layer.key] ? "Show" : "Hide"} {layer.label}
              </button>
            ))}
        </div>
      )}
      <div className="screenshot-markup-surface">
        <canvas
          ref={canvas}
          aria-label="Screenshot marking canvas"
          style={{ cursor: tool === "pin" ? "crosshair" : "cell" }}
          onPointerDown={(event) => {
            if (!ready || busy) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            const point = normalized(event);
            if (tool === "pin") {
              setPin(point);
              changed();
              return;
            }
            drawing.current = { tool, points: [point, point] };
          }}
          onPointerMove={(event) => {
            if (
              !drawing.current ||
              !event.currentTarget.hasPointerCapture(event.pointerId)
            )
              return;
            const point = normalized(event);
            drawing.current = {
              ...drawing.current,
              points:
                drawing.current.tool === "ellipse"
                  ? [drawing.current.points[0], point]
                  : [...drawing.current.points.slice(-1999), point],
            };
            const ctx = event.currentTarget.getContext("2d");
            const base = image.current;
            if (ctx && base) {
              ctx.drawImage(
                base,
                0,
                0,
                event.currentTarget.width,
                event.currentTarget.height,
              );
              for (const stroke of strokes)
                drawStroke(
                  ctx,
                  stroke,
                  event.currentTarget.width,
                  event.currentTarget.height,
                );
              drawStroke(
                ctx,
                drawing.current,
                event.currentTarget.width,
                event.currentTarget.height,
              );
            }
          }}
          onPointerUp={(event) => {
            if (!drawing.current) return;
            event.currentTarget.releasePointerCapture(event.pointerId);
            const stroke = drawing.current;
            setStrokes((old) => [...old, stroke]);
            drawing.current = null;
            changed();
          }}
        />
      </div>
      {target.kind === "frame" && (
        <label className="screenshot-markup-comment">
          Comment for this point
          <textarea
            value={body}
            onChange={(event) => {
              setBody(event.target.value);
              changed();
            }}
            rows={3}
            maxLength={4000}
            placeholder="What should change here?"
          />
        </label>
      )}
      {error && (
        <p className="screenshot-markup-error" role="alert">
          {error}
        </p>
      )}
      <div className="screenshot-markup-actions">
        <button type="button" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button
          type="button"
          className="primary"
          onClick={() => void save()}
          disabled={!ready || busy}
        >
          {busy
            ? "Saving…"
            : target.kind === "frame"
              ? "Save point and frame"
              : "Save marked screenshot"}
        </button>
      </div>
    </dialog>
  );
}
