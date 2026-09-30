import { assetPreview } from "../src/server/assets.js";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { Database } from "../src/server/db.js";
import { migrate } from "../src/server/migrations.js";
import { Operations } from "../src/server/operations.js";
import sharp from "sharp";
import { outputSchemas } from "../src/shared/contracts.js";
import { recordingSchema, redactRecording } from "../src/shared/recordings.js";
import { prepareRecording } from "../src/server/recordings.js";

const context = {
  url: "https://example.test/page",
  viewport: { width: 1000, height: 800 },
};
test("recording objects use the same private project prefix as video assets", () => {
  const projectId = randomUUID();
  const threadId = randomUUID();
  const prepared = prepareRecording({ threadId, recording: fixture() }, projectId, {
    production: true,
    organizationId: "company",
  } as any);
  assert.match(
    prepared.objectKey,
    new RegExp(
      `^feedbacks/production/organizations/company/projects/${projectId}/feedback/${threadId}/recordings/[a-f0-9-]+\\.json$`,
    ),
  );
});
function fixture(id = randomUUID()) {
  return {
    schemaVersion: 1,
    id,
    startedAt: new Date().toISOString(),
    durationMs: 100,
    mode: "session",
    url: "https://example.test/page?token=synthetic-secret",
    environment: { userAgent: "test", apiKey: "synthetic-secret" },
    privacy: { maskText: false, maskInputs: false, networkBodies: false },
    coverage: [{ channel: "replay", status: "complete" }],
    events: [
      {
        seq: 0,
        atMs: 0,
        type: "replay",
        data: {
          type: 2,
          timestamp: 1000,
          data: {
            node: {
              type: 2,
              tagName: "div",
              id: 77,
              attributes: { type: "password", value: "synthetic-secret" },
            },
          },
        },
      },
      {
        seq: 1,
        atMs: 10,
        type: "replay",
        data: {
          type: 3,
          timestamp: 1010,
          data: { source: 5, id: 77, text: "synthetic-secret" },
        },
      },
      {
        seq: 2,
        atMs: 20,
        type: "network",
        data: {
          headers: { authorization: "Bearer synthetic-secret" },
          url: "https://example.test/?api_key=synthetic-secret",
          requestBody: '{"password":"synthetic-secret"}',
        },
      },
    ],
  };
}
function wideSnapshot() {
  return {
    type: 2,
    timestamp: 1000,
    data: {
      node: {
        type: 2,
        id: 1,
        tagName: "main",
        attributes: {},
        childNodes: Array.from({ length: 12000 }, (_, index) => ({
          type: 2,
          id: index * 2 + 2,
          tagName: "article",
          attributes: { class: "result", role: "region" },
          childNodes: [
            { type: 3, id: index * 2 + 3, textContent: `Synthetic result ${index}` },
          ],
        })),
      },
      initialOffset: { top: 0, left: 0 },
    },
  };
}

test("large full DOM snapshots get a bounded allowance without enlarging diagnostic limits", () => {
  const snapshot = wideSnapshot();
  const recording = {
    ...fixture(),
    events: [{ seq: 0, atMs: 0, type: "replay", data: snapshot }],
  };
  const count = (value: unknown): number =>
    1 +
    (Array.isArray(value)
      ? value
      : value && typeof value === "object"
        ? Object.values(value)
        : []
    ).reduce((sum: number, child: unknown) => sum + count(child), 0);
  assert.ok(count(snapshot) > 100000 && count(snapshot) < 500000);
  assert.ok(Buffer.byteLength(JSON.stringify(snapshot)) < 6 * 1024 * 1024);
  assert.equal(recordingSchema.safeParse(recording).success, true);
  for (const type of ["console", "network", "activity", "performance"])
    assert.equal(
      recordingSchema.safeParse({
        ...recording,
        events: [{ ...recording.events[0], type }],
      }).success,
      false,
    );
  assert.equal(
    recordingSchema.safeParse({ ...recording, environment: snapshot }).success,
    false,
  );
  assert.equal(
    recordingSchema.safeParse({
      ...recording,
      events: [{ ...recording.events[0], data: { ...snapshot, type: 3 } }],
    }).success,
    false,
  );
  assert.equal(
    recordingSchema.safeParse({
      ...recording,
      events: [
        {
          ...recording.events[0],
          data: { ...snapshot, excessive: Array(500000).fill(0) },
        },
      ],
    }).success,
    false,
  );
  assert.equal(
    recordingSchema.safeParse({
      ...recording,
      environment: { text: "x".repeat(16 * 1024 * 1024) },
    }).success,
    false,
  );
});
test("recording schema enforces ordered bounded JSON and video linkage", () => {
  assert.equal(recordingSchema.safeParse(fixture()).success, true);
  assert.equal(
    recordingSchema.safeParse({
      ...fixture(),
      events: [{ seq: 1, atMs: 0, type: "replay", data: {} }],
    }).success,
    false,
  );
  assert.equal(recordingSchema.safeParse({ ...fixture(), mode: "video" }).success, false);
  assert.equal(
    recordingSchema.safeParse({ ...fixture(), environment: { bad: undefined } }).success,
    false,
  );
});

