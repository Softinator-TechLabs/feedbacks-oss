import test from "node:test";
import assert from "node:assert/strict";
import { createCaptureStore, captureElapsed } from "../extension/session-capture.js";
import { createSessionCoordinator } from "../extension/session-coordinator.js";
import { createRecordingAnnotations } from "../extension/recording-annotations.js";

async function fixture(mode = "video", initiallyPaused = false) {
  let data: any = {};
  const storage = {
    get: async (keys: string | string[]) =>
      Object.fromEntries(
        (Array.isArray(keys) ? keys : [keys]).map((key) => [
          key,
          structuredClone(data[key]),
        ]),
      ),
    set: async (values: any) => {
      data = { ...data, ...structuredClone(values) };
    },
    remove: async (key: string) => {
      delete data[key];
    },
  };
  const target = {
    sourceTabId: 1,
    origin: "https://source.test",
    url: "https://source.test/start",
    server: "https://feedback.test",
    projectId: "project",
    reviewId: "review",
  };
  await storage.set({ sessions: { 1: target } });
  await createCaptureStore({ storage }).start(target, {}, mode);
  let failInjection = false,
    failTail = false,
    injections = 0,
    images = 0;
  let native = {
    state: initiallyPaused ? "paused" : "recording",
    sourceAtMs: 20,
    elapsedMs: 15,
  };
  let alarmListener: any;
  const alarmCalls: any[] = [];
  const event = { addListener() {} };
  const sender = { tab: { id: 1 }, frameId: 0, url: target.url };
  const chrome = {
    storage: { local: storage },
    debugger: { onEvent: event, onDetach: event },
    alarms: {
      onAlarm: {
        addListener(fn: any) {
          alarmListener = fn;
        },
      },
      clear: async (name: string) => {
        alarmCalls.push({ clear: name });
      },
      create: async (name: string, value: any) => {
        alarmCalls.push({ name, ...value });
      },
    },
    tabs: {
      onUpdated: event,
      onRemoved: event,
      get: async () => ({ id: 1, url: target.url }),
      sendMessage: async () => ({}),
    },
    scripting: {
      executeScript: async (request: any) => {
        if (request.files?.includes("rrweb-capture.js")) {
          injections++;
          if (failInjection) {
            failInjection = false;
            throw Error("Synthetic injection failure");
          }
        }
        if (request.world === "MAIN" && request.func && !request.args && failTail) {
          failTail = false;
          return [{ result: "invalid paused tail" }];
        }
        return [{ result: [] }];
      },
    },
  };
  const capture = createSessionCoordinator({
    chrome,
    captureStorage: storage,
    ready: Promise.resolve(),
    sessionFor: async () => target,
    authenticated: async () => ({}),
  });
  const manager = createRecordingAnnotations({
    chrome,
    capture,
    recordings: {
      info: () => ({ ...native }),
      control: async (_sender: any, action: string) => {
        native = { ...native, state: action === "pause" ? "paused" : "recording" };
        return { ...native };
      },
    },
    saveImage: async () => {
      images++;
    },
    readImage: async () => "data:image/webp;base64,cGl4ZWxz",
  });
  return {
    manager,
    capture,
    sender,
    native: () => native,
    endNative: () => {
      native.state = "ready";
    },
    alarmCalls,
    alarm: () => alarmListener({ name: "feedbacks-session-limit" }),
    images: () => images,
    injections: () => injections,
    failInjection: () => {
      failInjection = true;
    },
    failTail: () => {
      failTail = true;
    },
  };
}
const key = "11111111-1111-4111-8111-111111111111";

for (const mode of ["session", "video"]) {
  test(`${mode} saved annotation retries failed capture restart without duplicate images, events or pause intervals`, async () => {
    const f = await fixture(mode);
    const point = await f.manager.begin(f.sender, { key });
    f.failInjection();
    const message = {
      annotationId: point.annotationId,
      key,
      body: "Saved comment",
      anchor: { selector: "button" },
    };
    await assert.rejects(
      f.manager.save(f.sender, message),
      /Synthetic injection failure/,
    );
    await f.manager.save(f.sender, message);
    const state = await f.capture.status();
    assert.equal(state.annotationPause, null);
    assert.equal(state.annotations.length, 1);
    assert.equal(
      state.recording.events.filter((e: any) => e.data.action === "annotation").length,
      1,
    );
    assert.equal(state.annotationIntervals.length, 1);
    assert.equal(f.images(), 1);
    assert.equal(f.injections(), 2);
    if (mode === "video") assert.equal(f.native().state, "recording");
  });
}
for (const initiallyPaused of [false, true]) {
  test(`navigation closes an unfinished video point and preserves prior ${initiallyPaused ? "paused" : "recording"} state`, async () => {
    const f = await fixture("video", initiallyPaused);
    await f.manager.begin(f.sender, { key });
    await f.manager.recoverNavigation(f.sender);
    const state = await f.capture.status();
    assert.equal(state.annotationPause, null);
    assert.equal(state.annotationIntervals.length, 1);
    assert.equal(state.annotations?.length || 0, 0);
    assert.equal(f.native().state, initiallyPaused ? "paused" : "recording");
    assert.ok(state.recording.coverage.some((c: any) => c.channel === "annotations"));
  });
}

