import { useEffect, useRef, useSyncExternalStore } from "react";

// Keep the working app mounted between ordinary pages. Capability links,
// downloads and administrative forms retain their native document navigation.
const ordinaryPage = (path: string) =>
  /^(?:\/|\/help|\/projects\/[^/]+(?:\/(?:members|instructions|github|settings|capture|documents(?:\/[^/]+)?))?|\/threads\/[^/]+)$/.test(
    path,
  );
const guards = new Set<() => boolean>();
const listeners = new Set<() => void>();
const snapshot = () => location.pathname + location.search;
let current = snapshot();
let position = 0;
let restoring = false;
export type PagePosition = {
  x: number;
  y: number;
  anchors: Array<{ id: string; top: number }>;
};
const pagePositions = new Map<string, PagePosition>();
function positionKey(page: string) {
  const url = new URL(page, location.origin);
  url.searchParams.sort();
  return url.pathname + url.search;
}
export function capturePagePosition(): PagePosition {
  return {
    x: window.scrollX,
    y: window.scrollY,
    anchors: [...document.querySelectorAll<HTMLElement>(".thread-row[data-thread-id]")]
      .filter((row) => row.getBoundingClientRect().bottom > 0)
      .slice(0, 3)
      .map((row) => ({
        id: row.dataset.threadId!,
        top: row.getBoundingClientRect().top,
      })),
  };
}
export function restorePagePosition(saved = pagePositions.get(positionKey(snapshot()))) {
  if (!saved) return;
  const rows = [...document.querySelectorAll<HTMLElement>(".thread-row[data-thread-id]")];
  const anchor = saved.anchors
    .map((item) => ({ item, row: rows.find((row) => row.dataset.threadId === item.id) }))
    .find((item) => item.row);
  window.scrollTo(
    saved.x,
    anchor?.row
      ? window.scrollY + anchor.row.getBoundingClientRect().top - anchor.item.top
      : saved.y,
  );
}
function savePagePosition() {
  if (!/^\/projects\/[^/?]+(?:\?|$)/.test(current)) return;
  const key = positionKey(current);
  pagePositions.delete(key);
  pagePositions.set(key, capturePagePosition());
  if (pagePositions.size > 20) pagePositions.delete(pagePositions.keys().next().value!);
}
window.addEventListener("feedbacks:account-change", () => pagePositions.clear());
history.replaceState({ ...history.state, feedbacksPosition: position }, "");
const dirty = () =>
  [...guards].some((guard) => guard()) ||
  !!document.querySelector('form[data-unsaved="true"]');
const mayLeave = () =>
  !dirty() || confirm("Leave this page? Your unsent changes will be lost.");

function publish(preservePosition = false) {
  current = snapshot();
  const target = current;
  const focusedBefore = document.activeElement;
  for (const listener of listeners) listener();
  if (preservePosition) return;
  requestAnimationFrame(() => {
    if (target !== snapshot()) return;
    if (location.hash) {
      document.getElementById(location.hash.slice(1))?.scrollIntoView();
    } else {
      if (pagePositions.has(positionKey(target))) restorePagePosition();
      else window.scrollTo(0, 0);
      if (
        document.activeElement === focusedBefore ||
        document.activeElement === document.body
      )
        document.getElementById("content")?.focus({ preventScroll: true });
    }
  });
}

export function navigate(
  href: string,
  options: { replace?: boolean; preservePosition?: boolean } = {},
) {
  const url = new URL(href, location.origin);
  if (
    url.origin !== location.origin ||
    !ordinaryPage(url.pathname) ||
    (url.pathname !== location.pathname && !mayLeave())
  )
    return false;
  if (url.pathname + url.search === snapshot()) return true;
  savePagePosition();
  if (options.replace)
    history.replaceState({ ...history.state, feedbacksPosition: position }, "", url);
  else history.pushState({ feedbacksPosition: ++position }, "", url);
  publish(options.preservePosition);
  return true;
}

document.addEventListener("click", (event) => {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  )
    return;
  const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
  if (
    !(link instanceof HTMLAnchorElement) ||
    link.hasAttribute("download") ||
    (link.target && link.target !== "_self")
  )
    return;
  const url = new URL(link.href);
  if (
    url.origin !== location.origin ||
    !ordinaryPage(location.pathname) ||
    !ordinaryPage(url.pathname)
  )
    return;
  if (url.pathname + url.search === snapshot()) return; // Native hash navigation.
  event.preventDefault();
  navigate(url.href);
});

window.addEventListener("popstate", (event) => {
  if (restoring) {
    restoring = false;
    return;
  }
  const next = event.state?.feedbacksPosition;
  if (
    snapshot() !== current &&
    new URL(current, location.origin).pathname !== location.pathname &&
    !mayLeave()
  ) {
    if (Number.isInteger(next)) {
      restoring = true;
      history.go(position - next);
    } else {
      location.replace(current);
    }
    return;
  }
  position = Number.isInteger(next) ? next : 0;
  savePagePosition();
  publish();
});

window.addEventListener("beforeunload", (event) => {
  if (dirty()) {
    event.preventDefault();
    event.returnValue = "";
  }
});

document.addEventListener("input", (event) => {
  const form = event.target instanceof Element ? event.target.closest("form") : null;
  if (!form || form.classList.contains("filters") || !ordinaryPage(location.pathname))
    return;
  form.dataset.unsaved = "true";
  form.dataset.editVersion = String(Number(form.dataset.editVersion ?? 0) + 1);
});

export function usePageLocation() {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, snapshot);
}

export function useUnsavedChanges(unsaved: boolean) {
  const value = useRef(unsaved);
  value.current = unsaved;
  useEffect(() => {
    const guard = () => value.current;
    guards.add(guard);
    return () => {
      guards.delete(guard);
    };
  }, []);
  return () => {
    value.current = false;
  };
}
