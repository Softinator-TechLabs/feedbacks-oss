import {
  sanitizeCapture,
  semanticTarget,
  inputActivity,
  CAPTURE_MAX_BYTES,
  CAPTURE_SNAPSHOT_BYTES,
  CAPTURE_BATCH_BYTES,
  captureByteLength,
  captureNodeCount,
  CAPTURE_SNAPSHOT_NODES,
  CAPTURE_DIAGNOSTIC_NODES,
} from "./session-capture.js";
// Bundled with rrweb by package-extension.mjs; no remote executable dependency.
export function installSessionRecorder(record, config) {
  globalThis.__feedbacksSessionPageStop?.();
  let active = true,
    events = [],
    pending = [],
    bytes = 0,
    count = 0;
  const postMessage = window.postMessage.bind(window);
  const flush = () => {
    if (events.length) {
      pending.push(...events);
      const message = { channel: "feedbacks-session-v1", token: config.token, events };
      events = [];
      // A synchronous, string-only event reaches the ISOLATED bridge before
      // navigation replaces this document. Use one transport for all batches
      // so a critical click cannot overtake an earlier DOM baseline.
      window.dispatchEvent(
        new CustomEvent("feedbacks-session-flush-v1", {
          detail: JSON.stringify(message),
        }),
      );
    }
  };
  const emit = (type, data, occurredAt = Date.now()) => {
    if (!active) return;
    let clean;
    try {
      clean = sanitizeCapture(
        data,
        0,
        type === "replay" ? CAPTURE_SNAPSHOT_BYTES : 262144,
      );
    } catch {
      return;
    }
    const nodeLimit =
      type === "replay" && data.type === 2
        ? CAPTURE_SNAPSHOT_NODES
        : CAPTURE_DIAGNOSTIC_NODES;
    const eventNodes = captureNodeCount(data, nodeLimit);
    const size = captureByteLength(JSON.stringify(clean));
    const limit =
      type === "replay" && data.type === 2 ? CAPTURE_SNAPSHOT_BYTES : 1024 * 1024;
    if (
      (bytes += size) > CAPTURE_MAX_BYTES ||
      ++count > 45000 ||
      size > limit ||
      eventNodes > nodeLimit
    ) {
      flush();
      postMessage(
        {
          channel: "feedbacks-session-v1",
          token: config.token,
          events: [
            {
              type: "activity",
              capturedAt: occurredAt,
              data: {
                action: "capture-limit",
                eventType: type,
                eventBytes: size,
                eventLimit: limit,
                eventNodes,
                nodeLimit,
                totalBytes: bytes,
                totalLimit: CAPTURE_MAX_BYTES,
              },
            },
          ],
        },
        location.origin,
      );
      stop();
      return;
    }
    if (type === "replay" && data.type === 2) flush();
    events.push({
      type,
      pageSeq: count,
      capturedAt: type === "replay" ? data.timestamp : occurredAt,
      data: clean,
    });
    const critical =
      type === "activity" && ["click", "input", "document-unload"].includes(data.action);
    if (
      critical ||
      events.length >= 50 ||
      (type === "replay" && data.type === 2) ||
      captureByteLength(JSON.stringify(events)) > CAPTURE_BATCH_BYTES - 1024 * 1024
    )
      flush();
  };
  const originals = {},
    wrappers = {};
  const descriptions = (args) =>
    args.slice(0, 12).map((v) => {
      if (v === null || ["string", "number", "boolean"].includes(typeof v)) return v;
      return `[${Array.isArray(v) ? "array" : typeof v} omitted without debugger]`;
    });
  if (!config.debugger)
    for (const level of ["debug", "log", "info", "warn", "error"]) {
      originals[level] = console[level];
      wrappers[level] = function (...args) {
        emit("console", { level, args: descriptions(args), source: "page-fallback" });
        return Reflect.apply(originals[level], this, args);
      };
      console[level] = wrappers[level];
    }
  const listeners = [];
  const listen = (name, fn) => {
    window.addEventListener(name, fn, true);
    listeners.push([name, fn]);
  };
  listen("message", (event) => {
    const message = event.data;
    if (
      event.source === window &&
      event.origin === location.origin &&
      message?.channel === "feedbacks-session-ack-v1" &&
      message.token === config.token &&
      Number.isInteger(message.pageSeq)
    )
      pending = pending.filter((item) => item.pageSeq > message.pageSeq);
  });
  listen("click", (e) =>
    emit("activity", {
      action: "click",
      ...semanticTarget(e.target, config.privacy.maskText),
      button: e.button,
      clickCount: e.detail,
      pointerType: e.pointerType || "mouse",
      modifiers: {
        alt: !!e.altKey,
        ctrl: !!e.ctrlKey,
        meta: !!e.metaKey,
        shift: !!e.shiftKey,
      },
      x: e.clientX,
      y: e.clientY,
    }),
  );
  listen("input", (e) => emit("activity", inputActivity(e.target, e, config.privacy)));
  listen("visibilitychange", () =>
    emit("activity", { action: "visibility", state: document.visibilityState }),
  );
  listen("error", (e) =>
    emit("console", {
      level: "error",
      args: [e.message || "Resource error"],
      source: "page-error",
    }),
  );
  listen("unhandledrejection", () =>
    emit("console", {
      level: "error",
      args: ["Unhandled promise rejection"],
      source: "page-error",
    }),
  );
  let observer;
  try {
    observer = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        const occurredAt = performance.timeOrigin + e.startTime;
        if (occurredAt < config.startedAt) continue;
        if (e.entryType === "resource" && config.debugger) continue;
        emit(
          e.entryType === "resource" ? "network" : "performance",
          {
            phase: "timing",
            name: e.name,
            url: e.entryType === "resource" ? e.name : undefined,
            entryType: e.entryType,
            durationMs: e.duration,
            startTime: e.startTime,
            status: e.responseStatus || null,
          },
          occurredAt,
        );
      }
    });
    observer.observe({ entryTypes: ["resource", "longtask", "navigation"] });
  } catch {}
  let stopRecord;
  const timer = setInterval(flush, 100);
  const limitTimer = setTimeout(
    () => {
      emit("activity", { action: "capture-time-limit" });
      stop();
    },
    Math.max(1, config.remainingMs),
  );
  function stop() {
    if (!active) return;
    active = false;
    stopRecord?.();
    clearInterval(timer);
    clearTimeout(limitTimer);
    observer?.disconnect();
    for (const [name, fn] of listeners) window.removeEventListener(name, fn, true);
    for (const level of Object.keys(originals))
      if (console[level] === wrappers[level]) console[level] = originals[level];
    flush();
  }
  globalThis.__feedbacksSessionPageStop = stop;
  globalThis.__feedbacksSessionPageTake = () => {
    const tail = [...pending, ...events];
    pending = [];
    events = [];
    return tail;
  };
  listen("pagehide", () => {
    emit("activity", { action: "document-unload" });
    stop();
  });
  stopRecord = record({
    emit: (event) => emit("replay", event),
    maskAllInputs: config.privacy.maskInputs,
    maskInputOptions: { password: true, hidden: true },
    maskTextSelector: config.privacy.maskText
      ? "*"
      : config.privacy.maskInputs
        ? '[contenteditable],[role="textbox"]'
        : undefined,
    blockSelector:
      'script,iframe,input[type="password"],input[type="hidden"],[autocomplete="current-password"],[autocomplete="new-password"],[name*="token" i],[name*="secret" i],[name*="password" i],[name*="api_key" i],[name*="otp" i],[id*="password" i],[id*="secret" i],[id*="token" i],[autocomplete="one-time-code"],[autocomplete="cc-number"],[autocomplete="cc-csc"],[aria-label*="password" i],#feedbacks-root,[data-feedbacks]',
    inlineStylesheet: true,
    collectFonts: false,
    recordCanvas: false,
    recordCrossOriginIframes: false,
    sampling: { mousemove: 100, scroll: 150, input: "all" },
  });
  emit("activity", { action: "document-start", url: location.href });
  flush();
}
