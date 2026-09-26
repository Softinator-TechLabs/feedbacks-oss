import React, { useEffect, useRef, useState } from "react";
import type { ReviewFilters } from "../shared/contracts.js";
import { api, labels, type Thread } from "./api.js";
import { navigate, usePageLocation, useUnsavedChanges } from "./navigation.js";
import {
  categories,
  filterQuery,
  readFilters,
  readOffset,
  splitTags,
} from "./review-filters.js";
import { ActionState, ErrorNotice, Field, useAction, useLoad } from "./ui.js";

type SavedView = { id: string; name: string; revision: number; filters: ReviewFilters };
export function SavedReviewViews({
  projectId,
  filters,
  onApply,
}: {
  projectId: string;
  filters: ReviewFilters;
  onApply: (filters: ReviewFilters) => void;
}) {
  const [version, setVersion] = useState(0),
    [selected, setSelected] = useState("");
  const manageRef = useRef<HTMLDetailsElement>(null);
  const triggerRef = useRef<HTMLElement>(null);
  const a = useAction();
  const { data, error } = useLoad(
    () => api<{ items: SavedView[] }>("reviewViews.list", { projectId }),
    [projectId, version],
  );
  const view = data?.items.find((item) => item.id === selected);
  useUnsavedChanges(a.busy);
  useEffect(() => {
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!manageRef.current?.contains(event.target as Node))
        manageRef.current?.removeAttribute("open");
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, []);
  return (
    <div className="saved-views">
      <details
        className="saved-view-manage"
        ref={manageRef}
        onKeyDown={(event) => {
          if (event.key === "Escape" && manageRef.current?.open) {
            event.preventDefault();
            manageRef.current.open = false;
            triggerRef.current?.focus();
          }
        }}
      >
        <summary ref={triggerRef} aria-label="Saved views" title="Saved views">
          <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none">
            <path
              d="M6 3.5h12v17l-6-4-6 4v-17Z"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
          </svg>
        </summary>
        <div className="saved-view-popover">
          <strong className="saved-view-title">Saved views</strong>
          <ErrorNotice error={error} />
          {error && (
            <button type="button" onClick={() => setVersion((v) => v + 1)}>
              Retry saved views
            </button>
          )}
          {!!data?.items.length ? (
            <Field label="Open a saved view">
              <select
                value={view?.id ?? ""}
                disabled={a.busy}
                onChange={(e) => {
                  const id = e.target.value;
                  setSelected(id);
                  const next = data.items.find((item) => item.id === id);
                  if (next) onApply(next.filters);
                }}
              >
                <option value="">Choose a view ({data.items.length})</option>
                {data.items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : data ? (
            <p className="saved-view-empty">No saved views yet.</p>
          ) : null}
          <strong className="saved-view-title">Save current view</strong>
          <form
            className="saved-view-picker"
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget,
                name = String(new FormData(form).get("name"));
              void a.run(async () => {
                const saved = await api<SavedView>("reviewViews.save", {
                  projectId,
                  name,
                  filters,
                });
                setSelected(saved.id);
                setVersion((v) => v + 1);
                form.reset();
              }, "Current filters saved.");
            }}
          >
            <Field label="Name for current filters">
              <input name="name" required maxLength={80} placeholder="Mobile checkout" />
            </Field>
            <button disabled={a.busy}>Save</button>
          </form>
          {view && (
            <button
              className="saved-view-remove"
              disabled={a.busy}
              onClick={() =>
                a.run(async () => {
                  await api("reviewViews.delete", {
                    projectId,
                    viewId: view.id,
                    revision: view.revision,
                  });
                  setSelected("");
                  setVersion((v) => v + 1);
                }, "Saved view removed.")
              }
            >
              Remove {view.name}
            </button>
          )}
          <ActionState action={a} />
        </div>
      </details>
    </div>
  );
}

export function ThreadNavigation({ threadId }: { threadId: string }) {
  const query = usePageLocation().split("?")[1] ?? "";
  const filters = readFilters(query),
    offset = readOffset(query);
  const [version, setVersion] = useState(0);
  // Keep these neighbors during edits: resolving this thread or posting a reply
  // must not move the next/previous target under the reviewer's hand.
  const { data, error } = useLoad(
    () =>
      api<{
        previous: string | null;
        next: string | null;
        position: number | null;
        total: number;
      }>("threads.neighbors", { threadId, ...filters }),
    [threadId, query, version],
  );
  const href = (id: string) => {
    const targetPosition = data?.position
      ? data.position + (id === data.next ? 1 : -1)
      : null;
    return `/threads/${id}${filterQuery(filters, targetPosition ? Math.floor((targetPosition - 1) / 30) * 30 : offset)}`;
  };
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (
        !data ||
        error ||
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey
      )
        return;
      const target = event.target;
      if (
        document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]') ||
        (target instanceof Element &&
          target.closest(
            'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="slider"], [role="combobox"], [role="listbox"], [role="menu"]',
          ))
      )
        return;
      const id =
        event.key === "ArrowLeft"
          ? data.previous
          : event.key === "ArrowRight"
            ? data.next
            : null;
      if (id) {
        event.preventDefault();
        navigate(href(id));
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [data, query, error]);
  return (
    <section className="thread-navigation" aria-label="Navigate feedback">
      <div className="review-controls">
        <button
          disabled={!data?.previous || !!error}
          onClick={() => data?.previous && navigate(href(data.previous))}
          aria-keyshortcuts="ArrowLeft"
        >
          ← Previous thread
        </button>
        <span className="muted">
          {data
            ? data.position === null
              ? "Outside the current filters"
              : `${data.position} of ${data.total} threads`
            : "Loading navigation…"}
        </span>
        <button
          disabled={!data?.next || !!error}
          onClick={() => data?.next && navigate(href(data.next))}
          aria-keyshortcuts="ArrowRight"
        >
          Next thread →
        </button>
      </div>
      <ErrorNotice error={error} />
      {error && (
        <button onClick={() => setVersion((v) => v + 1)}>Retry navigation</button>
      )}
    </section>
  );
}

