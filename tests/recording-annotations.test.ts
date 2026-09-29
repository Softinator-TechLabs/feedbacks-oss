import test from "node:test";
import assert from "node:assert/strict";
import { createRecordingAnnotations } from "../extension/recordings/recording-annotations.js";
import {
  createCaptureStore,
  captureElapsed,
} from "../extension/session/session-capture.js";

function fixture(mode = "video", initiallyPaused = false) {
  const calls: string[] = [];
  const s: any = { active: true, recording: { id: "recording", mode }, annotations: [] };
  const sender = { tab: { id: 1 } };
  let native: any = {
    state: initiallyPaused ? "paused" : "recording",
    elapsedMs: 500,
    sourceAtMs: 800,
  };
  const capture = {
    contextForControls: async () => ({ target: {} }),
    status: async () => s,
    beginAnnotation: async (input: any) => {
      calls.push("pause capture");
      return (s.annotationPause = { ...input, annotationId: "point", startedAt: 1000 });
    },
    saveAnnotation: async (input: any) => {
      calls.push("save point");
      s.annotations.push({ id: input.annotationId });
    },
    endAnnotation: async () => {
      calls.push("resume capture");
      s.annotationPause = null;
    },
  };
  const manager = createRecordingAnnotations({
    chrome: {
      tabs: {
        sendMessage: async () => {
          calls.push("hide editor");
          return {};
        },
      },
    },
    capture,
    recordings: {
      info: () => native,
      control: async (_: any, action: string) => {
        calls.push(action + " video");
        native = { ...native, state: action === "pause" ? "paused" : "recording" };
        return native;
      },
    },
    saveImage: async () => {
      calls.push("save pixels");
    },
    readImage: async () => "data:image/webp;base64,cGl4ZWxz",
  });
  return { manager, s, calls, sender, capture };
}
const key = "11111111-1111-4111-8111-111111111111";
test("screenshot comment waits for native pause, saves pixels and event before hidden-editor resume", async () => {
  const f = fixture();
  const point = await f.manager.begin(f.sender, { key });
  assert.equal(point.atMs, 800);
  assert.equal(point.videoTimeMs, 500);
  assert.deepEqual(f.calls, ["pause video", "pause capture"]);
  assert.deepEqual(await f.manager.begin(f.sender, { key }), point);
  await f.manager.save(f.sender, {
    annotationId: "point",
    key,
    body: "Broken button",
    anchor: {},
  });
  assert.deepEqual(f.calls, [
    "pause video",
    "pause capture",
    "save pixels",
    "save point",
    "hide editor",
    "resume capture",
    "resume video",
  ]);
});
test("cancel preserves a video that was already manually paused", async () => {
  const f = fixture("video", true);
  await f.manager.begin(f.sender, { key });
  await f.manager.cancel(f.sender, { annotationId: "point" });
  assert.deepEqual(f.calls, ["pause capture", "hide editor", "resume capture"]);
});
test("session screenshot comment does not call native media controls", async () => {
  const f = fixture("session");
  await f.manager.begin(f.sender, { key });
  await f.manager.cancel(f.sender, { annotationId: "point" });
  assert.deepEqual(f.calls, ["pause capture", "hide editor", "resume capture"]);
});
test("wrong page and mismatched screenshot key cannot save a capture point", async () => {
  const f = fixture();
  await f.manager.begin(f.sender, { key });
  await assert.rejects(
    f.manager.save(f.sender, { annotationId: "point", key: "other" }),
    /Select/,
  );
  f.capture.contextForControls = async () => null as any;
  await assert.rejects(
    f.manager.cancel(f.sender, { annotationId: "point" }),
    /does not own/,
  );
  assert.deepEqual(f.calls, ["pause video", "pause capture"]);
});
test("session clock excludes annotation editing and resumed DOM timestamps share that clock", async () => {
  let value: any = {};
  let now = 1000;
  const storage = {
    get: async () => structuredClone(value),
    set: async (v: any) => {
      value = structuredClone(v);
    },
    remove: async () => {
      value = {};
    },
  };
  const store = createCaptureStore({ storage, now: () => now });
  await store.start(
    { sourceTabId: 1, origin: "https://site.test", url: "https://site.test" },
    {},
    "session",
  );
  now = 1500;
  await store.update((s: any) => {
    s.annotationPause = { startedAt: now };
  });
  now = 2000;
  await store.append(
    { type: "console", data: { message: "editing" } },
    1,
    "https://site.test",
  );
  assert.equal((await store.read()).recording.events.length, 0);
  assert.equal(captureElapsed(await store.read(), now), 500);
  await store.update((s: any) => {
    s.annotationPause = null;
    s.pausedMs = 500;
    s.annotationIntervals = [{ start: 1500, end: 2000 }];
  });
  now = 2200;
  await store.append(
    { type: "replay", data: { type: 2, timestamp: now, data: { node: { id: 1 } } } },
    1,
    "https://site.test",
  );
  const state = await store.stop();
  assert.equal(state.recording.durationMs, 700);
  assert.equal(state.recording.events[0].atMs, 700);
  assert.equal(state.recording.events[0].data.timestamp, 1700);
});

