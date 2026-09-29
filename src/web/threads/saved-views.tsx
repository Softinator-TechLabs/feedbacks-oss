import React, { useEffect, useRef, useState } from "react";
import type { ReviewFilters } from "../../shared/contracts.js";
import { api } from "../api.js";
import { useUnsavedChanges } from "../navigation.js";
import { ActionState, ErrorNotice, Field, useAction, useLoad } from "../ui.js";

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
            <button disabled={a.busy || (!!filters.url && !URL.canParse(filters.url))}>
              Save
            </button>
            {!!filters.url && !URL.canParse(filters.url) && (
              <small>Complete Page URL before saving this view.</small>
            )}
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
