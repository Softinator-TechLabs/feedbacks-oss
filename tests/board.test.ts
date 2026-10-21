import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { Database } from "../src/server/db.js";
import { migrate } from "../src/server/migrations.js";
import { Operations } from "../src/server/operations.js";
import {
  boardConfigurationSchema,
  defaultBoardConfiguration,
} from "../src/shared/board.js";
import { boardOutputs } from "../src/shared/contracts/domains/board.js";

async function fixture() {
  const pg = new PGlite();
  const db = new Database(pg as any);
  await migrate(db);
  const ops = new Operations(db, {} as any, {} as any);
  const owner = await ops.auth.bootstrap(
    "owner@example.test",
    "Owner",
    "Correct-Horse-Battery-123",
  );
  const call = (actor: any, op: string, input: any) =>
    ops.executeOperation(actor, op, input);
  const project = await call(owner, "projects.create", {
    name: "Board",
    origins: ["https://example.test"],
  });
  async function member(name: string, role?: string) {
    const member = await call(owner, "members.create", {
      email: `${name}@example.test`,
      name,
      password: "Correct-Horse-Battery-123",
      grants: role ? [{ projectId: project.id, role }] : [],
    });
    return {
      ...owner,
      id: member.id,
      userId: member.id,
      name,
      owner: false,
      primaryOwner: false,
    };
  }
  const writer = await member("Writer", "reviewer");
  const viewer = await member("Viewer", "viewer");
  const outsider = await member("Outsider");
  async function create(body = "Review feedback") {
    return call(owner, "threads.create", {
      projectId: project.id,
      body,
      idempotencyKey: randomUUID(),
    });
  }
  async function column(columnId = "intake", extra: any = {}, actor = owner) {
    const board = await call(actor, "board.get", { projectId: project.id });
    const result = await call(actor, "board.column", {
      projectId: project.id,
      boardRevision: board.revision,
      columnId,
      filters: { showResolved: true },
      ...extra,
    });
    assert.ok(boardOutputs["board.column"].safeParse(result).success);
    return result;
  }
  const snapshot = (item: any) => ({
    threadId: item.thread.id,
    revision: item.thread.revision,
    assignmentVersion: item.assignmentVersion,
  });
  function batch(items: any[], action: any, extra: any = {}, actor = owner) {
    return call(actor, "board.batch", {
      projectId: project.id,
      boardRevision: 0,
      threads: items.map(snapshot),
      action,
      idempotencyKey: randomUUID(),
      ...extra,
    });
  }
  return {
    pg,
    db,
    ops,
    owner,
    project,
    writer,
    viewer,
    outsider,
    call,
    create,
    column,
    snapshot,
    batch,
  };
}

test("board configuration partitions authoritative work states and keeps intake mapped to Open", () => {
  assert.ok(boardConfigurationSchema.safeParse(defaultBoardConfiguration).success);
  for (const configuration of [
    { ...defaultBoardConfiguration, intakeColumnId: "done" },
    { ...defaultBoardConfiguration, columns: defaultBoardConfiguration.columns.slice(1) },
    {
      ...defaultBoardConfiguration,
      columns: [
        ...defaultBoardConfiguration.columns,
        defaultBoardConfiguration.columns[0],
      ],
    },
    {
      ...defaultBoardConfiguration,
      columns: defaultBoardConfiguration.columns.map((column) => ({
        ...column,
        entryState: "declined",
      })),
    },
  ])
    assert.equal(boardConfigurationSchema.safeParse(configuration).success, false);
});