test("mandatory redaction preserves replay shape and optional network bodies", () => {
  const input = fixture();
  input.privacy.networkBodies = true;
  input.events[2].data = {
    message: "POST password=visible-secret token=another-secret",
    requestBody:
      '{"password":"json-secret","tokenCount":3,"nested":{"apiKey":"api-secret"}}',
    responseBody: '{"data":"safe","authorization":"Basic abcdef"}',
  };
  const redacted = redactRecording(input as any);
  assert.equal(redacted.events[1].data.data.id, 77);
  assert.equal(redacted.events[1].data.data.text, "[redacted]");
  assert.equal(JSON.parse(redacted.events[2].data.requestBody).tokenCount, 3);
  assert.ok(!JSON.stringify(redacted).includes("visible-secret"));
  assert.ok(!JSON.stringify(redacted).includes("another-secret"));
  assert.ok(!JSON.stringify(redacted).includes("json-secret"));
  assert.ok(!JSON.stringify(redacted).includes("api-secret"));
  assert.ok(!JSON.stringify(redacted).includes("abcdef"));
});

test("redaction follows sensitive rrweb inputs through snapshots and mutations", () => {
  const input = fixture();
  input.events = [
    {
      seq: 0,
      atMs: 0,
      type: "replay",
      data: {
        type: 2,
        timestamp: 1000,
        data: {
          node: {
            id: 91,
            type: 2,
            tagName: "input",
            attributes: { type: "text", name: "token", value: "snapshot-token-canary" },
          },
        },
      },
    },
    {
      seq: 1,
      atMs: 10,
      type: "replay",
      data: {
        type: 3,
        timestamp: 1010,
        data: {
          source: 0,
          adds: [
            {
              node: {
                id: 92,
                type: 2,
                tagName: "input",
                attributes: {
                  type: "text",
                  autocomplete: "one-time-code",
                  value: "mutation-code-canary",
                },
              },
            },
          ],
          attributes: [{ id: 91, attributes: { value: "updated-token-canary" } }],
        },
      },
    },
    {
      seq: 2,
      atMs: 20,
      type: "replay",
      data: {
        type: 3,
        timestamp: 1020,
        data: { source: 5, id: 92, text: "typed-code-canary" },
      },
    },
    {
      seq: 3,
      atMs: 30,
      type: "replay",
      data: {
        type: 3,
        timestamp: 1030,
        data: {
          source: 0,
          adds: [
            {
              node: {
                id: 93,
                type: 2,
                tagName: "input",
                attributes: { type: "text", name: "search", value: "allowed search" },
              },
            },
          ],
        },
      },
    },
  ];
  const redacted = redactRecording(input as any);
  const serialized = JSON.stringify(redacted);
  for (const canary of [
    "snapshot-token-canary",
    "mutation-code-canary",
    "updated-token-canary",
    "typed-code-canary",
  ])
    assert.ok(!serialized.includes(canary), `${canary} leaked`);
  assert.equal(redacted.events[0].data.data.node.attributes.value, "[redacted]");
  assert.equal(redacted.events[1].data.data.adds[0].node.attributes.value, "[redacted]");
  assert.equal(redacted.events[1].data.data.attributes[0].attributes.value, "[redacted]");
  assert.equal(redacted.events[2].data.data.text, "[redacted]");
  assert.equal(
    redacted.events[3].data.data.adds[0].node.attributes.value,
    "allowed search",
  );
  assert.equal(redacted.events[1].data.data.adds[0].node.id, 92);
});

