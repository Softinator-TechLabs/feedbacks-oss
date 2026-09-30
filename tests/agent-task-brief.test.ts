import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { runAgentTool } from "../src/shared/agent-workflow.js";
const id = randomUUID(),
  projectId = randomUUID(),
  pointId = randomUUID();
const base = () => ({
  id,
  projectId,
  revision: 3,
  body: "Change Save to Submit",
  archived: false,
  context: { url: "https://example.test/form", annotations: [] },
  work: { state: "open", history: [] },
  response: { state: "unanswered" },
  replies: [],
  assets: [],
  externalIssues: [],
  fixEvidence: [],
});
function executor(thread: any, calls: Array<{ op: string; input: any }>) {
  return async (op: string, input: any) => {
    calls.push({ op, input });
    if (op === "auth.me")
      return {
        actor: { id: "agent", userId: "member" },
        member: { id: "member", name: "Developer" },
        credential: {
          operationScopes: [
            "threads.get",
            "instructions.get",
            "assignments.list",
            "assignments.delegations",
            "assets.get",
            "assignments.claim",
            "threads.status",
          ],
        },
        projects: [],
      };
    if (op === "threads.get") return thread;
    if (op === "instructions.get") return { items: [], revision: 1 };
    if (op === "assignments.list" || op === "assignments.delegations")
      return { items: [], total: 0, nextOffset: null };
    if (op === "assets.get")
      return {
        id: input.assetId,
        image: {
          data: "synthetic-pixels",
          mimeType: "image/png",
          width: 800,
          height: 600,
        },
      };
    throw Error(`Unneeded operation: ${op}`);
  };
}
test("text-only start carries the problem and omits empty evidence inventories", async () => {
  const calls: Array<{ op: string; input: any }> = [];
  const r = await runAgentTool(executor(base(), calls), "start", { threadId: id });
  assert.equal(r.task.body, "Change Save to Submit");
  for (const key of [
    "discussion",
    "media",
    "diagnosticEvidence",
    "approvedInstructions",
    "snapshot",
  ])
    assert.equal(r[key], undefined, key);
  assert.equal(r.task.points, undefined);
  assert.equal(r.task.counts, undefined);
  assert.equal(r.coordination.verified, true);
  assert.ok(JSON.stringify(r).length < 1800);
  assert.ok(calls.every((c) => !/recording|diagnostic|assets|profile/.test(c.op)));
});
test("one start returns the point's relevant image, never every attachment", async () => {
  const f: any = base();
  const unrelated = randomUUID(),
    original = randomUUID();
  f.context.annotations = [
    { id: pointId, body: "Change this label", anchor: { selector: "#save" } },
  ];
  f.assets = [
    { id: unrelated, contentType: "image/webp", rendition: "thumbnail" },
    {
      id: original,
      contentType: "image/webp",
      rendition: "screenshot",
      markings: [{ annotationId: pointId }],
    },
  ];
  const calls: Array<{ op: string; input: any }> = [];
  const r = await runAgentTool(executor(f, calls), "start", {
    threadId: id,
    includeImage: true,
  });
  assert.equal(r.image.data, "synthetic-pixels");
  assert.equal(r.media.assetId, original);
  assert.equal(r.task.points[0].id, pointId);
  assert.deepEqual(
    calls.filter((c) => c.op === "assets.get").map((c) => c.input.assetId),
    [original],
  );
});
test("video issue starts with its saved timestamped frame without exporting video or logs", async () => {
  const f: any = base();
  const videoId = randomUUID(),
    frameId = randomUUID(),
    recordingId = randomUUID();
  f.context.annotations = [{ id: pointId, body: "Save fails here", anchor: {} }];
  f.assets = [
    { id: videoId, contentType: "video/webm", durationMs: 120000 },
    {
      id: frameId,
      contentType: "image/webp",
      recordingFrame: { recordingId, atMs: 1200, annotationId: pointId },
    },
  ];
  const calls: Array<{ op: string; input: any }> = [];
  const r = await runAgentTool(executor(f, calls), "start", {
    threadId: id,
    includeImage: true,
  });
  assert.equal(r.media.assetId, frameId);
  assert.equal(r.media.atMs, 1200);
  assert.equal(r.media.playbackVerified, false);
  assert.ok(
    calls.every(
      (c) => !c.op.startsWith("recordings.") && !c.op.startsWith("diagnostics."),
    ),
  );
});
test("video without a frame supplies a focused media action without inventing playback", async () => {
  const f: any = base();
  f.assets = [{ id: randomUUID(), contentType: "video/webm", durationMs: 120000 }];
  const calls: Array<{ op: string; input: any }> = [];
  const r = await runAgentTool(executor(f, calls), "start", {
    threadId: id,
    includeImage: true,
  });
  assert.equal(r.image, undefined);
  assert.equal(r.media.kind, "video");
  assert.equal(r.media.playbackVerified, false);
  assert.equal(r.media.read.tool, "feedbacks_asset");
  assert.ok(calls.every((c) => c.op !== "assets.get"));
});
test("known-empty overview has no discussion, diagnostic or history suggestions", async () => {
  const r = await runAgentTool(async () => base(), "thread", { threadId: id });
  assert.equal(r.diagnosticEvidence, undefined);
  assert.ok(!r.sections.includes("discussion"));
  assert.ok(!r.sections.includes("history"));
  assert.ok(!r.sections.includes("diagnostics"));
  assert.ok(!r.sections.includes("assets"));
});

