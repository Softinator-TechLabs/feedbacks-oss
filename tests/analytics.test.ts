import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { Database } from "../src/server/db.js";
import { migrate } from "../src/server/migrations.js";
import {
  analyticsGet,
  buildAnalytics,
  type AnalyticsRecord,
} from "../src/server/analytics.js";
import { analyticsCsv, analyticsDateBoundary } from "../src/shared/analytics.js";
import {
  analyticsInputs,
  analyticsOutputs,
} from "../src/shared/contracts/domains/analytics.js";
import type { Actor } from "../src/shared/contracts.js";

const input = {
  from: "2026-01-01T00:00:00Z",
  to: "2026-02-01T00:00:00Z",
  timeZone: "UTC",
};
const now = "2026-02-01T00:00:00Z";
const base = (patch: Partial<AnalyticsRecord> = {}): AnalyticsRecord => ({
  id: randomUUID(),
  projectId: "00000000-0000-4000-8000-000000000001",
  projectName: "Synthetic website",
  createdAt: "2026-01-01T00:00:00Z",
  state: "open",
  archived: false,
  category: "general",
  tags: [],
  priority: "normal",
  origin: "https://example.test",
  page: "https://user:password@example.test/path?secret=private#secret",
  device: "desktop",
  history: [],
  firstResponse: null,
  firstTriage: null,
  assignees: [],
  ...patch,
});

test("stalled columns derive retained transitions through the current board mapping without resetting for an in-column status change", () => {
  const columns: NonNullable<AnalyticsRecord["columns"]> = [
    { id: "work", name: "Work", states: ["open", "in_progress"], entryState: "open" },
    {
      id: "review",
      name: "Review",
      states: ["ready_for_review"],
      entryState: "ready_for_review",
    },
    {
      id: "closed",
      name: "Closed",
      states: ["resolved", "declined"],
      entryState: "resolved",
    },
  ];
  const record = base({
    state: "in_progress",
    columns,
    history: [{ state: "in_progress", at: "2026-01-31T00:00:00Z" }],
  });
  const report = buildAnalytics(
    [record],
    {
      ...input,
      detail: {
        metric: "stalled",
        dimension: "column",
        key: `${record.projectId}:work`,
        offset: 0,
        limit: 25,
      },
    },
    now,
  );
  assert.equal(report.counts.stalled, 1);
  assert.equal(report.breakdowns.column[0].label, "Synthetic website · Work");
  assert.equal(report.details?.items[0].column, "Synthetic website · Work");
  assert.equal(
    buildAnalytics([{ ...record, columns: undefined }], input, now).counts.stalled,
    0,
    "default mapping distinguishes the states",
  );
  assert.equal(
    buildAnalytics(
      [
        {
          ...record,
          state: "ready_for_review",
          history: [
            ...record.history,
            { state: "ready_for_review", at: "2026-01-31T01:00:00Z" },
          ],
        },
      ],
      input,
      now,
    ).counts.stalled,
    0,
    "cross-column movement restarts dwell",
  );
});

