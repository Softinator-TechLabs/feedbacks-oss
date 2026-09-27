import React, { useEffect, useRef, useState } from "react";
import type { Thread } from "./api.js";
import { MarkdownText } from "./markdown-text.js";

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
  const activeBounds =
    active &&
    selected?.markings?.find(
      (mark) => mark.origin === "element" && mark.annotationId === active.id,
    )?.bounds;
  const marks = selected?.markings?.filter((mark) => mark.tool !== "point") || [];
  const markKinds = marks.map((mark) =>
    mark.origin === "element" ? "selected element box" : mark.tool,
  );
  const markSummary = [...new Set(markKinds)]
    .map((kind) => `${markKinds.filter((value) => value === kind).length} ${kind}`)
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
            {activeBounds && (
              <span
                className="review-evidence-target"
                aria-hidden="true"
                style={{
                  left: `${activeBounds.x * 100}%`,
                  top: `${activeBounds.y * 100}%`,
                  width: `${activeBounds.width * 100}%`,
                  height: `${activeBounds.height * 100}%`,
                }}
              />
            )}
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
                <MarkdownText body={active.body} />
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
                <MarkdownText body={item.body} />
                <span className="review-point-kind">
                  {item.anchor.selector
                    ? item.anchor.confidence === "unmatched"
                      ? "Selected element · changed after selection"
                      : "Selected element"
                    : "Page position only"}
                </span>
                {item.anchor.selector && (
                  <details className="review-point-context">
                    <summary>Element and box details</summary>
                    <dl>
                      {item.anchor.tagName && (
                        <>
                          <dt>Element</dt>
                          <dd>&lt;{item.anchor.tagName}&gt;</dd>
                        </>
                      )}
                      <dt>Selector</dt>
                      <dd>
                        <code>{item.anchor.selector}</code>
                      </dd>
                      {item.anchor.rect && (
                        <>
                          <dt>Box on page</dt>
                          <dd>
                            {Math.round(item.anchor.rect.x)},{" "}
                            {Math.round(item.anchor.rect.y)} ·{" "}
                            {Math.round(item.anchor.rect.width)} ×{" "}
                            {Math.round(item.anchor.rect.height)} px
                          </dd>
                        </>
                      )}
                      {item.anchor.styles?.borderStyle && (
                        <>
                          <dt>Border</dt>
                          <dd>
                            {item.anchor.styles.borderWidth}{" "}
                            {item.anchor.styles.borderStyle}{" "}
                            {item.anchor.styles.borderColor}
                          </dd>
                        </>
                      )}
                      {item.anchor.styles?.borderRadius && (
                        <>
                          <dt>Corner radius</dt>
                          <dd>{item.anchor.styles.borderRadius}</dd>
                        </>
                      )}
                    </dl>
                  </details>
                )}
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
