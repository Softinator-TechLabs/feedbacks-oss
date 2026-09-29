import test from "node:test";
import assert from "node:assert/strict";
import { createCaptureStore } from "../extension/session/session-capture.js";
import { createSessionCoordinator } from "../extension/session/session-coordinator.js";
import { videoFingerprint } from "../extension/video/video-target.js";

async function fixture() {
  let data: Record<string, any> = {};
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
    allowedOrigins: ["https://source.test", "https://redirect.test"],
    url: "https://source.test/start",
    server: "https://feedback.test",
    reviewId: "review",
    projectId: "original-project",
  };
  await storage.set({
    server: target.server,
    accounts: { [target.server]: { token: "original-account" } },
    sessions: { 1: target },
  });
  const store = createCaptureStore({ storage });
  await store.start(target, {}, "session");
  await store.update(async (s: any) => {
    s.accountFingerprint = await videoFingerprint("original-account");
    s.debuggerAttached = true;
    s.mainFrameId = "main";
  });
  const initial = await store.read();
  let onDebugger: (...args: any[]) => void = () => {};
  let onUpdated: (...args: any[]) => void = () => {};
  let url = target.url,
    detached = 0;
  const injected: any[] = [];
  const event = { addListener() {} };
  const chrome = {
    storage: { local: storage },
    debugger: {
      onEvent: {
        addListener(fn: typeof onDebugger) {
          onDebugger = fn;
        },
      },
      onDetach: event,
      detach: async () => {
        detached++;
      },
    },
    alarms: { onAlarm: event, clear: async () => {} },
    tabs: {
      get: async () => ({ id: 1, url }),
      onUpdated: {
        addListener(fn: typeof onUpdated) {
          onUpdated = fn;
        },
      },
      onRemoved: event,
      sendMessage: async () => ({}),
    },
    scripting: {
      executeScript: async (request: any) => {
        injected.push(request);
        return [{ result: [] }];
      },
    },
  };
  const coordinator = createSessionCoordinator({
    chrome,
    captureStorage: storage,
    ready: Promise.resolve(),
    sessionFor: async () => target,
    authenticated: async () => ({}),
  });
  return {
    coordinator,
    target,
    storage,
    initial,
    injected,
    navigate: (next: string) => {
      url = next;
    },
    detached: () => detached,
    console: (text: string) =>
      onDebugger({ tabId: 1 }, "Runtime.consoleAPICalled", {
        type: "log",
        args: [{ type: "string", value: text }],
      }),
    protocol: (method: string, params: any) => onDebugger({ tabId: 1 }, method, params),
    completed: (eventUrl: string) =>
      onUpdated(1, { status: "complete" }, { id: 1, url: eventUrl }),
    changed: (eventUrl: string) =>
      onUpdated(1, { url: eventUrl }, { id: 1, url: eventUrl }),
  };
}

for (const ingress of [
  "queued debugger event",
  "queued page batch",
  "stale approved-page completion",
] as const) {
  test(`${ingress} suspends capture when the live tab has left approved origins and resumes on return`, async () => {
    const f = await fixture();
    // Chrome can report the new live URL before the queued navigation event is handled.
    f.navigate("https://outside.test/private");
    if (ingress === "queued debugger event") f.console("OUTSIDE_CANARY");
    else if (ingress === "queued page batch")
      await f.coordinator.events(
        {
          token: f.initial.bridgeToken,
          events: [
            { type: "activity", data: { action: "click", label: "OUTSIDE_CANARY" } },
          ],
        },
        { tab: { id: 1 }, frameId: 0, url: f.target.url, documentId: "old-document" },
      );
    else f.completed(f.target.url);
    const suspended = await f.coordinator.status();
    assert.equal(
      suspended.active,
      true,
      "leaving capture scope is reversible suspension",
    );
    assert.equal(suspended.scopeActive, false);
    assert.equal(f.detached(), 0, "retain the debugger for the approved return");
    assert.ok(!JSON.stringify(suspended.recording.events).includes("OUTSIDE_CANARY"));
    assert.ok(
      suspended.recording.coverage.some(
        (c: any) => c.channel === "navigation" && c.status === "partial",
      ),
    );
    f.navigate("https://redirect.test/return");
    f.completed("https://redirect.test/return");
    const returned = await f.coordinator.status();
    assert.equal(returned.active, true);
    assert.equal(returned.scopeActive, true);
    assert.equal(returned.target.projectId, "original-project");
    assert.ok(f.injected.some((request) => request.files?.includes("rrweb-capture.js")));
    f.console("Evidence after approved return");
    const resumed = await f.coordinator.status();
    assert.ok(
      JSON.stringify(resumed.recording.events).includes("Evidence after approved return"),
    );
    assert.ok(!JSON.stringify(resumed.recording.events).includes("OUTSIDE_CANARY"));
  });
}