test("recordings are private, immutable and removed with their thread", async () => {
  const pg = new PGlite(),
    db = new Database(pg as any),
    objects = new Map<string, Buffer>();
  const store = {
    put: async (key: string, bytes: Buffer) => {
      objects.set(key, bytes);
    },
    get: async (key: string) => objects.get(key)!,
    remove: async (key: string) => {
      objects.delete(key);
    },
  };
  try {
    await migrate(db);
    const ops = new Operations(db, store as any, {} as any);
    const owner = await ops.auth.bootstrap(
      "owner@example.test",
      "Owner",
      "Correct-Horse-Battery-123",
    );
    const p = await ops.executeOperation(owner, "projects.create", {
      name: "Recording",
      origins: ["https://example.test"],
    });
    const other = await ops.executeOperation(owner, "projects.create", {
      name: "Other",
      origins: ["https://example.test"],
    });
    const thread = await ops.executeOperation(owner, "threads.create", {
      projectId: p.id,
      body: "Check the form",
      context: { ...context, url: "https://example.test/page?token=thread-secret" },
      idempotencyKey: randomUUID(),
    });
    const outside = await ops.executeOperation(owner, "threads.create", {
      projectId: other.id,
      body: "Outside",
      context,
      idempotencyKey: randomUUID(),
    });
    const videoId = randomUUID();
    await db.query(
      "INSERT INTO assets(id,project_id,thread_id,object_key,data,status) VALUES($1,$2,$3,$4,$5,'validated')",
      [
        videoId,
        other.id,
        outside.id,
        "other/video",
        JSON.stringify({ contentType: "video/webm" }),
      ],
    );
    const recording = fixture();
    const input = {
      threadId: thread.id,
      revision: thread.revision,
      idempotencyKey: randomUUID(),
      recording,
    };
    await assert.rejects(
      ops.executeOperation(owner, "recordings.upload", {
        ...input,
        recording: {
          ...recording,
          mode: "video",
          video: { assetId: videoId, offsetMs: 0 },
        },
      }),
      { code: "VALIDATION" },
    );
    const uploaded = await ops.executeOperation(owner, "recordings.upload", input);
    const exported = await ops.executeOperation(owner, "recordings.export", {
      recordingId: recording.id,
    });
    assert.equal(exported.thread.revision, uploaded.thread.revision);
    assert.equal(uploaded.recording.id, recording.id);
    assert.deepEqual(uploaded.thread.recordingModes, ["session"]);
    const summaryList = await ops.executeOperation(owner, "threads.list", {
      projectId: p.id,
    });
    assert.deepEqual(
      summaryList.items.find((item: any) => item.id === thread.id).recordingModes,
      ["session"],
    );
    assert.deepEqual(
      (await ops.executeOperation(owner, "threads.get", { threadId: outside.id }))
        .recordingModes,
      [],
    );

    assert.equal(
      (await ops.executeOperation(owner, "recordings.list", { threadId: thread.id }))
        .items.length,
      1,
    );
    const read = await ops.executeOperation(owner, "recordings.get", {
      recordingId: recording.id,
    });
    assert.equal(read.recording.events.length, 3);
    assert.ok(!JSON.stringify(read).includes("synthetic-secret"));
    assert.equal(read.recording.events[2].data.requestBody, "[omitted]");
    assert.equal(
      (
        await ops.executeOperation(owner, "recordings.events", {
          recordingId: recording.id,
          type: "network",
          limit: 1,
        })
      ).items.length,
      1,
    );
    assert.equal(
      (
        await ops.executeOperation(owner, "recordings.export", {
          recordingId: recording.id,
        })
      ).thread.body,
      "Check the form",
    );
    assert.ok(
      !JSON.stringify(
        await ops.executeOperation(owner, "recordings.export", {
          recordingId: recording.id,
        }),
      ).includes("thread-secret"),
    );
    const oldKey = await ops.executeOperation(owner, "tokens.create", {
      name: "Old scope",
      projectIds: [p.id],
      scopes: ["threads.get"],
    });
    const oldAgent = await ops.auth.authenticate(oldKey.token);
    await assert.rejects(
      ops.executeOperation(oldAgent, "recordings.get", { recordingId: recording.id }),
      { code: "FORBIDDEN" },
    );
    const readKey = await ops.executeOperation(owner, "tokens.create", {
      name: "Recording read",
      projectIds: [p.id],
      scopes: ["recordings.get", "recordings.export"],
    });
    const readAgent = await ops.auth.authenticate(readKey.token);
    assert.equal(
      (
        await ops.executeOperation(readAgent, "recordings.get", {
          recordingId: recording.id,
        })
      ).recording.id,
      recording.id,
    );
    await assert.rejects(
      ops.executeOperation(readAgent, "recordings.export", { recordingId: recording.id }),
      { code: "FORBIDDEN" },
    );
    const videoIdSame = randomUUID();
    await db.query(
      "INSERT INTO assets(id,project_id,thread_id,object_key,data,status) VALUES($1,$2,$3,$4,$5,'validated')",
      [
        videoIdSame,
        p.id,
        thread.id,
        "same/video",
        JSON.stringify({ contentType: "video/webm" }),
      ],
    );
    const videoRecording = {
      ...fixture(),
      mode: "video",
      video: { assetId: videoIdSame, offsetMs: 0 },
    };
    const videoUploaded = await ops.executeOperation(owner, "recordings.upload", {
      threadId: thread.id,
      revision: uploaded.thread.revision,
      idempotencyKey: randomUUID(),
      recording: videoRecording,
    });
    assert.equal(videoUploaded.recording.video.assetId, videoIdSame);
    assert.deepEqual(videoUploaded.thread.recordingModes, ["session", "video"]);
    const repeated = await ops.executeOperation(owner, "recordings.upload", input);
    assert.equal(repeated.recording.id, recording.id);
    assert.equal(objects.size, 2);
    await assert.rejects(
      ops.executeOperation(owner, "recordings.upload", {
        ...input,
        recording: { ...recording, durationMs: 200 },
      }),
      { code: "IDEMPOTENCY_CONFLICT" },
    );
    const invite = await ops.executeOperation(owner, "members.invite", {
      email: "viewer@example.test",
      projectId: other.id,
      role: "viewer",
    });
    await ops.auth.acceptInvite(invite.token, "Viewer", "Correct-Horse-Battery-123");
    const viewer = (
      await ops.auth.login("viewer@example.test", "Correct-Horse-Battery-123")
    ).actor;
    await assert.rejects(
      ops.executeOperation(viewer, "recordings.get", { recordingId: recording.id }),
      { code: "FORBIDDEN" },
    );
    const deleted = await ops.executeOperation(owner, "threads.delete", {
      projectId: p.id,
      threads: [{ threadId: thread.id, revision: videoUploaded.thread.revision }],
      idempotencyKey: randomUUID(),
      confirmation: "DELETE",
    });
    assert.equal(deleted.cleanup.state, "complete");
    assert.equal(objects.size, 0);
    await assert.rejects(
      ops.executeOperation(owner, "recordings.get", { recordingId: recording.id }),
      { code: "NOT_FOUND" },
    );
  } finally {
    await pg.close();
  }
});

