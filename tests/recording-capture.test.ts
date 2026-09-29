import test from "node:test";
import assert from "node:assert/strict";
import {
  createCaptureStore,
  sanitizeCapture,
  captureHandleMatches,
} from "../extension/session/session-capture.js";

function memory() {
  let data: any = {};
  return {
    get: async (key: string | string[]) =>
      structuredClone(
        Object.fromEntries((Array.isArray(key) ? key : [key]).map((k) => [k, data[k]])),
      ),
    set: async (input: any) => {
      await new Promise((r) => setTimeout(r, 1));
      data = { ...data, ...structuredClone(input) };
    },
    remove: async (key: string) => {
      delete data[key];
    },
  };
}
const target = {
  sourceTabId: 1,
  origin: "https://site.test",
  projectId: "project",
  reviewId: "review",
  server: "https://feedback.test",
  url: "https://site.test/start",
  viewport: { width: 1200, height: 800 },
};
const privacy = { maskText: false, maskInputs: true, networkBodies: false };
test("capture serializes callbacks and survives coordinator reload with original scope", async () => {
  const storage = memory(),
    store = createCaptureStore({ storage, now: () => 1000 });
  await store.start(target, privacy, "session");
  await Promise.all(
    Array.from({ length: 20 }, (_, n) =>
      store.append(
        { type: "console", data: { message: String(n) } },
        1,
        "https://site.test/next",
      ),
    ),
  );
  const restarted = createCaptureStore({ storage, now: () => 1200 });
  assert.equal((await restarted.read()).recording.events.length, 20);
  await restarted.append(
    { type: "console", data: { message: "wrong tab" } },
    2,
    "https://site.test",
  );
  await restarted.append(
    { type: "console", data: { message: "wrong origin" } },
    1,
    "https://other.test",
  );
  const saved = await restarted.stop("Reviewer stopped");
  assert.equal(saved.recording.events.length, 20);
  assert.deepEqual(
    saved.recording.events.map((e: any) => e.seq),
    Array.from({ length: 20 }, (_, i) => i),
  );
  assert.equal(saved.recording.durationMs, 200);
  assert.equal(saved.target.projectId, "project");
  await restarted.append(
    { type: "console", data: { message: "late" } },
    1,
    "https://site.test",
  );
  assert.equal((await restarted.read()).recording.events.length, 20);
});
test("capture stops honestly at caps without evicting initial DOM snapshot", async () => {
  const store = createCaptureStore({ storage: memory(), now: () => 1000, maxEvents: 2 });
  await store.start(target, privacy, "session");
  await store.append(
    { type: "replay", data: { type: 2, timestamp: 1000, data: { node: { id: 1 } } } },
    1,
    target.origin,
  );
  await store.append({ type: "activity", data: { action: "click" } }, 1, target.origin);
  await store.append({ type: "activity", data: { action: "click" } }, 1, target.origin);
  const saved = await store.read();
  assert.equal(saved.active, false);
  assert.equal(saved.recording.events[0].data.type, 2);
  assert.match(JSON.stringify(saved.recording.coverage), /limit/i);
  assert.equal(saved.dropped, 1);
});
test("credentials are removed from nested diagnostics and DOM attribute URLs", () => {
  const input = {
    headers: { Authorization: "Bearer CANARY", Cookie: "CANARY", "X-Api-Key": "CANARY" },
    url: "https://user:CANARY@site.test/a?access_token=CANARY&ok=1#CANARY",
    text: "password=CANARY Bearer CANARY",
    node: {
      attributes: {
        value: "CANARY",
        type: "password",
        src: "https://site.test?token=CANARY",
      },
    },
    body: '{"password":"CANARY"}',
  };
  const output = JSON.stringify(sanitizeCapture(input));
  assert.ok(!output.includes("CANARY"), output);
  assert.match(output, /ok=1/);
});
test("hostile or oversized bridge payload cannot become stored events", async () => {
  const store = createCaptureStore({
    storage: memory(),
    now: () => 1000,
    maxEventBytes: 512,
    maxSnapshotBytes: 512,
  });
  await store.start(target, privacy, "session");
  await store.append({ type: "madeup", data: {} }, 1, target.origin);
  await store.append(
    {
      type: "replay",
      data: { type: 2, timestamp: 1000, data: { text: "x".repeat(2000) } },
    },
    1,
    target.origin,
  );
  const saved = await store.read();
  assert.equal(saved.recording.events.length, 0);
  assert.equal(saved.active, true);
  assert.match(JSON.stringify(saved.recording.coverage), /snapshot|oversized/i);
});
test("video evidence only accepts exact Chrome capture handle", () => {
  assert.equal(
    captureHandleMatches(
      { handle: "a", origin: "https://site.test" },
      "a",
      "https://site.test",
    ),
    true,
  );
  assert.equal(captureHandleMatches(undefined, "a", "https://site.test"), false);
  assert.equal(
    captureHandleMatches(
      { handle: "a", origin: "https://else.test" },
      "a",
      "https://site.test",
    ),
    false,
  );
  assert.equal(
    captureHandleMatches(
      { handle: "b", origin: "https://site.test" },
      "a",
      "https://site.test",
    ),
    false,
  );
});

