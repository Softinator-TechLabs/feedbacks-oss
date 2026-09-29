import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  capturePreparedDom,
  streamPreparedSnapshot,
} from "../extension/capture/dom-stream.js";

function eventTarget() {
  const listeners = new Set<(value: any) => void>();
  return {
    addListener(listener: (value: any) => void) {
      listeners.add(listener);
    },
    removeListener(listener: (value: any) => void) {
      listeners.delete(listener);
    },
    fire(value: any) {
      for (const listener of listeners) listener(value);
    },
  };
}

function portPair() {
  const source = {
    onMessage: eventTarget(),
    onDisconnect: eventTarget(),
    postMessage(value: any) {
      queueMicrotask(() => receiver.onMessage.fire(value));
    },
    disconnect() {
      source.onDisconnect.fire(undefined);
      receiver.onDisconnect.fire(undefined);
    },
  };
  const receiver = {
    name: "feedbacks-diagnostic-dom:evidence-1",
    onMessage: eventTarget(),
    onDisconnect: eventTarget(),
    sender: { tab: { id: 7 } },
    postMessage(value: any) {
      queueMicrotask(() => source.onMessage.fire(value));
    },
    disconnect() {
      source.disconnect();
    },
  };
  return { source, receiver };
}

function fakeStore() {
  const chunks = new Map<string, Uint8Array>();
  return {
    chunks,
    async putEvidenceChunk(
      evidenceId: string,
      fileId: string,
      sequence: number,
      bytes: Uint8Array,
    ) {
      assert.equal(evidenceId, "evidence-1");
      assert.ok(bytes.byteLength <= 2_097_152);
      chunks.set(`${fileId}:${sequence}`, bytes.slice());
      return {
        sha256: createHash("sha256").update(bytes).digest("hex"),
        byteLength: bytes.byteLength,
      };
    },
    read(file: any) {
      return Buffer.concat(
        file.chunks.map((chunk: any) => chunks.get(`${file.fileId}:${chunk.sequence}`)!),
      );
    },
  };
}

test("prepared DOM over 5 MiB streams exact multibyte bytes with bounded messages", async () => {
  const store = fakeStore();
  const html = `<html><body>${"x".repeat(2_097_151)}é${"y".repeat(3_300_000)}</body></html>`;
  const pair = portPair();
  const messageSizes: number[] = [];
  const original = pair.source.postMessage;
  pair.source.postMessage = (value: any) => {
    messageSizes.push(JSON.stringify(value).length);
    original(value);
  };
  const browser = {
    runtime: {
      onConnect: eventTarget(),
      connect: () => {
        browser.runtime.onConnect.fire(pair.receiver);
        return pair.source;
      },
    },
    scripting: {
      executeScript: async () => {
        const oldChrome = (globalThis as any).chrome;
        const oldDocument = (globalThis as any).document;
        const oldLocation = (globalThis as any).location;
        const oldWindow = (globalThis as any).window;
        try {
          (globalThis as any).chrome = browser;
          (globalThis as any).document = {
            documentElement: { outerHTML: html },
            querySelectorAll: () => [],
          };
          (globalThis as any).location = {
            href: "https://example.test/page",
            origin: "https://example.test",
          };
          (globalThis as any).window = {
            innerWidth: 900,
            innerHeight: 600,
            scrollX: 0,
            scrollY: 0,
            devicePixelRatio: 1,
            performance: { getEntries: () => [] },
          };
          await streamPreparedSnapshot({
            evidenceId: "evidence-1",
            expectedUrl: "https://example.test/page",
            expectedSignature: "https://example.test/page|900|600|0|0|1",
            captureEpoch: 0,
          });
        } finally {
          (globalThis as any).chrome = oldChrome;
          (globalThis as any).document = oldDocument;
          (globalThis as any).location = oldLocation;
          (globalThis as any).window = oldWindow;
        }
      },
    },
  };
  const result = await capturePreparedDom({
    tabId: 7,
    evidenceId: "evidence-1",
    expectedUrl: "https://example.test/page",
    expectedSignature: "https://example.test/page|900|600|0|0|1",
    captureEpoch: 0,
    store,
    chrome: browser,
    remainingBytes: 268_435_456,
  });
  const dom = result.files.find((file: any) => file.kind === "dom")!;
  const bytes = store.read(dom);
  assert.equal(bytes.byteLength, Buffer.byteLength(html));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), dom.sha256);
  assert.equal(bytes.toString("utf8"), html);
  assert.ok(dom.chunks.length >= 5);
  assert.ok(messageSizes.every((size) => size <= 2_097_152));
  assert.equal(result.coverage.dom.status, "complete");
});

test("stale page or blocked storage reports coverage rather than attaching stale bytes", async () => {
  const store = fakeStore();
  const browser = {
    runtime: { onConnect: eventTarget() },
    scripting: {
      executeScript: async () => {
        const pair = portPair();
        browser.runtime.onConnect.fire(pair.receiver);
        pair.source.postMessage({
          type: "gap",
          channel: "dom",
          reason: "capture_epoch_changed",
        });
        pair.source.postMessage({
          type: "gap",
          channel: "storage",
          reason: "storage_unavailable",
        });
        pair.source.postMessage({ type: "done" });
      },
    },
  };
  const result = await capturePreparedDom({
    tabId: 7,
    evidenceId: "evidence-1",
    expectedUrl: "https://example.test/page",
    expectedSignature: "stale",
    captureEpoch: 1,
    store,
    chrome: browser,
    remainingBytes: 268_435_456,
  });
  assert.equal(result.files.length, 0);
  assert.equal(result.coverage.dom.status, "partial");
  assert.ok(result.coverage.dom.reasons.includes("capture_epoch_changed"));
  assert.ok(result.coverage.storage.reasons.includes("storage_unavailable"));
});
