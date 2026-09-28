import test from "node:test";
import assert from "node:assert/strict";
import {
  reviewState,
  eventLabel,
  sourceToVideo,
  videoToSource,
  safeReplay,
} from "../extension/session-review.js";
test("review state excludes future network phases and honors console clear", () => {
  const events = [
    {
      seq: 0,
      atMs: 10,
      type: "network",
      data: { requestId: "a", phase: "request", url: "/a", method: "GET" },
    },
    { seq: 1, atMs: 20, type: "console", data: { level: "error", args: ["bad"] } },
    {
      seq: 2,
      atMs: 30,
      type: "network",
      data: { requestId: "a", phase: "response", status: 500, responseBody: "future" },
    },
    { seq: 3, atMs: 40, type: "console", data: { level: "clear" } },
  ];
  const early = reviewState(events, 25);
  assert.equal(early.network[0].data.status, undefined);
  assert.equal(early.network[0].data.responseBody, undefined);
  assert.equal(early.console.length, 1);
  assert.equal(reviewState(events, 45).console.length, 0);
  assert.equal(reviewState(events, 35).network[0].data.status, 500);
});
test("review shows clicked control, location, input privacy and typed text", () => {
  assert.match(
    eventLabel({
      type: "activity",
      data: { action: "click", label: "Save", x: 12, y: 34, button: 0 },
    }),
    /Save.*12.*34/,
  );
  assert.match(
    eventLabel({
      type: "activity",
      data: { action: "input", target: { label: "Search" }, valueMasked: true },
    }),
    /Search.*masked/,
  );
  assert.match(
    eventLabel({
      type: "activity",
      data: { action: "input", target: { name: "query" }, value: "hello" },
    }),
    /query.*hello/,
  );
});
test("edited video mapping uses source intervals and rejects pauses", () => {
  const video = {
    offsetMs: -50,
    segments: [
      { sourceStartMs: 400, sourceEndMs: 800, outputStartMs: 0 },
      { sourceStartMs: 1100, sourceEndMs: 1500, outputStartMs: 400 },
    ],
  };
  assert.equal(sourceToVideo(500, video), 100);
  assert.equal(sourceToVideo(900, video), null);
  assert.equal(videoToSource(400, video), 1100);
});
test("replay copy blocks active elements and resource attributes without changing capture", () => {
  const event = {
    type: 2,
    data: {
      node: {
        tagName: "script",
        attributes: { src: "https://example.test/x", onclick: "bad()" },
        childNodes: [],
      },
    },
  };
  const safe = safeReplay(event);
  assert.equal(safe.data.node.tagName, "div");
  assert.equal(safe.data.node.attributes.src, "data:,");
  assert.equal(safe.data.node.attributes.onclick, undefined);
  assert.equal(event.data.node.tagName, "script");
});

test("queued frame retry preserves dispatched revision/key after recording committed", async () => {
  const { uploadReviewFrames } = await import("../extension/session-review.js");
  const frames: any[] = [
    {
      atMs: 100,
      videoTimeMs: 80,
      imageBase64: "data:image/png;base64,eA==",
      key: "frame-key-1",
    },
    {
      atMs: 200,
      videoTimeMs: 180,
      imageBase64: "data:image/png;base64,eA==",
      key: "frame-key-2",
    },
  ];
  const calls: any[] = [];
  let fail = true;
  const upload = async (input: any) => {
    calls.push(structuredClone(input));
    if (input.idempotencyKey === "frame-key-2" && fail) throw Error("response lost");
    return { thread: { id: "thread", revision: input.revision + 1 } };
  };
  await assert.rejects(() =>
    uploadReviewFrames(frames, { id: "thread", revision: 3 }, "recording", upload),
  );
  fail = false;
  const thread = await uploadReviewFrames(
    frames,
    { id: "thread", revision: 3 },
    "recording",
    upload,
  );
  assert.equal(thread.revision, 5);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[1], calls[2]);
  assert.equal(calls[1].revision, 4);
  assert.equal(calls[0].recordingFrame.recordingId, "recording");
});