test("pause intervals intersect an applied trim into exact video source/output segments", async () => {
  const { videoSegments } = await import("../extension/session/session-capture.js");
  const segments = videoSegments(
    [
      { sourceStartMs: 100, sourceEndMs: 1100, outputStartMs: 0 },
      { sourceStartMs: 3100, sourceEndMs: 6100, outputStartMs: 1000 },
    ],
    500,
    2500,
  );
  assert.deepEqual(segments, [
    { sourceStartMs: 600, sourceEndMs: 1100, outputStartMs: 0 },
    { sourceStartMs: 3100, sourceEndMs: 4600, outputStartMs: 500 },
  ]);
});
test("edited evidence removes excluded diagnostics and all unsafe DOM baseline", async () => {
  const { clipRecording } = await import("../extension/session/session-capture.js");
  const recording: any = {
    events: [
      { seq: 0, atMs: 0, type: "replay", data: { secret: "outside" } },
      { seq: 1, atMs: 700, type: "console", data: { message: "included" } },
      { seq: 2, atMs: 2000, type: "console", data: { message: "paused" } },
      { seq: 3, atMs: 3500, type: "network", data: { url: "kept" } },
    ],
    coverage: [{ channel: "replay", status: "partial" }],
  };
  const clipped = clipRecording(recording, [
    { sourceStartMs: 600, sourceEndMs: 1100, outputStartMs: 0 },
    { sourceStartMs: 3100, sourceEndMs: 4600, outputStartMs: 500 },
  ]);
  assert.deepEqual(
    clipped.events.map((e: any) => [e.seq, e.atMs]),
    [
      [0, 700],
      [1, 3500],
    ],
  );
  assert.match(JSON.stringify(clipped.coverage), /unavailable/);
  assert.ok(!JSON.stringify(clipped).includes("outside"));
  assert.ok(!JSON.stringify(clipped).includes("paused"));
});

test("edited video upload retry accepts identical frozen coverage without changing immutable evidence", async () => {
  const { createSessionCoordinator } = await import(
    "../extension/session/session-coordinator.js"
  );
  const storage = memory();
  const frozen = {
    active: false,
    recording: {
      coverage: [
        { channel: "video", status: "partial", detail: "Measured trim mapping" },
      ],
      events: [],
    },
    submission: { input: { idempotencyKey: "original" } },
  };
  await storage.set({ feedbacksSessionCaptureV1: frozen });
  const event = { addListener() {} };
  const coordinator = createSessionCoordinator({
    captureStorage: storage,
    chrome: {
      storage: { local: storage },
      debugger: { onEvent: event, onDetach: event },
      alarms: { onAlarm: event },
      tabs: { onUpdated: event, onRemoved: event },
    },
    ready: Promise.resolve(),
    sessionFor: async () => {},
    authenticated: async () => {},
  });
  const before = JSON.stringify(await coordinator.status());
  await coordinator.annotate("video", "Measured trim mapping");
  assert.equal(JSON.stringify(await coordinator.status()), before);
  await assert.rejects(coordinator.annotate("video", "Changed mapping"), /immutable/);
});

test("queued capture uses occurrence clock and sorts late-arriving batches before upload", async () => {
  let clock = 1000;
  const store = createCaptureStore({ storage: memory(), now: () => clock });
  await store.start(target, privacy, "session");
  clock = 5000;
  await store.append(
    {
      type: "console",
      capturedAt: 1200,
      data: { message: "later occurrence arrived first" },
    },
    1,
    target.origin,
  );
  await store.append(
    { type: "replay", data: { type: 2, timestamp: 1050, data: { node: { id: 1 } } } },
    1,
    target.origin,
  );
  const s = await store.stop();
  assert.deepEqual(
    s.recording.events.map((e: any) => [e.seq, e.atMs]),
    [
      [0, 50],
      [1, 200],
    ],
  );
  assert.equal(s.recording.events[0].type, "replay");
});