test("analytics defines distinct lifecycle counts, cohort durations, backlog aging and exact drilldowns", () => {
  const resolved = base({
    state: "resolved",
    tags: ["mobile", "mobile"],
    firstResponse: "2026-01-01T02:00:00Z",
    firstTriage: "2026-01-01T01:00:00Z",
    history: [
      { state: "in_progress", at: "2026-01-01T04:00:00Z" },
      { state: "resolved", at: "2026-01-02T00:00:00Z" },
      { state: "open", at: "2026-01-03T00:00:00Z" },
      { state: "resolved", at: "2026-01-04T00:00:00Z" },
    ],
  });
  const duplicate = base({
    state: "declined",
    createdAt: "2025-12-01T00:00:00Z",
    history: [
      { state: "declined", at: "2026-01-05T00:00:00Z", duplicate: true },
      { state: "declined", at: "2026-01-06T00:00:00Z", duplicate: true },
    ],
  });
  const active = base({
    createdAt: "2026-01-20T00:00:00Z",
    state: "in_progress",
    history: [
      { state: "in_progress", at: "2026-01-21T00:00:00Z" },
      { state: "in_progress", at: "2026-01-31T00:00:00Z" },
    ],
    assignees: [
      { id: "a", name: "Zoe" },
      { id: "b", name: "Ada" },
    ],
  });
  const archived = base({ archived: true });
  const report = buildAnalytics(
    [resolved, duplicate, active, archived],
    { ...input, detail: { metric: "resolved", offset: 0, limit: 25 } },
    now,
  );
  assert.deepEqual(report.counts, {
    incoming: 3,
    triaged: 3,
    resolved: 1,
    reopened: 1,
    declined: 1,
    duplicate: 1,
    backlog: 1,
    overdue: 0,
    high_priority: 0,
    stalled: 1,
  });
  assert.deepEqual(report.durations.firstResponse, {
    sample: 1,
    medianHours: 2,
    p90Hours: 2,
    smallSample: true,
  });
  assert.equal(report.durations.firstTriage.medianHours, 12.5);
  assert.equal(report.durations.firstResolution.medianHours, 24);
  assert.equal(
    report.trend.reduce((sum, day) => sum + day.resolved, 0),
    2,
  );
  assert.equal(
    report.trend.reduce((sum, day) => sum + day.duplicate, 0),
    1,
  );
  assert.deepEqual(report.breakdowns.age, [
    { key: "8-14", label: "8-14 days", count: 1 },
  ]);
  assert.deepEqual(
    report.breakdowns.assignee.map((row) => row.label),
    ["Ada", "Zoe"],
  );
  assert.equal(report.breakdowns.page[0].key, "https://example.test/path");
  assert.deepEqual(report.breakdowns.browser, [
    { key: "Unknown", label: "Unknown", count: 3 },
  ]);
  assert.equal(report.breakdowns.tag.find((row) => row.key === "mobile")?.count, 1);
  assert.deepEqual(
    report.details?.items.map((row) => row.id),
    [resolved.id],
  );
  const filtered = buildAnalytics(
    [resolved, active],
    {
      ...input,
      detail: { metric: "backlog", dimension: "assignee", key: "a", offset: 0, limit: 1 },
    },
    now,
  );
  assert.equal(filtered.details?.total, 1);
  assert.equal(filtered.details?.items[0].id, active.id);
  assert.doesNotThrow(() => analyticsOutputs["analytics.get"].parse(report));
});

test("analytics median and nearest-rank P90 retain zero, omit incomplete observations and mark sparse samples", () => {
  const records = [0, 1, 2, 3, 10, 20, 30, 40, 50, 100].map((hours) =>
    base({
      firstResponse: new Date(
        Date.parse("2026-01-01T00:00:00Z") + hours * 3600000,
      ).toISOString(),
    }),
  );
  records.push(
    base({ firstResponse: "2026-03-01T00:00:00Z" }),
    base({ firstResponse: "2025-01-01T00:00:00Z" }),
    base(),
  );
  const report = buildAnalytics(records, input, now);
  assert.deepEqual(report.durations.firstResponse, {
    sample: 10,
    medianHours: 15,
    p90Hours: 50,
    smallSample: false,
  });
  assert.deepEqual(report.durations.firstTriage, {
    sample: 0,
    medianHours: null,
    p90Hours: null,
    smallSample: false,
  });
  const empty = buildAnalytics([], input, now);
  assert.equal(empty.trend.length, 31);
  assert.ok(empty.trend.every((day) => day.incoming === 0));
  assert.equal(empty.counts.backlog, 0);
});

