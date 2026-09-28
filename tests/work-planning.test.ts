import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { Database } from "../src/server/db.js";
import { migrate } from "../src/server/migrations.js";
import { Operations } from "../src/server/operations.js";
import { outputSchemas } from "../src/shared/contracts.js";

async function fixture() {
  const pg = new PGlite(),
    db = new Database(pg as any);
  await migrate(db);
  const ops = new Operations(db, {} as any, {} as any);
  const owner = await ops.auth.bootstrap(
    "owner@example.test",
    "Owner",
    "Correct-Horse-Battery-123",
  );
  const call = (a: any, n: string, i: any) => ops.executeOperation(a, n, i);
  const project = await call(owner, "projects.create", {
    name: "Planning",
    origins: ["https://example.test"],
  });
  async function member(name: string, role?: string) {
    const m = await call(owner, "members.create", {
      name,
      email: `${name}@example.test`,
      password: "Correct-Horse-Battery-123",
      grants: role ? [{ projectId: project.id, role }] : [],
    });
    return { ...owner, id: m.id, userId: m.id, owner: false, primaryOwner: false };
  }
  const writer = await member("Writer", "reviewer"),
    viewer = await member("Viewer", "viewer"),
    outsider = await member("Outsider");
  async function thread(body: string) {
    return call(owner, "threads.create", {
      projectId: project.id,
      body,
      context: {
        url: "https://example.test",
        viewport: { width: 1000, height: 800 },
        annotations: [
          { id: randomUUID(), body: "First", anchor: { selector: "#a" } },
          { id: randomUUID(), body: "Second", anchor: { selector: "#b" } },
        ],
      },
      idempotencyKey: randomUUID(),
    });
  }
  return { pg, db, ops, owner, call, project, writer, viewer, outsider, thread };
}
const normal = {
  priority: "normal",
  schedule: "unscheduled",
  scheduledFor: null,
  timeZone: "UTC",
};

test("thread planning validates real calendar dates and zones, protects revisions/scopes, and records authenticated changes", async () => {
  const f = await fixture();
  const { call, owner, writer, viewer, outsider, project, ops, db } = f;
  try {
    const thread = await f.thread("Plan this work");
    assert.deepEqual(thread.workPlan, normal);
    const plan = {
      priority: "high",
      schedule: "tomorrow",
      scheduledFor: "2026-10-01",
      timeZone: "Asia/Kolkata",
    };
    const request = { threadId: thread.id, revision: thread.revision, workPlan: plan };
    for (const actor of [viewer, outsider])
      await assert.rejects(call(actor, "threads.plan", request), { code: "FORBIDDEN" });
    const oldKey = await call(writer, "tokens.create", {
      name: "Old scope",
      projectIds: [project.id],
      scopes: ["threads.get"],
    });
    await assert.rejects(
      call(await ops.auth.authenticate(oldKey.token), "threads.plan", request),
      { code: "FORBIDDEN" },
    );
    const key = await call(writer, "tokens.create", {
      name: "Planner",
      projectIds: [project.id],
      scopes: ["threads.plan", "threads.get"],
    });
    const agent = await ops.auth.authenticate(key.token);
    const changed = await call(agent, "threads.plan", request);
    assert.deepEqual(changed.workPlan, plan);
    assert.equal(changed.revision, 2);
    outputSchemas["threads.plan"].parse(changed);
    assert.equal(changed.lastActor.id, agent.id);
    await assert.rejects(call(writer, "threads.plan", request), { code: "CONFLICT" });
    assert.deepEqual(
      (await call(writer, "threads.get", { threadId: thread.id })).workPlan,
      plan,
    );
    const event = await db.one(
      "SELECT actor,data FROM events WHERE entity_id=$1 AND kind='threads.plan'",
      [thread.id],
    );
    assert.equal(event.actor.id, agent.id);
    assert.deepEqual(event.data.workPlan, plan);
    for (const invalid of [
      { ...plan, scheduledFor: "2026-02-30" },
      { ...plan, scheduledFor: "2026-02-29" },
      { ...plan, scheduledFor: "0000-01-01" },
      { ...plan, scheduledFor: "2026-13-01" },
      { ...plan, scheduledFor: "2026-1-01" },
      { ...plan, scheduledFor: null },
      { ...plan, timeZone: "Made/Up" },
      { ...plan, timeZone: "+05:30" },
      { ...plan, schedule: "later" },
      { ...plan, schedule: "unscheduled" },
    ])
      await assert.rejects(
        call(writer, "threads.plan", { ...request, revision: 2, workPlan: invalid }),
        { code: "VALIDATION" },
      );
    const leap = await call(writer, "threads.plan", {
      ...request,
      revision: 2,
      workPlan: { ...plan, scheduledFor: "2028-02-29" },
    });
    const cleared = await call(owner, "threads.plan", {
      ...request,
      revision: leap.revision,
      workPlan: normal,
    });
    assert.deepEqual(cleared.workPlan, normal);
  } finally {
    await f.pg.close();
  }
});