test("column totals cover all pages and share search, archive and work-plan filters", async () => {
  const f = await fixture();
  try {
    for (let index = 0; index < 21; index++)
      await f.create(`Searchable feedback ${String(index).padStart(2, "0")}`);
    const first = await f.column("intake", {
      limit: 15,
      filters: { search: "Searchable", sort: "newest", showResolved: true },
    });
    assert.equal(first.total, 21);
    assert.equal(first.items.length, 15);
    assert.equal(first.nextOffset, 15);
    const second = await f.column("intake", {
      limit: 15,
      offset: 15,
      filters: { search: "Searchable", sort: "newest", showResolved: true },
    });
    assert.equal(second.total, 21);
    assert.equal(second.items.length, 6);
    assert.equal(second.nextOffset, null);
    assert.equal(
      new Set([...first.items, ...second.items].map((item) => item.thread.id)).size,
      21,
    );
    const chosen = first.items[0];
    await f.call(f.owner, "threads.plan", {
      threadId: chosen.thread.id,
      revision: chosen.thread.revision,
      workPlan: {
        priority: "high",
        schedule: "today",
        scheduledFor: "2026-10-21",
        timeZone: "Asia/Kolkata",
      },
    });
    const sorted = await f.column("intake", {
      filters: {
        sort: "workPlan",
        planningDate: "2026-10-21",
        search: "Searchable",
        showResolved: true,
      },
    });
    assert.equal(sorted.items[0].thread.id, chosen.thread.id);
    await f.batch([sorted.items[0]], { type: "archive", archived: true });
    assert.equal((await f.column()).total, 20);
    assert.equal(
      (await f.column("intake", { filters: { archived: true, showResolved: true } }))
        .total,
      1,
    );
    assert.equal(
      (
        await f.column("intake", {
          filters: { search: "no matches", showResolved: true },
        })
      ).total,
      0,
    );
    assert.equal((await f.column("done")).total, 0);
  } finally {
    await f.pg.close();
  }
});

test("atomic moves keep discussion, duplicate triage, history and retry receipts", async () => {
  const f = await fixture();
  try {
    const thread = await f.create("Original review");
    const duplicate = await f.create("Canonical review");
    const replied = await f.call(f.writer, "threads.reply", {
      threadId: thread.id,
      revision: thread.revision,
      body: "Keep this discussion",
      idempotencyKey: randomUUID(),
    });
    await f.call(f.owner, "threads.status", {
      threadId: thread.id,
      revision: replied.revision,
      state: "open",
      note: "Keep triage note",
      duplicateOf: duplicate.id,
    });
    const items = (await f.column()).items;
    const request = {
      projectId: f.project.id,
      boardRevision: 0,
      threads: items.map(f.snapshot),
      action: { type: "move", columnId: "in_progress" },
      idempotencyKey: randomUUID(),
    };
    const receipt = await f.call(f.writer, "board.batch", request);
    assert.equal(receipt.affected, 2);
    assert.ok(boardOutputs["board.batch"].safeParse(receipt).success);
    assert.deepEqual(await f.call(f.writer, "board.batch", request), receipt);
    const current = await f.call(f.owner, "threads.get", { threadId: thread.id });
    assert.equal(current.work.state, "in_progress");
    assert.equal(current.work.note, "Keep triage note");
    assert.equal(current.work.duplicateOf, duplicate.id);
    assert.equal(current.replies[0].body, "Keep this discussion");
    assert.equal(current.work.history.at(-1).actor.userId, f.writer.userId);
    assert.equal((await f.column()).total, 0);
    assert.equal((await f.column("in_progress")).total, 2);
    await assert.rejects(
      f.call(f.writer, "board.batch", {
        ...request,
        action: { type: "move", columnId: "review" },
      }),
      { code: "IDEMPOTENCY_CONFLICT" },
    );
    const list = await f.call(f.owner, "threads.list", { projectId: f.project.id });
    assert.ok(list.items.every((item) => item.work.state === "in_progress"));
  } finally {
    await f.pg.close();
  }
});

test("a stale selected revision rolls back the complete batch and unchanged rows", async () => {
  const f = await fixture();
  try {
    await f.create("First");
    await f.create("Second");
    const items = (await f.column()).items;
    await f.call(f.owner, "threads.reply", {
      threadId: items[1].thread.id,
      revision: items[1].thread.revision,
      body: "Concurrent change",
      idempotencyKey: randomUUID(),
    });
    await assert.rejects(f.batch(items, { type: "move", columnId: "in_progress" }), {
      code: "CONFLICT",
    });
    assert.ok(
      (await f.column()).items.every((item) => item.thread.work.state === "open"),
    );
    assert.equal(
      Number(
        (await f.db.one("SELECT count(*) AS count FROM board_batch_receipts")).count,
      ),
      0,
    );
    const newItems = (await f.column()).items;
    // The second delegation fails after the first has written history: the
    // surrounding Operations transaction must undo the first assignment too.
    const last = [...newItems]
      .sort((a, b) => a.thread.id.localeCompare(b.thread.id))
      .at(-1)!;
    await f.call(f.owner, "threads.status", {
      threadId: last.thread.id,
      revision: last.thread.revision,
      state: "resolved",
    });
    const all = [...(await f.column()).items, ...(await f.column("done")).items];
    await assert.rejects(f.batch(all, { type: "assign", userId: f.writer.userId }), {
      code: "CONFLICT",
    });
    assert.equal(
      Number((await f.db.one("SELECT count(*) AS count FROM work_delegations")).count),
      0,
    );
    assert.equal(
      Number(
        (await f.db.one("SELECT count(*) AS count FROM work_delegation_history")).count,
      ),
      0,
    );
  } finally {
    await f.pg.close();
  }
});

