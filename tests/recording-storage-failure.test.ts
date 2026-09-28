import test from "node:test";
import assert from "node:assert/strict";
import { createCaptureStore } from "../extension/session-capture.js";
import { createSessionCoordinator } from "../extension/session-coordinator.js";

test("Stop ends live collection even when durable recording storage keeps failing", async () => {
  let data: any = {};
  let failWrites = false;
  let writes = 0;
  const storage = {
    get: async (key: string) => structuredClone({ [key]: data[key] }),
    set: async (values: any) => {
      writes++;
      if (failWrites) throw Error("Persistent IndexedDB failure");
      data = structuredClone({ ...data, ...values });
    },
    remove: async (key: string) => {
      delete data[key];
    },
  };
  const target = {
    sourceTabId: 1,
    origin: "https://example.test",
    url: "https://example.test/page",
    projectId: "original-project",
    server: "https://feedback.example.test",
  };
  const store = createCaptureStore({ storage });
  await store.start(target, { maskInputs: true, maskText: false, networkBodies: false });
  await store.append(
    { type: "console", data: { message: "durable evidence" } },
    1,
    target.origin,
  );
  await store.update((state) => {
    state.debuggerAttached = true;
  });
  const before = structuredClone(data);
  let detached = 0;
  let scriptCalls = 0;
  let cleared = 0;
  const event = { addListener() {} };
  const coordinator = createSessionCoordinator({
    captureStorage: storage,
    ready: Promise.resolve(),
    sessionFor: async () => target,
    authenticated: async () => {},
    chrome: {
      storage: { local: { get: async () => ({}) } },
      debugger: {
        onEvent: event,
        onDetach: event,
        detach: async () => {
          detached++;
        },
      },
      alarms: {
        onAlarm: event,
        clear: async () => {
          cleared++;
        },
      },
      tabs: {
        onUpdated: event,
        onRemoved: event,
        get: async () => ({ id: 1, url: target.url }),
        sendMessage: async () => {},
      },
      scripting: {
        executeScript: async () => {
          scriptCalls++;
          return [{ result: [] }];
        },
      },
    },
  });
  failWrites = true;
  // Stop may report the durability failure, but must still stop the live sources.
  await coordinator.stop().catch(() => {});
  assert.ok(detached >= 1, "Stop must detach Chrome debugger despite a failed write");
  assert.ok(scriptCalls >= 3, "Stop must drain and stop both page collectors");
  assert.ok(cleared >= 1);
  assert.equal((await coordinator.status()).active, false);
  const writesAfterStop = writes;
  await coordinator.events(
    {
      type: "sessionEvents",
      token: before.feedbacksSessionCaptureV1.bridgeToken,
      events: [{ type: "console", data: { message: "must not collect after Stop" } }],
    },
    { tab: { id: 1 }, frameId: 0, url: target.url },
  );
  assert.equal(writes, writesAfterStop, "Stopped sources cannot retry new event writes");
  assert.deepEqual(data, before, "The last successfully persisted evidence is intact");
});