test("cross-origin child iframe document does not suspend top-level recording scope", async () => {
  const { isTopDocumentRequest } = await import(
    "../extension/session/session-coordinator.js"
  );
  assert.equal(
    isTopDocumentRequest({ type: "Document", frameId: "child" }, "main"),
    false,
  );
  assert.equal(isTopDocumentRequest({ type: "Document", frameId: "main" }, "main"), true);
  assert.equal(isTopDocumentRequest({ type: "Document", frameId: "main" }, null), false);
});

test("quota failure preserves chronological upload order for delayed batches", async () => {
  const backing = memory();
  let failed = false,
    clock = 1000;
  const storage = {
    ...backing,
    set: async (input: any) => {
      if (!failed && input.feedbacksSessionCaptureV1?.recording?.events.length === 3) {
        failed = true;
        throw Error("quota");
      }
      return backing.set(input);
    },
  };
  const store = createCaptureStore({ storage, now: () => clock });
  await store.start(target, privacy, "session");
  clock = 2000;
  await store.append(
    { type: "console", capturedAt: 1200, data: { message: "later" } },
    1,
    target.origin,
  );
  await store.append(
    { type: "console", capturedAt: 1050, data: { message: "earlier" } },
    1,
    target.origin,
  );
  await store.append(
    { type: "console", capturedAt: 1500, data: { message: "quota" } },
    1,
    target.origin,
  );
  const s = await store.read();
  assert.equal(s.active, false);
  assert.deepEqual(
    s.recording.events.map((e: any) => [e.seq, e.atMs]),
    [
      [0, 50],
      [1, 200],
    ],
  );
});

test("ordinary deeply nested DOM snapshots keep their rrweb node structure", () => {
  let node: any = { id: 100, type: 3, textContent: "deep content" };
  for (let n = 0; n < 60; n++)
    node = { id: n, type: 2, tagName: "div", attributes: {}, childNodes: [node] };
  assert.deepEqual(sanitizeCapture(node), node);
});

test("activity names semantic controls while respecting page text privacy and never input values", async () => {
  const { semanticTarget } = await import("../extension/session/session-capture.js");
  const button = {
    tagName: "BUTTON",
    textContent: "Save profile",
    getAttribute: (key: string) =>
      ({ role: "button", "data-testid": "save" })[key] || null,
  };
  assert.equal(semanticTarget(button, false).label, "Save profile");
  assert.equal(semanticTarget(button, true).label, undefined);
  assert.equal(semanticTarget(button, true).testId, "save");
  const input = {
    tagName: "INPUT",
    value: "CANARY",
    textContent: "CANARY",
    getAttribute: () => null,
  };
  assert.ok(!JSON.stringify(semanticTarget(input, false)).includes("CANARY"));
});

test("normal stop drains the final MAIN batch before freezing the durable recording", async () => {
  const { createSessionCoordinator } = await import(
    "../extension/session/session-coordinator.js"
  );
  const storage = memory(),
    store = createCaptureStore({ storage });
  await store.start(target, privacy, "session");
  const event = { addListener() {} };
  const chrome = {
    storage: { local: storage },
    debugger: { onEvent: event, onDetach: event },
    alarms: { onAlarm: event, clear: async () => {} },
    tabs: {
      onUpdated: event,
      onRemoved: event,
      get: async () => ({ id: 1, url: target.origin }),
      sendMessage: async () => {},
    },
    scripting: {
      executeScript: async () => [
        {
          result: [
            {
              type: "console",
              capturedAt: Date.now(),
              data: { message: "last unflushed event" },
            },
          ],
        },
      ],
    },
  };
  const coordinator = createSessionCoordinator({
    captureStorage: storage,
    chrome,
    ready: Promise.resolve(),
    sessionFor: async () => target,
    authenticated: async () => {},
  });
  assert.equal(await coordinator.restore(1, target.reviewId), true);
  assert.equal(await coordinator.restore(2, target.reviewId), false);
  assert.equal(await coordinator.restore(1, "another-review"), false);
  const stopped = await coordinator.stop();
  assert.equal(stopped.active, false);
  assert.equal(stopped.recording.events.length, 1);
  assert.equal(stopped.recording.events[0].data.message, "last unflushed event");
});