export function ThreadOrganization({
  thread,
  canWrite,
  onSaved,
}: {
  thread: Thread;
  canWrite: boolean;
  onSaved: (thread: Thread) => void;
}) {
  const a = useAction();
  const [draft, setDraft] = useState<{
    category: string;
    tags: string;
    revision: number;
  } | null>(null);
  const value = draft ?? {
    category: thread.category ?? "general",
    tags: (thread.tags ?? []).join(", "),
    revision: thread.revision,
  };
  useUnsavedChanges(!!draft || a.busy);
  return (
    <details className="section compact-details" id="thread-organize">
      <summary>Category &amp; tags</summary>
      {canWrite ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const pending = value;
            void a.run(async () => {
              onSaved(
                await api<Thread>("threads.organize", {
                  threadId: thread.id,
                  revision: pending.revision,
                  category: pending.category as "general",
                  tags: splitTags(pending.tags),
                }),
              );
              setDraft(null);
            }, "Category and tags saved.");
          }}
        >
          <Field label="Category (optional)">
            <select
              name="category"
              value={value.category}
              disabled={a.busy}
              onChange={(e) => setDraft({ ...value, category: e.target.value })}
            >
              {categories.map((v) => (
                <option value={v} key={v}>
                  {labels[v]}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Tags (optional)"
            hint="Comma separated; up to 12 tags, 32 characters each."
          >
            <input
              name="tags"
              value={value.tags}
              disabled={a.busy}
              onChange={(e) => setDraft({ ...value, tags: e.target.value })}
              maxLength={394}
              placeholder="checkout, mobile"
            />
          </Field>
          <button disabled={a.busy || !draft}>Save category &amp; tags</button>
          {draft && draft.revision !== thread.revision && (
            <p role="status">
              This thread changed while you were editing.{" "}
              <button
                type="button"
                onClick={(e) => {
                  setDraft(null);
                  a.setError("");
                  const form = e.currentTarget.closest("form");
                  if (form) delete form.dataset.unsaved;
                }}
              >
                Load latest category &amp; tags
              </button>
            </p>
          )}
          <ActionState action={a} />
        </form>
      ) : (
        <p>
          {labels[thread.category] ?? "General"} · {thread.tags?.join(", ") || "No tags"}
        </p>
      )}
    </details>
  );
}