test("explicit frame revision conflict refreshes only rejected request; ambiguous failures keep it", async () => {
  const { uploadReviewFrames } = await import("../extension/session-review.js");
  const frames: any[] = [
    { atMs: 100, videoTimeMs: 80, imageBase64: "png", key: "original-key" },
  ];
  const inputs: any[] = [];
  let refreshes = 0;
  const result = await uploadReviewFrames(
    frames,
    { id: "t", revision: 3 },
    "r",
    async (input: any) => {
      inputs.push(structuredClone(input));
      if (inputs.length === 1)
        throw Object.assign(Error("changed"), { code: "CONFLICT" });
      return { thread: { id: "t", revision: 8 } };
    },
    async () => {
      refreshes++;
      return { id: "t", revision: 7 };
    },
  );
  assert.equal(result.revision, 8);
  assert.equal(refreshes, 1);
  assert.equal(inputs[1].revision, 7);
  assert.notEqual(inputs[1].idempotencyKey, inputs[0].idempotencyKey);
  assert.deepEqual(inputs[1].recordingFrame, inputs[0].recordingFrame);
});
test("expanding an applied trim to full recording restores original alignment", async () => {
  const { videoTrimState } = await import("../extension/session-review.js");
  assert.deepEqual(videoTrimState(5, 10, 15000, 1), {
    appliedTrim: { start: 5000, end: 10000 },
    debugAligned: false,
  });
  assert.deepEqual(videoTrimState(0, 15, 15000, 1), {
    appliedTrim: null,
    debugAligned: true,
  });
  assert.equal(videoTrimState(0, 15, 15000, 2).debugAligned, false);
});
test("network exchange identity keeps request-less resource phases separate", async () => {
  const { networkKey } = await import("../extension/session-review.js");
  assert.notEqual(networkKey({ seq: 1, data: {} }), networkKey({ seq: 2, data: {} }));
  assert.equal(
    networkKey({ seq: 1, data: { requestId: "a" } }),
    networkKey({ seq: 2, data: { requestId: "a" } }),
  );
});

test("annotation frames keep exact identity while trim mapping omits removed moments", async () => {
  const { mapAnnotationFrames } = await import("../extension/session-review.js");
  const items = [
    { id: "one", atMs: 1000, body: "First comment", imageBase64: "image" },
    { id: "two", atMs: 1000, body: "Second comment", imageBase64: "image" },
    { id: "removed", atMs: 2000, body: "Removed", imageBase64: "image" },
  ];
  const mapped = mapAnnotationFrames(
    items,
    { segments: [{ sourceStartMs: 500, sourceEndMs: 1500, outputStartMs: 0 }] },
    1000,
  );
  assert.deepEqual(
    mapped.map((frame: any) => [
      frame.annotationId,
      frame.atMs,
      frame.videoTimeMs,
      frame.key,
    ]),
    [
      ["one", 1000, 500, "annotation-one"],
      ["two", 1000, 500, "annotation-two"],
    ],
  );
  assert.equal(mapAnnotationFrames(items)[0].videoTimeMs, undefined);
  assert.match(
    eventLabel({
      type: "activity",
      data: { action: "annotation", body: "Change this heading" },
    }),
    /Change this heading/,
  );
});

test("loading activity names its phase and destination", () => {
  assert.equal(
    eventLabel({
      type: "activity",
      data: {
        action: "loading",
        phase: "DOMContentLoaded",
        url: "https://example.test/next",
      },
    }),
    "Loading: DOMContentLoaded · https://example.test/next",
  );
});

test("annotation upload retains association and exact input after an ambiguous failure", async () => {
  const { mapAnnotationFrames, uploadReviewFrames } = await import(
    "../extension/session-review.js"
  );
  const frames = mapAnnotationFrames([
    { id: "annotation", atMs: 100, body: "Comment", imageBase64: "image" },
  ]);
  const inputs: any[] = [];
  const upload = async (input: any) => {
    inputs.push(structuredClone(input));
    if (inputs.length === 1) throw Error("Response lost");
    return { thread: { id: "thread", revision: 2 } };
  };
  await assert.rejects(
    uploadReviewFrames(frames, { id: "thread", revision: 1 }, "recording", upload),
  );
  await uploadReviewFrames(frames, { id: "thread", revision: 1 }, "recording", upload);
  assert.deepEqual(inputs[0], inputs[1]);
  assert.deepEqual(inputs[1].recordingFrame, {
    recordingId: "recording",
    atMs: 100,
    annotationId: "annotation",
  });
});
