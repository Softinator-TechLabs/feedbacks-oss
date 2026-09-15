import { useEffect, useRef, useSyncExternalStore } from "react";

// Keep the working app mounted between ordinary pages. Capability links,
// downloads and administrative forms retain their native document navigation.
const ordinaryPage = (path: string) =>
  /^(?:\/|\/help|\/projects\/[^/]+(?:\/(?:members|instructions|settings))?|\/threads\/[^/]+)$/.test(
    path,
  );
const guards = new Set<() => boolean>();
const listeners = new Set<() => void>();
const snapshot = () => location.pathname + location.search;
let current = snapshot();
let position = 0;
let restoring = false;
history.replaceState({ ...history.state, feedbacksPosition: position }, "");
const dirty = () =>
  [...guards].some((guard) => guard()) ||
  !!document.querySelector('form[data-unsaved="true"]');
const mayLeave = () =>
  !dirty() || confirm("Leave this page? Your unsent changes will be lost.");

function publish() {
  current = snapshot();
  for (const listener of listeners) listener();
  requestAnimationFrame(() => {
    if (location.hash) {
      document.getElementById(location.hash.slice(1))?.scrollIntoView();
    } else {
      window.scrollTo(0, 0);
      document.getElementById("content")?.focus({ preventScroll: true });
    }
  });
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
  if (!mayLeave()) return;
  history.pushState({ feedbacksPosition: ++position }, "", url);
  publish();
});

window.addEventListener("popstate", (event) => {
  if (restoring) {
    restoring = false;
    return;
  }
  const next = event.state?.feedbacksPosition;
  if (snapshot() !== current && !mayLeave()) {
    if (Number.isInteger(next)) {
      restoring = true;
      history.go(position - next);
    } else {
      location.replace(current);
    }
    return;
  }
  position = Number.isInteger(next) ? next : 0;
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
