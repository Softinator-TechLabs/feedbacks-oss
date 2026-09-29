import test from "node:test";
import assert from "node:assert/strict";
import { createRecordingControls } from "../extension/recordings/recording-controls.js";

test("one-click video starts hidden capture and opens review only after Stop", async () => {
  let connect: any, receive: any;
  const created: any[] = [],
    started: any[] = [],
    messages: any[] = [];
  const chrome = {
    runtime: {
      getURL: (path: string) => `chrome-extension://test/${path}`,
      onConnect: { addListener: (fn: any) => (connect = fn) },
    },
    tabs: {
      sendMessage: async (...args: any[]) => messages.push(args),
      update: async () => {},
      create: async (input: any) => {
        created.push(input);
        return { id: 21, ...input };
      },
    },
  };
  const controls = createRecordingControls({
    chrome,
    sessionFor: async () => ({ reviewId: "review-a" }),
    startCapture: async (sender: any, session: any) =>
      started.push({ sourceTabId: sender.tab.id, reviewId: session.reviewId }),
  });
  await controls.open({ tab: { id: 10 } });
  assert.deepEqual(started, [{ sourceTabId: 10, reviewId: "review-a" }]);
  assert.equal(created.length, 0, "starting capture must not add a tab");
  const port = {
    name: "feedbacks-video-offscreen",
    sender: { url: "chrome-extension://test/offscreen-video.html" },
    onMessage: { addListener: (fn: any) => (receive = fn) },
    onDisconnect: { addListener: () => {} },
    postMessage() {},
    disconnect() {},
  };
  connect(port);
  receive({ sourceTabId: 10, reviewId: "review-a", state: "recording", elapsedMs: 0 });
  assert.equal(created.length, 0);
  receive({
    sourceTabId: 10,
    reviewId: "review-a",
    state: "ready",
    elapsedMs: 2500,
    draftId: "draft-1",
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(created.length, 1);
  assert.equal(created[0].active, true);
  assert.match(created[0].url, /video\.html\?sourceTabId=10.*draftId=draft-1/);
  assert.equal(messages.at(-1)[1].state, "ready");
});

test("recording controls stay with their source tab and stop on disconnect", async () => {
  let connect: any;
  const notices: any[] = [],
    updates: any[] = [],
    created: any[] = [];
  const chrome = {
    runtime: {
      getURL: (path: string) => `chrome-extension://test/${path}`,
      onConnect: {
        addListener: (fn: any) => {
          connect = fn;
        },
      },
    },
    tabs: {
      sendMessage: async (...args: any[]) => {
        notices.push(args);
      },
      update: async (...args: any[]) => {
        updates.push(args);
      },
      create: async (input: any) => {
        created.push(input);
      },
    },
  };
  let permitted = true,
    reviewId = "review-a";
  const controller = createRecordingControls({
    chrome,
    sessionFor: async () => {
      if (!permitted) throw Error("Review ended");
      return { reviewId };
    },
  });
  let state: any, disconnect: any;
  const commands: any[] = [];
  const port = {
    name: "feedbacks-video",
    sender: {
      tab: { id: 20 },
      url: "chrome-extension://test/video.html?sourceTabId=10&reviewId=review-a",
    },
    onMessage: {
      addListener: (fn: any) => {
        state = fn;
      },
    },
    onDisconnect: {
      addListener: (fn: any) => {
        disconnect = fn;
      },
    },
    postMessage: (input: any) => {
      commands.push(input);
    },
    disconnect: () => {},
  };
  connect({
    ...port,
    sender: {
      ...port.sender,
      url: "https://untrusted.test/video.html?sourceTabId=10&reviewId=review-a",
    },
  });
  assert.equal(controller.state(10), "idle");
  assert.equal(state, undefined);
  connect(port);
  const target = {
    sourceTabId: 10,
    reviewId: "review-a",
    projectId: "project-a",
    url: "https://site.test/start",
  };
  controller.bindTarget(20, target);
  assert.deepEqual(controller.target(20, target), target);
  assert.throws(() => controller.target(21, target), /context changed/);
  assert.throws(
    () => controller.target(20, { ...target, projectId: "project-b" }),
    /context changed/,
  );
  controller.bindTarget(20, { ...target, url: "https://site.test/next" });
  assert.deepEqual(
    controller.target(20, target),
    target,
    "navigation retains starting context",
  );
  state({ state: "recording" });
  assert.equal(controller.state(10), "recording");
  assert.equal(notices.at(-1)[0], 10);
  await assert.rejects(
    controller.control({ tab: { id: 11 } }, "pause"),
    /Open the recorder/,
  );
  let pauseSettled = false;
  const pause = controller.control({ tab: { id: 10 } }, "pause").then((result) => {
    pauseSettled = true;
    return result;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(commands.at(-1), { action: "pause" });
  assert.equal(pauseSettled, false, "pause must wait for MediaRecorder acknowledgment");
  state({ state: "paused", elapsedMs: 1450, sourceAtMs: 2600 });
  assert.deepEqual(await pause, { state: "paused", elapsedMs: 1450, sourceAtMs: 2600 });
  assert.deepEqual(controller.info(10), {
    state: "paused",
    elapsedMs: 1450,
    sourceAtMs: 2600,
    reviewId: "review-a",
  });
  assert.equal(controller.state(10), "paused");
  await controller.control({ tab: { id: 10 } }, "stop");
  assert.deepEqual(updates.at(-1), [20, { active: true }]);
  await controller.open({ tab: { id: 10 } });
  assert.equal(created.length, 0);
  reviewId = "review-b";
  await controller.open({ tab: { id: 10 } });
  assert.equal(created.length, 1);
  assert.match(created[0].url, /reviewId=review-b/);
  assert.match(created[0].url, /autoStart=1/);
  assert.equal(created[0].active, false);
  connect({
    ...port,
    sender: {
      ...port.sender,
      url: "chrome-extension://test/video.html?sourceTabId=10&reviewId=review-b",
    },
  });
  state({ state: "ready" });
  state({ state: "sent" });
  await controller.open({ tab: { id: 10 } });
  assert.equal(created.length, 2, "A completed video must allow a fresh recording");
  permitted = false;
  await assert.rejects(controller.control({ tab: { id: 10 } }, "resume"), /Review ended/);
  disconnect();
  assert.equal(controller.state(10), "idle");
});

test("native video clock survives heartbeat and page restore without counting paused time", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1000 });
  let connect: any, receive: any;
  const notices: any[] = [],
    updates: any[] = [];
  const controller = createRecordingControls({
    chrome: {
      runtime: {
        getURL: (path: string) => `chrome-extension://test/${path}`,
        onConnect: {
          addListener: (fn: any) => {
            connect = fn;
          },
        },
      },
      tabs: {
        sendMessage: async (...args: any[]) => {
          notices.push(args);
        },
        update: async (...args: any[]) => {
          updates.push(args);
        },
      },
    },
    sessionFor: async () => ({ reviewId: "review-a" }),
  });
  connect({
    name: "feedbacks-video",
    sender: {
      tab: { id: 20 },
      url: "chrome-extension://test/video.html?sourceTabId=10&reviewId=review-a",
    },
    onMessage: {
      addListener: (fn: any) => {
        receive = fn;
      },
    },
    onDisconnect: { addListener: () => {} },
    disconnect: () => {},
    postMessage: () => {},
  });
  receive({ state: "starting", elapsedMs: 0 });
  assert.equal(controller.state(10), "starting");
  receive({ state: "recording", elapsedMs: 1200 });
  assert.deepEqual(notices.at(-1), [
    10,
    { type: "recordingState", mode: "video", state: "recording", elapsedMs: 1200 },
  ]);
  assert.equal(updates.length, 1, "starting returns focus to the source page");
  t.mock.timers.tick(700);
  await controller.restore(10);
  assert.equal(notices.at(-1)[1].elapsedMs, 1900);
  receive({ state: "recording", elapsedMs: 1950, heartbeat: true });
  assert.equal(updates.length, 1, "heartbeats never steal focus");
  receive({ state: "paused", elapsedMs: 2000 });
  t.mock.timers.tick(9000);
  await controller.restore(10);
  assert.deepEqual(notices.at(-1)[1], {
    type: "recordingState",
    mode: "video",
    state: "paused",
    elapsedMs: 2000,
  });
  receive({ state: "recording", elapsedMs: 2000 });
  assert.equal(updates.length, 1, "resume does not switch tabs");
  t.mock.timers.tick(500);
  receive({ state: "stopping", elapsedMs: 2500 });
  assert.equal(controller.state(10), "stopping");
  t.mock.timers.tick(4000);
  await controller.restore(10);
  assert.equal(notices.at(-1)[1].elapsedMs, 2500, "finalization time is not video time");
  receive({ state: "ready", elapsedMs: 2500 });
  await controller.restore(10);
  assert.deepEqual(notices.at(-1)[1], {
    type: "recordingState",
    mode: "video",
    state: "ready",
    elapsedMs: 2500,
  });
});

test("unacknowledged recording controls time out and disconnect rejects an in-flight resume", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let connect: any, receive: any, disconnect: any;
  const commands: any[] = [];
  const controller = createRecordingControls({
    chrome: {
      runtime: {
        getURL: (path: string) => `chrome-extension://test/${path}`,
        onConnect: {
          addListener: (fn: any) => {
            connect = fn;
          },
        },
      },
      tabs: { sendMessage: async () => {}, update: async () => {} },
    },
    sessionFor: async () => ({ reviewId: "review" }),
  });
  connect({
    name: "feedbacks-video",
    sender: {
      tab: { id: 20 },
      url: "chrome-extension://test/video.html?sourceTabId=10&reviewId=review",
    },
    onMessage: {
      addListener: (fn: any) => {
        receive = fn;
      },
    },
    onDisconnect: {
      addListener: (fn: any) => {
        disconnect = fn;
      },
    },
    postMessage: (message: any) => {
      commands.push(message);
    },
    disconnect: () => {},
  });
  receive({ state: "recording", elapsedMs: 100 });
  const pause = controller.control({ tab: { id: 10 } }, "pause");
  const timedOut = assert.rejects(pause, /did not confirm/);
  await Promise.resolve();
  await assert.rejects(controller.control({ tab: { id: 10 } }, "stop"), /Wait for/);
  t.mock.timers.tick(5000);
  await timedOut;
  assert.deepEqual(
    commands,
    [{ action: "pause" }, { action: "resume" }],
    "timed-out pause must enqueue a compensating resume even before late pause acknowledgment",
  );
  receive({ state: "paused", elapsedMs: 150 });
  const resume = controller.control({ tab: { id: 10 } }, "resume");
  const lost = assert.rejects(resume, /disconnected/);
  await Promise.resolve();
  disconnect();
  await lost;
  assert.equal(controller.info(10), null);
});
