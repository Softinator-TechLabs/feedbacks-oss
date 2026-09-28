export const CAPTURE_MAX_BYTES = 12 * 1024 * 1024;
export const CAPTURE_SNAPSHOT_BYTES = 6 * 1024 * 1024;
export const CAPTURE_BATCH_BYTES = CAPTURE_SNAPSHOT_BYTES + 128 * 1024;
export const captureByteLength = (value) => new TextEncoder().encode(value).byteLength;
export const CAPTURE_SNAPSHOT_NODES = 500000;
export const CAPTURE_DIAGNOSTIC_NODES = 100000;
export function captureNodeCount(value, limit) {
  let nodes = 0;
  const pending = [value];
  while (pending.length) {
    const item = pending.pop();
    if (++nodes > limit) return nodes;
    if (item && typeof item === "object") {
      const children = Array.isArray(item) ? item : Object.values(item);
      if (nodes + pending.length + children.length > limit) return limit + 1;
      for (const child of children) pending.push(child);
    }
  }
  return nodes;
}

const KEY = "feedbacksSessionCaptureV1";
const SECRET =
  /password|passwd|secret|token|authorization|cookie|api[-_]?key|credential|session[-_]?id/i;
const TYPES = new Set(["replay", "console", "network", "activity", "performance"]);
export function captureOrigins(source, additional = []) {
  const values =
    typeof additional === "string"
      ? additional.split(/[\s,]+/).filter(Boolean)
      : additional;
  if (!Array.isArray(values) || values.length > 4)
    throw Error("List at most four exact redirect origins.");
  const result = [new URL(source).origin];
  for (const value of values) {
    if (typeof value !== "string") throw Error("Use exact http(s) redirect origins.");
    const url = new URL(value);
    if (
      !/^https?:$/.test(url.protocol) ||
      url.username ||
      url.password ||
      (url.pathname !== "/" && url.pathname !== "") ||
      url.search ||
      url.hash
    )
      throw Error(
        "Use an exact redirect origin, without a path, credentials, query or fragment.",
      );
    if (!result.includes(url.origin)) result.push(url.origin);
  }
  if (result.length > 4)
    throw Error("Capture supports at most four origins including the source.");
  return result;
}
export function originAllowed(target, value) {
  try {
    return (target.allowedOrigins || [target.origin]).includes(new URL(value).origin);
  } catch {
    return false;
  }
}
export function capturedVideoTarget(capture, requested, ownerTabId, accountFingerprint) {
  if (capture?.recording?.mode !== "video" || capture.target?.ownerTabId !== ownerTabId)
    return null;
  if (
    capture.accountFingerprint !== accountFingerprint ||
    ["sourceTabId", "projectId", "reviewId", "server", "routeFingerprint"].some(
      (key) => capture.target[key] !== requested?.[key],
    )
  )
    throw Error("The captured video project or account changed.");
  return structuredClone(capture.target);
}
export function captureHandleMatches(value, handle, origin) {
  return !!value && value.handle === handle && value.origin === origin;
}
export function captureUrl(value) {
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol)) return "[url omitted]";
    url.username = "";
    url.password = "";
    url.hash = "";
    for (const key of [...url.searchParams.keys()])
      if (SECRET.test(key)) url.searchParams.set(key, "[redacted]");
    return url.href;
  } catch {
    return "[url omitted]";
  }
}
function safeText(value) {
  return value
    .replace(/https?:\/\/[^\s<>"']+/gi, captureUrl)
    .replace(/\bBearer\s+[^\s,"'}]+/gi, "Bearer [redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[redacted]")
    .replace(
      /(["']?(?:password|passwd|secret|\b[\w-]{0,80}token|authorization|cookie|api[-_]?key)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}&]+)/gi,
      "$1[redacted]",
    );
}
// Runs in both isolated extension code and the bundled MAIN collector. No getter
// invocation or object traversal occurs until a browser structured clone is received.
export function sanitizeCapture(value, depth = 0, maxStringBytes = 262144) {
  if (depth >= 256) return "[depth limit]";
  if (typeof value === "string") return safeText(value).slice(0, maxStringBytes);
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value))
    return value
      .slice(0, CAPTURE_SNAPSHOT_NODES)
      .map((v) => sanitizeCapture(v, depth + 1, maxStringBytes));
  if (!value || typeof value !== "object") return null;
  const out = {};
  const sensitiveInput =
    SECRET.test(String(value.name || "") + " " + String(value.id || "")) ||
    value.type === "password" ||
    value.type === "hidden";
  for (const [key, child] of Object.entries(value).slice(0, CAPTURE_SNAPSHOT_NODES)) {
    if (["__proto__", "constructor", "prototype"].includes(key)) continue;
    out[key] =
      SECRET.test(key) || (sensitiveInput && key === "value")
        ? "[redacted]"
        : sanitizeCapture(child, depth + 1, maxStringBytes);
  }
  return out;
}
export function createCaptureStore({
  storage,
  now = Date.now,
  maxBytes = CAPTURE_MAX_BYTES,
  maxEvents = 45000,
  maxEventBytes = 1024 * 1024,
  maxSnapshotBytes = CAPTURE_SNAPSHOT_BYTES,
  maxMs = 300000,
}) {
  let queue = Promise.resolve();
  const serial = (fn) => {
    const result = queue.then(fn);
    queue = result.catch(() => {});
    return result;
  };
  let cached;
  const copy = (state) => {
    if (!state) return state;
    const events = state.recording?.events || [];
    const result = structuredClone({
      ...state,
      recording: state.recording ? { ...state.recording, events: [] } : undefined,
    });
    if (result.recording) result.recording.events = events.map((event) => ({ ...event }));
    return result;
  };
  const read = async () => {
    if (cached === undefined) cached = (await storage.get(KEY))[KEY] || null;
    return copy(cached);
  };
  const save = async (s) => {
    try {
      await storage.set({ [KEY]: s });
      cached = copy(s);
      return s;
    } catch (error) {
      if (cached?.active) {
        const terminal = copy(cached);
        stop(terminal);
        terminal.storageFailure = true;
        coverage(
          terminal,
          "capture",
          "partial",
          "Recording storage became unavailable. Capture stopped; previously durable evidence is preserved. This stopped status is held in memory until storage recovers.",
        );
        cached = terminal;
      }
      throw error;
    }
  };
  const coverage = (s, channel, status, detail) => {
    const existing = s.recording.coverage.find((c) => c.channel === channel);
    if (existing) Object.assign(existing, { status, detail });
    else s.recording.coverage.push({ channel, status, detail });
  };
  const stop = (s, detail) => {
    s.active = false;
    s.recording.events.sort((a, b) => a.atMs - b.atMs || a.seq - b.seq);
    s.recording.events.forEach((event, seq) => {
      event.seq = seq;
    });
    s.recording.durationMs = Math.max(1, Math.min(maxMs, now() - s.started));
    if (detail) coverage(s, "capture", "partial", detail);
    if (
      !s.recording.events.some(
        (event) => event.type === "replay" && event.data.type === 2,
      )
    )
      coverage(
        s,
        "replay",
        "unavailable",
        detail || "No complete DOM baseline was captured.",
      );
    return s;
  };
  return {
    read: () => serial(read),
    start: (target, privacy, mode = "session", environment = {}) =>
      serial(async () => {
        const old = await read();
        if (old)
          throw Error(
            "A local recording exists. Send or discard it before starting another.",
          );
        const started = now();
        return save({
          active: true,
          started,
          bytes: 0,
          dropped: 0,
          target: { ...structuredClone(target), url: captureUrl(target.url) },
          scopeActive: true,
          currentOrigin: target.origin,
          bridgeToken: crypto.randomUUID(),
          documentId: null,
          recording: {
            schemaVersion: 1,
            id: crypto.randomUUID(),
            startedAt: new Date(started).toISOString(),
            durationMs: 1,
            mode,
            url: captureUrl(target.url),
            environment: sanitizeCapture(environment),
            privacy: {
              maskText: privacy.maskText === true,
              maskInputs: privacy.maskInputs !== false,
              networkBodies: privacy.networkBodies === true,
            },
            coverage: [
              {
                channel: "replay",
                status: "partial",
                detail:
                  "Top-level DOM only; cross-origin frames, canvas and media pixels are omitted.",
              },
              {
                channel: "console",
                status: "partial",
                detail: "Page bridge is untrusted; debugger attachment pending.",
              },
              {
                channel: "network",
                status: "partial",
                detail: "Resource timing fallback; debugger attachment pending.",
              },
            ],
            events: [],
          },
        });
      }),
    append: (event, tabId, url) =>
      serial(async () => {
        const s = await read();
        if (!s?.active || !s.scopeActive || s.target.sourceTabId !== tabId) return s;
        try {
          if (!originAllowed(s.target, url)) return s;
        } catch {
          return s;
        }
        if (
          !event ||
          !TYPES.has(event.type) ||
          !event.data ||
          typeof event.data !== "object"
        )
          return s;
        if (
          event.pageSeq !== undefined &&
          (!Number.isInteger(event.pageSeq) ||
            event.pageSeq < 1 ||
            event.pageSeq > 45000 ||
            event.pageSeq <= (s.lastPageSeq || 0))
        )
          return s;
        const occurredAt = Number.isFinite(event.capturedAt)
          ? event.capturedAt
          : event.type === "replay" && Number.isFinite(event.data.timestamp)
            ? event.data.timestamp
            : now();
        if (occurredAt - s.started >= maxMs)
          return save(stop(s, "5 minute duration limit reached."));
        let raw;
        try {
          raw = JSON.stringify(event.data);
        } catch {
          return s;
        }
        const eventBytes = captureByteLength(raw);
        const eventLimit =
          event.type === "replay" && event.data.type === 2
            ? maxSnapshotBytes
            : maxEventBytes;
        if (
          eventBytes > eventLimit ||
          s.recording.events.length >= maxEvents ||
          s.bytes + eventBytes > maxBytes
        ) {
          s.dropped++;
          return save(
            stop(
              s,
              event.type === "replay"
                ? `DOM snapshot/event ${eventBytes} bytes exceeds available capture budget (event limit ${eventLimit}, total ${maxBytes}); replay is incomplete. No earlier events were evicted.`
                : "Capture size/event limit reached. No earlier events were evicted.",
            ),
          );
        }
        if (
          event.type === "replay" &&
          (!Number.isInteger(event.data.type) ||
            event.data.type < 0 ||
            event.data.type > 6 ||
            !Number.isFinite(event.data.timestamp))
        )
          return s;
        const nodeLimit =
          event.type === "replay" && event.data.type === 2
            ? CAPTURE_SNAPSHOT_NODES
            : CAPTURE_DIAGNOSTIC_NODES;
        if (captureNodeCount(event.data, nodeLimit) > nodeLimit) {
          s.dropped++;
          return save(
            stop(
              s,
              `Capture event exceeds JSON node limit ${nodeLimit}; no partial event was saved.`,
            ),
          );
        }
        const data = sanitizeCapture(
          event.data,
          0,
          event.type === "replay" ? maxSnapshotBytes : 262144,
        );
        if (event.type === "replay" && JSON.stringify(data).includes("[depth limit]")) {
          s.dropped++;
          return save(
            stop(
              s,
              "DOM snapshot exceeds the supported nesting depth; replay is incomplete. No malformed DOM event was saved.",
            ),
          );
        }
        const atMs = Math.min(
          maxMs,
          Math.max(0, Math.min(now(), occurredAt) - s.started),
        );
        s.recording.events.push({
          seq: s.recording.events.length,
          atMs,
          type: event.type,
          data,
        });
        if (event.pageSeq !== undefined) s.lastPageSeq = event.pageSeq;
        s.bytes += captureByteLength(JSON.stringify(data));
        s.recording.durationMs = Math.max(s.recording.durationMs, 1, atMs);
        try {
          return await save(s);
        } catch (error) {
          s.recording.events.pop();
          stop(s);
          s.dropped++;
          coverage(
            s,
            "capture",
            "partial",
            "Local storage quota reached. Last event was not saved.",
          );
          await save(s);
          return s;
        }
      }),
    update: (fn) =>
      serial(async () => {
        const s = await read();
        if (!s) return null;
        await fn(s);
        return save(s);
      }),
    coverage: (channel, status, detail) =>
      serial(async () => {
        const s = await read();
        if (!s) return null;
        coverage(s, channel, status, detail);
        return save(s);
      }),
    stop: (detail) =>
      serial(async () => {
        const s = await read();
        if (!s) return null;
        return save(stop(s, detail));
      }),
    discard: () =>
      serial(async () => {
        await storage.remove(KEY);
        cached = null;
      }),
  };
}

// Source intervals are measured when the media recorder starts/pauses/resumes.
// Applying a trim intersects media output time with those intervals, preserving
// the original session clock without inventing events during a video pause.
export function videoSegments(intervals, trimStartMs, trimEndMs) {
  const result = [];
  for (const segment of intervals) {
    const duration = segment.sourceEndMs - segment.sourceStartMs;
    const from = Math.max(trimStartMs, segment.outputStartMs);
    const to = Math.min(trimEndMs, segment.outputStartMs + duration);
    if (to <= from) continue;
    result.push({
      sourceStartMs: segment.sourceStartMs + from - segment.outputStartMs,
      sourceEndMs: segment.sourceStartMs + to - segment.outputStartMs,
      outputStartMs: from - trimStartMs,
    });
  }
  return result;
}
export function clipRecording(recording, segments) {
  const events = recording.events
    .filter(
      (e) =>
        e.type !== "replay" &&
        segments.some((s) => e.atMs >= s.sourceStartMs && e.atMs <= s.sourceEndMs),
    )
    .map((e, seq) => ({ ...e, seq }));
  const coverage = recording.coverage.filter((c) => c.channel !== "replay");
  coverage.push({
    channel: "replay",
    status: "unavailable",
    detail:
      "DOM replay is omitted after video trimming or pauses because a trustworthy DOM baseline cannot be reconstructed without retaining excluded page content. Remaining diagnostics follow the kept video intervals.",
  });
  return { ...recording, events, coverage };
}

export function semanticTarget(element, maskText) {
  element =
    element?.closest?.('button,a,input,textarea,select,[role="button"],[role="link"]') ||
    element;
  if (!element || typeof element.getAttribute !== "function") return {};
  const tag = String(element.tagName || "").slice(0, 30);
  const result = { tag };
  for (const [key, attribute] of [
    ["role", "role"],
    ["testId", "data-testid"],
    ["id", "id"],
    ["name", "name"],
  ]) {
    const value = element.getAttribute(attribute);
    if (value) result[key] = sanitizeCapture(String(value).slice(0, 120));
  }
  if (!maskText) {
    const label =
      element.getAttribute("aria-label") ||
      element.labels?.[0]?.textContent ||
      element.getAttribute("placeholder") ||
      (!/^(INPUT|TEXTAREA|SELECT)$/i.test(tag) ? element.textContent : "");
    if (label)
      result.label = sanitizeCapture(
        String(label).replace(/\s+/g, " ").trim().slice(0, 160),
      );
  }
  return result;
}

export function inputActivity(element, event, privacy) {
  const type = String(element?.type || "").toLowerCase();
  const identity = ["name", "id", "autocomplete", "aria-label"]
    .map((key) => element?.getAttribute?.(key) || "")
    .join(" ");
  const sensitive =
    type === "password" ||
    type === "hidden" ||
    SECRET.test(identity) ||
    /one-time-code|\botp\b|verification[-_ ]?code|cc-number|cc-csc|\bcvv\b/i.test(
      identity,
    );
  const valueMasked = privacy.maskInputs !== false || sensitive;
  const data = {
    action: "input",
    ...semanticTarget(element, privacy.maskText),
    inputType: String(event?.inputType || "change").slice(0, 80),
    valueMasked,
  };
  if (type === "checkbox" || type === "radio") data.checked = !!element.checked;
  if (!valueMasked) {
    const value = String(
      element?.isContentEditable ? element.textContent : (element?.value ?? ""),
    );
    data.value = sanitizeCapture(value.slice(0, 2000));
    data.valueTruncated = value.length > 2000;
  }
  return data;
}
