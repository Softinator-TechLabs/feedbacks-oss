import React, { useEffect, useRef, useState } from "react";
import { api, type Thread } from "./api.js";
import { MarkdownText } from "./markdown-text.js";
import { ErrorNotice, Notice, useAction } from "./ui.js";
import { HumanTime } from "./human-time.js";

type Asset = Thread["assets"][number];
type Annotation = NonNullable<Thread["context"]["annotations"]>[number];

function imageLabel(asset: Asset) {
  const point = /^point-(\d+)-original\.webp$/.exec(asset.filename || "");
  if (point) return `Point ${Number(point[1])} · original view`;
  if (asset.filename === "page-visible.webp") return "Page · visible area";
  if (asset.filename === "full-page-combined.webp") return "Full page · combined";
  return asset.filename || "Attached screenshot";
}

function position(asset: Asset, item: Annotation, context: Thread["context"]) {
  const mark = asset.markings?.find(
    (entry) => entry.tool === "point" && entry.annotationId === item.id,
  );
  if (mark?.endpoints[0]) return { ...mark.endpoints[0], baked: true };
  // New extension images carry explicit point identities. Absence means this
  // point was not visible in that image; do not project old viewport coordinates.
  if (
    asset.filename === "page-visible.webp" ||
    /^point-\d+-original\.webp$/.test(asset.filename || "") ||
    item.anchor.viewport
  )
    return null;
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

export function ReviewEvidence({
  thread,
  canResolve = false,
  canMaintain = false,
  onSaved,
}: {
  thread: Thread;
  canResolve?: boolean;
  canMaintain?: boolean;
  onSaved?: (thread: Thread) => void;
}) {
  const annotations = thread.context.annotations || [];
  const action = useAction();
  const pending = useRef(false);
  const [filter, setFilter] = useState("all");
  const threadClosed = ["resolved", "declined"].includes(thread.work.state);
  const stateOf = (item: Annotation) => {
    const state = thread.annotationStates?.[item.id]?.state || "open";
    if (state === "removed") return state;
    if (thread.work.state === "declined") return "closed";
    return thread.work.state === "resolved" ? "resolved" : state;
  };
  const counts = annotations.reduce(
    (counts, item) => {
      counts[stateOf(item)]++;
      return counts;
    },
    { open: 0, resolved: 0, removed: 0, closed: 0 },
  );
  async function changePoint(item: Annotation, state: "open" | "resolved" | "removed") {
    if (pending.current || !onSaved) return;
    pending.current = true;
    try {
      await action.run(
        async () =>
          onSaved(
            await api<Thread>("threads.annotationStatus", {
              threadId: thread.id,
              revision: thread.revision,
              annotationId: item.id,
              state,
            }),
          ),
        state === "removed"
          ? "Point removed. Its original evidence is kept; you can restore it."
          : state === "resolved"
            ? "Point resolved. The thread status is unchanged."
            : "Point reopened.",
      );
    } finally {
      pending.current = false;
    }
  }
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
    images.find(
      (asset) =>
        /^point-\d+-original\.webp$/.test(asset.filename || "") &&
        asset.markings?.some(
          (mark) => mark.tool === "point" && mark.annotationId === item.id,
        ),
    ) ||
    numbered.find((asset) => position(asset, item, thread.context)) ||
    (combined && position(combined, item, thread.context) ? combined : undefined) ||
    images.find((asset) => position(asset, item, thread.context));
  const active = annotations.find(
    (item) => item.id === activeId && stateOf(item) !== "removed",
  );
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
                  {imageLabel(asset)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="review-point-overview">
        <p>
          {counts.open} open · {counts.resolved} resolved
          {counts.closed ? ` · ${counts.closed} closed` : ""}
          {counts.removed ? ` · ${counts.removed} removed` : ""}
        </p>
        <label>
          Points{" "}
          <select
            aria-label="Filter points"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          >
            <option value="all">All active points</option>
            <option value="open">Open</option>
            <option value="resolved">Resolved / closed</option>
            <option value="removed">Removed</option>
          </select>
        </label>
      </div>
      {threadClosed && (
        <p className="muted">
          This thread is closed. Reopen it to continue individual points; earlier point
          decisions are kept.
        </p>
      )}
      <ErrorNotice error={action.error} />
      {action.notice && <Notice>{action.notice}</Notice>}
      {action.error.includes("CONFLICT") && onSaved && (
        <button
          type="button"
          disabled={action.busy}
          onClick={() =>
            void action.run(async () =>
              onSaved(await api<Thread>("threads.get", { threadId: thread.id })),
            )
          }
        >
          Load latest point status
        </button>
      )}
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
              if (stateOf(item) === "removed") return [];
              const point = position(selected, item, thread.context);
              return point
                ? [
                    <button
                      type="button"
                      key={item.id}
                      className={`review-evidence-pin${point.baked ? " baked" : ""}${stateOf(item) !== "open" ? " resolved" : ""}${activeId === item.id ? " active" : ""}`}
                      style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
                      aria-label={`Point ${index + 1} · ${stateOf(item)}: ${item.body}`}
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
                <strong>
                  Point {annotations.indexOf(active) + 1} · {stateOf(active)}
                </strong>
                <MarkdownText body={active.body} />
              </div>
            )}
          </div>
          <figcaption>
            {imageLabel(selected)}
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
          const state = stateOf(item);
          if (
            filter === "all"
              ? state === "removed"
              : filter === "resolved"
                ? !["resolved", "closed"].includes(state)
                : state !== filter
          )
            return null;
          const decision = thread.annotationStates?.[item.id];
          return (
            <li
              key={item.id}
              className={`${state} ${activeId === item.id ? "active" : ""}`}
            >
              <span className="review-point-number">{index + 1}</span>
              <div>
                <div className="review-point-status">
                  <strong>
                    {state === "open"
                      ? "Open"
                      : state === "removed"
                        ? "Removed"
                        : state === "closed"
                          ? "Thread closed"
                          : "Resolved"}
                  </strong>
                  {decision && (
                    <span>
                      Point {decision.state} by {decision.actor.name} ·{" "}
                      <HumanTime at={decision.at} />
                    </span>
                  )}
                </div>
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
                      {item.anchor.viewport && (
                        <>
                          <dt>Original screen size</dt>
                          <dd>
                            {item.anchor.viewport.width} × {item.anchor.viewport.height}{" "}
                            px
                          </dd>
                        </>
                      )}
                      {item.anchor.capturedAt && (
                        <>
                          <dt>Captured</dt>
                          <dd>
                            <time dateTime={item.anchor.capturedAt}>
                              {new Date(item.anchor.capturedAt).toLocaleString()}
                            </time>
                          </dd>
                        </>
                      )}
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
                    {/^point-\d+-original\.webp$/.test(asset.filename || "")
                      ? "Show original view"
                      : `Show on ${imageLabel(asset)}`}
                  </button>
                ) : (
                  <small className="muted">Saved page position</small>
                )}
                <div className="review-point-actions">
                  {onSaved && canResolve && !threadClosed && state !== "removed" && (
                    <button
                      type="button"
                      disabled={action.busy}
                      onClick={() =>
                        void changePoint(item, state === "resolved" ? "open" : "resolved")
                      }
                    >
                      {state === "resolved" ? "Reopen point" : "Resolve point"}
                    </button>
                  )}
                  {onSaved && canMaintain && (
                    <button
                      type="button"
                      disabled={action.busy}
                      onClick={() =>
                        void changePoint(item, state === "removed" ? "open" : "removed")
                      }
                    >
                      {state === "removed" ? "Restore point" : "Remove point"}
                    </button>
                  )}
                </div>
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