test("denied image access stays explicit and never reads storage anyway", async () => {
  const f: any = base();
  f.assets = [{ id: randomUUID(), contentType: "image/webp", rendition: "screenshot" }];
  const calls: Array<{ op: string; input: any }> = [];
  const execute = executor(f, calls);
  const r = await runAgentTool(
    async (op, input) => {
      const result = await execute(op, input);
      if (op === "auth.me")
        result.credential.operationScopes = result.credential.operationScopes.filter(
          (s: string) => s !== "assets.get",
        );
      return result;
    },
    "start",
    { threadId: id, includeImage: true },
  );
  assert.equal(r.image, undefined);
  assert.equal(r.media.access.status, "missing_scope");
  assert.ok(!calls.some((c) => c.op === "assets.get"));
});

test("continuation is executable and retains the correct revision/content cursor", async () => {
  const f = base();
  f.body = "long task ".repeat(100);
  const first = await runAgentTool(async () => f, "thread", {
    threadId: id,
    section: "body",
    textLimit: 256,
  });
  assert.equal(first.next.tool, "feedbacks_thread");
  const second = await runAgentTool(async () => f, "thread", first.next.input);
  assert.equal(first.next.input.expectedContentVersion, first.contentVersion);
  assert.equal(second.textOffset, 256);
  assert.equal(first.text + second.text, f.body.slice(0, 512));
});

test("start suggests an authorized claim; a successful claim gives the exact status step", async () => {
  const calls: Array<{ op: string; input: any }> = [];
  const r = await runAgentTool(executor(base(), calls), "start", { threadId: id });
  assert.equal(r.next.input.operation, "assignments.claim");
  assert.match(r.next.when, /authorized/);
  assert.ok(calls.every((c) => !c.op.endsWith("claim") && !c.op.endsWith("status")));
  const claim = await runAgentTool(
    async (op, input: any) => {
      assert.equal(op, "assignments.claim");
      assert.equal(input.threadId, id);
      return { id: randomUUID(), state: "active", revision: 1 };
    },
    "execute",
    r.next.input,
  );
  assert.equal(claim.next.input.operation, "threads.status");
  const status = await runAgentTool(
    async (op, input: any) => {
      assert.equal(op, "threads.status");
      assert.equal(input.revision, 3);
      return { ...base(), revision: 4, work: { state: input.state } };
    },
    "execute",
    claim.next.input,
  );
  assert.equal(status.work.state, "in_progress");
});

test("text-only start does not suggest fetching image pixels", async () => {
  const f: any = base();
  f.assets = [{ id: randomUUID(), contentType: "image/webp", rendition: "screenshot" }];
  const calls: Array<{ op: string; input: any }> = [];
  const r = await runAgentTool(executor(f, calls), "start", {
    threadId: id,
    includeImage: false,
  });
  assert.notEqual(r.next.tool, "feedbacks_asset");
  assert.ok(!calls.some((c) => c.op === "assets.get"));
});
test("selected second point gets its own screenshot and claim scope", async () => {
  const f: any = base(),
    second = randomUUID(),
    image1 = randomUUID(),
    image2 = randomUUID();
  f.context.annotations = [
    { id: pointId, body: "First", anchor: {} },
    { id: second, body: "Second", anchor: {} },
  ];
  f.assets = [
    { id: image1, contentType: "image/webp", markings: [{ annotationId: pointId }] },
    { id: image2, contentType: "image/webp", markings: [{ annotationId: second }] },
  ];
  const calls: Array<{ op: string; input: any }> = [];
  const r = await runAgentTool(executor(f, calls), "start", {
    threadId: id,
    includeImage: true,
    annotationIds: [second],
  });
  assert.equal(r.media.assetId, image2);
  assert.equal(r.media.annotationId, second);
  assert.equal(r.task.points[0].number, 2);
  assert.deepEqual(
    r.task.points.map((p: any) => p.id),
    [second],
  );
  assert.deepEqual(r.next.input.input.annotationIds, [second]);
  assert.deepEqual(
    calls.filter((c) => c.op === "assets.get").map((c) => c.input.assetId),
    [image2],
  );
});
test("own matching point claim resumes without claiming the whole thread", async () => {
  const f: any = base();
  f.work.state = "in_progress";
  f.context.annotations = [{ id: pointId, body: "First", anchor: {} }];
  const calls: Array<{ op: string; input: any }> = [],
    execute = executor(f, calls);
  const r = await runAgentTool(
    async (op, input) =>
      op === "assignments.list"
        ? {
            items: [
              {
                id: randomUUID(),
                agentId: "agent",
                annotationIds: [pointId],
                state: "active",
                revision: 1,
              },
            ],
            total: 1,
            nextOffset: null,
          }
        : execute(op, input),
    "start",
    { threadId: id, annotationIds: [pointId] },
  );
  assert.equal(r.next.step, "implement");
  assert.equal(r.next.tool, undefined);
});

