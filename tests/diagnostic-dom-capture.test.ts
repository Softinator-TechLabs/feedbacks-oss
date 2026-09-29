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

test("prepared DOM identifies frames and recursively captures open shadow roots", async () => {
  const store = fakeStore();
  const pair = portPair();
  const leafShadow = {
    innerHTML: "<em>nested-shadow</em>",
    querySelectorAll: () => [],
  };
  const frameShadow = {
    innerHTML: "<section>frame-shadow</section>",
    querySelectorAll: () => [{ tagName: "SPAN", shadowRoot: leafShadow }],
  };
  const frameDocument = {
    URL: "https://example.test/frame",
    documentElement: { outerHTML: "<html>frame</html>" },
    querySelectorAll: (selector: string) =>
      selector === "*" ? [{ tagName: "DIV", shadowRoot: frameShadow }] : [],
  };
  const inaccessibleFrame = {
    tagName: "IFRAME",
    src: "https://outside.test/frame",
    contentDocument: null,
    shadowRoot: null,
  };
  const accessibleFrame = {
    tagName: "IFRAME",
    src: "https://example.test/frame",
    contentDocument: frameDocument,
    shadowRoot: null,
  };
  const rootShadow = {
    innerHTML: "<strong>root-shadow</strong>",
    querySelectorAll: () => [],
  };
  const rootDocument = {
    URL: "https://example.test/page",
    documentElement: { outerHTML: "<html>root</html>" },
    querySelectorAll: (selector: string) =>
      selector === "*"
        ? [
            accessibleFrame,
            inaccessibleFrame,
            { tagName: "MAIN", shadowRoot: rootShadow },
          ]
        : [accessibleFrame, inaccessibleFrame],
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
        const prior = {
          chrome: (globalThis as any).chrome,
          document: (globalThis as any).document,
          location: (globalThis as any).location,
          window: (globalThis as any).window,
        };
        try {
          (globalThis as any).chrome = browser;
          (globalThis as any).document = rootDocument;
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
          (globalThis as any).chrome = prior.chrome;
          (globalThis as any).document = prior.document;
          (globalThis as any).location = prior.location;
          (globalThis as any).window = prior.window;
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
  });
  const htmlFiles = result.files.filter((file: any) => file.mimeType === "text/html");
  assert.deepEqual(
    htmlFiles.map((file: any) => store.read(file).toString("utf8")),
    ["<html>root</html>", "<html>frame</html>"],
  );
  const metadata = result.files
    .filter((file: any) => file.kind === "dom" && file.mimeType === "application/jsonl")
    .flatMap((file: any) =>
      store
        .read(file)
        .toString("utf8")
        .trim()
        .split("\n")
        .map((line: string) => JSON.parse(line)),
    );
  assert.ok(
    metadata.some(
      (entry: any) =>
        entry.type === "document" &&
        entry.fileId === htmlFiles[1].fileId &&
        entry.url === "https://example.test/frame" &&
        entry.path !== "root",
    ),
  );
  assert.ok(metadata.some((entry: any) => entry.html === "<em>nested-shadow</em>"));
  assert.ok(
    metadata.some((entry: any) => entry.html === "<section>frame-shadow</section>"),
  );
  assert.ok(metadata.some((entry: any) => entry.html === "<strong>root-shadow</strong>"));
  assert.ok(
    metadata.some(
      (entry: any) =>
        entry.type === "frame_gap" && entry.src === "https://outside.test/frame",
    ),
  );
  assert.equal(result.coverage.dom.status, "partial");
  assert.ok(result.coverage.dom.reasons.includes("frame_inaccessible"));
});

test("disconnect after one DOM file preserves bytes but reports unfinished coverage", async () => {
  const store = fakeStore();
  const pair = portPair();
  const fileId = "11111111-1111-4111-8111-111111111111";
  const browser = {
    runtime: { onConnect: eventTarget() },
    scripting: {
      executeScript: async () => {
        browser.runtime.onConnect.fire(pair.receiver);
        const reply = (type: string) =>
          new Promise<void>((resolve) => {
            pair.source.onMessage.addListener((message: any) => {
              if (message.type === type) resolve();
            });
          });
        const begin = reply("begin");
        pair.source.postMessage({ type: "hello" });
        await begin;
        const ack = reply("ack");
        pair.source.postMessage({
          type: "chunk",
          kind: "dom",
          mimeType: "text/html",
          fileId,
          sequence: 0,
          dataBase64: Buffer.from("<html>partial</html>").toString("base64"),
        });
        await ack;
        const end = reply("file_ack");
        pair.source.postMessage({ type: "file_end", fileId });
        await end;
        pair.source.disconnect();
      },
    },
  };
  const result = await capturePreparedDom({
    tabId: 7,
    evidenceId: "evidence-1",
    expectedUrl: "https://example.test/page",
    expectedSignature: "unused",
    captureEpoch: 0,
    store,
    chrome: browser,
  });
  assert.equal(store.read(result.files[0]).toString("utf8"), "<html>partial</html>");
  assert.equal(result.coverage.dom.status, "partial");
  assert.ok(result.coverage.dom.reasons.includes("port_disconnected"));
});