test("failed page-tail validation restarts capture and returns the native video to recording", async () => {
  const f = await fixture();
  f.failTail();
  await assert.rejects(
    f.manager.begin(f.sender, { key }),
    /pause the page capture safely/,
  );
  const state = await f.capture.status();
  assert.equal(state.active, true);
  assert.ok(!state.annotationPause);
  assert.equal(f.native().state, "recording");
  assert.equal(
    f.injections(),
    1,
    "the page recorder was stopped by the tail read and must be reinstalled",
  );
});

test("session annotation suspends the duration budget and resumes with its remaining time", async (t) => {
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  const f = await fixture("session");
  now += 1000;
  const point = await f.manager.begin(f.sender, { key });
  assert.equal(f.alarmCalls.at(-1).clear, "feedbacks-session-limit");
  now += 301000;
  f.alarm();
  let state = await f.capture.status();
  assert.equal(state.active, true);
  assert.equal(captureElapsed(state), 1000);
  await f.manager.save(f.sender, {
    annotationId: point.annotationId,
    key,
    body: "Thoughtful comment",
    anchor: {},
  });
  state = await f.capture.status();
  assert.equal(captureElapsed(state), 1000);
  assert.equal(f.alarmCalls.at(-1).when, now + 299000);
});
test("failed annotation restart keeps the whole retry interval paused", async (t) => {
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  const f = await fixture("session");
  now += 1000;
  const point = await f.manager.begin(f.sender, { key });
  const input = {
    annotationId: point.annotationId,
    key,
    body: "Saved comment",
    anchor: {},
  };
  now += 4000;
  f.failInjection();
  await assert.rejects(f.manager.save(f.sender, input), /Synthetic injection failure/);
  let state = await f.capture.status();
  assert.equal(state.annotationPause.annotationId, point.annotationId);
  now += 10000;
  await f.manager.save(f.sender, input);
  state = await f.capture.status();
  assert.equal(state.pausedMs, 14000);
  assert.equal(captureElapsed(state), 1000);
});
for (const mode of ["session", "video"])
  test(`${mode} pending point can finish after recording stops`, async () => {
    const f = await fixture(mode);
    const point = await f.manager.begin(f.sender, { key });
    await f.capture.stop();
    f.endNative();
    await f.manager.save(f.sender, {
      annotationId: point.annotationId,
      key,
      body: "Final point",
      anchor: {},
    });
    const state = await f.capture.status();
    assert.equal(state.active, false);
    assert.equal(state.annotationPause, null);
    assert.equal(state.annotations.length, 1);
    assert.ok(state.annotations[0].atMs <= state.recording.durationMs);
    assert.equal(f.injections(), 0);
    assert.equal(f.native().state, "ready");
  });

for (const mode of ["session", "video"])
  test(`${mode} append uses its own duration budget after editing`, async () => {
    let data: any = {},
      now = 1000;
    const storage = {
      get: async () => structuredClone(data),
      set: async (value: any) => {
        data = structuredClone(value);
      },
      remove: async () => {},
    };
    const store = createCaptureStore({ storage, now: () => now });
    await store.start(
      { sourceTabId: 1, origin: "https://source.test", url: "https://source.test" },
      {},
      mode,
    );
    await store.update((s: any) => {
      s.pausedMs = 301000;
      s.annotationIntervals = [{ start: 2000, end: 303000 }];
    });
    now = 304000;
    await store.append(
      { type: "activity", data: { action: "click" } },
      1,
      "https://source.test",
    );
    const state = await store.read();
    assert.equal(state.active, mode === "session");
    if (mode === "session") assert.equal(state.recording.events[0].atMs, 2000);
  });