test("current project counts include empty projects, overlap overdue/high priority and match isolated drilldowns outside the period", () => {
  const a = base().projectId,
    b = randomUUID(),
    empty = randomUUID();
  const plan = (scheduledFor: string | null, patch: Record<string, unknown> = {}) => ({
    priority: "normal",
    schedule: scheduledFor ? "today" : "unscheduled",
    scheduledFor,
    timeZone: "UTC",
    ...patch,
  });
  const records = [
    base({ priority: "high", workPlan: plan("2026-01-31", { priority: "high" }) }),
    base({ workPlan: plan("2026-02-01") }),
    base({ priority: "low", workPlan: plan("2026-02-02", { priority: "low" }) }),
    base({ priority: "high", workPlan: plan(null, { priority: "high" }) }),
    base({ topPriority: true, workPlan: plan(null, { schedule: "later" }) }),
    base({ workPlan: plan("2026-01-31", { timeZone: "invalid/timezone" }) }),
    base({ workPlan: plan("2026-02-30") }),
    base({ workPlan: plan("2026-01-31", { schedule: "unscheduled" }) }),
    base({
      projectId: b,
      projectName: "Beta",
      topPriority: true,
      workPlan: plan("2026-01-31"),
    }),
    base({ projectId: b, projectName: "Beta", workPlan: plan("2026-01-30") }),
    ...["resolved", "declined", "closed"].map((state) =>
      base({
        projectId: b,
        projectName: "Beta",
        state,
        priority: "high",
        topPriority: true,
        workPlan: plan("2026-01-31"),
      }),
    ),
    base({
      projectId: b,
      projectName: "Beta",
      archived: true,
      priority: "high",
      topPriority: true,
      workPlan: plan("2026-01-31"),
    }),
  ];
  const projects = [
    { id: a, name: "Alpha" },
    { id: b, name: "Beta" },
    { id: empty, name: "Empty" },
  ];
  const outsidePeriod = {
    ...input,
    from: "2025-11-01T00:00:00Z",
    to: "2025-12-01T00:00:00Z",
  };
  const report = buildAnalytics(
    records,
    {
      ...outsidePeriod,
      detail: { metric: "overdue", dimension: "project", key: b, offset: 0, limit: 25 },
    },
    now,
    projects.length,
    projects,
  );
  assert.equal(
    report.counts.incoming,
    0,
    "historical period does not control the current workload",
  );
  assert.equal(report.counts.backlog, 10);
  assert.equal(report.counts.overdue, 3);
  assert.equal(report.counts.high_priority, 4);
  assert.deepEqual(report.currentProjects, [
    {
      projectId: a,
      projectName: "Alpha",
      pending: 8,
      overdue: 1,
      highPriority: 3,
      stalled: 8,
    },
    {
      projectId: b,
      projectName: "Beta",
      pending: 2,
      overdue: 2,
      highPriority: 1,
      stalled: 2,
    },
    {
      projectId: empty,
      projectName: "Empty",
      pending: 0,
      overdue: 0,
      highPriority: 0,
      stalled: 0,
    },
  ]);
  assert.equal(report.projectCount, 3);
  assert.equal(report.details?.total, 2);
  assert.ok(
    report.details?.items.every(
      (row) => row.projectId === b && row.workPlan?.scheduledFor! < "2026-02-01",
    ),
  );
  assert.equal(report.details?.items.find((row) => row.topPriority)?.priority, "normal");
  const high = buildAnalytics(
    records,
    {
      ...outsidePeriod,
      detail: {
        metric: "high_priority",
        dimension: "project",
        key: a,
        offset: 0,
        limit: 25,
      },
    },
    now,
    projects.length,
    projects,
  );
  assert.equal(high.details?.total, 3);
  assert.ok(high.details?.items.every((row) => row.projectId === a));
  const invalid = buildAnalytics(
    records,
    {
      ...outsidePeriod,
      detail: { metric: "backlog", dimension: "project", key: a, offset: 0, limit: 25 },
    },
    now,
  );
  assert.equal(
    invalid.details?.items.filter((row) => row.workPlan === null).length,
    3,
    "invalid retained plans expose no invalid planning fields and cannot become overdue",
  );
  assert.doesNotThrow(() => analyticsOutputs["analytics.get"].parse(report));
  assert.deepEqual(buildAnalytics([], input, now, 1, [projects[2]]).currentProjects, [
    {
      projectId: empty,
      projectName: "Empty",
      pending: 0,
      overdue: 0,
      highPriority: 0,
      stalled: 0,
    },
  ]);
});