test("typing activity preserves timing-ready input meaning only when privacy permits", async () => {
  const { inputActivity } = await import("../extension/session/session-capture.js");
  const element = (tag: string, type: string, value: string, attrs: any = {}) => ({
    tagName: tag,
    type,
    value,
    textContent: value,
    isContentEditable: tag === "DIV",
    checked: true,
    getAttribute: (key: string) => attrs[key] || null,
  });
  assert.deepEqual(
    inputActivity(
      element("INPUT", "text", "hello"),
      { inputType: "insertText" },
      { maskInputs: false, maskText: false },
    ).value,
    "hello",
  );
  assert.equal(
    inputActivity(element("INPUT", "text", "CANARY"), {}, { maskInputs: true })
      .valueMasked,
    true,
  );
  assert.ok(
    !JSON.stringify(
      inputActivity(element("INPUT", "password", "CANARY"), {}, { maskInputs: false }),
    ).includes("CANARY"),
  );
  assert.ok(
    !JSON.stringify(
      inputActivity(
        element("INPUT", "text", "CANARY", { autocomplete: "one-time-code" }),
        {},
        { maskInputs: false },
      ),
    ).includes("CANARY"),
  );
  assert.equal(
    inputActivity(element("DIV", "", "typed editable"), {}, { maskInputs: false }).value,
    "typed editable",
  );
  assert.equal(
    inputActivity(element("INPUT", "checkbox", "yes"), {}, { maskInputs: true }).checked,
    true,
  );
  assert.equal(
    inputActivity(element("INPUT", "text", "a".repeat(3000)), {}, { maskInputs: false })
      .valueTruncated,
    true,
  );
});

test("click child nodes resolve semantic controls and input fields retain safe identity", async () => {
  const { semanticTarget } = await import("../extension/session/session-capture.js");
  const button = { tagName: "BUTTON", textContent: "Submit", getAttribute: () => null };
  const span = {
    tagName: "SPAN",
    textContent: "icon",
    getAttribute: () => null,
    closest: () => button,
  };
  assert.equal(semanticTarget(span, false).tag, "BUTTON");
  assert.equal(semanticTarget(span, false).label, "Submit");
  const input = {
    tagName: "INPUT",
    labels: [{ textContent: "Customer name" }],
    getAttribute: (key: string) => (key === "name" ? "customer_name" : null),
  };
  assert.equal(semanticTarget(input, false).label, "Customer name");
  assert.equal(semanticTarget(input, true).name, "customer_name");
  assert.equal(semanticTarget(input, true).label, undefined);
});

test("passive console object previews preserve useful fields and redact named credentials", async () => {
  const { consoleArgument } = await import("../extension/session/session-coordinator.js");
  const arg = consoleArgument({
    type: "object",
    description: "Object",
    objectId: "do-not-persist",
    preview: {
      type: "object",
      overflow: false,
      properties: [
        { name: "code", type: "number", value: "42" },
        { name: "password", type: "string", value: "CANARY_PASSIVE_SECRET" },
        {
          name: "nested",
          type: "object",
          valuePreview: {
            type: "object",
            overflow: true,
            properties: [
              { name: "token", type: "string", value: "CANARY_NESTED_SECRET" },
            ],
          },
        },
      ],
    },
  });
  assert.equal(arg.preview.properties.code, "42");
  assert.ok(!JSON.stringify(arg).includes("CANARY"));
  assert.ok(!JSON.stringify(arg).includes("do-not-persist"));
  assert.equal(arg.preview.properties.nested.truncated, true);
  assert.equal(
    consoleArgument({ type: "object", description: "Object" }).propertiesUnavailable,
    true,
  );
});