test("large cross-origin evidence roundtrips without changing the initial website or project authority", async () => {
  const pg = new PGlite();
  const db = new Database(pg as any);
  const objects = new Map<string, Buffer>();
  let reads = 0;
  const store = {
    put: async (key: string, bytes: Buffer) => objects.set(key, bytes),
    get: async (key: string) => {
      reads++;
      return objects.get(key)!;
    },
    remove: async (key: string) => objects.delete(key),
  };
  try {
    await migrate(db);
    const ops = new Operations(db, store as any, {} as any);
    const owner = await ops.auth.bootstrap(
      "owner@example.test",
      "Owner",
      "Correct-Horse-Battery-123",
    );
    const project = await ops.executeOperation(owner, "projects.create", {
      name: "Initial website",
      origins: ["https://example.test"],
    });
    const other = await ops.executeOperation(owner, "projects.create", {
      name: "Separate destination project",
      origins: ["https://redirect.example.test"],
    });
    const thread = await ops.executeOperation(owner, "threads.create", {
      projectId: project.id,
      body: "Follow the approved redirect",
      context,
      idempotencyKey: randomUUID(),
    });
    const recording = {
      ...fixture(),
      url: context.url,
      environment: {
        captureOrigins: ["https://example.test", "https://redirect.example.test"],
      },
      events: [
        {
          seq: 0,
          atMs: 0,
          type: "replay",
          data: {
            type: 4,
            timestamp: 1000,
            data: { href: context.url, width: 1000, height: 800 },
          },
        },
        {
          seq: 1,
          atMs: 10,
          type: "activity",
          data: {
            action: "navigate",
            url: "https://redirect.example.test/return?token=redirect-secret",
          },
        },
        {
          seq: 2,
          atMs: 20,
          type: "replay",
          data: {
            type: 4,
            timestamp: 1020,
            data: {
              href: "https://redirect.example.test/return",
              width: 1000,
              height: 800,
            },
          },
        },
        {
          seq: 3,
          atMs: 30,
          type: "network",
          data: {
            requestId: "second-origin",
            phase: "response",
            url: "https://redirect.example.test/api/result",
            status: 200,
            headers: { authorization: "Bearer redirect-secret" },
          },
        },
        { seq: 4, atMs: 40, type: "replay", data: wideSnapshot() },
      ],
    };
    const input = {
      threadId: thread.id,
      revision: thread.revision,
      idempotencyKey: randomUUID(),
      recording,
    };
    // An approved destination is evidence metadata, not authority to replace
    // the feedback's initial website or rebind its owning project.
    await assert.rejects(
      ops.executeOperation(owner, "recordings.upload", {
        ...input,
        recording: { ...recording, url: "https://redirect.example.test/return" },
      }),
      { code: "VALIDATION" },
    );
    assert.equal(objects.size, 0);
    const uploaded = await ops.executeOperation(owner, "recordings.upload", input);
    assert.equal(uploaded.recording.projectId, project.id);
    assert.equal(uploaded.recording.url, context.url);
    const read = await ops.executeOperation(owner, "recordings.get", {
      recordingId: recording.id,
    });
    assert.equal(outputSchemas["recordings.get"].safeParse(read).success, true);
    assert.deepEqual(
      read.recording.environment.captureOrigins.map((url: string) => new URL(url).origin),
      recording.environment.captureOrigins,
    );
    assert.equal(
      read.recording.events[2].data.data.href,
      "https://redirect.example.test/return",
    );
    assert.equal(
      read.recording.events[3].data.url,
      "https://redirect.example.test/api/result",
    );
    assert.ok(!JSON.stringify(read).includes("redirect-secret"));
    assert.equal(read.recording.events[4].data.data.node.childNodes.length, 12000);
    assert.equal(
      read.recording.events[4].data.data.node.childNodes[11999].childNodes[0].textContent,
      "Synthetic result 11999",
    );
    const page = await ops.executeOperation(owner, "recordings.events", {
      recordingId: recording.id,
      type: "network",
      fromMs: 20,
    });
    assert.deepEqual(page.items, [read.recording.events[3]]);
    const exported = await ops.executeOperation(owner, "recordings.export", {
      recordingId: recording.id,
    });
    assert.deepEqual(exported.recording, read.recording);
    assert.equal(exported.thread.projectId, project.id);
    assert.equal(exported.thread.context.url, context.url);
    const token = await ops.executeOperation(owner, "tokens.create", {
      name: "Destination project only",
      projectIds: [other.id],
      scopes: ["recordings.get", "recordings.events", "recordings.export", "threads.get"],
    });
    const outsider = await ops.auth.authenticate(token.token);
    const readsBefore = reads;
    for (const operation of ["recordings.get", "recordings.events", "recordings.export"])
      await assert.rejects(
        ops.executeOperation(outsider, operation, { recordingId: recording.id }),
        { code: "FORBIDDEN" },
      );
    await assert.rejects(ops.executeOperation(outsider, "recordings.upload", input), {
      code: "FORBIDDEN",
    });
    assert.equal(reads, readsBefore);
    assert.equal(objects.size, 1);
  } finally {
    await pg.close();
  }
});