test("overdue follows each saved planning timezone across midnight and DST rather than the report timezone or elapsed hours", () => {
  const dated = (scheduledFor: string, timeZone: string) =>
    base({ workPlan: { priority: "normal", schedule: "today", scheduledFor, timeZone } });
  for (const [at, scheduledFor, timeZone, expected] of [
    ["2026-03-08T04:59:59Z", "2026-03-07", "America/New_York", 0],
    ["2026-03-08T04:59:59Z", "2026-03-07", "UTC", 1],
    ["2026-03-08T05:00:00Z", "2026-03-07", "America/New_York", 1],
    ["2026-03-08T06:59:59Z", "2026-03-08", "America/New_York", 0],
    ["2026-03-08T07:00:00Z", "2026-03-08", "America/New_York", 0],
    ["2026-03-09T03:59:59Z", "2026-03-08", "America/New_York", 0],
    ["2026-03-09T04:00:00Z", "2026-03-08", "America/New_York", 1],
    ["2026-11-01T05:59:59Z", "2026-11-01", "America/New_York", 0],
    ["2026-11-01T06:00:00Z", "2026-11-01", "America/New_York", 0],
    ["2026-11-02T04:59:59Z", "2026-11-01", "America/New_York", 0],
    ["2026-11-02T05:00:00Z", "2026-11-01", "America/New_York", 1],
    ["2026-01-31T18:29:59Z", "2026-01-31", "Asia/Kolkata", 0],
    ["2026-01-31T18:30:00Z", "2026-01-31", "Asia/Kolkata", 1],
  ] as const) {
    for (const reportTimeZone of ["UTC", "Pacific/Honolulu"])
      assert.equal(
        buildAnalytics(
          [dated(scheduledFor, timeZone)],
          { ...input, timeZone: reportTimeZone },
          at,
        ).counts.overdue,
        expected,
        `${scheduledFor} in ${timeZone} at ${at}`,
      );
  }
});

test("analytics timezone days, inclusive/exclusive bounds and daylight-saving boundaries are explicit", () => {
  assert.equal(
    analyticsDateBoundary("2026-01-01", "Asia/Kolkata"),
    "2025-12-31T18:30:00.000Z",
  );
  assert.equal(
    analyticsDateBoundary("2026-03-08", "America/New_York"),
    "2026-03-08T05:00:00.000Z",
  );
  assert.equal(
    analyticsDateBoundary("2026-03-09", "America/New_York"),
    "2026-03-09T04:00:00.000Z",
  );
  assert.equal(
    analyticsDateBoundary("2026-11-02", "America/New_York"),
    "2026-11-02T05:00:00.000Z",
  );
  assert.throws(() => analyticsDateBoundary("2026-02-30", "UTC"));
  const report = buildAnalytics(
    [base({ createdAt: input.from }), base({ createdAt: input.to })],
    { ...input, timeZone: "Asia/Kolkata" },
    now,
  );
  assert.equal(report.counts.incoming, 1);
  assert.equal(report.trend[0].date, "2026-01-01");
  assert.equal(report.trend[0].incoming, 1);
  assert.throws(() =>
    analyticsInputs["analytics.get"].parse({ ...input, timeZone: "imaginary/place" }),
  );
  assert.throws(() =>
    analyticsInputs["analytics.get"].parse({ ...input, to: "2028-01-01T00:00:00Z" }),
  );
  assert.throws(() =>
    analyticsInputs["analytics.get"].parse({
      ...input,
      detail: { metric: "backlog", dimension: "assignee" },
    }),
  );
});

test("analytics handles high-cardinality labels without losing totals and exports no private labels or formulas", () => {
  const records = Array.from({ length: 100 }, (_, index) =>
    base({
      projectName: "=HYPERLINK(secret)",
      category: `Private category ${index}`,
      assignees: [{ id: `member${index}`, name: "Private member" }],
    }),
  );
  const report = buildAnalytics(records, input, now);
  assert.equal(report.breakdowns.category.length, 31);
  assert.equal(report.breakdowns.category.at(-1)?.count, 70);
  assert.equal(
    report.breakdowns.category.reduce((sum, row) => sum + row.count, 0),
    100,
  );
  const csv = analyticsCsv(report);
  assert.match(csv, /"incoming","100"/);
  for (const secret of [
    "Private category",
    "Private member",
    "HYPERLINK",
    "example.test",
    records[0].id,
  ])
    assert.ok(!csv.includes(secret));
});

