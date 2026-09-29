import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import { createRawDiagnosticCapture } from "../extension/diagnostics/raw-debug.js";
import { createSessionCoordinator } from "../extension/session/session-coordinator.js";
import { DIAGNOSTIC_CHUNK_BYTES } from "../src/shared/screenshot-diagnostics.js";

function harness({
  recordingAttached = false,
  attachFails = false,
  bodyFails = false,
  workerFails = false,
  workerEnableFails = false,
} = {}) {
  const saved = new Map<string, Uint8Array>();
  const commands: { method: string; params: any; sessionId?: string }[] = [];
  let listener:
    | ((method: string, params: any, at: number, sessionId?: string) => Promise<void>)
    | null = null;
  let attached = recordingAttached;
  let detachCount = 0;
  const source = {
    isAttached: async () => attached,
    attach: async () => {
      if (attachFails) throw new Error("debugger unavailable");
      attached = true;
    },
    detach: async () => {
      attached = false;
      detachCount++;
    },
    subscribeRawDebugger: (_tabId: number, next: typeof listener) => {
      listener = next;
      return () => {
        listener = null;
      };
    },
    sendCommand: async (
      _tabId: number,
      method: string,
      params: any = {},
      sessionId?: string,
    ) => {
      commands.push({ method, params, sessionId });
      if (method === "Target.setAutoAttach" && workerFails)
        throw new Error("worker denied");
      if (method === "Network.enable" && sessionId && workerEnableFails)
        throw new Error("worker network denied");
      if (method === "Network.getRequestPostData")
        return { postData: '{"password":"fake-pass"}' };
      if (method === "Network.getResponseBody") {
        if (bodyFails) throw new Error("body evicted");
        return {
          body: Buffer.from([0xff, 0x00, 0x41]).toString("base64"),
          base64Encoded: true,
        };
      }
      return {};
    },
  };
  const store = {
    putEvidenceChunk: async (
      evidenceId: string,
      fileId: string,
      sequence: number,
      bytes: Uint8Array,
    ) => {
      assert.equal(evidenceId, "evidence-1");
      assert.ok(bytes.byteLength <= DIAGNOSTIC_CHUNK_BYTES);
      saved.set(`${fileId}:${sequence}`, bytes.slice());
      return {
        sequence,
        byteLength: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      };
    },
    putEvidenceState: async () => {},
  };
  const read = (file: { fileId: string; chunks: { sequence: number }[] }) =>
    Buffer.concat(
      file.chunks.map((part) =>
        Buffer.from(saved.get(`${file.fileId}:${part.sequence}`)!),
      ),
    );
  return {
    source,
    store,
    read,
    commands,
    get listener() {
      return listener;
    },
    get detachCount() {
      return detachCount;
    },
  };
}

test("raw CDP events retain credentials, ordering, binary body and a 2 MiB chunk ceiling", async () => {
  const h = harness();
  const capture = createRawDiagnosticCapture({
    tabId: 5,
    evidenceId: "evidence-1",
    sourceOrigin: "https://example.test",
    store: h.store,
    debuggerSource: h.source,
  });
  await capture.start();
  assert.equal(
    h.commands.find((item) => item.method === "Network.enable")?.params
      .maxTotalBufferSize,
    268435456,
  );
  assert.equal(
    h.commands.find((item) => item.method === "Network.enable")?.params
      .maxResourceBufferSize,
    67108864,
  );
  const deliver = (method: string, params: any, at: number) =>
    h.listener!(method, params, at);
  await deliver(
    "Network.requestWillBeSent",
    {
      requestId: "r1",
      request: {
        url: "https://example.test/api?token=fake",
        method: "POST",
        headers: { Cookie: "sid=fake-cookie", Authorization: "Bearer fake-token" },
        hasPostData: true,
      },
    },
    10,
  );
  await deliver(
    "Network.responseReceived",
    {
      requestId: "r1",
      response: {
        url: "https://example.test/api",
        status: 200,
        headers: { "Set-Cookie": "sid=fake-response" },
        mimeType: "application/octet-stream",
      },
    },
    11,
  );
  await deliver(
    "Runtime.consoleAPICalled",
    {
      type: "error",
      args: [
        {
          type: "object",
          preview: {
            properties: [{ name: "password", value: "fake-console-pass" }],
          },
        },
      ],
      stackTrace: {
        callFrames: [
          { functionName: "submit", url: "https://example.test/app.js", lineNumber: 5 },
        ],
      },
    },
    12,
  );
  await deliver(
    "Network.webSocketFrameReceived",
    { requestId: "ws1", response: { payloadData: "fake-frame" } },
    13,
  );
  await deliver("Network.loadingFinished", { requestId: "r1", encodedDataLength: 3 }, 14);
  const result = await capture.stop();
  const network = result.files.find((file: any) => file.kind === "network")!;
  const consoleFile = result.files.find((file: any) => file.kind === "console")!;
  const bodies = result.files.filter((file: any) => file.kind === "body");
  const networkText = h.read(network).toString("utf8");
  assert.equal(
    network.sha256,
    createHash("sha256").update(h.read(network)).digest("hex"),
  );
  assert.ok(networkText.includes("sid=fake-cookie"));
  assert.ok(networkText.includes("Bearer fake-token"));
  assert.ok(networkText.includes("fake-frame"));
  assert.ok(
    bodies.some((item: any) => h.read(item).toString("utf8").includes("fake-pass")),
  );
  assert.ok(
    networkText.indexOf("Network.requestWillBeSent") <
      networkText.indexOf("Network.loadingFinished"),
  );
  assert.ok(h.read(consoleFile).toString("utf8").includes("fake-console-pass"));
  assert.ok(
    bodies.some((item: any) => h.read(item).equals(Buffer.from([0xff, 0x00, 0x41]))),
  );
  assert.deepEqual(result.stats, {
    consoleCount: 1,
    errorCount: 1,
    httpRequestCount: 1,
    responseCount: 1,
    responseBodyCount: 1,
  });
  assert.equal(h.detachCount, 1);
});

