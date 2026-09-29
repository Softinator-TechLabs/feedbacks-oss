import React, { useEffect, useState } from "react";
import { api } from "../../api.js";
import { navigate, usePageLocation } from "../../navigation.js";
import { filterQuery, readFilters, readOffset } from "../../review-filters.js";
import { ErrorNotice, useLoad } from "../../ui.js";

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