test("analytics SQL honors current grants and token project limits, response intent and deletion, including bounded large-workspace failure", async () => {
  const pg = new PGlite(),
    db = new Database(pg as any);
  try {
    await migrate(db);
    const ownerId = randomUUID(),
      viewerId = randomUUID(),
      otherId = randomUUID(),
      projectId = randomUUID(),
      emptyProjectId = randomUUID(),
      privateId = randomUUID();
    for (const [id, name, owner] of [
      [ownerId, "Owner", true],
      [viewerId, "Viewer", false],
      [otherId, "Developer", false],
    ] as const)
      await db.query(
        "INSERT INTO users(id,email,name,password_hash,owner) VALUES($1,$2,$3,'synthetic',$4)",
        [id, `${id}@example.test`, name, owner],
      );
    await db.query("INSERT INTO projects(id,data) VALUES($1,$2),($3,$4)", [
      projectId,
      JSON.stringify({ name: "Allowed" }),
      privateId,
      JSON.stringify({ name: "PRIVATE-PROJECT" }),
    ]);
    await db.query("INSERT INTO grants(project_id,user_id,role) VALUES($1,$2,'viewer')", [
      projectId,
      viewerId,
    ]);
    await db.query("INSERT INTO projects(id,data) VALUES($1,$2)", [
      emptyProjectId,
      JSON.stringify({ name: "Allowed empty" }),
    ]);
    await db.query("INSERT INTO grants(project_id,user_id,role) VALUES($1,$2,'viewer')", [
      emptyProjectId,
      viewerId,
    ]);
    const threadId = randomUUID(),
      privateThreadId = randomUUID();
    const data = {
      body: "PRIVATE DISCUSSION",
      author: { userId: viewerId },
      category: "custom:classified-later",
      context: { url: "https://example.test/path?secret=token", deviceClass: "mobile" },
      tags: ["PRIVATE-TAG"],
      archived: false,
      topPriority: true,
      workPlan: {
        priority: "normal",
        schedule: "today",
        scheduledFor: new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10),
        timeZone: "UTC",
      },
      work: { state: "open", history: [] },
    };
    await db.query(
      "INSERT INTO threads(id,project_id,data,created_at,updated_at) VALUES($1,$2,$3,'2026-01-01T00:00:00Z','2026-01-10T00:00:00Z'),($4,$5,$3,'2026-01-01T00:00:00Z','2026-01-10T00:00:00Z')",
      [threadId, projectId, JSON.stringify(data), privateThreadId, privateId],
    );
    for (const [authorId, intent, at] of [
      [viewerId, "response", "2026-01-01 01:00Z"],
      [otherId, "request", "2026-01-01 02:00Z"],
      [otherId, "response", "2026-01-01 03:00Z"],
    ])
      await db.query(
        "INSERT INTO replies(id,thread_id,data,created_at) VALUES($1,$2,$3,$4)",
        [
          randomUUID(),
          threadId,
          JSON.stringify({ author: { userId: authorId }, intent, body: "PRIVATE REPLY" }),
          at,
        ],
      );
    await db.query(
      "INSERT INTO events(project_id,entity_id,kind,actor,data,created_at) VALUES($1,$2,'threads.organize','{}','{}','2026-01-04T00:00:00Z')",
      [projectId, threadId],
    );
    await db.query(
      "INSERT INTO work_delegations(id,project_id,thread_id,annotation_ids,user_id,summary,category,tags,github_decision,github_rationale,updated_by) VALUES($1,$2,$3,'[]',$4,'synthetic','general','[]','undecided','synthetic','{}')",
      [randomUUID(), projectId, threadId, otherId],
    );
    const viewer: Actor = {
      id: viewerId,
      userId: viewerId,
      kind: "human",
      name: "Viewer",
      owner: false,
    };
    const report = await analyticsGet(db, viewer, {
      ...input,
      detail: { metric: "incoming", offset: 0, limit: 25 },
    });
    assert.equal(report.counts.incoming, 1);
    assert.equal(report.projectCount, 2);
    assert.equal(report.counts.overdue, 1);
    assert.equal(report.counts.high_priority, 1);
    assert.deepEqual(report.currentProjects, [
      {
        projectId,
        projectName: "Allowed",
        pending: 1,
        overdue: 1,
        highPriority: 1,
        stalled: 1,
      },
      {
        projectId: emptyProjectId,
        projectName: "Allowed empty",
        pending: 0,
        overdue: 0,
        highPriority: 0,
        stalled: 0,
      },
    ]);
    assert.equal(report.durations.firstResponse.medianHours, 3);
    assert.equal(
      report.durations.firstTriage.medianHours,
      72,
      "later classification must not be backdated to capture",
    );
    assert.deepEqual(
      report.breakdowns.assignee.map((row) => row.label),
      ["Developer"],
    );
    assert.deepEqual(
      report.details?.items.map((row) => row.id),
      [threadId],
    );
    assert.ok(!JSON.stringify(report).includes("PRIVATE-PROJECT"));
    assert.ok(!JSON.stringify(report).includes("PRIVATE DISCUSSION"));
    assert.ok(!JSON.stringify(report).includes("secret=token"));
    assert.equal(report.details?.items[0].workPlan?.timeZone, "UTC");
    assert.equal(report.details?.items[0].topPriority, true);
    const forbiddenDetail = await analyticsGet(db, viewer, {
      ...input,
      detail: {
        metric: "overdue",
        dimension: "project",
        key: privateId,
        offset: 0,
        limit: 25,
      },
    });
    assert.equal(forbiddenDetail.details?.total, 0);
    assert.ok(!JSON.stringify(forbiddenDetail).includes("PRIVATE-PROJECT"));
    await assert.rejects(analyticsGet(db, viewer, { ...input, projectId: privateId }), {
      code: "FORBIDDEN",
    });
    const restricted = await analyticsGet(
      db,
      { ...viewer, owner: true, projects: [projectId] },
      input,
    );
    assert.equal(restricted.projectCount, 1);
    const noTokenProject = await analyticsGet(
      db,
      { ...viewer, projects: [privateId] },
      input,
    );
    assert.equal(noTokenProject.projectCount, 0);
    assert.equal(noTokenProject.counts.incoming, 0);
    const noProjects = await analyticsGet(
      db,
      { ...viewer, owner: true, projects: [] },
      input,
    );
    assert.equal(noProjects.projectCount, 0);
    await assert.rejects(
      analyticsGet(db, { ...viewer, mustChangePassword: true }, input),
      { code: "PASSWORD_CHANGE_REQUIRED" },
    );
    await db.query(
      "DELETE FROM replies WHERE thread_id=$1 AND data->>'intent'='response' AND data->'author'->>'userId'=$2",
      [threadId, otherId],
    );
    assert.equal(
      (await analyticsGet(db, viewer, input)).durations.firstResponse.sample,
      0,
    );
    await db.query("DELETE FROM grants WHERE user_id=$1", [viewerId]);
    assert.equal((await analyticsGet(db, viewer, input)).projectCount, 0);
    const owner: Actor = { ...viewer, id: ownerId, userId: ownerId, owner: true };
    await db.query(
      "INSERT INTO threads(id,project_id,data,created_at,updated_at) SELECT md5('analytics-large-'||n)::uuid,$1,'{\"work\":{\"state\":\"open\",\"history\":[]}}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z' FROM generate_series(1,10000) n",
      [projectId],
    );
    await assert.rejects(
      analyticsGet(db, owner, { ...input, projectId }),
      /exceeds 10,000 threads/,
    );
    // Unrelated large projects do not prevent a narrow authorized report.
    assert.equal(
      (await analyticsGet(db, owner, { ...input, projectId: privateId })).counts.incoming,
      1,
    );
  } finally {
    await pg.close();
  }
});