test("account revocation remains terminal rather than becoming navigation suspension", async () => {
  const f = await fixture();
  await f.storage.set({
    accounts: { [f.target.server]: { token: "replacement-account" } },
  });
  f.console("REVOKED_ACCOUNT_CANARY");
  const stopped = await f.coordinator.status();
  assert.equal(stopped.active, false);
  assert.equal(f.detached(), 1);
  assert.ok(!JSON.stringify(stopped.recording.events).includes("REVOKED_ACCOUNT_CANARY"));
});

test("approved top-document return captures its request and response before load completion and drops stale responses", async () => {
  const f = await fixture();
  f.protocol("Network.requestWillBeSent", {
    requestId: "stale",
    type: "Fetch",
    request: { url: "https://source.test/old-request", method: "GET", headers: {} },
  });
  await f.coordinator.status();
  f.navigate("https://outside.test/private");
  f.console("outside");
  await f.coordinator.status();
  f.navigate("https://redirect.test/return");
  f.protocol("Network.requestWillBeSent", {
    requestId: "return-document",
    type: "Document",
    frameId: "main",
    request: { url: "https://redirect.test/return", method: "GET", headers: {} },
  });
  f.protocol("Network.responseReceived", {
    requestId: "return-document",
    response: { url: "https://redirect.test/return", status: 200, mimeType: "text/html" },
  });
  f.protocol("Network.loadingFinished", {
    requestId: "return-document",
    encodedDataLength: 300,
  });
  f.protocol("Network.responseReceived", {
    requestId: "stale",
    response: { url: "https://outside.test/STALE_RESPONSE_CANARY", status: 200 },
  });
  const s = await f.coordinator.status();
  assert.equal(s.active, true);
  assert.equal(s.scopeActive, true);
  assert.deepEqual(
    s.recording.events
      .filter((e: any) => e.data.requestId === "return-document")
      .map((e: any) => e.data.phase),
    ["request", "response", "finished"],
  );
  assert.ok(!JSON.stringify(s.recording.events).includes("STALE_RESPONSE_CANARY"));
});

test("a future approved destination or a child frame cannot reopen a currently excluded page", async () => {
  const f = await fixture();
  f.navigate("https://outside.test/private");
  f.console("outside");
  await f.coordinator.status();
  f.protocol("Network.requestWillBeSent", {
    requestId: "future-document",
    type: "Document",
    frameId: "main",
    request: { url: "https://redirect.test/return", method: "GET", headers: {} },
  });
  let s = await f.coordinator.status();
  assert.equal(s.scopeActive, false);
  assert.equal(s.active, true);
  const child = await fixture();
  child.navigate("https://outside.test/private");
  child.console("outside");
  await child.coordinator.status();
  child.navigate("https://redirect.test/return");
  child.protocol("Network.requestWillBeSent", {
    requestId: "child-document",
    type: "Document",
    frameId: "child",
    request: { url: "https://redirect.test/frame", method: "GET", headers: {} },
  });
  s = await child.coordinator.status();
  assert.equal(s.scopeActive, false);
  assert.equal(s.recording.events.length, 0);
});

