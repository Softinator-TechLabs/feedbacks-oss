import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import { uid } from "../api.js";
import { Field } from "../ui.js";
import type { CaptureImage, CapturePoint, Mask } from "./image.js";

export function CaptureEditor({
  image,
  appName,
  masks,
  points,
  setMasks,
  setPoints,
  editable,
  locked,
}: {
  image: CaptureImage;
  appName: string;
  masks: Mask[];
  points: CapturePoint[];
  setMasks: Dispatch<SetStateAction<Mask[]>>;
  setPoints: Dispatch<SetStateAction<CapturePoint[]>>;
  editable: boolean;
  locked: boolean;
}) {
  const [tool, setTool] = useState<"point" | "mask">("point");
  const [drag, setDrag] = useState<{ x: number; y: number }>();
  const [selectedId, setSelectedId] = useState<string>();
  const moving = useRef<
    { id: string; pointerId: number; x: number; y: number } | undefined
  >(undefined);
  const selected = points.findIndex((point) => point.id === selectedId);
  const addPoint = (x: number, y: number) => {
    const id = uid();
    setPoints((items) => [...items, { id, body: "", x, y }]);
    setSelectedId(id);
  };
  const removePoint = (id: string) => {
    setPoints((items) => items.filter((item) => item.id !== id));
    if (selectedId === id) setSelectedId(undefined);
  };
  const cancelMove = () => {
    const original = moving.current;
    if (!original) return;
    moving.current = undefined;
    setPoints((items) =>
      items.map((item) =>
        item.id === original.id ? { ...item, x: original.x, y: original.y } : item,
      ),
    );
  };
  return (
    <>
      {editable && (
        <>
          <div className="app-capture-tools" role="group" aria-label="Screenshot tools">
            <button
              type="button"
              disabled={locked}
              aria-pressed={tool === "point"}
              onClick={() => setTool("point")}
            >
              Add point
            </button>
            <button
              type="button"
              disabled={locked || selected < 0}
              aria-label={`Remove selected point${selected >= 0 ? ` ${selected + 1}` : ""}`}
              onClick={() => selectedId && removePoint(selectedId)}
            >
              Remove selected point
            </button>
            <button
              type="button"
              disabled={locked}
              aria-pressed={tool === "mask"}
              onClick={() => setTool("mask")}
            >
              Hide area
            </button>
            <button
              type="button"
              disabled={locked || !masks.length}
              onClick={() => setMasks((items) => items.slice(0, -1))}
            >
              Undo hidden area
            </button>
          </div>
          <p className="muted">
            {tool === "point"
              ? "Click the image to add a point. Drag a point to move it, or focus it and use arrow keys. Delete removes the focused point."
              : "Drag across private information to cover it with a solid black rectangle."}
          </p>
        </>
      )}
      <div
        className="app-capture-image"
        style={{
          aspectRatio: `${image.width}/${image.height}`,
          maxWidth: `min(100%, ${image.width}px, ${(45 * image.width) / image.height}dvh)`,
        }}
        onPointerDown={(event) => {
          if (
            !editable ||
            locked ||
            event.button !== 0 ||
            (tool === "point" && points.length >= 100)
          )
            return;
          const bounds = event.currentTarget.getBoundingClientRect();
          const point = {
            x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
            y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
          };
          if (tool === "point") {
            addPoint(point.x, point.y);
          } else {
            setDrag(point);
            event.currentTarget.setPointerCapture(event.pointerId);
          }
        }}
        onPointerMove={(event) => {
          const point = moving.current;
          if (!point || point.pointerId !== event.pointerId || locked) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          const x = Math.max(
            0,
            Math.min(1, (event.clientX - bounds.left) / bounds.width),
          );
          const y = Math.max(
            0,
            Math.min(1, (event.clientY - bounds.top) / bounds.height),
          );
          setPoints((items) =>
            items.map((item) => (item.id === point.id ? { ...item, x, y } : item)),
          );
        }}
        onPointerUp={(event) => {
          if (moving.current?.pointerId === event.pointerId) {
            moving.current = undefined;
            return;
          }
          if (!drag || locked) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          const x = Math.max(
            0,
            Math.min(1, (event.clientX - bounds.left) / bounds.width),
          );
          const y = Math.max(
            0,
            Math.min(1, (event.clientY - bounds.top) / bounds.height),
          );
          if (Math.abs(x - drag.x) > 0.002 && Math.abs(y - drag.y) > 0.002)
            setMasks((items) => [
              ...items,
              {
                x: Math.min(x, drag.x),
                y: Math.min(y, drag.y),
                width: Math.abs(x - drag.x),
                height: Math.abs(y - drag.y),
              },
            ]);
          setDrag(undefined);
        }}
        onPointerCancel={() => {
          setDrag(undefined);
          cancelMove();
        }}
        onLostPointerCapture={cancelMove}
      >
        <img
          src={image.dataUrl}
          alt={`Screenshot of ${appName || "the selected app"}`}
          draggable={false}
        />
        {masks.map((mask, index) => (
          <span
            key={index}
            className="app-capture-mask"
            style={{
              left: `${mask.x * 100}%`,
              top: `${mask.y * 100}%`,
              width: `${mask.width * 100}%`,
              height: `${mask.height * 100}%`,
            }}
          />
        ))}
        {points.map((point, index) => (
          <button
            type="button"
            key={point.id}
            className="app-capture-pin"
            aria-label={`Point ${index + 1}`}
            aria-pressed={selectedId === point.id}
            disabled={!editable || locked}
            onClick={(event) => {
              event.stopPropagation();
              setSelectedId(point.id);
            }}
            onPointerDown={(event) => {
              event.stopPropagation();
              if (event.button !== 0 || locked || !editable) return;
              event.preventDefault();
              setSelectedId(point.id);
              moving.current = {
                id: point.id,
                pointerId: event.pointerId,
                x: point.x,
                y: point.y,
              };
              event.currentTarget.focus({ preventScroll: true });
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onKeyDown={(event) => {
              if (locked || !editable) return;
              if (event.key === "Delete" || event.key === "Backspace") {
                event.preventDefault();
                removePoint(point.id);
                return;
              }
              const step = event.shiftKey ? 0.05 : 0.01;
              const deltas: Record<string, [number, number]> = {
                ArrowLeft: [-step, 0],
                ArrowRight: [step, 0],
                ArrowUp: [0, -step],
                ArrowDown: [0, step],
              };
              const delta = deltas[event.key];
              if (!delta) return;
              event.preventDefault();
              setSelectedId(point.id);
              setPoints((items) =>
                items.map((item) =>
                  item.id === point.id
                    ? {
                        ...item,
                        x: Math.max(0, Math.min(1, item.x + delta[0])),
                        y: Math.max(0, Math.min(1, item.y + delta[1])),
                      }
                    : item,
                ),
              );
            }}
            style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
          >
            <span>{index + 1}</span>
          </button>
        ))}
      </div>
      {editable && (
        <>
          <button
            type="button"
            disabled={locked || points.length >= 100}
            onClick={() => addPoint(0.5, 0.5)}
          >
            Add point at center
          </button>
          {points.map((point, index) => (
            <div className="app-capture-note" key={point.id}>
              <Field label={`Point ${index + 1}`}>
                <textarea
                  disabled={locked}
                  required
                  maxLength={4000}
                  value={point.body}
                  onChange={(event) =>
                    setPoints((items) =>
                      items.map((item) =>
                        item.id === point.id
                          ? { ...item, body: event.target.value }
                          : item,
                      ),
                    )
                  }
                />
              </Field>
              <details>
                <summary>Position</summary>
                <div className="form-grid">
                  {(["x", "y"] as const).map((axis) => (
                    <Field key={axis} label={`${axis.toUpperCase()} (%)`}>
                      <input
                        type="number"
                        disabled={locked}
                        min={0}
                        max={100}
                        step={0.1}
                        value={Math.round(point[axis] * 1000) / 10}
                        onChange={(event) =>
                          setPoints((items) =>
                            items.map((item) =>
                              item.id === point.id
                                ? {
                                    ...item,
                                    [axis]: Math.max(
                                      0,
                                      Math.min(1, Number(event.target.value) / 100),
                                    ),
                                  }
                                : item,
                            ),
                          )
                        }
                      />
                    </Field>
                  ))}
                </div>
              </details>
              <button
                type="button"
                disabled={locked}
                onClick={() => removePoint(point.id)}
              >
                Remove point {index + 1}
              </button>
            </div>
          ))}
          <details>
            <summary>Hide an area with coordinates</summary>
            <p>Values are percentages of the image.</p>
            <button
              type="button"
              disabled={locked}
              onClick={() =>
                setMasks((items) => [
                  ...items,
                  { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
                ])
              }
            >
              Add hidden area
            </button>
            {masks.map((mask, index) => (
              <div className="form-grid" key={index}>
                {(["x", "y", "width", "height"] as const).map((axis) => (
                  <Field key={axis} label={`Area ${index + 1}: ${axis} (%)`}>
                    <input
                      type="number"
                      disabled={locked}
                      min={0}
                      max={100}
                      step={0.1}
                      value={Math.round(mask[axis] * 1000) / 10}
                      onChange={(event) =>
                        setMasks((items) =>
                          items.map((item, position) =>
                            position === index
                              ? {
                                  ...item,
                                  [axis]: Math.max(
                                    0,
                                    Math.min(1, Number(event.target.value) / 100),
                                  ),
                                }
                              : item,
                          ),
                        )
                      }
                    />
                  </Field>
                ))}
              </div>
            ))}
          </details>
        </>
      )}
    </>
  );
}
