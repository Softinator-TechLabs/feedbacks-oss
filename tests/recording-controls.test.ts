import test from "node:test";
import assert from "node:assert/strict";
import { createRecordingControls } from "../extension/recording-controls.js";

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
  await controller.control({ tab: { id: 10 } }, "pause");
  assert.deepEqual(commands.at(-1), { action: "pause" });
  state({ state: "paused" });
  assert.equal(controller.state(10), "paused");
  await controller.control({ tab: { id: 10 } }, "stop");
  assert.deepEqual(updates.at(-1), [20, { active: true }]);
  await controller.open({ tab: { id: 10 } });
  assert.equal(created.length, 0);
  reviewId = "review-b";
  await controller.open({ tab: { id: 10 } });
  assert.equal(created.length, 1);
  assert.match(created[0].url, /reviewId=review-b/);
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