test("claims on other points do not block the selected point", async () => {
  const f: any = base(),
    other = randomUUID();
  f.context.annotations = [
    { id: pointId, body: "Selected", anchor: {} },
    { id: other, body: "Other", anchor: {} },
  ];
  const calls: Array<{ op: string; input: any }> = [],
    execute = executor(f, calls);
  const r = await runAgentTool(
    async (op, input) =>
      op === "assignments.list" || op === "assignments.delegations"
        ? {
            items: [
              {
                id: randomUUID(),
                agentId: "other-agent",
                userId: "other-member",
                annotationIds: [other],
                state: "active",
                revision: 1,
              },
            ],
            total: 1,
            nextOffset: null,
          }
        : execute(op, input),
    "start",
    { threadId: id, annotationIds: [pointId] },
  );
  assert.equal(r.next.input.operation, "assignments.claim");
  assert.deepEqual(r.next.input.input.annotationIds, [pointId]);
});

test("own claim on an open task supplies the status step after a restart", async () => {
  const calls: Array<{ op: string; input: any }> = [],
    execute = executor(base(), calls);
  const r = await runAgentTool(
    async (op, input) =>
      op === "assignments.list"
        ? {
            items: [
              {
                id: randomUUID(),
                agentId: "agent",
                annotationIds: [],
                state: "active",
                revision: 1,
              },
            ],
            total: 1,
            nextOffset: null,
          }
        : execute(op, input),
    "start",
    { threadId: id },
  );
  assert.equal(r.next.input.operation, "threads.status");
  assert.equal(r.next.input.input.revision, 3);
  assert.equal(r.next.input.input.state, "in_progress");
});

test("mixed open and closed points narrow the next start instead of suggesting an invalid claim", async () => {
  const f: any = base(),
    closedId = randomUUID();
  f.context.annotations = [
    { id: pointId, body: "Open", anchor: {} },
    { id: closedId, body: "Closed", anchor: {} },
  ];
  f.annotationStates = { [closedId]: { state: "resolved" } };
  const calls: Array<{ op: string; input: any }> = [];
  const r = await runAgentTool(executor(f, calls), "start", {
    threadId: id,
    annotationIds: [pointId, closedId],
    includeImage: true,
  });
  assert.equal(r.next.tool, "feedbacks_start");
  assert.deepEqual(r.next.input.annotationIds, [pointId]);
  const next = await runAgentTool(executor(f, calls), "start", r.next.input);
  assert.deepEqual(next.next.input.input.annotationIds, [pointId]);
});

test("start carries short text replacements and requires a points read for long copy", async () => {
  const thread: any = base();
  thread.context.annotations = [
    {
      id: pointId,
      body: "Suggested text edit",
      anchor: {},
      textEdit: { original: "Old page copy", replacement: "", rects: [] },
    },
  ];
  const calls: Array<{ op: string; input: any }> = [];
  const short = await runAgentTool(executor(thread, calls), "start", { threadId: id });
  assert.deepEqual(short.task.points[0].textEdit, {
    original: "Old page copy",
    replacement: "",
  });
  assert.equal(short.task.incomplete, undefined);
  thread.context.annotations[0].textEdit.replacement = "Long replacement ".repeat(50);
  const long = await runAgentTool(executor(thread, calls), "start", { threadId: id });
  assert.ok(long.task.incomplete.includes("points"));
  assert.equal(long.task.points[0].textEdit.replacement.length, 240);
  assert.equal(long.next.tool, "feedbacks_thread");
  assert.equal(long.next.input.section, "points");
});