test("large complete DOM baselines fit dedicated snapshot budget and preserve unicode byte caps", async () => {
  const storage = memory();
  const store = createCaptureStore({ storage, now: () => 1100 });
  await store.start(
    {
      sourceTabId: 1,
      origin: "https://example.test",
      url: "https://example.test",
      projectId: "p",
    },
    {},
  );
  const text = "x".repeat(5 * 1024 * 1024);
  let s = await store.append(
    {
      type: "replay",
      data: {
        type: 2,
        timestamp: 1100,
        data: {
          node: { id: 1, type: 0, childNodes: [{ id: 2, type: 3, textContent: text }] },
        },
      },
    },
    1,
    "https://example.test",
  );
  assert.equal(s.active, true);
  assert.equal(
    s.recording.events[0].data.data.node.childNodes[0].textContent.length,
    text.length,
  );
  assert.ok(s.bytes < 6 * 1024 * 1024);
  const restored = await createCaptureStore({ storage }).read();
  assert.equal(
    restored.recording.events[0].data.data.node.childNodes[0].textContent.length,
    text.length,
  );
  s = await store.append(
    { type: "console", data: { args: [text] } },
    1,
    "https://example.test",
  );
  assert.equal(s.active, false, "diagnostic event still uses smaller cap");
});
test("stopped capture without full DOM baseline explicitly marks replay unavailable", async () => {
  const store = createCaptureStore({ storage: memory(), now: () => 1000 });
  await store.start(
    { sourceTabId: 1, origin: "https://example.test", url: "https://example.test" },
    {},
  );
  const s = await store.stop("Snapshot failed");
  assert.equal(
    s.recording.coverage.find((c) => c.channel === "replay").status,
    "unavailable",
  );
});

test("capture budget counts UTF-8 bytes for multibyte diagnostics", async () => {
  const store = createCaptureStore({ storage: memory(), now: () => 1000, maxBytes: 300 });
  await store.start(
    { sourceTabId: 1, origin: "https://example.test", url: "https://example.test" },
    {},
  );
  const s = await store.append(
    { type: "console", data: { args: ["😀".repeat(80)] } },
    1,
    "https://example.test",
  );
  assert.equal(s.active, false);
  assert.equal(s.recording.events.length, 0);
});

test("explicit redirect origins retain original recording project and reject unknown hosts", async () => {
  const { captureOrigins, originAllowed } = await import(
    "../extension/session/session-capture.js"
  );
  const allowed = captureOrigins(target.origin, ["https://dashboard.site.test"]);
  assert.deepEqual(allowed, [target.origin, "https://dashboard.site.test"]);
  assert.throws(() =>
    captureOrigins(target.origin, ["https://dashboard.site.test/private"]),
  );
  assert.throws(() =>
    captureOrigins(target.origin, ["https://user:pass@dashboard.site.test"]),
  );
  assert.equal(
    originAllowed({ ...target, allowedOrigins: allowed }, "https://evil.site.test"),
    false,
  );
  const store = createCaptureStore({ storage: memory(), now: () => 1000 });
  await store.start({ ...target, allowedOrigins: allowed }, privacy);
  await store.append(
    {
      type: "activity",
      data: { action: "navigation", url: "https://dashboard.site.test/article" },
    },
    1,
    "https://dashboard.site.test",
  );
  await store.append(
    { type: "console", data: { args: ["unknown-origin"] } },
    1,
    "https://evil.site.test",
  );
  const s = await store.read();
  assert.equal(s.recording.events.length, 1);
  assert.equal(s.target.projectId, target.projectId);
  assert.equal(s.recording.url, target.url);
});

test("capture caches loaded baseline without rereading storage per event and failed updates do not poison cache", async () => {
  const backing = memory();
  let reads = 0,
    fail = false;
  const storage = {
    get: async (k) => {
      reads++;
      return backing.get(k);
    },
    set: async (v) => {
      if (fail) throw Error("atomic failure");
      return backing.set(v);
    },
    remove: (k) => backing.remove(k),
  };
  const store = createCaptureStore({ storage, now: () => 1000 });
  await store.start(target, privacy);
  for (let i = 0; i < 10; i++)
    await store.append({ type: "console", data: { args: [i] } }, 1, target.origin);
  assert.equal(reads, 1);
  fail = true;
  await assert.rejects(
    store.update((s) => {
      s.target.projectId = "wrong";
    }),
  );
  fail = false;
  assert.equal((await store.read()).target.projectId, target.projectId);
  await store.discard();
  assert.equal(await store.read(), null);
});