test("session point upload survives an ambiguous response and retries identical image input", async () => {
  const { createSessionCoordinator } = await import(
    "../extension/session/session-coordinator.js"
  );
  const { videoFingerprint } = await import("../extension/video/video-target.js");
  let data: any = {};
  const storage = {
    get: async (keys: any) =>
      Object.fromEntries(
        (Array.isArray(keys) ? keys : [keys]).map((k: string) => [
          k,
          structuredClone(data[k]),
        ]),
      ),
    set: async (v: any) => {
      data = { ...data, ...structuredClone(v) };
    },
    remove: async (k: string) => {
      delete data[k];
    },
  };
  const target = {
    sourceTabId: 1,
    origin: "https://site.test",
    url: "https://site.test",
    server: "https://feedback.test",
    projectId: "project",
    reviewId: "review",
    viewport: { width: 1200, height: 800 },
  };
  await storage.set({
    server: target.server,
    accounts: { [target.server]: { token: "token" } },
  });
  const store = createCaptureStore({ storage });
  await store.start(target, {}, "session");
  await store.update(async (s: any) => {
    s.accountFingerprint = await videoFingerprint("token");
    s.annotations = [{ id: key, atMs: 0, body: "Broken link", anchor: {} }];
  });
  await store.stop();
  const event = { addListener() {} };
  const uploads: any[] = [];
  let uploadRecordingCalls = 0;
  const coordinator = createSessionCoordinator({
    captureStorage: storage,
    ready: Promise.resolve(),
    sessionFor: async () => target,
    chrome: {
      storage: { local: storage },
      debugger: { onEvent: event, onDetach: event },
      tabs: { onUpdated: event, onRemoved: event },
      alarms: { onAlarm: event },
    },
    annotationImage: async () => "data:image/webp;base64,cGl4ZWxz",
    authenticated: async (operation: string, input: any) => {
      if (operation === "threads.create") return { id: "thread", revision: 1 };
      if (operation === "recordings.upload") {
        uploadRecordingCalls++;
        return { thread: { id: "thread", revision: 2 } };
      }
      if (operation === "assets.upload") {
        uploads.push(structuredClone(input));
        if (uploads.length === 1) throw Error("Response lost after accepted upload");
        return { thread: { id: "thread", revision: 3 } };
      }
      throw Error(operation);
    },
  });
  await assert.rejects(coordinator.submit({ body: "Review" }, 2), /Response lost/);
  assert.ok((await coordinator.status()).submission.annotationUploads[key]);
  const result = await coordinator.submit({ body: "Changed after retry" }, 2);
  assert.deepEqual(uploads[0], uploads[1]);
  assert.equal(uploads[1].recordingFrame.annotationId, key);
  assert.equal(uploads[1].recordingFrame.videoTimeMs, undefined);
  assert.equal(result.thread.revision, 3);
  assert.equal(uploadRecordingCalls, 2);
  assert.equal(await coordinator.status(), null);
});