test("point plans persist independently with project write access, revision checks and an audit event", async () => {
  const f = await fixture();
  const { call, writer, viewer, outsider, project, db } = f;
  try {
    const thread = await f.thread("Plan individual points");
    const annotationId = thread.context.annotations[0].id;
    const workPlan = {
      priority: "high",
      schedule: "today",
      scheduledFor: "2026-09-28",
      timeZone: "Asia/Kolkata",
    };
    const request = {
      threadId: thread.id,
      revision: thread.revision,
      annotationId,
      workPlan,
    };
    for (const actor of [viewer, outsider])
      await assert.rejects(call(actor, "threads.annotationPlan", request), {
        code: "FORBIDDEN",
      });
    const oldKey = await call(writer, "tokens.create", {
      name: "Old point scope",
      projectIds: [project.id],
      scopes: ["threads.get"],
    });
    await assert.rejects(
      call(
        await f.ops.auth.authenticate(oldKey.token),
        "threads.annotationPlan",
        request,
      ),
      { code: "FORBIDDEN" },
    );
    const key = await call(writer, "tokens.create", {
      name: "Point planner",
      projectIds: [project.id],
      scopes: ["threads.annotationPlan", "threads.get"],
    });
    const agent = await f.ops.auth.authenticate(key.token);
    await assert.rejects(
      call(writer, "threads.annotationPlan", { ...request, annotationId: randomUUID() }),
      { code: "NOT_FOUND" },
    );
    const changed = await call(agent, "threads.annotationPlan", request);
    assert.deepEqual(changed.annotationPlans[annotationId], workPlan);
    assert.equal(changed.annotationPlans[thread.context.annotations[1].id], undefined);
    assert.equal(changed.revision, thread.revision + 1);
    assert.deepEqual(
      (await call(writer, "threads.get", { threadId: thread.id })).annotationPlans,
      changed.annotationPlans,
    );
    assert.deepEqual(
      (await call(writer, "threads.list", { projectId: project.id })).items[0]
        .annotationPlans,
      changed.annotationPlans,
    );
    await assert.rejects(call(writer, "threads.annotationPlan", request), {
      code: "CONFLICT",
    });
    const resolved = await call(f.owner, "threads.annotationStatus", {
      threadId: thread.id,
      revision: changed.revision,
      annotationId,
      state: "resolved",
    });
    await assert.rejects(
      call(writer, "threads.annotationPlan", { ...request, revision: resolved.revision }),
      { code: "VALIDATION" },
    );
    assert.deepEqual(resolved.annotationPlans[annotationId], workPlan);
    const event = await db.one(
      "SELECT data FROM events WHERE entity_id=$1 AND kind='threads.annotationPlan'",
      [thread.id],
    );
    assert.equal(event.data.annotationId, annotationId);
    assert.deepEqual(event.data.workPlan, workPlan);
    assert.equal(changed.lastActor.id, agent.id);
  } finally {
    await f.pg.close();
  }
});