test("screenshot collector borrows a recording debugger and preserves unavailable coverage", async () => {
  const h = harness({ recordingAttached: true, bodyFails: true, workerFails: true });
  const capture = createRawDiagnosticCapture({
    tabId: 5,
    evidenceId: "evidence-1",
    sourceOrigin: "https://example.test",
    store: h.store,
    debuggerSource: h.source,
  });
  await capture.start();
  await h.listener!("Network.loadingFinished", { requestId: "missing" }, 30);
  const result = await capture.stop();
  assert.equal(h.detachCount, 0);
  assert.equal(result.coverage.body.status, "partial");
  assert.ok(result.coverage.body.reasons.includes("body_unavailable"));
  assert.ok(result.coverage.network.reasons.includes("worker_attach_unavailable"));
});

test("attached worker events retain their session and retrieve bodies from that session", async () => {
  const h = harness();
  const capture = createRawDiagnosticCapture({
    tabId: 5,
    evidenceId: "evidence-1",
    sourceOrigin: "https://example.test",
    store: h.store,
    debuggerSource: h.source,
  });
  await capture.start();
  await h.listener!(
    "Network.loadingFinished",
    { requestId: "worker-r1" },
    31,
    "worker-session-1",
  );
  const result = await capture.stop();
  assert.equal(
    h.commands.find((item) => item.method === "Network.getResponseBody")?.sessionId,
    "worker-session-1",
  );
  const network = h
    .read(result.files.find((item: any) => item.kind === "network")!)
    .toString("utf8");
  assert.ok(network.includes('"sessionId":"worker-session-1"'));
});

test("attached workers enable their own protocol session and report failed domains", async () => {
  const h = harness({ workerEnableFails: true });
  const capture = createRawDiagnosticCapture({
    tabId: 5,
    evidenceId: "evidence-1",
    sourceOrigin: "https://example.test",
    store: h.store,
    debuggerSource: h.source,
  });
  await capture.start();
  await h.listener!(
    "Target.attachedToTarget",
    { sessionId: "worker-1", targetInfo: { type: "worker" } },
    40,
  );
  const result = await capture.stop();
  assert.deepEqual(
    h.commands.filter((item) => item.sessionId === "worker-1").map((item) => item.method),
    ["Network.enable", "Runtime.enable", "Log.enable"],
  );
  assert.equal(result.coverage.network.status, "partial");
  assert.ok(result.coverage.network.reasons.includes("worker_enable_failed"));
});

test("attach failure and leaving the approved origin keep earlier bytes with explicit gaps", async () => {
  const denied = harness({ attachFails: true });
  const failed = createRawDiagnosticCapture({
    tabId: 6,
    evidenceId: "evidence-1",
    sourceOrigin: "https://example.test",
    store: denied.store,
    debuggerSource: denied.source,
  });
  const unavailable = await failed.start();
  assert.equal(unavailable.coverage.network.status, "unavailable");
  assert.ok(unavailable.coverage.network.reasons.includes("debugger_attach_failed"));
  const h = harness();
  const capture = createRawDiagnosticCapture({
    tabId: 5,
    evidenceId: "evidence-1",
    sourceOrigin: "https://example.test",
    store: h.store,
    debuggerSource: h.source,
  });
  await capture.start();
  await h.listener!(
    "Runtime.consoleAPICalled",
    { type: "warn", args: [{ value: "before navigation" }] },
    1,
  );
  await h.listener!(
    "Page.frameNavigated",
    { frame: { id: "main", url: "https://outside.test/" } },
    2,
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(h.detachCount, 1);
  const stopped = await capture.stop();
  assert.equal(stopped.coverage.network.status, "partial");
  assert.ok(stopped.coverage.network.reasons.includes("origin_changed"));
  assert.ok(
    h
      .read(stopped.files.find((file: any) => file.kind === "console")!)
      .toString("utf8")
      .includes("before navigation"),
  );
});

test("recording coordinator taps unmasked debugger events before its recording projection", async () => {
  let onEvent: any;
  const event = { addListener() {} };
  const coordinator = createSessionCoordinator({
    chrome: {
      debugger: {
        onEvent: {
          addListener(listener: any) {
            onEvent = listener;
          },
        },
        onDetach: event,
      },
      alarms: { onAlarm: event },
      tabs: { onUpdated: event, onRemoved: event },
    },
    captureStorage: {
      get: async () => ({}),
      set: async () => {},
      remove: async () => {},
    },
    ready: Promise.resolve(),
    sessionFor: async () => {},
    authenticated: async () => {},
  } as any);
  const values: string[] = [];
  const unsubscribe = coordinator.subscribeRawDebugger(
    5,
    async (_method: string, params: any) => {
      values.push(params.request.headers.Authorization);
    },
  );
  onEvent({ tabId: 5 }, "Network.requestWillBeSent", {
    request: { headers: { Authorization: "Bearer fake-token" } },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(values, ["Bearer fake-token"]);
  unsubscribe();
  onEvent({ tabId: 5 }, "Network.requestWillBeSent", {
    request: { headers: { Authorization: "Bearer later" } },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(values, ["Bearer fake-token"]);
});
