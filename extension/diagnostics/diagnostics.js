// Injected only after the reviewer presses Start diagnostics. Keep self-contained:
// Chrome serializes the function, not its module closure. Page data is untrusted.
export function diagnosticCollector(action, reviewId) {
  const slot = "__feedbacksLocalDiagnosticsV1";
  const previous = window[slot];
  if (action === "stop") {
    previous?.stop?.();
    return { active: false };
  }
  if (action === "take") {
    if (!previous || previous.reviewId !== reviewId) {
      previous?.stop?.();
      return null;
    }
    return previous.take();
  }
  if (action === "status")
    return { active: !!previous && previous.reviewId === reviewId };
  if (action !== "start") return null;
  previous?.stop?.();
  const consoleEntries = [],
    network = [],
    started = performance.now(),
    startedAt = new Date().toISOString();
  let active = true,
    timer,
    observer;
  const elapsed = () =>
    Math.max(0, Math.min(3600000, Math.round(performance.now() - started)));
  const safeUrl = (value) => {
    try {
      const url = new URL(value);
      return /^https?:$/.test(url.protocol) ? url.origin : null;
    } catch {
      return null;
    }
  };
  const text = (value) =>
    value
      .slice(0, 2000)
      .replace(/https?:\/\/[^\s<>"']+/gi, (url) => safeUrl(url) || "[url]")
      .replace(/\bbearer\s+[\w.+/=-]+/gi, "Bearer [redacted]")
      .replace(
        /\b(token|password|secret|api[_-]?key|authorization|cookie)\s*[:=]\s*[^\s,;]+/gi,
        "$1=[redacted]",
      )
      .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[email]")
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .slice(0, 400);
  const record = (level, message) => {
    if (active && consoleEntries.length < 25)
      consoleEntries.push({ level, message: text(message), atMs: elapsed() });
  };
  const originals = {},
    wrappers = {};
  for (const level of ["warn", "error"]) {
    originals[level] = console[level];
    wrappers[level] = function (...args) {
      // Never serialize objects, inspect getters, or collect stacks/extra arguments.
      try {
        record(level, typeof args[0] === "string" ? args[0] : "Console object omitted");
      } catch {}
      return Reflect.apply(originals[level], this, args);
    };
    console[level] = wrappers[level];
  }
  const error = (event) =>
    record(
      "exception",
      typeof event.message === "string" ? event.message : "Unhandled exception",
    );
  const rejection = () =>
    record("rejection", "Unhandled promise rejection (value omitted)");
  window.addEventListener("error", error);
  window.addEventListener("unhandledrejection", rejection);
  try {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!active || network.length >= 50 || entry.startTime < started) continue;
        const url = safeUrl(entry.name);
        if (!url || url.length > 4096) continue;
        network.push({
          url,
          type: /^[a-zA-Z0-9_-]{1,30}$/.test(entry.initiatorType)
            ? entry.initiatorType
            : "other",
          durationMs: Math.min(3600000, Math.max(0, Math.round(entry.duration))),
          atMs: Math.min(3600000, Math.max(0, Math.round(entry.startTime - started))),
          status:
            Number.isInteger(entry.responseStatus) &&
            entry.responseStatus >= 100 &&
            entry.responseStatus <= 599
              ? entry.responseStatus
              : null,
        });
      }
    });
    observer.observe({ type: "resource", buffered: false });
  } catch {} // Resource timing may be unavailable on some pages.
  const stop = () => {
    active = false;
    clearTimeout(timer);
    observer?.disconnect();
    window.removeEventListener("error", error);
    window.removeEventListener("unhandledrejection", rejection);
    window.removeEventListener("pagehide", stop);
    for (const level of ["warn", "error"])
      if (console[level] === wrappers[level]) console[level] = originals[level];
    if (window[slot]?.reviewId === reviewId) delete window[slot];
    consoleEntries.length = network.length = 0;
  };
  window[slot] = {
    reviewId,
    stop,
    take() {
      const result = {
        source: "browser_opt_in",
        startedAt,
        endedAt: new Date().toISOString(),
        console: consoleEntries.slice(),
        network: network.slice(),
      };
      stop();
      return result;
    },
  };
  window.addEventListener("pagehide", stop);
  timer = setTimeout(stop, 5 * 60 * 1000);
  return { active: true };
}

// Revalidate the MAIN-world result before it reaches extension storage or UI.
export function cleanDiagnostics(value) {
  if (
    !value ||
    value.source !== "browser_opt_in" ||
    !Array.isArray(value.console) ||
    !Array.isArray(value.network)
  )
    return null;
  const date = (s) => typeof s === "string" && Number.isFinite(Date.parse(s));
  if (!date(value.startedAt) || !date(value.endedAt)) return null;
  const time = (n) =>
    Number.isFinite(n) ? Math.min(3600000, Math.max(0, Math.round(n))) : 0;
  const safeUrl = (s) => {
    try {
      const u = new URL(String(s).slice(0, 4096));
      return /^https?:$/.test(u.protocol) ? u.origin : null;
    } catch {
      return null;
    }
  };
  const text = (s) =>
    String(s ?? "")
      .slice(0, 2000)
      .replace(/https?:\/\/[^\s<>"']+/gi, (s) => safeUrl(s) || "[url]")
      .replace(/\bbearer\s+[\w.+/=-]+/gi, "Bearer [redacted]")
      .replace(
        /\b(token|password|secret|api[_-]?key|authorization|cookie)\s*[:=]\s*[^\s,;]+/gi,
        "$1=[redacted]",
      )
      .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[email]")
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .slice(0, 400);
  return {
    source: "browser_opt_in",
    startedAt: new Date(value.startedAt).toISOString(),
    endedAt: new Date(value.endedAt).toISOString(),
    console: value.console
      .slice(0, 25)
      .filter((e) => e && ["warn", "error", "exception", "rejection"].includes(e.level))
      .map((e) => ({ level: e.level, message: text(e.message), atMs: time(e.atMs) })),
    network: value.network
      .slice(0, 50)
      .filter((e) => e && safeUrl(e.url))
      .map((e) => ({
        url: safeUrl(e.url),
        type: /^[a-zA-Z0-9_-]{1,30}$/.test(e.type) ? e.type : "other",
        durationMs: time(e.durationMs),
        atMs: time(e.atMs),
        status:
          Number.isInteger(e.status) && e.status >= 100 && e.status <= 599
            ? e.status
            : null,
      })),
  };
}
