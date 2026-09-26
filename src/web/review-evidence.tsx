import React, { useEffect, useRef, useState } from "react";
import type { Thread } from "./api.js";

type Asset = Thread["assets"][number];
type Annotation = NonNullable<Thread["context"]["annotations"]>[number];

function position(asset: Asset, item: Annotation, context: Thread["context"]) {
  const mark = asset.markings?.find(
    (entry) => entry.tool === "point" && entry.annotationId === item.id,
  );
  if (mark?.endpoints[0]) return { ...mark.endpoints[0], baked: true };
  const point = item.anchor.pagePoint;
  const section = asset.captureSections?.find(
    (part) => point && point.y >= part.startY && point.y < part.endY,
  );
  if (point && section && point.x >= 0 && point.x <= section.pageWidth)
    return {
      x: point.x / section.pageWidth,
      y:
        section.imageTop +
        ((point.y - section.startY) / (section.endY - section.startY)) *
          (section.imageBottom - section.imageTop),
      baked: false,
    };
  if (asset.filename === "full-page-combined.webp") return null;
  const region = asset.captureRegion;
  if (
    point &&
    region &&
    point.y >= region.startY &&
    point.y < region.endY &&
    point.x >= 0 &&
    point.x <= region.pageWidth
  )
    return {
      x: point.x / region.pageWidth,
      y: (point.y - region.startY) / (region.endY - region.startY),
      baked: false,
    };
  if (
    !region &&
    !asset.filename?.startsWith("full-page-") &&
    item.anchor.screenshotPoint
  ) {
    const { x, y } = item.anchor.screenshotPoint;
    if (x >= 0 && y >= 0 && x <= context.viewport.width && y <= context.viewport.height)
      return {
        x: x / context.viewport.width,
        y: y / context.viewport.height,
        baked: false,
      };
  }
  return null;
}

export function ReviewEvidence({ thread }: { thread: Thread }) {
  const annotations = thread.context.annotations || [];
  const images = thread.assets.filter((asset) => asset.contentType === "image/webp");
  const numbered = images.filter((asset) =>
    /^full-page-\d+-of-\d+\.webp$/.test(asset.filename || ""),
  );
  const combined = images.find((asset) => asset.filename === "full-page-combined.webp");
  const first = combined || numbered[0] || images[0];
  const [selectedId, setSelectedId] = useState(first?.id);
  const [activeId, setActiveId] = useState<string | null>(null);
  const stage = useRef<HTMLElement>(null);
  useEffect(() => {
    setSelectedId(first?.id);
    setActiveId(null);
  }, [thread.id, first?.id]);
  const selected = images.find((asset) => asset.id === selectedId) || first;
  const locationFor = (item: Annotation) =>
    numbered.find((asset) => position(asset, item, thread.context)) ||
    (combined && position(combined, item, thread.context) ? combined : undefined) ||
    images.find((asset) => position(asset, item, thread.context));
  const active = annotations.find((item) => item.id === activeId);
  const activePosition = active && selected && position(selected, active, thread.context);
  const marks = selected?.markings?.filter((mark) => mark.tool !== "point") || [];
  const markSummary = [...new Set(marks.map((mark) => mark.tool))]
    .map((tool) => `${marks.filter((mark) => mark.tool === tool).length} ${tool}`)
    .join(" · ");

  function show(item: Annotation) {
    const asset = locationFor(item);
    if (asset) setSelectedId(asset.id);
    setActiveId(item.id);
    requestAnimationFrame(() =>
      stage.current?.scrollIntoView({ block: "center", behavior: "smooth" }),
    );
  }

  return (
    <section className="review-evidence" aria-label="Annotated page review">
      <div className="review-evidence-heading">
        <div>
          <h2>Review on the page</h2>
          <p className="muted">
            {annotations.length} numbered{" "}
            {annotations.length === 1 ? "comment" : "comments"}
            {numbered.length ? ` · ${numbered.length} screenshots in page order` : ""}
          </p>
        </div>
        {images.length > 1 && (
          <label>
            Screenshot
            <select
              value={selected?.id || ""}
              onChange={(event) => {
                setSelectedId(event.target.value);
                setActiveId(null);
              }}
            >
              {images.map((asset) => (
                <option value={asset.id} key={asset.id}>
                  {asset === combined
                    ? "Full page · combined"
                    : asset.filename || "Attached screenshot"}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {selected && (
        <figure className="review-evidence-figure" ref={stage}>
          <div className="review-evidence-image">
            <img
              src={selected.url}
              alt={selected.filename || "Annotated feedback screenshot"}
              width={selected.width}
              height={selected.height}
            />
            {annotations.flatMap((item, index) => {
              const point = position(selected, item, thread.context);
              return point
                ? [
                    <button
                      type="button"
                      key={item.id}
                      className={`review-evidence-pin${point.baked ? " baked" : ""}${activeId === item.id ? " active" : ""}`}
                      style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
                      aria-label={`Point ${index + 1}: ${item.body}`}
                      onMouseEnter={() => setActiveId(item.id)}
                      onFocus={() => setActiveId(item.id)}
                      onClick={() => setActiveId(item.id)}
                    >
                      {point.baked ? (
                        <span className="sr-only">{index + 1}</span>
                      ) : (
                        index + 1
                      )}
                    </button>,
                  ]
                : [];
            })}
            {active && activePosition && (
              <div
                className={`review-evidence-popover${activePosition.y > 0.65 ? " above" : ""}`}
                style={{
                  left: `clamp(8px, calc(${activePosition.x * 100}% - 115px), calc(100% - 238px))`,
                  top: `${activePosition.y * 100}%`,
                }}
              >
                <strong>Point {annotations.indexOf(active) + 1}</strong>
                <p>{active.body}</p>
              </div>
            )}
          </div>
          <figcaption>
            {selected.filename || "Screenshot"}
            {selected.captureRegion &&
              ` · ${Math.round(selected.captureRegion.startY)}–${Math.round(selected.captureRegion.endY)}px down the page`}
            {" · "}
            <a href={selected.url} target="_blank" rel="noopener noreferrer">
              Open full image
            </a>
          </figcaption>
        </figure>
      )}
      {markSummary && (
        <p className="review-mark-summary">Image markings: {markSummary}</p>
      )}
      <ol className="review-point-list">
        {annotations.map((item, index) => {
          const asset = locationFor(item);
          return (
            <li key={item.id} className={activeId === item.id ? "active" : ""}>
              <span className="review-point-number">{index + 1}</span>
              <div>
                <p>{item.body}</p>
                {asset ? (
                  <button type="button" onClick={() => show(item)}>
                    Show on {asset.filename || "screenshot"}
                  </button>
                ) : (
                  <small className="muted">Saved page position</small>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {thread.assets
        .filter((asset) => asset.contentType === "video/webm")
        .map((asset) => (
          <video
            key={asset.id}
            controls
            preload="metadata"
            src={asset.url}
            aria-label="Tab video feedback"
          />
        ))}
    </section>
  );
}