test("assigned work is filtered and human plans ordered in SQL before pagination and neighbor navigation", async () => {
  const f = await fixture();
  const { call, owner, writer, project, db } = f;
  try {
    const items = [];
    for (let n = 0; n < 12; n++) items.push(await f.thread(`Task ${n}`));
    async function assign(t: any, point: number, key: string) {
      return call(owner, "assignments.assign", {
        threadId: t.id,
        threadRevision: t.revision,
        userId: writer.userId,
        annotationIds: [t.context.annotations[point].id],
        summary: "Assigned",
        category: "general",
        tags: [],
        githubDecision: "undecided",
        githubRationale: "Human chooses next",
        idempotencyKey: key,
      });
    }
    // Older assignments would be absent if the client filtered a recent first page.
    for (let n = 0; n < 6; n++) await assign(items[n], 0, `assign-${n}`);
    await assign(items[0], 1, "second-point-same-thread");
    const cancelled = await assign(items[6], 0, "cancelled-work");
    await call(owner, "assignments.cancel", {
      delegationId: cancelled.id,
      revision: 1,
      reason: "No longer assigned",
      idempotencyKey: "cancel-work",
    });
    const plans = [
      normal,
      { ...normal, priority: "high", schedule: "later" },
      { ...normal, priority: "low", schedule: "today", scheduledFor: "2026-09-29" },
      { ...normal, priority: "high", schedule: "next_week", scheduledFor: "2026-10-07" },
      { ...normal, priority: "high" },
      { ...normal, priority: "normal", schedule: "tomorrow", scheduledFor: "2026-10-01" },
    ];
    for (let n = 0; n < plans.length; n++)
      await call(owner, "threads.plan", {
        threadId: items[n].id,
        revision: items[n].revision,
        workPlan: plans[n],
      });
    await db.query(
      "UPDATE threads SET data=jsonb_set(data,'{topPriority}','true') WHERE id=$1",
      [items[1].id],
    );
    const filters = {
      projectId: project.id,
      assignedTo: writer.userId,
      sort: "workPlan",
      planningDate: "2026-09-30",
      limit: 2,
    };
    const first = await call(writer, "threads.list", {
      ...filters,
      includeSummary: true,
    });
    assert.equal(first.total, 6);
    assert.deepEqual(
      first.items.map((t: any) => t.id),
      [items[4].id, items[0].id],
    );
    const second = await call(writer, "threads.list", {
      ...filters,
      offset: first.nextOffset,
    });
    assert.deepEqual(
      second.items.map((t: any) => t.id),
      [items[2].id, items[3].id],
    );
    const third = await call(writer, "threads.list", {
      ...filters,
      offset: second.nextOffset,
    });
    assert.deepEqual(
      third.items.map((t: any) => t.id),
      [items[5].id, items[1].id],
    );
    assert.equal(third.nextOffset, null);
    const nav = await call(writer, "threads.neighbors", {
      ...filters,
      threadId: items[2].id,
    });
    assert.equal(nav.previous, items[0].id);
    assert.equal(nav.next, items[3].id);
    assert.equal(nav.total, 6);
    await assert.rejects(
      call(writer, "threads.list", { ...filters, planningDate: "2026-02-30" }),
      { code: "VALIDATION" },
    );
    assert.equal(
      (await call(writer, "threads.list", { ...filters, assignedTo: owner.userId }))
        .total,
      0,
    );
    const newerDate = await call(writer, "threads.list", {
      ...filters,
      planningDate: "2026-10-10",
      limit: 10,
    });
    assert.deepEqual(
      newerDate.items.map((t: any) => t.id),
      [items[3].id, items[4].id, items[5].id, items[0].id, items[2].id, items[1].id],
    );
    // A completed point must not make its unassigned open sibling appear as assigned work.
    await db.query(
      "UPDATE threads SET data=jsonb_set(data,'{annotationStates}',$2::jsonb) WHERE id=$1",
      [
        items[2].id,
        JSON.stringify({ [items[2].context.annotations[0].id]: { state: "resolved" } }),
      ],
    );
    await db.query(
      "UPDATE threads SET data=jsonb_set(data,'{context,annotations}',$2::jsonb) WHERE id=$1",
      [items[3].id, JSON.stringify([items[3].context.annotations[1]])],
    );
    // Multiple selected delegations still match when only one assigned point remains open.
    await db.query(
      "UPDATE threads SET data=jsonb_set(data,'{annotationStates}',$2::jsonb) WHERE id=$1",
      [
        items[0].id,
        JSON.stringify({ [items[0].context.annotations[0].id]: { state: "resolved" } }),
      ],
    );
    const eligible = await call(writer, "threads.list", { ...filters, limit: 10 });
    assert.equal(eligible.total, 4);
    assert.deepEqual(
      eligible.items.map((t: any) => t.id),
      [items[4].id, items[0].id, items[5].id, items[1].id],
    );
  } finally {
    await f.pg.close();
  }
});