test("video submission uses captured original target after redirect without rebinding to another recorder", async () => {
  const { capturedVideoTarget } = await import("../extension/session/session-capture.js");
  const original = { ...target, ownerTabId: 9, routeFingerprint: "bound" };
  const capture = {
    target: original,
    accountFingerprint: "account",
    recording: { mode: "video" },
  };
  assert.equal(
    capturedVideoTarget(capture, { ...target, routeFingerprint: "bound" }, 9, "account")
      .projectId,
    target.projectId,
  );
  assert.equal(capturedVideoTarget(capture, target, 8, "account"), null);
  assert.throws(() =>
    capturedVideoTarget(
      capture,
      { ...target, projectId: "dashboard", routeFingerprint: "bound" },
      9,
      "account",
    ),
  );
  assert.throws(() =>
    capturedVideoTarget(
      capture,
      { ...target, routeFingerprint: "bound" },
      9,
      "different-account",
    ),
  );
});

test("final stop may drain unacknowledged page events without duplicating already stored batches", async () => {
  const store = createCaptureStore({ storage: memory(), now: () => 1100 });
  await store.start(target, privacy);
  const event = {
    type: "activity",
    pageSeq: 1,
    data: { action: "input", value: "last typed" },
  };
  await store.append(event, 1, target.origin);
  await store.append(event, 1, target.origin);
  assert.equal((await store.read()).recording.events.length, 1);
  await store.update((s) => {
    s.lastPageSeq = 0;
  });
  await store.append(event, 1, target.origin);
  assert.equal(
    (await store.read()).recording.events.length,
    2,
    "new document sequences restart",
  );
});

test("wide DOM snapshots use the server node budget and fail honestly before truncation", async () => {
  const store = createCaptureStore({ storage: memory(), now: () => 1100 });
  await store.start(target, privacy);
  const node = {
    type: 0,
    id: 1,
    childNodes: Array.from({ length: 50001 }, (_, id) => ({
      type: 3,
      id: id + 2,
      textContent: "x",
    })),
  };
  await store.append(
    { type: "replay", data: { type: 2, timestamp: 1100, data: { node } } },
    1,
    target.origin,
  );
  let saved = await store.read();
  assert.equal(
    saved.recording.events[0].data.data.node.childNodes.length,
    50001,
    "valid wide DOM must not be silently truncated at 50000 children",
  );
  await store.append(
    {
      type: "replay",
      data: {
        type: 2,
        timestamp: 1100,
        data: {
          node: {
            type: 0,
            id: 1,
            childNodes: Array.from({ length: 125001 }, (_, id) => ({
              type: 3,
              id: id + 2,
              textContent: "x",
            })),
          },
        },
      },
    },
    1,
    target.origin,
  );
  saved = await store.read();
  assert.equal(saved.active, true);
  assert.equal(saved.recording.events.length, 1);
  assert.match(JSON.stringify(saved.recording.coverage), /node.*500000/i);
});

test("large DOM mutations retain diagnostics and replay exhaustion only freezes DOM", async () => {
  let now = 1000;
  const store = createCaptureStore({ storage: memory(), now: () => now });
  await store.start(target, privacy, "video");
  await store.append(
    { type: "replay", data: { type: 2, timestamp: now, data: { node: { id: 1 } } } },
    1,
    target.origin,
  );
  now = 1100;
  await store.append(
    {
      type: "replay",
      data: { type: 3, timestamp: now, data: { source: 0, text: "x".repeat(1300000) } },
    },
    1,
    target.origin,
  );
  let saved = await store.read();
  assert.equal(saved.active, true, "ordinary large mutation must not stop capture");
  assert.equal(saved.recording.events.length, 2);
  now = 1200;
  await store.append(
    {
      type: "replay",
      data: { type: 3, timestamp: now, data: { text: "x".repeat(7 * 1024 * 1024) } },
    },
    1,
    target.origin,
  );
  for (const type of ["activity", "console", "network"])
    await store.append(
      { type, data: { action: "after-large-dom", message: "still captured" } },
      1,
      target.origin,
    );
  saved = await store.read();
  assert.equal(saved.active, true);
  assert.equal(saved.recording.environment.replayStoppedAtMs, 200);
  assert.equal(saved.recording.events.length, 5);
  assert.match(
    saved.recording.coverage.find((c: any) => c.channel === "replay").detail,
    /limit|budget/i,
  );
  await store.append(
    { type: "replay", data: { type: 3, timestamp: now, data: {} } },
    1,
    target.origin,
  );
  assert.equal(
    (await store.read()).recording.events.length,
    5,
    "later mutations cannot apply to an incomplete DOM",
  );
});