test("recording schema preserves realistic nested DOM snapshots with a bounded maximum", () => {
  const nested = (levels: number) => {
    let node: any = { type: 3, id: 1, textContent: "Nested evidence" };
    for (let i = 0; i < levels; i++)
      node = { type: 2, id: i + 2, tagName: "div", attributes: {}, childNodes: [node] };
    return node;
  };
  const input = fixture();
  input.events = [
    {
      seq: 0,
      atMs: 0,
      type: "replay",
      data: { type: 2, timestamp: 1000, data: { node: nested(70) } },
    },
  ] as any;
  assert.equal(recordingSchema.safeParse(input).success, true);
  assert.match(
    JSON.stringify(redactRecording(recordingSchema.parse(input))),
    /Nested evidence/,
  );
  (input.events[0].data as any).data.node = nested(140);
  assert.equal(recordingSchema.safeParse(input).success, false);
});

test("recording frames preserve authorized source time, reject rebinding and export only matching images", async () => {
  const pg = new PGlite(),
    db = new Database(pg as any),
    objects = new Map<string, Buffer>();
  const store = {
    put: async (key: string, bytes: Buffer) => {
      objects.set(key, bytes);
    },
    get: async (key: string) => objects.get(key)!,
    remove: async (key: string) => {
      objects.delete(key);
    },
  };
  try {
    await migrate(db);
    const ops = new Operations(
      db,
      store as any,
      { organizationId: "synthetic", production: false } as any,
    );
    const owner = await ops.auth.bootstrap(
      "frames@example.test",
      "Owner",
      "Correct-Horse-Battery-123",
    );
    const project = await ops.executeOperation(owner, "projects.create", {
      name: "Frames",
      origins: ["https://example.test"],
    });
    let thread = await ops.executeOperation(owner, "threads.create", {
      projectId: project.id,
      body: "Click evidence",
      context,
      idempotencyKey: randomUUID(),
    });
    const other = await ops.executeOperation(owner, "threads.create", {
      projectId: project.id,
      body: "Other thread",
      context,
      idempotencyKey: randomUUID(),
    });
    const videoId = randomUUID();
    await db.query(
      "INSERT INTO assets(id,project_id,thread_id,object_key,data,status) VALUES($1,$2,$3,$4,$5,'validated')",
      [
        videoId,
        project.id,
        thread.id,
        "frames/video",
        JSON.stringify({
          contentType: "video/webm",
          durationMs: 5000,
          captureId: randomUUID(),
          rendition: "tabVideo",
          bytes: 500,
          createdAt: new Date().toISOString(),
        }),
      ],
    );
    const linear = {
      ...fixture(),
      events: [],
      durationMs: 6000,
      mode: "video",
      video: { assetId: videoId, offsetMs: -500 },
    };
    const segmented = {
      ...linear,
      id: randomUUID(),
      video: {
        assetId: videoId,
        offsetMs: -500,
        segments: [
          { sourceStartMs: 500, sourceEndMs: 2500, outputStartMs: 0 },
          { sourceStartMs: 4000, sourceEndMs: 6000, outputStartMs: 2000 },
        ],
      },
    };
    const sessionOnly = { ...fixture(), events: [], durationMs: 6000 };
    const segmentOverrun = {
      ...segmented,
      id: randomUUID(),
      video: {
        ...segmented.video,
        segments: [{ sourceStartMs: 4000, sourceEndMs: 6000, outputStartMs: 4000 }],
      },
    };
    for (const recording of [linear, segmented, sessionOnly, segmentOverrun])
      thread = (
        await ops.executeOperation(owner, "recordings.upload", {
          threadId: thread.id,
          revision: thread.revision,
          recording,
          idempotencyKey: randomUUID(),
        })
      ).thread;
    const imageBase64 = (
      await sharp({ create: { width: 2, height: 2, channels: 3, background: "red" } })
        .png()
        .toBuffer()
    ).toString("base64");
    const upload = (recordingFrame: any, overrides: any = {}) =>
      ops.executeOperation(owner, "assets.upload", {
        threadId: thread.id,
        revision: thread.revision,
        imageBase64,
        filename: "recording-frame.webp",
        recordingFrame,
        idempotencyKey: randomUUID(),
        ...overrides,
      });
    // Missing validation previously accepted this as an ordinary screenshot.
    await assert.rejects(
      upload({ recordingId: linear.id, atMs: 1000, videoTimeMs: 1000 }),
      { code: "VALIDATION" },
    );
    await assert.rejects(upload({ recordingId: linear.id, atMs: 100, videoTimeMs: 0 }), {
      code: "VALIDATION",
    });
    await assert.rejects(
      upload({ recordingId: linear.id, atMs: 6001, videoTimeMs: 5000 }),
      { code: "VALIDATION" },
    );
    // The decode tolerance must not turn a source moment beyond the video into its last frame.
    await assert.rejects(
      upload({ recordingId: linear.id, atMs: 5600, videoTimeMs: 5000 }),
      { code: "VALIDATION" },
    );
    await assert.rejects(
      upload({ recordingId: segmentOverrun.id, atMs: 5100, videoTimeMs: 5000 }),
      { code: "VALIDATION" },
    );
    await assert.rejects(
      upload({ recordingId: segmented.id, atMs: 3000, videoTimeMs: 2000 }),
      { code: "VALIDATION" },
    );
    await assert.rejects(
      upload(
        { recordingId: linear.id, atMs: 1000, videoTimeMs: 500 },
        { threadId: other.id, revision: other.revision },
      ),
      { code: "VALIDATION" },
    );
    await assert.rejects(
      upload({ recordingId: randomUUID(), atMs: 1000, videoTimeMs: 500 }),
      { code: "VALIDATION" },
    );
    await assert.rejects(
      upload({ recordingId: sessionOnly.id, atMs: 1000, videoTimeMs: 1000 }),
      { code: "VALIDATION" },
    );
    await assert.rejects(upload({ recordingId: linear.id, atMs: 1000 }), {
      code: "VALIDATION",
    });
    await assert.rejects(upload({ recordingId: sessionOnly.id, atMs: 6001 }), {
      code: "VALIDATION",
    });
    const sessionFrame = {
      recordingId: sessionOnly.id,
      atMs: 1000,
      annotationId: randomUUID(),
    };
    const sessionImage = await upload(sessionFrame);
    thread = sessionImage.thread;
    assert.deepEqual(sessionImage.asset.recordingFrame, sessionFrame);
    assert.deepEqual(
      (
        await ops.executeOperation(owner, "recordings.export", {
          recordingId: sessionOnly.id,
        })
      ).thread.frames[0].recordingFrame,
      sessionFrame,
    );
    const frame = { recordingId: linear.id, atMs: 1000, videoTimeMs: 650 };
    const retryInput = { idempotencyKey: randomUUID(), revision: thread.revision };
    const uploaded = await upload(frame, retryInput);
    thread = uploaded.thread;
    const retried = await upload(frame, retryInput);
    assert.equal(retried.asset.id, uploaded.asset.id);
    await assert.rejects(upload({ ...frame, atMs: 1100 }, retryInput), {
      code: "IDEMPOTENCY_CONFLICT",
    });
    assert.deepEqual(uploaded.asset.recordingFrame, frame);
    assert.deepEqual(
      outputSchemas["assets.upload"].parse(uploaded).asset.recordingFrame,
      frame,
    );
    const read = await ops.executeOperation(owner, "assets.get", {
      assetId: uploaded.asset.id,
    });
    assert.deepEqual(read.recordingFrame, frame);
    const second = await upload({
      recordingId: segmented.id,
      atMs: 4500,
      videoTimeMs: 2500,
    });
    thread = second.thread;
    const ordinary = await upload(undefined);
    thread = ordinary.thread;
    assert.equal(ordinary.asset.recordingFrame, undefined);
    const exported = await ops.executeOperation(owner, "recordings.export", {
      recordingId: linear.id,
    });
    assert.deepEqual(exported.thread.frames, [
      {
        id: uploaded.asset.id,
        contentType: "image/webp",
        filename: "recording-frame.webp",
        recordingFrame: frame,
      },
    ]);
    assert.equal(exported.thread.framesTruncated, false);
    assert.equal(
      outputSchemas["recordings.export"].parse(exported).thread.frames.length,
      1,
    );
    // Bounded export is independent of how many linked screenshots already exist.
    for (let n = 0; n < 100; n++)
      await db.query(
        "INSERT INTO assets(id,project_id,thread_id,object_key,data,status) VALUES($1,$2,$3,$4,$5,'validated')",
        [
          randomUUID(),
          project.id,
          thread.id,
          `frames/extra-${n}`,
          JSON.stringify({ contentType: "image/webp", recordingFrame: frame }),
        ],
      );
    const bounded = await ops.executeOperation(owner, "recordings.export", {
      recordingId: linear.id,
    });
    assert.equal(bounded.thread.frames.length, 100);
    assert.equal(bounded.thread.framesTruncated, true);
    await db.query("DELETE FROM assets WHERE id=$1", [videoId]);
    await assert.rejects(
      upload({ recordingId: linear.id, atMs: 1000, videoTimeMs: 500 }),
      { code: "VALIDATION" },
    );
  } finally {
    await pg.close();
  }
});