test("batch assignments reuse delegated work and detect independent assignment revisions", async () => {
  const f = await fixture();
  try {
    const thread = await f.create();
    let item = (await f.column()).items[0];
    await f.batch([item], { type: "assign", userId: f.writer.userId });
    item = (await f.column()).items[0];
    assert.equal(item.thread.revision, thread.revision + 1);
    assert.equal(item.assignments[0].name, "Writer");
    assert.equal(
      (
        await f.column("intake", {
          filters: { assignedTo: f.writer.userId, showResolved: true },
        })
      ).total,
      1,
    );
    const assigned = (
      await f.call(f.owner, "assignments.delegations", { projectId: f.project.id })
    ).items[0];
    await f.call(f.owner, "assignments.assign", {
      threadId: thread.id,
      threadRevision: item.thread.revision,
      delegationId: assigned.id,
      revision: assigned.revision,
      annotationIds: [],
      userId: f.owner.userId,
      summary: "Keep meaningful triage",
      category: "general",
      tags: ["review"],
      githubDecision: "not_needed",
      githubRationale: "Small repair",
      idempotencyKey: randomUUID(),
    });
    await assert.rejects(f.batch([item], { type: "assign", userId: f.writer.userId }), {
      code: "CONFLICT",
    });
    item = (await f.column()).items[0];
    await f.batch([item], { type: "assign", userId: f.writer.userId });
    const changed = (
      await f.call(f.owner, "assignments.delegations", { projectId: f.project.id })
    ).items[0];
    assert.equal(changed.id, assigned.id);
    assert.equal(changed.summary, "Keep meaningful triage");
    assert.equal(changed.githubDecision, "not_needed");
    assert.equal(changed.githubRationale, "Small repair");
    assert.deepEqual(changed.tags, ["review"]);
    item = (await f.column()).items[0];
    await f.batch([item], { type: "assign", userId: null });
    assert.equal((await f.column()).items[0].assignments.length, 0);
    assert.equal(
      (await f.call(f.owner, "assignments.history", { delegationId: assigned.id })).total,
      4,
    );
  } finally {
    await f.pg.close();
  }
});

test("board changes enforce current project grants, status permissions and token action scopes", async () => {
  const f = await fixture();
  try {
    await f.create();
    const items = (await f.column()).items;
    await assert.rejects(f.column("intake", {}, f.outsider), { code: "FORBIDDEN" });
    assert.equal((await f.column("intake", {}, f.viewer)).total, 1);
    await assert.rejects(
      f.batch(items, { type: "move", columnId: "in_progress" }, {}, f.viewer),
      { code: "FORBIDDEN" },
    );
    await assert.rejects(
      f.batch(items, { type: "move", columnId: "done" }, {}, f.writer),
      { code: "FORBIDDEN" },
    );
    await assert.rejects(
      f.batch(items, { type: "archive", archived: true }, {}, f.writer),
      { code: "FORBIDDEN" },
    );
    await assert.rejects(
      f.call(f.writer, "board.configure", {
        projectId: f.project.id,
        revision: 0,
        configuration: defaultBoardConfiguration,
      }),
      { code: "FORBIDDEN" },
    );
    const token = await f.call(f.writer, "tokens.create", {
      name: "Board only",
      projectIds: [f.project.id],
      scopes: ["board.get", "board.column", "board.batch"],
    });
    const agent = await f.ops.auth.authenticate(token.token);
    await assert.rejects(
      f.batch(items, { type: "move", columnId: "in_progress" }, {}, agent),
      { code: "FORBIDDEN" },
    );
    await f.call(f.owner, "members.grant", {
      projectId: f.project.id,
      userId: f.writer.userId,
      role: "reviewer",
      remove: true,
    });
    await assert.rejects(f.column("intake", {}, agent), { code: "FORBIDDEN" });
  } finally {
    await f.pg.close();
  }
});

