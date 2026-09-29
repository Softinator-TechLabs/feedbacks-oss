import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

export async function verifyDiagnosticDom({
  page,
  control,
  toFixture,
  tabId,
  send,
  draft,
  results,
}) {
  await toFixture();
  const captureTabId = await tabId();
  await control.evaluate(async (id) => {
    await chrome.scripting.executeScript({
      target: { tabId: id },
      func: () => {
        globalThis.__captureProgressHistory = [];
        const attach = Element.prototype.attachShadow;
        Element.prototype.attachShadow = function (options) {
          const shadow = attach.call(this, options);
          if (this.id === "feedbacks-capture-progress") {
            globalThis.__captureProgressRoot = shadow;
            const record = () => {
              const label = shadow.querySelector('[role="status"]')?.textContent?.trim();
              if (label && globalThis.__captureProgressHistory.at(-1)?.label !== label)
                globalThis.__captureProgressHistory.push({
                  label,
                  at: performance.now(),
                });
            };
            new MutationObserver(record).observe(shadow, {
              childList: true,
              characterData: true,
              subtree: true,
            });
            queueMicrotask(record);
          }
          return shadow;
        };
      },
    });
  }, captureTabId);
  await page.evaluate(async () => {
    const pixelCanary = document.createElement("div");
    pixelCanary.id = "capture-pixel-canary";
    pixelCanary.style.cssText =
      "position:fixed;top:0;right:0;width:320px;height:70px;background:#eee;z-index:2147483646;pointer-events:none";
    document.body.append(pixelCanary);
    const hidden = document.createElement("div");
    hidden.hidden = true;
    hidden.id = "diagnostic-large-dom";
    hidden.textContent = "x".repeat(2_097_151) + "é" + "y".repeat(3_300_000);
    document.body.append(hidden);
    const form = document.createElement("input");
    form.name = "synthetic-secret";
    form.value = "fake-live-value";
    document.body.append(form);
    localStorage.setItem("synthetic-token", "fake-local-token");
    const host = document.createElement("section");
    host.attachShadow({ mode: "open" }).innerHTML = "<strong>shadow-canary</strong>";
    document.body.append(host);
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("synthetic-diagnostic-db", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("values");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const transaction = database.transaction("values", "readwrite");
      transaction
        .objectStore("values")
        .put({ password: "fake-indexeddb-secret" }, "record");
      transaction.objectStore("values").put(
        {
          blob: new Blob(["fake-indexeddb-blob"], { type: "text/plain" }),
          map: new Map([["map-key", "map-value"]]),
          set: new Set(["set-value"]),
        },
        "structured-record",
      );
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
    const cache = await caches.open("synthetic-diagnostic-cache");
    await cache.put(
      "https://example.com/cached-diagnostic",
      new Response("fake-cache-body", {
        headers: { "X-Diagnostic": "raw-cache-header" },
      }),
    );
  });
  await send({ type: "popupAction", tabId: captureTabId, action: "capture" });
  const current = await draft();
  assert.ok(current?.diagnosticEvidence?.evidenceId);
  const progress = await control.evaluate(async (id) => {
    const [entry] = await chrome.scripting.executeScript({
      target: { tabId: id },
      func: () => ({
        history: globalThis.__captureProgressHistory || [],
        removed: !document.getElementById("feedbacks-capture-progress"),
      }),
    });
    return entry.result;
  }, captureTabId);
  const labels = progress.history.map(({ label }) => label);
  assert.ok(labels.includes("Fetching DOM data…"), JSON.stringify(labels));
  assert.ok(labels.includes("Saving local draft…"), JSON.stringify(labels));
  assert.equal(progress.removed, true);
  const screenshotTopRight = await control.evaluate(async (image) => {
    const decoded = new Image();
    decoded.src = image;
    await decoded.decode();
    const canvas = document.createElement("canvas");
    canvas.width = decoded.naturalWidth;
    canvas.height = decoded.naturalHeight;
    const context = canvas.getContext("2d");
    context.drawImage(decoded, 0, 0);
    return [...context.getImageData(canvas.width - 30, 30, 1, 1).data];
  }, current.image);
  assert.ok(
    screenshotTopRight.slice(0, 3).every((value) => value > 180),
    `Capture progress appeared in screenshot pixels: ${screenshotTopRight}`,
  );
  results.captureProgress = { labels, removed: progress.removed };
  if (process.env.FEEDBACKS_CAPTURE_PROGRESS_SHOTS) {
    const output = `${process.cwd()}/.local/capture-progress`;
    await mkdir(output, { recursive: true });
    const viewport = page.viewportSize();
    await page.locator("#capture-pixel-canary").evaluate((element) => element.remove());
    await control.evaluate(
      (id) => chrome.tabs.sendMessage(id, { type: "captureProgress", stage: "dom" }),
      captureTabId,
    );
    try {
      await page.screenshot({ path: `${output}/desktop.png` });
      await page.setViewportSize({ width: 390, height: 780 });
      await page.screenshot({ path: `${output}/mobile.png` });
    } finally {
      await page.setViewportSize(viewport);
      await control.evaluate(
        (id) => chrome.tabs.sendMessage(id, { type: "captureProgress", stage: "done" }),
        captureTabId,
      );
    }
  }
  const saved = await control.evaluate(async (evidenceId) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("feedbacks-screenshot-evidence");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const state = await new Promise((resolve, reject) => {
        const request = db.transaction("state").objectStore("state").get(evidenceId);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const dom = state.manifest.files.find(
        (file) => file.kind === "dom" && file.mimeType === "text/html",
      );
      async function read(file) {
        const parts = [];
        for (const chunk of file.chunks) {
          const row = await new Promise((resolve, reject) => {
            const request = db
              .transaction("chunks")
              .objectStore("chunks")
              .get([evidenceId, file.fileId, chunk.sequence]);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          parts.push(new Uint8Array(await row.blob.arrayBuffer()));
        }
        const bytes = new Uint8Array(
          parts.reduce((sum, part) => sum + part.byteLength, 0),
        );
        let offset = 0;
        for (const part of parts) {
          bytes.set(part, offset);
          offset += part.byteLength;
        }
        return bytes;
      }
      const bytes = await read(dom);
      const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
        .map((part) => part.toString(16).padStart(2, "0"))
        .join("");
      const text = new TextDecoder().decode(bytes);
      const storage = [];
      const shadow = [];
      for (const file of state.manifest.files) {
        if (file.kind === "storage")
          storage.push(new TextDecoder().decode(await read(file)));
        if (file.kind === "dom" && file.mimeType === "application/jsonl")
          shadow.push(new TextDecoder().decode(await read(file)));
      }
      return {
        manifest: state.manifest,
        file: dom,
        byteLength: bytes.byteLength,
        digest,
        hasCanary: text.includes("é") && text.includes("diagnostic-large-dom"),
        hasForm: storage.some((value) => value.includes("fake-live-value")),
        hasLocalStorage: storage.some((value) => value.includes("fake-local-token")),
        hasIndexedDb: storage.some((value) => value.includes("fake-indexeddb-secret")),
        hasIndexedDbBlob: storage.some((value) =>
          value.split("\n").some((line) => {
            if (!line.includes('"source":"indexeddb_blob"')) return false;
            return atob(JSON.parse(line).dataBase64) === "fake-indexeddb-blob";
          }),
        ),
        hasMapAndSet: storage.some(
          (value) => value.includes("map-value") && value.includes("set-value"),
        ),
        hasCache: storage.some((value) =>
          value.split("\n").some((line) => {
            if (!line.includes('"source":"cache_body"')) return false;
            return atob(JSON.parse(line).dataBase64) === "fake-cache-body";
          }),
        ),
        hasShadow: shadow.some((value) => value.includes("shadow-canary")),
      };
    } finally {
      db.close();
    }
  }, current.diagnosticEvidence.evidenceId);
  assert.ok(saved.byteLength > 5 * 1024 * 1024);
  assert.ok(saved.file.chunks.every((part) => part.byteLength <= 2_097_152));
  assert.equal(saved.digest, saved.file.sha256);
  assert.ok(saved.hasCanary);
  assert.ok(saved.hasForm);
  assert.ok(saved.hasLocalStorage);
  assert.ok(saved.hasIndexedDb);
  assert.ok(saved.hasIndexedDbBlob);
  assert.ok(saved.hasMapAndSet);
  assert.ok(saved.hasCache);
  assert.ok(saved.hasShadow);
  assert.equal(saved.manifest.coverage.dom.status, "complete");
  assert.ok(
    saved.manifest.coverage.network.reasons.includes("prestart_history_unavailable"),
  );
  await send({ type: "discard" });
  console.log(
    JSON.stringify({
      diagnosticDom: {
        bytes: saved.byteLength,
        chunks: saved.file.chunks.length,
        sha256: saved.file.sha256,
        coverage: saved.manifest.coverage.dom.status,
      },
    }),
  );
}
