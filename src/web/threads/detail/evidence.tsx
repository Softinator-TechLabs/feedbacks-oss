import React, { useEffect, useRef, useState } from "react";
import { api, type Thread } from "../../api.js";
import { MarkdownText } from "../../markdown-text.js";
import { ErrorNotice, Notice, useAction } from "../../ui.js";
import { HumanTime } from "../../human-time.js";
import { Icon } from "../../icons.js";
import { PointWorkPlan } from "../../point-work-plan.js";
import { pointProgress } from "../../point-progress.js";
import { planPriorities, timingLabel } from "../../work-plan-model.js";

import { EvidenceScreenshot, type EvidenceLayer } from "./evidence-screenshot.js";

const pointsPerPage = 5;

type Asset = Thread["assets"][number];
type Annotation = NonNullable<Thread["context"]["annotations"]>[number];

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
  canWrite = false,
  canMaintain = false,
  onSaved,
}: {
  thread: Thread;
  canResolve?: boolean;
  canWrite?: boolean;
  canMaintain?: boolean;
  onSaved?: (thread: Thread) => void;
}) {
  const annotations = thread.context.annotations || [];
  const currentThread = useRef(thread);
  currentThread.current = thread;
  const action = useAction();
  const pending = useRef(false);
  const [filter, setFilter] = useState("all");
  const [pointPage, setPointPage] = useState(0);
  const [expandedPoints, setExpandedPoints] = useState<Set<string>>(
    () => new Set(annotations.length === 1 ? [annotations[0].id] : []),
  );
  const setPointOpen = (id: string, open: boolean) =>
    setExpandedPoints((current) => {
      if (current.has(id) === open) return current;
      const next = new Set(current);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });
  useEffect(() => {
    setExpandedPoints(new Set(annotations.length === 1 ? [annotations[0].id] : []));
    setPointPage(0);
    setFilter("all");
  }, [thread.id]);
  useEffect(() => {
    const revealPoint = () => {
      const latest = currentThread.current;
      const annotations = latest.context.annotations || [];
      const id = location.hash.startsWith("#point-") ? location.hash.slice(7) : null;
      if (id && annotations.some((item) => item.id === id)) {
        const removed = latest.annotationStates?.[id]?.state === "removed";
        const matching = annotations.filter(
          (item) => (latest.annotationStates?.[item.id]?.state === "removed") === removed,
        );
        setFilter(removed ? "removed" : "all");
        setPointPage(
          Math.floor(matching.findIndex((item) => item.id === id) / pointsPerPage),
        );
        setPointOpen(id, true);
        requestAnimationFrame(() =>
          document.getElementById(`point-${id}`)?.scrollIntoView({ block: "start" }),
        );
      }
    };
    revealPoint();
    addEventListener("hashchange", revealPoint);
    return () => removeEventListener("hashchange", revealPoint);
  }, [thread.id]);
  const [layerVisibility, setLayerVisibility] = useState<Record<string, boolean>>({});
  const hiddenLayers = (assetId: string): Record<EvidenceLayer, boolean> => ({
    points: layerVisibility[`${assetId}:points`] ?? false,
    element: layerVisibility[`${assetId}:element`] ?? true,
    text: layerVisibility[`${assetId}:text`] ?? false,
  });
  const toggleLayer = (assetId: string, layer: EvidenceLayer) =>
    setLayerVisibility((current) => ({
      ...current,
      [`${assetId}:${layer}`]: !(current[`${assetId}:${layer}`] ?? layer === "element"),
    }));
  useEffect(() => setLayerVisibility({}), [thread.id]);
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
  const filteredPoints = annotations
    .map((item, index) => ({ item, index, state: stateOf(item) }))
    .filter(({ state }) =>
      filter === "all"
        ? state !== "removed"
        : filter === "resolved"
          ? ["resolved", "closed"].includes(state)
          : state === filter,
    );
  const currentPage = Math.min(
    pointPage,
    Math.max(0, Math.ceil(filteredPoints.length / pointsPerPage) - 1),
  );
  const pointOffset = currentPage * pointsPerPage;
  const progress = pointProgress(thread);
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
  const pageImages = images.filter((asset) => !asset.recordingFrame);
  const numbered = pageImages.filter((asset) =>
    /^full-page-\d+-of-\d+\.webp$/.test(asset.filename || ""),
  );
  const combined = pageImages.find(
    (asset) => asset.filename === "full-page-combined.webp",
  );
  const pageVisible = pageImages.find((asset) => asset.filename === "page-visible.webp");
  const mainCaptures = combined
    ? [combined]
    : numbered.length
      ? numbered
      : pageVisible
        ? [pageVisible]
        : pageImages.filter(
            (asset) => !/^point-\d+-original\.webp$/.test(asset.filename || ""),
          );
  const extraCaptures = pageImages.filter(
    (asset) =>
      !mainCaptures.includes(asset) &&
      !/^point-\d+-original\.webp$/.test(asset.filename || ""),
  );
  useEffect(() => {
    const openLinkedAsset = () => {
      const latest = currentThread.current;
      const linked = latest.assets.find(
        (asset) => location.hash === `#asset-${asset.id}`,
      );
      if (!linked) return;
      const element = document.getElementById(`asset-${linked.id}`);
      const group = element?.closest("details");
      if (group?.classList.contains("review-point-details"))
        setPointOpen(group.dataset.pointId!, true);
      else if (group) group.open = true;
      else if (!element) {
        const annotations = latest.context.annotations || [];
        const index = annotations.findIndex(
          (item) =>
            linked.markings?.some(
              (mark) => mark.tool === "point" && mark.annotationId === item.id,
            ) || position(linked, item, latest.context),
        );
        if (index >= 0) {
          location.hash = `point-${annotations[index].id}`;
          return;
        }
      }
      requestAnimationFrame(() => element?.scrollIntoView({ block: "start" }));
    };
    openLinkedAsset();
    addEventListener("hashchange", openLinkedAsset);
    return () => removeEventListener("hashchange", openLinkedAsset);
  }, [thread.id]);
  const locationFor = (item: Annotation) =>
    images.find(
      (asset) =>
        /^point-\d+-original\.webp$/.test(asset.filename || "") &&
        asset.markings?.some(
          (mark) => mark.tool === "point" && mark.annotationId === item.id,
        ),
    ) ||
    images.find((asset) =>
      asset.markings?.some(
        (mark) => mark.tool === "point" && mark.annotationId === item.id,
      ),
    ) ||
    numbered.find((asset) => position(asset, item, thread.context)) ||
    (combined && position(combined, item, thread.context) ? combined : undefined) ||
    images.find((asset) => position(asset, item, thread.context));
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
      </div>
      <div className="review-point-overview">
        <p>
          {counts.open} open · {counts.resolved} resolved
          {progress.urgent ? ` · ${progress.urgent} urgent` : ""}
          {progress.later ? ` · ${progress.later} later` : ""}
          {counts.closed ? ` · ${counts.closed} closed` : ""}
          {counts.removed ? ` · ${counts.removed} removed` : ""}
        </p>
        {annotations.length > 1 && (
          <div className="review-point-controls">
            <label>
              <select
                aria-label="Filter points"
                value={filter}
                onChange={(event) => {
                  setFilter(event.target.value);
                  setPointPage(0);
                }}
              >
                <option value="all">All active points</option>
                <option value="open">Open</option>
                <option value="resolved">Resolved / closed</option>
                <option value="removed">Removed</option>
              </select>
            </label>
            <div className="review-point-bulk" role="group" aria-label="Point display">
              <button
                type="button"
                disabled={filteredPoints.every(({ item }) => expandedPoints.has(item.id))}
                onClick={() =>
                  setExpandedPoints(
                    (current) =>
                      new Set([...current, ...filteredPoints.map(({ item }) => item.id)]),
                  )
                }
              >
                Expand all
              </button>
              <button
                type="button"
                disabled={!filteredPoints.some(({ item }) => expandedPoints.has(item.id))}
                onClick={() =>
                  setExpandedPoints(
                    (current) =>
                      new Set(
                        [...current].filter(
                          (id) => !filteredPoints.some(({ item }) => item.id === id),
                        ),
                      ),
                  )
                }
              >
                Collapse all
              </button>
            </div>
          </div>
        )}
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
      {mainCaptures.map((asset) => (
        <EvidenceScreenshot
          asset={asset}
          id={`asset-${asset.id}`}
          className="review-main-capture"
          loading="eager"
          hiddenLayers={hiddenLayers(asset.baseAssetId ?? asset.id)}
          onToggleLayer={toggleLayer}
          captureMarker={thread.context.captureMarker}
          thread={thread}
          onSaved={canWrite ? onSaved : undefined}
          key={asset.baseAssetId ?? asset.id}
        />
      ))}
      {extraCaptures.length > 0 && (
        <details className="review-extra-captures">
          <summary>More page captures ({extraCaptures.length})</summary>
          {extraCaptures.map((asset) => (
            <EvidenceScreenshot
              asset={asset}
              id={`asset-${asset.id}`}
              loading="lazy"
              hiddenLayers={hiddenLayers(asset.baseAssetId ?? asset.id)}
              onToggleLayer={toggleLayer}
              captureMarker={thread.context.captureMarker}
              thread={thread}
              onSaved={canWrite ? onSaved : undefined}
              key={asset.baseAssetId ?? asset.id}
            />
          ))}
        </details>
      )}
      <ol className="review-point-list">
        {filteredPoints
          .slice(pointOffset, pointOffset + pointsPerPage)
          .map(({ item, index, state }) => {
            const asset = locationFor(item);
            const decision = thread.annotationStates?.[item.id];
            return (
              <li id={`point-${item.id}`} key={item.id} className={state}>
                <details
                  className="review-point-details"
                  data-point-id={item.id}
                  open={expandedPoints.has(item.id)}
                  onToggle={(event) => setPointOpen(item.id, event.currentTarget.open)}
                >
                  <summary className="review-point-summary">
                    <span className="review-point-number">{index + 1}</span>
                    <span className="review-point-preview">
                      <strong>{item.textEdit ? "Text edit" : "Comment"}</strong>
                      <span>
                        {item.textEdit
                          ? `${item.textEdit.original} → ${item.textEdit.replacement || "Remove selected text"}`
                          : item.body}
                      </span>
                      {thread.annotationPlans?.[item.id] &&
                        thread.annotationPlans[item.id].priority !== "normal" && (
                          <small>
                            {planPriorities[thread.annotationPlans[item.id].priority]}{" "}
                            priority
                          </small>
                        )}
                    </span>
                    <span className="review-point-state">
                      {state === "open"
                        ? "Open"
                        : state === "removed"
                          ? "Removed"
                          : state === "closed"
                            ? "Closed"
                            : "Resolved"}
                    </span>
                    <Icon name="arrowRight" />
                  </summary>
                  <div className="review-point-detail">
                    <div className={`review-point-layout${asset ? " has-evidence" : ""}`}>
                      <div className="review-point-body">
                        {item.textEdit ? (
                          <div
                            className="review-text-edit"
                            aria-label="Suggested text edit"
                          >
                            <div>
                              <strong>Original text</strong>
                              <blockquote>{item.textEdit.original}</blockquote>
                            </div>
                            <div>
                              <strong>Suggested replacement</strong>
                              {item.textEdit.replacement ? (
                                <blockquote>{item.textEdit.replacement}</blockquote>
                              ) : (
                                <p className="muted">Remove selected text</p>
                              )}
                            </div>
                          </div>
                        ) : (
                          <MarkdownText body={item.body} />
                        )}
                        <span className="review-point-kind">
                          {!asset
                            ? "Saved page position"
                            : asset.recordingFrame
                              ? `Video frame · ${(asset.recordingFrame.atMs / 1000).toFixed(1)}s`
                              : item.anchor.selector
                                ? item.anchor.confidence === "unmatched"
                                  ? "Selected element · changed after selection"
                                  : "Selected element"
                                : "Page position only"}
                        </span>
                        {onSaved && canWrite && state === "open" && !threadClosed ? (
                          <div
                            className="review-point-planning"
                            role="group"
                            aria-label="Point planning"
                          >
                            <PointWorkPlan
                              thread={thread}
                              annotationId={item.id}
                              number={index + 1}
                              onSaved={onSaved}
                            />
                          </div>
                        ) : (
                          thread.annotationPlans?.[item.id] && (
                            <span className="review-point-plan-summary">
                              {planPriorities[thread.annotationPlans[item.id].priority]}{" "}
                              priority · {timingLabel(thread.annotationPlans[item.id])}
                            </span>
                          )
                        )}
                      </div>
                      <div className="review-point-media">
                        {asset ? (
                          <EvidenceScreenshot
                            asset={asset}
                            id={
                              /^point-\d+-original\.webp$/.test(asset.filename || "")
                                ? `asset-${asset.id}`
                                : undefined
                            }
                            className="review-point-figure"
                            loading="lazy"
                            hiddenLayers={hiddenLayers(asset.baseAssetId ?? asset.id)}
                            onToggleLayer={toggleLayer}
                            captureMarker={thread.context.captureMarker}
                            thread={thread}
                            onSaved={canWrite ? onSaved : undefined}
                          />
                        ) : null}
                      </div>
                    </div>
                    <div className="review-point-footer">
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
                                  {item.anchor.viewport.width} ×{" "}
                                  {item.anchor.viewport.height} px
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
                      )}{" "}
                      <div className="review-point-actions">
                        {onSaved &&
                          canResolve &&
                          !threadClosed &&
                          state !== "removed" && (
                            <button
                              type="button"
                              disabled={action.busy}
                              onClick={() =>
                                void changePoint(
                                  item,
                                  state === "resolved" ? "open" : "resolved",
                                )
                              }
                            >
                              <Icon name={state === "resolved" ? "history" : "check"} />
                              {state === "resolved" ? "Reopen point" : "Resolve point"}
                            </button>
                          )}
                        {onSaved && canMaintain && (
                          <button
                            type="button"
                            disabled={action.busy}
                            onClick={() =>
                              void changePoint(
                                item,
                                state === "removed" ? "open" : "removed",
                              )
                            }
                          >
                            <Icon name={state === "removed" ? "history" : "trash"} />
                            {state === "removed" ? "Restore point" : "Remove point"}
                          </button>
                        )}
                      </div>
                    </div>
                    {decision && (
                      <p className="review-point-decision muted">
                        Point {decision.state} by {decision.actor.name} ·{" "}
                        <HumanTime at={decision.at} />
                      </p>
                    )}
                  </div>
                </details>
              </li>
            );
          })}
      </ol>
      {filteredPoints.length === 0 && <p className="muted">No points in this view.</p>}
      {filteredPoints.length > pointsPerPage && (
        <nav className="review-point-pagination" aria-label="Point pages">
          <span aria-live="polite">
            {pointOffset + 1}–
            {Math.min(pointOffset + pointsPerPage, filteredPoints.length)} of{" "}
            {filteredPoints.length} points
          </span>
          <button
            type="button"
            aria-label="Previous points"
            disabled={currentPage === 0}
            onClick={() => {
              setPointPage(currentPage - 1);
            }}
          >
            Previous
          </button>
          <button
            type="button"
            aria-label="Next points"
            disabled={pointOffset + pointsPerPage >= filteredPoints.length}
            onClick={() => {
              setPointPage(currentPage + 1);
            }}
          >
            Next
          </button>
        </nav>
      )}
    </section>
  );
}
