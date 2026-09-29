import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { runAgentTool, agentToolSchemas } from "../src/shared/agent-workflow.js";

const projectId = randomUUID(),
  threadId = randomUUID(),
  annotationId = randomUUID();
const thread: any = {
  id: threadId,
  projectId,
  revision: 4,
  body: "Requested change ".repeat(1000),
  trust: "untrusted_discussion",
  author: { name: "Reviewer" },
  context: {
    url: "https://example.test/pricing",
    annotations: [
      { id: annotationId, body: "Fix price", anchor: { selector: "#price" } },
    ],
  },
  annotationStates: {},
  work: { state: "open", history: [] },
  response: { state: "unanswered" },
  topPriority: true,
  externalIssues: [],
  fixEvidence: [],
  replies: Array.from({ length: 51 }, (_, n) => ({
    id: randomUUID(),
    body: `Reply ${n}`,
    author: { name: `Person ${n}` },
    likes: { uniqueLikes: 2 },
  })),
  assets: [
    {
      id: randomUUID(),
      filename: "point-001-original.webp",
      markings: [{ annotationId }],
      contentType: "image/webp",
    },
  ],
};

test("workspace matches SSH remotes against connected repositories; ambiguous and weak matches stay explicit", async () => {
  const projects = [
    {
      id: projectId,
      name: "A",
      origins: ["https://example.test"],
      repositoryUrl: "https://github.com/acme/app",
      githubRepositories: [],
      permissions: {},
    },
    {
      id: randomUUID(),
      name: "B",
      origins: [],
      repositoryUrl: null,
      githubRepositories: ["https://github.com/acme/app"],
      permissions: {},
    },
    { id: randomUUID(), name: "app", origins: [], repositoryUrl: null, permissions: {} },
  ];
  const execute = async (name: string) => {
    assert.equal(name, "projects.list");
    return { items: projects };
  };
  const result = await runAgentTool(execute, "workspace", {
    repositoryUrls: ["git@github.com:acme/app.git"],
    directoryName: "app",
  });
  assert.equal(result.matchStatus, "ambiguous");
  assert.equal(result.items.length, 3);
  assert.equal(result.items[0].match, "repository");
  assert.equal(result.items[2].match, "name_hint");
  assert.equal(result.selectedProjectId, null);
  const origin = await runAgentTool(execute, "workspace", {
    pageUrl: "https://example.test/pricing?secret=redacted",
  });
  assert.equal(origin.selectedProjectId, projectId);
  assert.ok(!JSON.stringify(origin).includes("secret="));
});

test("queue keeps filters and server order, bounds previews and omits full discussions", async () => {
  const result = await runAgentTool(
    async (name, input: any) => {
      assert.equal(name, "threads.list");
      assert.equal(input.limit, 10);
      assert.equal(input.search, "price");
      return { items: [thread], total: 500, nextOffset: 10 };
    },
    "queue",
    { projectId, search: "price" },
  );
  assert.equal(result.total, 500);
  assert.equal(result.nextOffset, 10);
  assert.equal(result.items[0].replies, 51);
  assert.equal(result.items[0].topPriority, true);
  assert.ok(result.items[0].preview.length <= 240);
  assert.equal(result.items[0].body, undefined);
  assert.ok(JSON.stringify(result).length < 2500);
});

test("compact queue and overview preserve human priority and persisted planning dates", async () => {
  const workPlan = {
    priority: "high",
    schedule: "tomorrow",
    scheduledFor: "2026-10-01",
    timeZone: "Asia/Kolkata",
  };
  const planned = { ...thread, workPlan };
  const later = {
    ...thread,
    id: randomUUID(),
    workPlan: { ...workPlan, priority: "low", schedule: "later", scheduledFor: null },
  };
  const queue = await runAgentTool(
    async () => ({ items: [planned, later, thread], total: 3, nextOffset: null }),
    "queue",
    { projectId },
  );
  assert.deepEqual(queue.items[0].workPlan, workPlan);
  assert.deepEqual(queue.items[1].workPlan, later.workPlan);
  assert.equal(
    queue.items[1].id,
    later.id,
    "compact previews retain server planning order",
  );
  assert.equal(
    queue.items[2].workPlan,
    undefined,
    "legacy plans do not invent a timezone",
  );
  const overview = await runAgentTool(async () => planned, "thread", { threadId });
  assert.deepEqual(overview.workPlan, workPlan);
  assert.equal(overview.revision, planned.revision);
  assert.ok(!JSON.stringify(overview).includes("Reply 0"));
});

