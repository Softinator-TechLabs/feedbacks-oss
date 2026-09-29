import test from "node:test";
import assert from "node:assert/strict";
import {
  entriesAt,
  entriesThrough,
  consoleAt,
  formatRecordingTime,
  mapRecordingToVideoTime,
  mapVideoToRecordingTime,
  networkExchanges,
  prepareReplayEvents,
} from "../src/web/recordings/model.js";

test("diagnostic rows remain ordered and seek to their recorded time", () => {
  const entries = [
    { seq: 4, atMs: 2500, type: "network", data: { url: "/a" } },
    { seq: 2, atMs: 1000, type: "console", data: { message: "first" } },
    { seq: 3, atMs: 1000, type: "network", data: { url: "/b" } },
  ];
  assert.deepEqual(
    entriesAt(entries, "network").map((entry) => entry.seq),
    [3, 4],
  );
  assert.deepEqual(
    entriesAt(entries, "network", 1100).map((entry) => entry.seq),
    [4],
  );
  assert.equal(formatRecordingTime(61234), "1:01.2");
});

test("edited video timeline uses segment mapping and marks removed gaps", () => {
  const video = {
    assetId: "asset",
    offsetMs: 100,
    segments: [
      { sourceStartMs: 0, sourceEndMs: 2000, outputStartMs: 0 },
      { sourceStartMs: 4000, sourceEndMs: 6000, outputStartMs: 2000 },
    ],
  };
  assert.equal(mapRecordingToVideoTime(4500, video), 2500);
  assert.equal(mapRecordingToVideoTime(3000, video), null);
  assert.equal(mapVideoToRecordingTime(2500, video), 4500);
  assert.equal(
    mapVideoToRecordingTime(2000, video),
    4000,
    "adjoining edited segments use the later source frame",
  );
  assert.equal(mapRecordingToVideoTime(1000, { assetId: "asset", offsetMs: 100 }), 1100);
  assert.equal(mapRecordingToVideoTime(100, { assetId: "asset", offsetMs: -500 }), null);
});

test("network phases form one inspectable request and response", () => {
  const exchanges = networkExchanges([
    {
      seq: 2,
      atMs: 130,
      type: "network",
      data: {
        requestId: "r1",
        phase: "response",
        status: 403,
        responseHeaders: { "content-type": "application/json" },
        responseBody: "denied",
      },
    },
    {
      seq: 1,
      atMs: 100,
      type: "network",
      data: {
        requestId: "r1",
        phase: "request",
        method: "POST",
        url: "https://example.test/api",
        requestHeaders: { accept: "*/*" },
        requestBody: "{}",
      },
    },
  ]);
  assert.equal(exchanges.length, 1);
  assert.deepEqual(exchanges[0]?.phases, ["request", "response"]);
  assert.equal(exchanges[0]?.status, 403);
  assert.equal(exchanges[0]?.requestBody, "{}");
  assert.equal(exchanges[0]?.responseBody, "denied");
});

test("playhead view hides future events and console history before clear", () => {
  const entries = [
    {
      seq: 0,
      atMs: 100,
      type: "console" as const,
      data: { level: "log", args: ["old"] },
    },
    { seq: 1, atMs: 200, type: "console" as const, data: { level: "clear" } },
    {
      seq: 2,
      atMs: 300,
      type: "console" as const,
      data: { level: "warn", args: ["now"] },
    },
    {
      seq: 3,
      atMs: 900,
      type: "console" as const,
      data: { level: "error", args: ["future"] },
    },
  ];
  assert.deepEqual(
    entriesThrough(entries, "console", 150).map((event) => event.seq),
    [0],
  );
  assert.deepEqual(
    consoleAt(entries, 250).map((event) => event.seq),
    [],
  );
  assert.deepEqual(
    consoleAt(entries, 350).map((event) => event.seq),
    [2],
  );
  assert.deepEqual(
    entriesAt(entries, "console").map((event) => event.seq),
    [0, 1, 2, 3],
  );
});

test("network details contain only phases reached by the playhead", () => {
  const events = [
    {
      seq: 0,
      atMs: 100,
      type: "network" as const,
      data: {
        requestId: "a",
        phase: "request",
        method: "POST",
        url: "/api",
        requestBody: "sent",
      },
    },
    {
      seq: 1,
      atMs: 900,
      type: "network" as const,
      data: { requestId: "a", phase: "response", status: 200, responseBody: "future" },
    },
  ];
  const atRequest = networkExchanges(events, 100)[0];
  assert.equal(atRequest?.requestBody, "sent");
  assert.equal(atRequest?.status, undefined);
  assert.equal(atRequest?.responseBody, undefined);
  assert.equal(networkExchanges(events, 99).length, 0);
  assert.equal(networkExchanges(events, 900)[0]?.responseBody, "future");
});

test("replay preserves event timestamps but removes resource URLs and executable nodes", () => {
  const events = prepareReplayEvents([
    {
      seq: 1,
      atMs: 0,
      type: "replay",
      data: {
        type: 2,
        timestamp: 1700000000000,
        data: {
          node: {
            type: 0,
            childNodes: [
              {
                type: 2,
                tagName: "link",
                attributes: {
                  rel: "stylesheet",
                  href: "https://private.example/style.css",
                },
              },
              {
                type: 2,
                tagName: "img",
                attributes: { src: "https://private.example/pixel" },
              },
              {
                type: 2,
                tagName: "style",
                attributes: {},
                childNodes: [
                  {
                    type: 3,
                    textContent:
                      "@import 'https://private.example/a.css'; .x{background:url(https://private.example/x)} .y{background:image-set('/api/private' 1x)}",
                  },
                ],
              },
            ],
          },
        },
      },
    },
  ]);
  assert.equal(events[0]?.timestamp, 1700000000000);
  assert.doesNotMatch(JSON.stringify(events), /private\.example/);
  assert.doesNotMatch(JSON.stringify(events), /api\/private/);
  assert.equal(
    ((events[0]?.data as any).node.childNodes[1].attributes as any).src,
    "data:,",
  );
});
test("screenshot comments associate by annotation identity even at the same timestamp", async () => {
  const { recordingAnnotation } = await import("../src/web/recordings/model.js");
  const events: any[] = [
    {
      seq: 0,
      type: "activity",
      atMs: 100,
      data: { action: "annotation", annotationId: "a", body: "First" },
    },
    {
      seq: 1,
      type: "activity",
      atMs: 100,
      data: { action: "annotation", annotationId: "b", body: "Second" },
    },
  ];
  assert.equal(
    recordingAnnotation(events, { annotationId: "b", atMs: 100 })?.body,
    "Second",
  );
  assert.equal(recordingAnnotation(events, { annotationId: "missing", atMs: 100 }), null);
  assert.equal(recordingAnnotation(events, { annotationId: "a", atMs: 200 }), null);
  assert.equal(recordingAnnotation(events, { atMs: 100 }), null);
});
