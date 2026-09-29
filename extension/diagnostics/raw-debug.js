// Chrome debugger traffic is already JSON data. Copy only own data descriptors:
// never inspect page object getters or evaluate captured code.
import { createSha256Hasher } from "./sha256.js";
function inertCopy(value, seen = new WeakSet(), depth = 0) {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "bigint") return String(value);
  if (typeof value !== "object" || depth > 100) return "[unavailable]";
  if (seen.has(value)) return "[circular]";
  seen.add(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const output = Array.isArray(value) ? [] : Object.create(null);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (key === "length" && Array.isArray(value)) continue;
    if (!Object.hasOwn(descriptor, "value")) continue;
    output[key] = inertCopy(descriptor.value, seen, depth + 1);
  }
  seen.delete(value);
  return output;
}

const BYTES_PER_CHUNK = 2_097_152;
const MAX_BYTES = 268_435_456;
const BODY_RESOURCE_BYTES = 67_108_864;
const encoder = new TextEncoder();
const rawChannels = [
  "dom",
  "console",
  "network",
  "body",
  "storage",
  "environment",
  "performance",
  "coverage",
];

export function createRawDiagnosticCapture({
  tabId,
  evidenceId = crypto.randomUUID(),
  sourceOrigin,
  store,
  debuggerSource,
}) {
  const coverage = Object.fromEntries(
    rawChannels.map((kind) => [
      kind,
      {
        status: "unavailable",
        observedCount: 0,
        capturedBytes: 0,
        reasons: ["not_collected"],
      },
    ]),
  );
  const files = [];
  let active = false;
  let attachedHere = false;
  let unsubscribe = null;
  let startedAt = null;
  let endedAt = null;
  let totalBytes = 0;
  let queue = Promise.resolve();
  let stopPromise = null;
  let timeout = null;
  const setCoverage = (channel, status, reason) => {
    const current = coverage[channel];
    current.status = status;
    if (status === "complete") current.reasons = [];
    if (reason && !current.reasons.includes(reason)) {
      current.reasons = current.reasons.filter((item) => item !== "not_collected");
      current.reasons.push(reason);
    }
  };
  const file = (kind, mimeType, separate = false) => {
    if (!separate) {
      const existing = files.find((item) => item.kind === kind);
      if (existing) return existing;
    }
    const item = {
      fileId: crypto.randomUUID(),
      kind,
      mimeType,
      byteLength: 0,
      chunks: [],
      hasher: createSha256Hasher(),
      pieces: [],
      bufferedBytes: 0,
    };
    files.push(item);
    return item;
  };
  async function flush(item) {
    if (!item.bufferedBytes) return;
    const joined = new Uint8Array(item.bufferedBytes);
    let offset = 0;
    for (const piece of item.pieces) {
      joined.set(piece, offset);
      offset += piece.byteLength;
    }
    const sequence = item.chunks.length;
    const saved = await store.putEvidenceChunk(evidenceId, item.fileId, sequence, joined);
    item.chunks.push({ sequence, byteLength: joined.byteLength, sha256: saved.sha256 });
    item.pieces = [];
    item.bufferedBytes = 0;
  }
  async function append(item, bytes) {
    if (!bytes?.byteLength) return;
    const remaining = MAX_BYTES - totalBytes;
    if (remaining <= 0) {
      setCoverage(item.kind, "stopped", "quota_exhausted");
      active = false;
      return;
    }
    const selected = bytes.subarray(0, Math.min(bytes.byteLength, remaining));
    for (let offset = 0; offset < selected.byteLength; ) {
      const length = Math.min(
        BYTES_PER_CHUNK - item.bufferedBytes,
        selected.byteLength - offset,
      );
      item.pieces.push(selected.slice(offset, offset + length));
      item.bufferedBytes += length;
      item.byteLength += length;
      item.hasher.update(bytes.subarray(offset, offset + length));
      coverage[item.kind].capturedBytes += length;
      totalBytes += length;
      offset += length;
      if (item.bufferedBytes === BYTES_PER_CHUNK) await flush(item);
    }
    if (selected.byteLength < bytes.byteLength) {
      setCoverage(item.kind, "stopped", "quota_exhausted");
      active = false;
    }
  }
  async function event(kind, method, params, ingressAt, extra = {}) {
    const item = file(kind, "application/jsonl");
    await append(
      item,
      encoder.encode(
        JSON.stringify({ method, ingressAt, params: inertCopy(params), ...extra }) + "\n",
      ),
    );
    coverage[kind].observedCount++;
  }
  async function body(requestId, phase, result, ingressAt, sessionId) {
    const item = file("body", "application/octet-stream", true);
    if (result.base64Encoded) {
      const encoded = String(result.body || "");
      for (let offset = 0; offset < encoded.length; offset += 4 * 524_288) {
        const piece = atob(encoded.slice(offset, offset + 4 * 524_288));
        await append(
          item,
          Uint8Array.from(piece, (character) => character.charCodeAt(0)),
        );
      }
    } else await append(item, encoder.encode(String(result.body || "")));
    await flush(item);
    coverage.body.observedCount++;
    await event(
      "network",
      "Diagnostic.body",
      {
        requestId,
        phase,
        fileId: item.fileId,
        byteLength: item.byteLength,
        base64Encoded: !!result.base64Encoded,
      },
      ingressAt,
      sessionId ? { sessionId } : {},
    );
  }
  async function handle(method, params, ingressAt, sessionId) {
    if (!active) return;
    if (method === "Debugger.detached") {
      attachedHere = false;
      active = false;
      setCoverage("console", "partial", "debugger_detached");
      setCoverage("network", "partial", "debugger_detached");
      return;
    }
    if (method === "Page.frameNavigated" && !params?.frame?.parentId) {
      let origin = null;
      try {
        origin = new URL(params.frame.url).origin;
      } catch {}
      if (origin !== sourceOrigin) {
        active = false;
        setCoverage("console", "partial", "origin_changed");
        setCoverage("network", "partial", "origin_changed");
        return;
      }
    }
    const kind = method.startsWith("Network.")
      ? "network"
      : method.startsWith("Runtime.") || method.startsWith("Log.")
        ? "console"
        : method.startsWith("Performance.")
          ? "performance"
          : method.startsWith("Page.") || method.startsWith("Target.")
            ? "network"
            : null;
    if (!kind) return;
    await event(kind, method, params, ingressAt, sessionId ? { sessionId } : {});
    if (method === "Network.requestWillBeSent" && params?.request?.hasPostData) {
      try {
        const result = await debuggerSource.sendCommand(
          tabId,
          "Network.getRequestPostData",
          { requestId: params.requestId },
          sessionId,
        );
        await body(
          params.requestId,
          "request",
          { body: result.postData, base64Encoded: false },
          ingressAt,
          sessionId,
        );
      } catch {
        setCoverage("body", "partial", "post_data_unavailable");
      }
    }
    if (method === "Network.loadingFinished") {
      try {
        const result = await debuggerSource.sendCommand(
          tabId,
          "Network.getResponseBody",
          { requestId: params.requestId },
          sessionId,
        );
        await body(params.requestId, "response", result, ingressAt, sessionId);
      } catch {
        setCoverage("body", "partial", "body_unavailable");
      }
    }
  }
  const receive = (method, params, ingressAt = Date.now(), sessionId) => {
    const next = queue.then(() => handle(method, params, ingressAt, sessionId));
    queue = next.catch(() => {
      setCoverage(
        method.startsWith("Runtime.") || method.startsWith("Log.")
          ? "console"
          : "network",
        "partial",
        "event_store_failed",
      );
    });
    void queue.then(() => {
      if (!active && !endedAt) return stop();
    });
    return next;
  };
  const view = () => ({
    evidenceId,
    sourceOrigin,
    active,
    startedAt,
    endedAt,
    totalBytes,
    coverage: structuredClone(coverage),
    files: files.map(
      ({ pieces: _pieces, bufferedBytes: _bufferedBytes, hasher: _hasher, ...item }) => ({
        ...item,
        chunks: item.chunks.map((chunk) => ({ ...chunk })),
      }),
    ),
  });
  function stop() {
    if (stopPromise) return stopPromise;
    active = false;
    if (timeout) clearTimeout(timeout);
    stopPromise = (async () => {
      await queue;
      for (const item of files) await flush(item);
      for (const item of files) item.sha256 ||= item.hasher.hexDigest();
      endedAt ||= new Date().toISOString();
      unsubscribe?.();
      unsubscribe = null;
      if (attachedHere) {
        attachedHere = false;
        await debuggerSource.detach(tabId).catch(() => {
          setCoverage("network", "partial", "debugger_detach_failed");
        });
      }
      const result = view();
      await store.putEvidenceState?.(evidenceId, result);
      return result;
    })();
    return stopPromise;
  }
  return {
    async start() {
      if (startedAt) return view();
      startedAt = new Date().toISOString();
      try {
        if (!(await debuggerSource.isAttached(tabId))) {
          await debuggerSource.attach(tabId);
          attachedHere = true;
        }
      } catch {
        setCoverage("console", "unavailable", "debugger_attach_failed");
        setCoverage("network", "unavailable", "debugger_attach_failed");
        setCoverage("body", "unavailable", "debugger_attach_failed");
        return view();
      }
      unsubscribe = debuggerSource.subscribeRawDebugger(tabId, receive);
      active = true;
      timeout = setTimeout(() => {
        setCoverage("console", "stopped", "time_limit");
        setCoverage("network", "stopped", "time_limit");
        active = false;
        void stop();
      }, 300_000);
      timeout.unref?.();
      for (const kind of ["console", "network", "body"]) setCoverage(kind, "complete");
      const enable = [
        [
          "Network.enable",
          { maxTotalBufferSize: MAX_BYTES, maxResourceBufferSize: BODY_RESOURCE_BYTES },
        ],
        ["Runtime.enable", {}],
        ["Log.enable", {}],
        ["Page.enable", {}],
        [
          "Target.setAutoAttach",
          { autoAttach: true, waitForDebuggerOnStart: false, flatten: true },
        ],
      ];
      for (const [method, params] of enable) {
        try {
          await debuggerSource.sendCommand(tabId, method, params);
        } catch {
          const channel =
            method === "Runtime.enable" || method === "Log.enable"
              ? "console"
              : "network";
          setCoverage(
            channel,
            "partial",
            method === "Target.setAutoAttach"
              ? "worker_attach_unavailable"
              : `${method.split(".")[0].toLowerCase()}_enable_failed`,
          );
        }
      }
      await store.putEvidenceState?.(evidenceId, view());
      return view();
    },
    stop,
    status: view,
  };
}