test("approved return buffers only its bounded document exchange until the live URL is approved", async () => {
  const f = await fixture();
  f.navigate("https://outside.test/private");
  f.console("outside");
  await f.coordinator.status();
  f.protocol("Network.requestWillBeSent", {
    requestId: "return",
    frameId: "main",
    type: "Document",
    request: {
      url: "https://redirect.test/return",
      method: "GET",
      headers: {
        Authorization: "SECRET_CREDENTIAL_CANARY",
        Referer: "https://outside.test/PRIVATE_PATH_CANARY",
      },
    },
    initiator: { url: "https://outside.test/PRIVATE_PATH_CANARY" },
  });
  f.protocol("Network.responseReceived", {
    requestId: "return",
    response: { url: "https://redirect.test/return", status: 200 },
  });
  f.protocol("Network.loadingFinished", { requestId: "return", encodedDataLength: 300 });
  f.console("EXCLUDED_CONSOLE_CANARY");
  f.protocol("Network.responseReceived", {
    requestId: "outside-request",
    response: { url: "https://outside.test/EXCLUDED_RESPONSE_CANARY", status: 200 },
  });
  const suspended = await f.coordinator.status();
  assert.equal(suspended.scopeActive, false);
  assert.equal(
    suspended.recording.events.length,
    0,
    "do not persist pending evidence while outside",
  );
  await new Promise((resolve) => setTimeout(resolve, 25));
  f.navigate("https://redirect.test/return");
  f.changed("https://redirect.test/return");
  const returned = await f.coordinator.status();
  assert.equal(returned.scopeActive, true);
  assert.deepEqual(
    returned.recording.events.map((e: any) => e.data.phase),
    ["request", "response", "finished"],
  );
  assert.ok(
    returned.recording.events[0].atMs < Date.now() - returned.started - 15,
    "retain occurrence time before the URL notification",
  );
  assert.ok(!JSON.stringify(returned).includes("CANARY"));
});

test("account revocation discards a buffered approved return", async () => {
  const f = await fixture();
  f.navigate("https://outside.test/private");
  f.console("outside");
  await f.coordinator.status();
  f.protocol("Network.requestWillBeSent", {
    requestId: "return",
    frameId: "main",
    type: "Document",
    request: { url: "https://redirect.test/return", method: "GET", headers: {} },
  });
  await f.coordinator.status();
  await f.storage.set({
    accounts: { [f.target.server]: { token: "replacement-account" } },
  });
  f.navigate("https://redirect.test/return");
  f.changed("https://redirect.test/return");
  const stopped = await f.coordinator.status();
  assert.equal(stopped.active, false);
  assert.equal(stopped.recording.events.length, 0);
});

test("uncalibrated lifecycle history is omitted while live frame loading still records", async () => {
  const f = await fixture();
  f.protocol("Page.lifecycleEvent", { frameId: "main", name: "load", timestamp: 12 });
  f.protocol("Page.frameStartedLoading", { frameId: "main" });
  const s = await f.coordinator.status();
  assert.deepEqual(
    s.recording.events.map((e: any) => e.data.phase),
    ["started"],
  );
});

test("calibrated lifecycle uses its occurrence clock and excludes milestones before capture", async () => {
  const f = await fixture();
  f.protocol("Network.requestWillBeSent", {
    requestId: "clock",
    frameId: "main",
    type: "Document",
    wallTime: f.initial.started / 1000,
    timestamp: 50,
    request: { url: f.target.url, method: "GET", headers: {} },
  });
  await f.coordinator.status();
  await new Promise((resolve) => setTimeout(resolve, 25));
  f.protocol("Page.lifecycleEvent", {
    frameId: "main",
    name: "OLD_LOAD_CANARY",
    timestamp: 49,
  });
  f.protocol("Page.lifecycleEvent", {
    frameId: "main",
    name: "DOMContentLoaded",
    timestamp: 50.005,
  });
  const s = await f.coordinator.status();
  const milestones = s.recording.events.filter((e: any) => e.data.action === "loading");
  assert.equal(milestones.length, 1);
  assert.equal(milestones[0].data.phase, "DOMContentLoaded");
  assert.ok(
    Math.abs(milestones[0].atMs - 5) < 1,
    "use the protocol's 5 ms offset rather than the later ingress time",
  );
});