test("an explicit plan mutation returns its saved date and revision in the compact receipt", async () => {
  const workPlan = {
    priority: "normal",
    schedule: "next_week",
    scheduledFor: "2026-10-05",
    timeZone: "America/New_York",
  };
  const result = await runAgentTool(
    async (operation, input: any) => {
      assert.equal(operation, "threads.plan");
      assert.equal(input.threadId, threadId);
      assert.equal(input.revision, thread.revision);
      assert.deepEqual(input.workPlan, workPlan);
      return { ...thread, revision: 5, workPlan };
    },
    "execute",
    { operation: "threads.plan", input: { threadId, revision: 4, workPlan } },
  );
  assert.equal(result.revision, 5);
  assert.deepEqual(result.workPlan, workPlan);
  assert.equal(result.operation, "threads.plan");
  assert.equal(result.readback, "feedbacks_thread");
  assert.equal(result.replies, undefined);
});

test("assigned queue filters and local planning date reach the server on every bounded page", async () => {
  const userId = randomUUID();
  const input = {
    projectId,
    assignedTo: userId,
    planningDate: "2026-09-30",
    sort: "workPlan",
    workState: "open",
    includeSummary: true,
    limit: 10,
  };
  let calls = 0;
  const execute = async (operation: string, filters: any) => {
    calls++;
    assert.equal(operation, "threads.list");
    for (const [key, value] of Object.entries(input)) assert.equal(filters[key], value);
    assert.equal(filters.offset, calls === 1 ? 0 : 10);
    return {
      items: [thread],
      total: 11,
      nextOffset: calls === 1 ? 10 : null,
      summary: { threads: { open: 11 } },
    };
  };
  const first = await runAgentTool(execute, "queue", input);
  const second = await runAgentTool(execute, "queue", {
    ...input,
    offset: first.nextOffset,
  });
  assert.equal(calls, 2);
  assert.equal(first.sort, "workPlan");
  assert.equal(first.assignedTo, userId);
  assert.equal(first.planningDate, input.planningDate);
  assert.equal(second.nextOffset, null);
  assert.deepEqual(first.summary, { threads: { open: 11 } });
});

test("explicit thread moves validate the destination and return a compact project readback receipt", async () => {
  const destinationId = randomUUID();
  const workPlan = {
    priority: "high",
    schedule: "later",
    scheduledFor: null,
    timeZone: "Asia/Kolkata",
  };
  let calls = 0;
  const execute = async (operation: string, input: any) => {
    calls++;
    assert.equal(operation, "threads.move");
    assert.deepEqual(input, { threadId, revision: 4, projectId: destinationId });
    return { ...thread, projectId: destinationId, revision: 5, workPlan };
  };
  await assert.rejects(
    runAgentTool(execute, "execute", {
      operation: "threads.move",
      input: { threadId, revision: 4 },
    }),
    { code: "VALIDATION" },
  );
  assert.equal(calls, 0);
  const result = await runAgentTool(execute, "execute", {
    operation: "threads.move",
    input: { threadId, revision: 4, projectId: destinationId },
  });
  assert.equal(calls, 1, "the adapter does not perform extra setup or access changes");
  assert.equal(result.id, threadId);
  assert.equal(result.projectId, destinationId);
  assert.equal(result.revision, 5);
  assert.deepEqual(result.workPlan, workPlan);
  assert.equal(result.operation, "threads.move");
  assert.equal(result.readback, "feedbacks_thread");
  assert.equal(result.assets, undefined);
  assert.equal(result.replies, undefined);
});

test("thread pages expose current revision, complete continuations and precise point state", async () => {
  const execute = async () => thread;
  const first = await runAgentTool(execute, "thread", {
    threadId,
    section: "discussion",
    limit: 10,
  });
  const next = await runAgentTool(execute, "thread", {
    threadId,
    section: "discussion",
    offset: first.nextOffset,
    expectedRevision: 4,
    expectedContentVersion: first.contentVersion,
    limit: 10,
  });
  assert.equal(first.items[0].body, "Reply 0");
  assert.equal(next.items[0].body, "Reply 10");
  assert.equal(first.total, 51);
  assert.equal(first.revision, 4);
  await assert.rejects(
    runAgentTool(execute, "thread", { threadId, section: "discussion", offset: 10 }),
    { code: "REVISION_REQUIRED" },
  );
  await assert.rejects(
    runAgentTool(execute, "thread", {
      threadId,
      section: "discussion",
      expectedRevision: 3,
    }),
    { code: "CONFLICT" },
  );
  const points = await runAgentTool(execute, "thread", { threadId, section: "points" });
  assert.equal(points.items[0].id, annotationId);
  assert.equal(points.items[0].effectiveState, "open");
  assert.deepEqual(points.items[0].assetIds, [thread.assets[0].id]);
  const planned = await runAgentTool(
    async () => ({
      ...thread,
      annotationPlans: {
        [annotationId]: {
          priority: "high",
          schedule: "later",
          scheduledFor: null,
          timeZone: "Asia/Kolkata",
        },
      },
    }),
    "thread",
    { threadId, section: "points" },
  );
  assert.equal(planned.items[0].workPlan.schedule, "later");
  const body = await runAgentTool(execute, "thread", {
    threadId,
    section: "body",
    textLimit: 1000,
  });
  assert.equal(body.text.length, 1000);
  assert.equal(body.nextTextOffset, 1000);
  const overview = await runAgentTool(execute, "thread", { threadId });
  assert.ok(!JSON.stringify(overview).includes("Reply 0"));
  assert.equal(overview.counts.replies, 51);
});