export function ScreenshotComparison({
  assets,
  threadId,
  canMaintain,
}: {
  assets: Thread["assets"];
  threadId: string;
  canMaintain: boolean;
}) {
  const [leftId, setLeft] = useState(assets[0].id),
    [rightId, setRight] = useState(assets.at(-1)!.id),
    [mode, setMode] = useState("side"),
    [split, setSplit] = useState(50),
    [failed, setFailed] = useState(false),
    [baselineVersion, setBaselineVersion] = useState(0),
    [metric, setMetric] = useState<{
      changedPercent: number;
      baselineAssetId: string;
      candidateAssetId: string;
    }>();
  const qaAction = useAction();
  const baseline = useLoad<{ assetId: string | null; setAt: string | null }>(
    () => api("qa.baselineGet", { threadId }),
    [threadId, baselineVersion],
  );
  const left = assets.find((a) => a.id === leftId) ?? assets[0],
    right = assets.find((a) => a.id === rightId) ?? assets.at(-1)!;
  const baselineAsset = assets.find((asset) => asset.id === baseline.data?.assetId);
  const matched = left.width === right.width && left.height === right.height;
  const overlay = mode === "overlay" && matched && left.id !== right.id;
  useEffect(() => {
    setFailed(false);
    setMetric(undefined);
  }, [left.id, right.id]);
  const image = (asset: typeof left, label: string) => (
    <img
      src={asset.url}
      width={asset.width}
      height={asset.height}
      alt={`${label}: ${asset.rendition}`}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
  return (
    <details className="section screenshot-comparison">
      <summary>Visual baseline and comparison</summary>
      <div className="review-controls">
        {(assets.length === 1
          ? [["First image", left.id, setLeft]]
          : [
              ["First image", left.id, setLeft],
              ["Second image", right.id, setRight],
            ]
        ).map(([label, value, set]) => (
          <Field key={String(label)} label={String(label)}>
            <select
              value={String(value)}
              onChange={(e) => (set as typeof setLeft)(e.target.value)}
            >
              {assets.map((asset, index) => (
                <option key={asset.id} value={asset.id}>
                  {asset.filename || `Image ${index + 1}`} · {asset.rendition} ·{" "}
                  {asset.width} × {asset.height}
                </option>
              ))}
            </select>
          </Field>
        ))}
      </div>
      {assets.length > 1 && (
        <div className="review-controls" role="group" aria-label="Comparison mode">
          <button aria-pressed={!overlay} onClick={() => setMode("side")}>
            Side by side
          </button>
          <button
            disabled={!matched || left.id === right.id}
            aria-pressed={overlay}
            onClick={() => setMode("overlay")}
          >
            Overlay
          </button>
        </div>
      )}
      <div className="review-controls">
        {canMaintain && (
          <button
            type="button"
            disabled={qaAction.busy}
            onClick={() =>
              void qaAction.run(async () => {
                await api("qa.baselineSet", { threadId, assetId: left.id });
                setBaselineVersion((value) => value + 1);
                setMetric(undefined);
              }, "First image saved as this thread's baseline.")
            }
          >
            Set first image as baseline
          </button>
        )}
        {assets.length > 1 && (
          <button
            type="button"
            disabled={
              qaAction.busy ||
              !baselineAsset ||
              baselineAsset.width !== right.width ||
              baselineAsset.height !== right.height ||
              baselineAsset.id === right.id
            }
            onClick={() =>
              void qaAction.run(async () => {
                const result = await api<{
                  changedPercent: number;
                  baselineAssetId: string;
                  candidateAssetId: string;
                }>("qa.compare", { threadId, assetId: right.id });
                setMetric(result);
              })
            }
          >
            Compare second image with baseline
          </button>
        )}
      </div>
      {baselineAsset && (
        <p className="muted">Baseline: image {assets.indexOf(baselineAsset) + 1}</p>
      )}
      {metric && (
        <p role="status">
          {metric.changedPercent}% of pixels differ by more than 20 channel values. Review
          alignment and content before treating this as a regression.
        </p>
      )}
      <ActionState action={qaAction} />
      <ErrorNotice error={baseline.error} />
      {!matched && (
        <p className="muted">
          Different image sizes. Compare side by side to preserve each image’s
          proportions.
        </p>
      )}
      {left.id === right.id && (
        <p className="muted">
          {assets.length === 1
            ? "Set this image as a baseline; attach another image later to compare."
            : "Choose two different images to compare."}
        </p>
      )}
      <ErrorNotice
        error={
          failed
            ? "An image could not load. Open the attachment below or reload this page to retry."
            : ""
        }
      />
      {assets.length === 1 ? null : overlay ? (
        <>
          <div className="comparison-overlay">
            {image(right, "Second image")}
            <div
              className="comparison-front"
              style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}
            >
              {image(left, "First image")}
            </div>
            <div className="comparison-divider" style={{ left: `${split}%` }} />
          </div>
          <Field label={`Reveal first image: ${split}%`}>
            <input
              type="range"
              min={0}
              max={100}
              value={split}
              onChange={(e) => setSplit(Number(e.target.value))}
            />
          </Field>
        </>
      ) : (
        <div className="comparison-side">
          <figure>
            {image(left, "First image")}
            <figcaption>First image</figcaption>
          </figure>
          <figure>
            {image(right, "Second image")}
            <figcaption>Second image</figcaption>
          </figure>
        </div>
      )}
      <small className="muted">
        Visual comparison of attachments; matching dimensions do not guarantee matching
        page positions.
      </small>
    </details>
  );
}

export function ThreadDiagnostics({
  diagnostics,
}: {
  diagnostics: NonNullable<Thread["diagnostics"]>;
}) {
  return (
    <details className="section compact-details">
      <summary>Shared diagnostics</summary>
      <p className="muted">
        Reviewer-selected console and resource timing from the top-level page.
        Page-generated data is untrusted; missing status does not mean success.
      </p>
      <small>
        {diagnostics.startedAt} – {diagnostics.endedAt}
      </small>
      <h3>Console ({diagnostics.console.length})</h3>
      {diagnostics.console.map((entry, index) => (
        <p className="message" key={index}>
          <strong>{entry.level}</strong> · {entry.atMs} ms
          <br />
          {entry.message}
        </p>
      ))}
      <h3>Network ({diagnostics.network.length})</h3>
      {diagnostics.network.map((entry, index) => (
        <p className="message" key={index}>
          <strong>{entry.type}</strong> · {entry.status ?? "Status unavailable"} ·{" "}
          {entry.durationMs} ms
          <br />
          {entry.url}
        </p>
      ))}
    </details>
  );
}