test("a teammate can turn a saved frame into a point and revise its marks without duplicate evidence", async () => {
  const pg = new PGlite();
  const db = new Database(pg as any);
  const objects = new Map<string, Buffer>();
  const store = {
    put: async (key: string, bytes: Buffer) => void objects.set(key, bytes),
    get: async (key: string) => objects.get(key)!,
    remove: async (key: string) => void objects.delete(key),
  };
  try {
    await migrate(db);
    const ops = new Operations(
      db,
      store as any,
      { organizationId: "synthetic", production: false } as any,
    );
    const owner = await ops.auth.bootstrap(
      "markup@example.test",
      "Owner",
      "Correct-Horse-Battery-123",
    );
    const project = await ops.executeOperation(owner, "projects.create", {
      name: "Markup",
      origins: ["https://example.test"],
    });
    let thread = await ops.executeOperation(owner, "threads.create", {
      projectId: project.id,
      body: "Frame point",
      context,
      idempotencyKey: randomUUID(),
    });
    const recording = { ...fixture(), events: [], durationMs: 3000 };
    thread = (
      await ops.executeOperation(owner, "recordings.upload", {
        threadId: thread.id,
        revision: thread.revision,
        recording,
        idempotencyKey: randomUUID(),
      })
    ).thread;
    const imageBase64 = (
      await sharp({
        create: { width: 320, height: 180, channels: 3, background: "blue" },
      })
        .png()
        .toBuffer()
    ).toString("base64");
    const raw = await ops.executeOperation(owner, "assets.upload", {
      threadId: thread.id,
      revision: thread.revision,
      imageBase64,
      recordingFrame: { recordingId: recording.id, atMs: 1200 },
      rendition: "screenshot",
      idempotencyKey: randomUUID(),
    });
    thread = raw.thread;
    const otherThread = await ops.executeOperation(owner, "threads.create", {
      projectId: project.id,
      body: "Another feedback thread",
      context,
      idempotencyKey: randomUUID(),
    });
    await assert.rejects(
      ops.executeOperation(owner, "assets.upload", {
        threadId: otherThread.id,
        revision: otherThread.revision,
        replacesAssetId: raw.asset.id,
        imageBase64,
        markup: [
          {
            tool: "pencil",
            points: [
              { x: 0.2, y: 0.2 },
              { x: 0.8, y: 0.8 },
            ],
          },
        ],
        idempotencyKey: randomUUID(),
      }),
      { code: "VALIDATION" },
    );
    const pointId = randomUUID();
    const annotatedInput = {
      rendition: "screenshot",
      threadId: thread.id,
      revision: thread.revision,
      replacesAssetId: raw.asset.id,
      imageBase64,
      point: { id: pointId, body: "Make the target larger", x: 0.4, y: 0.6 },
      markup: [
        {
          tool: "ellipse",
          points: [
            { x: 0.3, y: 0.4 },
            { x: 0.7, y: 0.8 },
          ],
        },
      ],
      idempotencyKey: randomUUID(),
    };
    const annotated = await ops.executeOperation(owner, "assets.upload", annotatedInput);
    thread = annotated.thread;
    assert.deepEqual(
      thread.context.annotations.map((point: any) => point.id),
      [pointId],
    );
    assert.deepEqual(
      thread.assets.map((asset: any) => asset.id),
      [annotated.asset.id],
    );
    assert.equal(annotated.asset.baseAssetId, raw.asset.id);
    assert.equal(annotated.asset.recordingFrame.annotationId, pointId);
    assert.equal(annotated.asset.markings[0].annotationId, pointId);
    const marked = await ops.executeOperation(owner, "assets.get", {
      assetId: annotated.asset.id,
      includeImage: true,
    });
    const assetKey = (
      await db.one("SELECT object_key FROM assets WHERE id=$1", [annotated.asset.id])
    ).object_key;
    const expected = await assetPreview(store, assetKey, 1600, undefined, [
      { ...annotated.asset.markings[0], number: 1 },
    ]);
    assert.equal(marked.image.marked, true);
    assert.equal(
      marked.image.data,
      expected.data,
      "saved-frame pin uses its thread point number",
    );
    const unmarked = await ops.executeOperation(owner, "assets.get", {
      assetId: annotated.asset.id,
      includeImage: true,
      showAnnotations: false,
    });
    assert.equal(unmarked.image.marked, undefined);
    assert.notEqual(unmarked.image.data, marked.image.data);

    assert.equal(
      (await ops.executeOperation(owner, "assets.upload", annotatedInput)).asset.id,
      annotated.asset.id,
    );
    await assert.rejects(
      ops.executeOperation(owner, "assets.upload", {
        ...annotatedInput,
        revision: thread.revision,
        idempotencyKey: randomUUID(),
      }),
      { code: "VALIDATION" },
    );
    const revised = await ops.executeOperation(owner, "assets.upload", {
      threadId: thread.id,
      revision: thread.revision,
      replacesAssetId: annotated.asset.id,
      imageBase64,
      markup: [
        {
          tool: "pencil",
          points: [
            { x: 0.2, y: 0.2 },
            { x: 0.8, y: 0.8 },
          ],
        },
      ],
      idempotencyKey: randomUUID(),
    });
    assert.equal(revised.asset.baseAssetId, raw.asset.id);
    assert.equal(revised.thread.context.annotations.length, 1);
    assert.deepEqual(
      revised.thread.assets.map((asset: any) => asset.id),
      [revised.asset.id],
    );
    const exported = await ops.executeOperation(owner, "recordings.export", {
      recordingId: recording.id,
    });
    assert.deepEqual(
      exported.thread.frames.map((frame: any) => frame.id),
      [revised.asset.id],
    );
    assert.equal(
      (await ops.executeOperation(owner, "assets.get", { assetId: raw.asset.id })).id,
      raw.asset.id,
    );
  } finally {
    await pg.close();
  }
});