test("column configuration uses revisions and regrouping immediately reads existing status", async () => {
  const f = await fixture();
  try {
    await f.create();
    const original = (await f.column()).items;
    const configuration = {
      columns: [
        {
          id: "todo",
          name: "To do",
          states: ["open", "in_progress"],
          entryState: "open",
        },
        {
          id: "review",
          name: "Review",
          states: ["ready_for_review"],
          entryState: "ready_for_review",
        },
        {
          id: "done",
          name: "Done",
          states: ["resolved", "declined"],
          entryState: "resolved",
        },
      ],
      intakeColumnId: "todo",
    };
    const saved = await f.call(f.owner, "board.configure", {
      projectId: f.project.id,
      revision: 0,
      configuration,
    });
    assert.equal(saved.revision, 1);
    await assert.rejects(
      f.call(f.owner, "board.configure", {
        projectId: f.project.id,
        revision: 0,
        configuration,
      }),
      { code: "CONFLICT" },
    );
    await assert.rejects(
      f.call(f.owner, "board.column", {
        projectId: f.project.id,
        boardRevision: 0,
        columnId: "intake",
        filters: {},
      }),
      { code: "CONFLICT" },
    );
    await assert.rejects(f.batch(original, { type: "move", columnId: "review" }), {
      code: "CONFLICT",
    });
    assert.equal((await f.column("todo")).total, 1);
    const item = (await f.column("todo")).items[0];
    await f.batch(
      [item],
      { type: "move", columnId: "done", state: "declined" },
      { boardRevision: 1 },
    );
    assert.equal((await f.column("done")).items[0].thread.work.state, "declined");
    await assert.rejects(
      f.batch(
        [(await f.column("done")).items[0]],
        { type: "move", columnId: "done", state: "open" },
        { boardRevision: 1 },
      ),
      { code: "VALIDATION" },
    );
  } finally {
    await f.pg.close();
  }
});

test("batch assignment keeps point scopes private to the discussion and rejects foreign-project selections", async () => {
  const f = await fixture();
  try {
    const pointId = randomUUID();
    const thread = await f.call(f.owner, "threads.create", {
      projectId: f.project.id,
      body: "Scoped review",
      context: {
        url: "https://example.test/",
        viewport: { width: 1000, height: 800 },
        annotations: [
          { id: pointId, body: "Fix the first field", anchor: { selector: "#first" } },
        ],
      },
      idempotencyKey: randomUUID(),
    });
    const pointAssignment = await f.call(f.owner, "assignments.assign", {
      threadId: thread.id,
      threadRevision: thread.revision,
      annotationIds: [pointId],
      userId: f.writer.userId,
      summary: "First field only",
      category: "general",
      tags: [],
      githubDecision: "not_needed",
      githubRationale: "Bounded repair",
      idempotencyKey: randomUUID(),
    });
    const items = (await f.column()).items;
    assert.deepEqual(items[0].assignments[0].annotationIds, [pointId]);
    await assert.rejects(f.batch(items, { type: "assign", userId: f.owner.userId }), {
      code: "CONFLICT",
    });
    await assert.rejects(f.batch(items, { type: "assign", userId: null }), {
      code: "CONFLICT",
    });
    assert.equal(
      (await f.call(f.owner, "assignments.delegations", { projectId: f.project.id }))
        .items[0].id,
      pointAssignment.id,
    );
    const other = await f.call(f.owner, "projects.create", {
      name: "Other",
      origins: ["https://other.test"],
    });
    await assert.rejects(
      f.call(f.owner, "board.batch", {
        projectId: other.id,
        boardRevision: 0,
        threads: items.map(f.snapshot),
        action: { type: "move", columnId: "in_progress" },
        idempotencyKey: randomUUID(),
      }),
      { code: "FORBIDDEN" },
    );
    assert.equal(
      (await f.call(f.owner, "threads.get", { threadId: thread.id })).work.state,
      "open",
    );
  } finally {
    await f.pg.close();
  }
});