test("execute validates selected schema, preserves scope errors and summarizes mutation receipts", async () => {
  let calls = 0;
  const execute = async (name: string) => {
    calls++;
    if (name === "threads.status")
      return { ...thread, revision: 5, work: { state: "in_progress" } };
    throw Object.assign(new Error("Denied"), { code: "FORBIDDEN" });
  };
  await assert.rejects(
    runAgentTool(execute, "execute", {
      operation: "threads.status",
      input: { threadId, state: "in_progress" },
    }),
    { code: "VALIDATION" },
  );
  assert.equal(calls, 0);
  await assert.rejects(
    runAgentTool(execute, "execute", { operation: "auth.login", input: {} }),
    { code: "NOT_FOUND" },
  );
  const result = await runAgentTool(execute, "execute", {
    operation: "threads.status",
    input: { threadId, revision: 4, state: "in_progress" },
  });
  assert.equal(result.revision, 5);
  assert.equal(result.work.state, "in_progress");
  assert.equal(result.replies, undefined);
  await assert.rejects(runAgentTool(execute, "queue", { projectId, sort: "priority" }), {
    code: "FORBIDDEN",
  });
  assert.equal(Object.keys(agentToolSchemas).length, 8);
});

test("oversized point/discussion pages can be reconstructed without losing later corrections", async () => {
  const source = {
    ...thread,
    replies: [
      {
        id: randomUUID(),
        body: "Long discussion ".repeat(900),
        author: { name: "Reviewer" },
      },
      { id: randomUUID(), body: "Latest correction", author: { name: "Reviewer" } },
    ],
  };
  let textOffset = 0,
    reconstructed = "",
    expectedContentVersion: string | undefined;
  do {
    const page = await runAgentTool(async () => source, "thread", {
      threadId,
      section: "discussion",
      limit: 2,
      textLimit: 1000,
      textOffset,
      expectedRevision: 4,
      expectedContentVersion,
    });
    expectedContentVersion = page.contentVersion;
    reconstructed += page.text;
    textOffset = page.nextTextOffset;
    assert.equal(page.total, 2);
    assert.equal(page.nextOffset, null);
  } while (textOffset !== null);
  assert.deepEqual(JSON.parse(reconstructed), source.replies);
});

test("legacy anchors remain separately identified and readable without invented point IDs", async () => {
  const legacy = {
    ...thread,
    body: "Legacy point",
    context: { url: thread.context.url, anchor: { selector: "#legacy" } },
  };
  const queue = await runAgentTool(
    async () => ({ items: [legacy], total: 1, nextOffset: null }),
    "queue",
    { projectId },
  );
  assert.equal(queue.items[0].points, 0);
  assert.equal(queue.items[0].legacyAnchor, true);
  assert.equal(queue.items[0].openPoints, 0);
  const points = await runAgentTool(async () => legacy, "thread", {
    threadId,
    section: "points",
    textLimit: 8000,
  });
  const items = points.items ?? JSON.parse(points.text);
  assert.equal(items[0].legacy, true);
  assert.equal(items[0].id, null);
  assert.equal(items[0].anchor.selector, "#legacy");
});

test("section continuation detects reviewer updates and likes without a thread revision change", async () => {
  let current = {
    ...thread,
    reviewerContext: {
      trust: "owner_approved_advisory_reviewer_context",
      items: [{ userId: projectId, revision: 1, guidance: "A".repeat(3000) }],
    },
  };
  const execute = async () => current;
  const first = await runAgentTool(execute, "thread", {
    threadId,
    section: "reviewers",
    textLimit: 1000,
  });
  current = {
    ...current,
    reviewerContext: {
      ...current.reviewerContext,
      items: [{ userId: projectId, revision: 2, guidance: "B".repeat(3000) }],
    },
  };
  await assert.rejects(
    runAgentTool(execute, "thread", {
      threadId,
      section: "reviewers",
      textOffset: first.nextTextOffset,
      textLimit: 1000,
      expectedRevision: 4,
      expectedContentVersion: first.contentVersion,
    }),
    { code: "CONFLICT" },
  );
  const discussion = await runAgentTool(execute, "thread", {
    threadId,
    section: "discussion",
    textLimit: 256,
  });
  current = {
    ...current,
    replies: current.replies.map((reply: any, index: number) =>
      index ? reply : { ...reply, likes: { uniqueLikes: 3 } },
    ),
  };
  await assert.rejects(
    runAgentTool(execute, "thread", {
      threadId,
      section: "discussion",
      textOffset: discussion.nextTextOffset,
      textLimit: 256,
      expectedRevision: 4,
      expectedContentVersion: discussion.contentVersion,
    }),
    { code: "CONFLICT" },
  );
});

