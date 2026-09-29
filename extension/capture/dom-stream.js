import { createSha256Hasher } from "../diagnostics/sha256.js";

const CHUNK_BYTES = 1_048_576; // Base64 keeps each Chrome JSON port message below 2 MiB.
const MAX_BYTES = 268_435_456;
const CHANNELS = ["dom", "storage", "environment", "performance"];

function coverage() {
  return Object.fromEntries(
    CHANNELS.map((channel) => [
      channel,
      {
        status: "unavailable",
        observedCount: 0,
        capturedBytes: 0,
        reasons: ["not_collected"],
      },
    ]),
  );
}

function mark(result, channel, status, reason) {
  const entry = result[channel];
  if (!entry) return;
  entry.status = status;
  if (status === "complete") entry.reasons = [];
  if (reason && !entry.reasons.includes(reason)) {
    entry.reasons = entry.reasons.filter((value) => value !== "not_collected");
    entry.reasons.push(reason);
  }
}

function decodeBase64(value) {
  if (
    typeof value !== "string" ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  )
    throw Error("Invalid diagnostic port chunk");
  const binary = atob(value);
  if (!binary.length || binary.length > CHUNK_BYTES)
    throw Error("Diagnostic port chunk exceeds 1 MiB");
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

/** Receive one prepared-page stream without putting raw DOM in chrome.storage or a runtime response. */
export async function capturePreparedDom({
  tabId,
  evidenceId,
  expectedUrl,
  expectedSignature,
  captureEpoch,
  store,
  chrome: browser = globalThis.chrome,
  remainingBytes = MAX_BYTES,
}) {
  const channelCoverage = coverage();
  const files = [];
  const open = new Map();
  let totalBytes = 0;
  let port = null;
  let ended = false;
  let resolveDone;
  const finished = new Promise((resolve) => {
    resolveDone = resolve;
  });
  const finish = (reason) => {
    if (ended) return;
    ended = true;
    for (const entry of open.values()) {
      if (!entry.chunks.length) continue;
      files.push({
        fileId: entry.fileId,
        kind: entry.kind,
        mimeType: entry.mimeType,
        byteLength: entry.byteLength,
        sha256: entry.hasher.hexDigest(),
        chunks: entry.chunks,
      });
      channelCoverage[entry.kind].observedCount++;
      mark(channelCoverage, entry.kind, "partial", reason || "stream_incomplete");
    }
    if (reason)
      for (const channel of CHANNELS) {
        if ([...open.values()].some((entry) => entry.kind === channel))
          mark(channelCoverage, channel, "partial", reason);
        else if (channelCoverage[channel].status === "unavailable")
          mark(channelCoverage, channel, "unavailable", reason);
      }
    resolveDone();
  };
  const onConnect = (connected) => {
    if (
      port ||
      connected.sender?.tab?.id !== tabId ||
      connected.name !== `feedbacks-diagnostic-dom:${evidenceId}`
    )
      return;
    port = connected;
    let queue = Promise.resolve();
    connected.onDisconnect.addListener(() => finish("port_disconnected"));
    connected.onMessage.addListener((message) => {
      queue = queue
        .then(async () => {
          if (ended) return;
          if (message?.type === "hello") {
            connected.postMessage({ type: "begin" });
            return;
          }
          if (message?.type === "gap") {
            if (
              CHANNELS.includes(message.channel) &&
              /^[a-z][a-z0-9._-]{0,79}$/.test(message.reason)
            )
              mark(channelCoverage, message.channel, "partial", message.reason);
            return;
          }
          if (message?.type === "channel_done") {
            if (
              CHANNELS.includes(message.channel) &&
              channelCoverage[message.channel].status === "unavailable"
            )
              mark(channelCoverage, message.channel, "complete");
            return;
          }
          if (message?.type === "chunk") {
            if (
              !CHANNELS.includes(message.kind) ||
              !/^[a-f0-9-]{36}$/.test(message.fileId) ||
              !Number.isSafeInteger(message.sequence) ||
              message.sequence < 0 ||
              typeof message.mimeType !== "string" ||
              message.mimeType.length > 200
            )
              throw Error("Invalid diagnostic port file");
            const bytes = decodeBase64(message.dataBase64);
            if (totalBytes + bytes.byteLength > remainingBytes) {
              mark(channelCoverage, message.kind, "stopped", "quota_exhausted");
              connected.postMessage({ type: "abort", reason: "quota_exhausted" });
              finish("quota_exhausted");
              return;
            }
            let entry = open.get(message.fileId);
            if (!entry) {
              entry = {
                fileId: message.fileId,
                kind: message.kind,
                mimeType: message.mimeType,
                byteLength: 0,
                chunks: [],
                hasher: createSha256Hasher(),
              };
              open.set(message.fileId, entry);
            }
            if (
              entry.kind !== message.kind ||
              entry.mimeType !== message.mimeType ||
              message.sequence !== entry.chunks.length
            )
              throw Error("Diagnostic port sequence changed");
            const saved = await store.putEvidenceChunk(
              evidenceId,
              entry.fileId,
              message.sequence,
              bytes,
            );
            entry.hasher.update(bytes);
            entry.byteLength += bytes.byteLength;
            entry.chunks.push({
              sequence: message.sequence,
              byteLength: bytes.byteLength,
              sha256: saved.sha256,
            });
            totalBytes += bytes.byteLength;
            channelCoverage[entry.kind].capturedBytes += bytes.byteLength;
            connected.postMessage({
              type: "ack",
              fileId: entry.fileId,
              sequence: message.sequence,
            });
            return;
          }
          if (message?.type === "file_end") {
            const entry = open.get(message.fileId);
            if (!entry || !entry.chunks.length)
              throw Error("Diagnostic port file is incomplete");
            open.delete(message.fileId);
            files.push({
              fileId: entry.fileId,
              kind: entry.kind,
              mimeType: entry.mimeType,
              byteLength: entry.byteLength,
              sha256: entry.hasher.hexDigest(),
              chunks: entry.chunks,
            });
            channelCoverage[entry.kind].observedCount++;
            if (channelCoverage[entry.kind].status !== "partial")
              mark(channelCoverage, entry.kind, "complete");
            connected.postMessage({ type: "file_ack", fileId: entry.fileId });
            return;
          }
          if (message?.type === "done") finish();
        })
        .catch(() => {
          connected.postMessage({ type: "abort", reason: "port_store_failed" });
          finish("port_store_failed");
        });
    });
  };
  browser.runtime.onConnect.addListener(onConnect);
  const timeout = setTimeout(() => finish("port_timeout"), 120_000);
  timeout.unref?.();
  try {
    await Promise.race([
      finished,
      browser.scripting
        .executeScript({
          target: { tabId, frameIds: [0] },
          world: "ISOLATED",
          func: streamPreparedSnapshot,
          args: [{ evidenceId, expectedUrl, expectedSignature, captureEpoch }],
        })
        .then(
          () => finished,
          () => finish("injection_failed"),
        ),
    ]);
  } finally {
    clearTimeout(timeout);
    browser.runtime.onConnect.removeListener(onConnect);
    port?.disconnect();
  }
  return { files, coverage: channelCoverage, totalBytes };
}

/** Serialized by chrome.scripting.executeScript; keep every helper inside this function. */
export async function streamPreparedSnapshot({
  evidenceId,
  expectedUrl,
  expectedSignature,
  captureEpoch,
}) {
  const port = chrome.runtime.connect({ name: `feedbacks-diagnostic-dom:${evidenceId}` });
  const encoder = new TextEncoder();
  const pending = new Map();
  let aborted = false;
  const awaitReply = (key) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(key);
        reject(Error("Diagnostic port response timed out"));
      }, 30_000);
      pending.set(key, (value) => {
        clearTimeout(timer);
        value?.type === "abort" ? reject(Error(value.reason)) : resolve(value);
      });
    });
  port.onMessage.addListener((message) => {
    if (message?.type === "abort") {
      aborted = true;
      for (const [key, complete] of pending) {
        pending.delete(key);
        complete(message);
      }
    } else {
      const key =
        message?.type === "begin"
          ? "begin"
          : message?.type === "ack"
            ? `${message.fileId}:${message.sequence}`
            : message?.type === "file_ack"
              ? `end:${message.fileId}`
              : null;
      if (key && pending.has(key)) {
        const complete = pending.get(key);
        pending.delete(key);
        complete(message);
      }
    }
  });
  port.onDisconnect.addListener(() => {
    aborted = true;
  });
  const gap = (channel, reason) => port.postMessage({ type: "gap", channel, reason });
  const signature = () => {
    const url = new URL(location.href);
    url.hash = "";
    return `${url.href}|${window.innerWidth}|${window.innerHeight}|${window.scrollX}|${window.scrollY}|${window.devicePixelRatio}`;
  };
  const stable = () =>
    location.href === expectedUrl &&
    signature() === expectedSignature &&
    captureEpoch === 0;
  const toBase64 = (bytes) => {
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 8192)
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    return btoa(binary);
  };
  async function writer(kind, mimeType) {
    const fileId = crypto.randomUUID();
    let sequence = 0;
    let buffered = new Uint8Array(0);
    async function emit(bytes) {
      const key = `${fileId}:${sequence}`;
      const reply = awaitReply(key);
      port.postMessage({
        type: "chunk",
        fileId,
        kind,
        mimeType,
        sequence,
        dataBase64: toBase64(bytes),
      });
      await reply;
      sequence++;
    }
    return {
      async write(value) {
        if (aborted || !stable()) throw Error("capture_epoch_changed");
        const bytes = typeof value === "string" ? encoder.encode(value) : value;
        let offset = 0;
        while (offset < bytes.byteLength) {
          const length = Math.min(
            1_048_576 - buffered.byteLength,
            bytes.byteLength - offset,
          );
          const next = new Uint8Array(buffered.byteLength + length);
          next.set(buffered);
          next.set(bytes.subarray(offset, offset + length), buffered.byteLength);
          buffered = next;
          offset += length;
          if (buffered.byteLength === 1_048_576) {
            await emit(buffered);
            buffered = new Uint8Array(0);
          }
        }
      },
      async end() {
        if (buffered.byteLength) await emit(buffered);
        if (!sequence) return;
        const reply = awaitReply(`end:${fileId}`);
        port.postMessage({ type: "file_end", fileId });
        await reply;
      },
    };
  }
  async function sendText(kind, mimeType, text) {
    if (!text) return;
    const output = await writer(kind, mimeType);
    await output.write(text);
    await output.end();
  }
  function inert(value, seen = new WeakSet(), depth = 0) {
    if (value === null || typeof value === "string" || typeof value === "boolean")
      return value;
    if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
    if (typeof value === "bigint") return String(value);
    if (typeof value !== "object" || depth > 40) return "[unavailable]";
    if (seen.has(value)) return "[circular]";
    if (value instanceof Date) return { type: "Date", value: value.toISOString() };
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value))
      return {
        type: value.constructor.name,
        base64: toBase64(
          new Uint8Array(value.buffer || value, value.byteOffset || 0, value.byteLength),
        ),
      };
    seen.add(value);
    const output = Array.isArray(value) ? [] : Object.create(null);
    for (const [key, descriptor] of Object.entries(
      Object.getOwnPropertyDescriptors(value),
    ))
      if (Object.hasOwn(descriptor, "value"))
        output[key] = inert(descriptor.value, seen, depth + 1);
    seen.delete(value);
    return output;
  }
  try {
    const begin = awaitReply("begin");
    port.postMessage({ type: "hello" });
    await begin;
    if (!stable()) {
      gap("dom", "capture_epoch_changed");
      port.postMessage({ type: "done" });
      return;
    }
    try {
      await sendText("dom", "text/html", document.documentElement.outerHTML);
      for (const frame of document.querySelectorAll("iframe,frame")) {
        try {
          const frameDoc = frame.contentDocument;
          if (!frameDoc?.documentElement) {
            gap("dom", "frame_inaccessible");
            continue;
          }
          await sendText("dom", "text/html", frameDoc.documentElement.outerHTML);
        } catch {
          gap("dom", "frame_inaccessible");
        }
      }
      const shadow = await writer("dom", "application/jsonl");
      for (const element of document.querySelectorAll("*")) {
        if (!element.shadowRoot) continue;
        await shadow.write(
          JSON.stringify({ host: element.tagName, html: element.shadowRoot.innerHTML }) +
            "\n",
        );
      }
      await shadow.end();
    } catch {
      gap("dom", "dom_snapshot_failed");
    }
    port.postMessage({ type: "channel_done", channel: "dom" });
    try {
      const forms = [];
      for (const element of document.querySelectorAll(
        "input,textarea,select,[contenteditable]",
      ))
        forms.push({
          tag: element.tagName,
          name: element.getAttribute("name"),
          type: element.type,
          value: element.value ?? element.textContent,
          checked: element.checked,
          selectedIndex: element.selectedIndex,
        });
      await sendText(
        "storage",
        "application/json",
        JSON.stringify({ source: "live_forms", values: forms }),
      );
    } catch {
      gap("storage", "form_state_unavailable");
    }
    for (const [source, storage] of [
      ["localStorage", () => window.localStorage],
      ["sessionStorage", () => window.sessionStorage],
    ]) {
      try {
        const values = [];
        const area = storage();
        for (let i = 0; i < area.length; i++) {
          const key = area.key(i);
          values.push([key, area.getItem(key)]);
        }
        await sendText("storage", "application/json", JSON.stringify({ source, values }));
      } catch {
        gap("storage", "web_storage_unavailable");
      }
    }
    try {
      if (!indexedDB.databases) throw Error("No database listing");
      const databases = await indexedDB.databases();
      const output = await writer("storage", "application/jsonl");
      for (const info of databases) {
        if (!info.name) continue;
        const db = await new Promise((resolve, reject) => {
          const request = indexedDB.open(info.name);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
          request.onblocked = () => reject(Error("blocked"));
        });
        try {
          for (const storeName of db.objectStoreNames) {
            let lastKey;
            let finished = false;
            while (!finished) {
              const batch = await new Promise((resolve, reject) => {
                const transaction = db.transaction(storeName, "readonly");
                const range =
                  lastKey === undefined
                    ? undefined
                    : IDBKeyRange.lowerBound(lastKey, true);
                const cursor = transaction.objectStore(storeName).openCursor(range);
                const rows = [];
                let batchBytes = 0;
                let nextKey;
                let atEnd = false;
                cursor.onerror = () => reject(cursor.error);
                cursor.onsuccess = () => {
                  const item = cursor.result;
                  if (!item) {
                    atEnd = true;
                    return;
                  }
                  const row =
                    JSON.stringify({
                      database: info.name,
                      store: storeName,
                      key: inert(item.key),
                      value: inert(item.value),
                    }) + "\n";
                  rows.push(row);
                  batchBytes += row.length;
                  nextKey = item.key;
                  if (rows.length < 100 && batchBytes < 1_048_576) item.continue();
                };
                transaction.oncomplete = () => resolve({ rows, nextKey, atEnd });
                transaction.onerror = () => reject(transaction.error);
              });
              for (const row of batch.rows) await output.write(row);
              if (batch.nextKey !== undefined) lastKey = batch.nextKey;
              finished = batch.atEnd || !batch.rows.length;
            }
          }
        } finally {
          db.close();
        }
      }
      await output.end();
    } catch {
      gap("storage", "indexeddb_unavailable");
    }
    try {
      const output = await writer("storage", "application/jsonl");
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        for (const request of await cache.keys()) {
          const response = await cache.match(request);
          if (!response) continue;
          await output.write(
            JSON.stringify({
              source: "cache",
              name,
              request: {
                url: request.url,
                method: request.method,
                headers: [...request.headers],
              },
              response: {
                status: response.status,
                headers: [...response.headers],
              },
            }) + "\n",
          );
          if (response.body) {
            const reader = response.body.getReader();
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              await output.write(
                JSON.stringify({
                  source: "cache_body",
                  name,
                  url: request.url,
                  dataBase64: toBase64(value),
                }) + "\n",
              );
            }
          }
        }
      }
      await output.end();
    } catch {
      gap("storage", "cache_storage_unavailable");
    }
    port.postMessage({ type: "channel_done", channel: "storage" });
    try {
      await sendText(
        "performance",
        "application/jsonl",
        window.performance
          .getEntries()
          .map((entry) => JSON.stringify(inert(entry.toJSON?.() || entry)) + "\n")
          .join(""),
      );
    } catch {
      gap("performance", "performance_unavailable");
    }
    port.postMessage({ type: "channel_done", channel: "performance" });
    try {
      await sendText(
        "environment",
        "application/json",
        JSON.stringify({
          url: location.href,
          capturedAt: new Date().toISOString(),
          userAgent: navigator.userAgent,
          language: navigator.language,
          viewport: {
            width: window.innerWidth,
            height: window.innerHeight,
            devicePixelRatio: window.devicePixelRatio,
          },
          document: {
            title: document.title,
            referrer: document.referrer,
            characterSet: document.characterSet,
          },
        }),
      );
    } catch {
      gap("environment", "environment_unavailable");
    }
    port.postMessage({ type: "channel_done", channel: "environment" });
    port.postMessage({ type: "done" });
  } catch {
    gap("dom", aborted ? "port_disconnected" : "snapshot_failed");
    port.postMessage({ type: "done" });
  }
}
