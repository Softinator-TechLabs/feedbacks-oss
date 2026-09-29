import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import {
  VIDEO_MAX_BYTES,
  VIDEO_MAX_MS,
  recordingOptions,
  exportVideo,
} from "../extension/video-media.js";

test("lost create acknowledgement retries the original comment and review target", async () => {
  const html = await readFile(
    new URL("../extension/video.html", import.meta.url),
    "utf8",
  );
  const nodes: Record<string, any> = Object.fromEntries(
    [...html.matchAll(/id="([^"]+)"/g)].map((match) => [
      match[1],
      {
        value: "",
        textContent: "",
        hidden: false,
        disabled: false,
        readOnly: false,
        addEventListener() {},
        replaceChildren() {},
      },
    ]),
  );
  const sent: any[] = [];
  const target = {
    project: { id: "project-a", name: "Project A" },
    projectId: "project-a",
    reviewId: "review-a",
    server: "https://feedback.example.test",
    url: "https://site.example.test/a",
    viewport: { width: 1280, height: 800 },
    routeFingerprint: "route-a",
  };
  const context = vm.createContext({
    createVideoTimeline: () => ({
      load() {},
      clear() {},
      lock() {},
      reset() {},
      applied() {},
      original() {},
    }),
    Blob,
    VIDEO_MAX_BYTES,
    VIDEO_MAX_MS,
    recordingOptions,
    exportVideo,
    URL,
    crypto,
    console,
    setInterval() {
      return 1;
    },
    clearInterval() {},
    location: { href: "chrome-extension://test/video.html?sourceTabId=10" },
    document: {
      body: { classList: { add() {}, remove() {}, toggle() {} } },
      getElementById: (id: string) => nodes[id],
    },
    window: { addEventListener() {} },
    chrome: {
      runtime: {
        connect: () => ({
          onMessage: { addListener() {} },
          onDisconnect: { addListener() {} },
          postMessage() {},
        }),
        sendMessage: async (message: any) => {
          if (message.type === "videoContext") return { ok: true, data: target };
          if (message.type === "videoCreate") {
            sent.push(structuredClone(message));
            return { ok: false, error: "Response lost", code: "NETWORK" };
          }
          throw Error(`Unexpected ${message.type}`);
        },
      },
    },
  });
  vm.runInContext(
    (await readFile(new URL("../extension/video.js", import.meta.url), "utf8")).replace(
      /^import[\s\S]*?from "\.\/video-media.js";\n/,
      "",
    ),
    context,
  );
  await new Promise((resolve) => setImmediate(resolve));
  vm.runInContext("blob = new Blob(['recording']); durationMs = 1000", context);
  nodes.comment.value = "Original comment";
  await nodes.send.onclick();
  nodes.comment.value = "Edited after lost response";
  await nodes.send.onclick();
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[1], sent[0]);
  assert.equal(nodes.comment.readOnly, true);
});

test("ending review while the native picker is open stops its eventual stream", async () => {
  const html = await readFile(
    new URL("../extension/video.html", import.meta.url),
    "utf8",
  );
  const nodes: Record<string, any> = Object.fromEntries(
    [...html.matchAll(/id="([^"]+)"/g)].map((match) => [
      match[1],
      {
        value: "",
        textContent: "",
        checked: false,
        disabled: false,
        addEventListener() {},
        removeAttribute() {},
        replaceChildren() {},
      },
    ]),
  );
  let disconnect!: () => void, resolvePicker!: (stream: any) => void;
  let stopped = 0,
    constructed = 0;
  const context = vm.createContext({
    createVideoTimeline: () => ({
      load() {},
      clear() {},
      lock() {},
      reset() {},
      applied() {},
      original() {},
    }),
    URL,
    VIDEO_MAX_BYTES,
    VIDEO_MAX_MS,
    recordingOptions,
    exportVideo,
    crypto,
    Blob,
    console,
    setInterval() {
      return 1;
    },
    clearInterval() {},
    location: { href: "chrome-extension://test/video.html?sourceTabId=10" },
    document: {
      body: { classList: { add() {}, remove() {}, toggle() {} } },
      getElementById: (id: string) => nodes[id],
    },
    window: { addEventListener() {} },
    navigator: {
      mediaDevices: {
        getDisplayMedia: () =>
          new Promise((resolve) => {
            resolvePicker = resolve;
          }),
      },
    },
    MediaRecorder: class {
      constructor() {
        constructed++;
      }
    },
    chrome: {
      runtime: {
        connect: () => ({
          onMessage: { addListener() {} },
          onDisconnect: {
            addListener(fn: () => void) {
              disconnect = fn;
            },
          },
          postMessage() {},
        }),
        sendMessage: async () => ({
          ok: true,
          data: { project: { name: "Project" }, viewport: { width: 900, height: 650 } },
        }),
      },
    },
  });
  vm.runInContext(
    (await readFile(new URL("../extension/video.js", import.meta.url), "utf8")).replace(
      /^import[\s\S]*?from "\.\/video-media.js";\n/,
      "",
    ),
    context,
  );
  await new Promise((resolve) => setImmediate(resolve));
  const starting = nodes.start.onclick();
  disconnect();
  resolvePicker({
    getTracks: () => [
      {
        stop() {
          stopped++;
        },
      },
    ],
  });
  await starting;
  assert.equal(stopped, 1);
  assert.equal(constructed, 0);
  assert.equal(nodes.start.disabled, true);
  assert.match(nodes.status.textContent, /Review ended/);
});