test("video diagnostics stop never replaces the native recorder controls with ready", async () => {
  const { createSessionCoordinator } = await import(
    "../extension/session/session-coordinator.js"
  );
  const storage = memory();
  await createCaptureStore({ storage }).start(target, privacy, "video");
  const event = { addListener() {} };
  const notices: any[] = [];
  const chrome = {
    storage: { local: storage },
    debugger: { onEvent: event, onDetach: event },
    alarms: { onAlarm: event, clear: async () => {} },
    tabs: {
      onUpdated: event,
      onRemoved: event,
      get: async () => ({ id: 1, url: target.origin }),
      sendMessage: async (_: any, message: any) => {
        notices.push(message);
      },
    },
    scripting: { executeScript: async () => [{ result: [] }] },
  };
  const coordinator = createSessionCoordinator({
    captureStorage: storage,
    chrome,
    ready: Promise.resolve(),
    sessionFor: async () => target,
    authenticated: async () => {},
  });
  await coordinator.stop();
  assert.equal(
    notices.some((m) => m.type === "recordingState"),
    false,
  );
  const health = await coordinator.health();
  assert.equal(health.active, false);
  assert.equal(health.counts.activity, 0);
  assert.equal(
    health.recording,
    undefined,
    "health does not ship multi-megabyte replay data",
  );
});

test("DOM replay budget reserves space for later diagnostics", async () => {
  const store = createCaptureStore({
    storage: memory(),
    now: () => 1000,
    maxBytes: 12000,
    maxSnapshotBytes: 7000,
  });
  await store.start(target, privacy, "video");
  for (let n = 0; n < 2; n++)
    await store.append(
      {
        type: "replay",
        data: { type: 2, timestamp: 1000, data: { text: "x".repeat(5500) } },
      },
      1,
      target.origin,
    );
  await store.append(
    { type: "console", data: { args: ["error after replay budget"] } },
    1,
    target.origin,
  );
  const s = await store.read();
  assert.equal(s.active, true);
  assert.equal(s.replayDisabled, true);
  assert.equal(s.recording.events.length, 2);
  assert.equal(s.recording.events.at(-1).type, "console");
  assert.ok(s.bytes < 10000);
});

test("recording controls authorize approved redirects without granting another tab or review", async () => {
  const { createSessionCoordinator } = await import(
    "../extension/session/session-coordinator.js"
  );
  const { videoFingerprint } = await import("../extension/video/video-target.js");
  const storage = memory(),
    store = createCaptureStore({ storage });
  const scoped = { ...target, allowedOrigins: [target.origin, "https://redirect.test"] };
  await storage.set({
    server: target.server,
    accounts: { [target.server]: { token: "test-account" } },
    sessions: { 1: target },
  });
  await store.start(scoped, privacy, "video");
  await store.update(async (s: any) => {
    s.accountFingerprint = await videoFingerprint("test-account");
  });
  const event = { addListener() {} };
  const chrome = {
    storage: { local: storage },
    debugger: { onEvent: event, onDetach: event },
    alarms: { onAlarm: event },
    tabs: {
      onUpdated: event,
      onRemoved: event,
      get: async () => ({ id: 1, url: "https://redirect.test/next" }),
    },
  };
  const coordinator = createSessionCoordinator({
    captureStorage: storage,
    chrome,
    ready: Promise.resolve(),
    sessionFor: async () => target,
    authenticated: async () => {},
  });
  const sender = { tab: { id: 1 }, frameId: 0, url: "https://redirect.test/next" };
  const ctx = await coordinator.contextForControls(sender);
  assert.equal(ctx.target.projectId, target.projectId);
  assert.equal(ctx.target.reviewId, target.reviewId);
  assert.equal(ctx.mode, "video");
  assert.equal(ctx.recording, undefined);
  assert.equal(await coordinator.contextForControls({ ...sender, tab: { id: 2 } }), null);
  assert.equal(await coordinator.contextForControls({ ...sender, frameId: 1 }), null);
  assert.equal(
    await coordinator.contextForControls({ ...sender, url: "https://unknown.test" }),
    null,
  );
  await storage.set({ sessions: { 1: { ...target, reviewId: "changed" } } });
  assert.equal(await coordinator.contextForControls(sender), null);
  await storage.set({
    sessions: { 1: target },
    accounts: { [target.server]: { token: "changed-account" } },
  });
  await assert.rejects(coordinator.contextForControls(sender), /account changed/);
});