test("start reads the selected task once, distinguishes its reviewed thread and skips known missing scopes", async () => {
  const referenced = randomUUID();
  const calls: string[] = [];
  const selected = {
    ...thread,
    archived: false,
    context: {
      ...thread.context,
      url: `https://feedback.example.test/threads/${referenced}`,
    },
  };
  const execute = async (name: string) => {
    calls.push(name);
    if (name === "auth.me")
      return {
        actor: { id: "agent", userId: "member", name: "Shared client", kind: "agent" },
        member: { id: "member", name: "Human" },
        serverOrigin: "https://feedback.example.test",
        credential: {
          operationScopes: ["auth.me", "threads.get", "assets.get", "instructions.get"],
        },
        projects: [{ id: projectId, name: "App", permissions: { canWrite: true } }],
      };
    if (name === "threads.get") return selected;
    if (name === "instructions.get")
      return { trust: "approved_project_instructions", revision: 1, items: [] };
    throw Error(`Unexpected call: ${name}`);
  };
  const result = await runAgentTool(execute, "start", {
    threadId,
    snapshotRevision: thread.revision,
  });
  assert.equal(result.task.id, threadId);
  assert.equal(result.task.archived, undefined);
  assert.equal(result.reviewedPage.threadId, referenced);
  assert.equal(result.reviewedPage.relationship, "reviewed_thread");
  assert.equal(result.snapshot.matches, true);
  assert.equal(result.identity.member.name, "Human");
  assert.equal(result.coordination.claims.status, "missing_scope");
  assert.equal(result.coordination.verified, false);
  assert.deepEqual(calls.sort(), ["auth.me", "instructions.get", "threads.get"].sort());
  assert.ok(!JSON.stringify(result).includes(thread.body));
});

test("start never follows an external thread-looking URL or hides expired authentication", async () => {
  const execute = async (name: string) => {
    if (name === "auth.me")
      return {
        actor: {},
        serverOrigin: "https://feedback.example.test",
        credential: { operationScopes: ["threads.get"] },
        projects: [],
      };
    if (name === "threads.get")
      return {
        ...thread,
        context: { url: `https://other.example.test/threads/${randomUUID()}` },
      };
    throw Error(name);
  };
  const result = await runAgentTool(execute, "start", { threadId });
  assert.equal(result.reviewedPage.relationship, "reviewed_page");
  assert.equal(result.reviewedPage.threadId, undefined);
  await assert.rejects(
    runAgentTool(
      async () => {
        throw Object.assign(Error("expired"), { code: "UNAUTHENTICATED" });
      },
      "start",
      { threadId },
    ),
    { code: "UNAUTHENTICATED" },
  );
});

test("body-only feedback does not count its legacy anchor as a numbered comment", async () => {
  const result = await runAgentTool(
    async () => ({
      ...thread,
      context: { url: "https://example.test", anchor: { confidence: "coordinate-only" } },
    }),
    "thread",
    { threadId },
  );
  assert.equal(result.counts.points, undefined);
  assert.equal(result.counts.openPoints, undefined);
  assert.equal(result.counts.legacyAnchor, true);
});

test("start keeps available recordings and diagnostics lazy even with unrestricted scopes", async () => {
  const calls: string[] = [];
  const result = await runAgentTool(
    async (operation) => {
      calls.push(operation);
      if (operation === "auth.me") return { actor: { userId: "member" }, projects: [] };
      if (operation === "threads.get")
        return {
          ...thread,
          diagnosticEvidence: { count: 3, latest: [{ id: "diagnostic-summary" }] },
          recordings: [{ id: "recording", events: ["RAW RECORDING"] }],
        };
      if (operation === "instructions.get") return { items: [], revision: 1 };
      if (operation === "assignments.list" || operation === "assignments.delegations")
        return { items: [], total: 0, nextOffset: null };
      throw new Error(`Unneeded evidence read: ${operation}`);
    },
    "start",
    { threadId },
  );
  assert.deepEqual(
    calls.sort(),
    [
      "auth.me",
      "threads.get",
      "instructions.get",
      "assignments.list",
      "assignments.delegations",
    ].sort(),
  );
  assert.equal(result.diagnosticEvidence.count, 3);
  assert.ok(!JSON.stringify(result).includes("RAW RECORDING"));
});
