import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { Database } from "../src/server/db.js";
import { migrate } from "../src/server/migrations.js";
import { Operations } from "../src/server/operations.js";

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
  const p = await call(owner, "projects.create", {
    name: "Assignments",
    origins: ["https://example.test"],
  });
  async function member(name: string, role?: string) {
    const m = await call(owner, "members.create", {
      email: `${name}@example.test`,
      name,
      password: "Correct-Horse-Battery-123",
      grants: role ? [{ projectId: p.id, role }] : [],
    });
    return { ...owner, id: m.id, userId: m.id, owner: false, primaryOwner: false, name };
  }
  const writer = await member("Writer", "reviewer"),
    assignee = await member("Assignee", "reviewer"),
    viewer = await member("Viewer", "viewer"),
    outsider = await member("Outsider");
  const points = [randomUUID(), randomUUID()];
  const thread = await call(owner, "threads.create", {
    projectId: p.id,
    body: "Review",
    context: {
      url: "https://example.test",
      viewport: { width: 1000, height: 800 },
      annotations: points.map((id) => ({
        id,
        body: "Point",
        anchor: { selector: "#field" },
      })),
    },
    idempotencyKey: "assignment-thread",
  });
  const request = {
    threadId: thread.id,
    threadRevision: thread.revision,
    userId: assignee.userId,
    annotationIds: [points[0]],
    summary: "Repair first field",
    category: "usabilityAccessibility",
    tags: ["Keyboard"],
    githubDecision: "not_needed",
    githubRationale: "Small local fix",
    idempotencyKey: "assign",
  };
  return {
    pg,
    db,
    ops,
    owner,
    call,
    p,
    writer,
    assignee,
    viewer,
    outsider,
    points,
    thread,
    request,
  };
}

test("durable delegation preserves triage, authenticated human and agent history, revisions and stable retries", async () => {
  const f = await fixture();
  const { call, writer, assignee, request, thread, p, owner, ops } = f;
  try {
    const key = await call(writer, "tokens.create", {
      name: "Writer Codex",
      projectIds: [p.id],
      scopes: [
        "assignments.assign",
        "assignments.cancel",
        "assignments.delegations",
        "assignments.history",
      ],
    });
    const agent = await ops.auth.authenticate(key.token);
    const assigned = await call(agent, "assignments.assign", {
      ...request,
      updatedBy: { userId: owner.id, memberName: "Forged" },
    });
    assert.equal(assigned.userId, assignee.userId);
    assert.equal(assigned.memberName, "Assignee");
    assert.deepEqual(assigned.updatedBy, {
      userId: writer.userId,
      memberName: "Writer",
      agentId: agent.id,
      agentName: "Writer Codex",
    });
    assert.deepEqual(assigned.tags, ["keyboard"]);
    assert.equal(assigned.githubDecision, "not_needed");
    const changed = await call(writer, "assignments.assign", {
      ...request,
      idempotencyKey: "reassign",
      delegationId: assigned.id,
      revision: 1,
      userId: owner.userId,
      githubDecision: "create_issue",
      githubRationale: "Needs tracking",
    });
    assert.equal(changed.revision, 2);
    assert.equal(changed.updatedBy.agentId, null);
    assert.deepEqual(
      await call(agent, "assignments.assign", request),
      assigned,
      "retry returns original immutable receipt after reassignment",
    );
    await assert.rejects(
      call(agent, "assignments.assign", { ...request, summary: "Different" }),
      { code: "CONFLICT" },
    );
    await assert.rejects(
      call(writer, "assignments.assign", {
        ...request,
        idempotencyKey: "stale",
        delegationId: assigned.id,
        revision: 1,
      }),
      { code: "CONFLICT" },
    );
    const cancel = {
      delegationId: assigned.id,
      revision: 2,
      idempotencyKey: "cancel",
      reason: "Replanned",
    };
    const cancelled = await call(writer, "assignments.cancel", cancel);
    assert.equal(cancelled.state, "cancelled");
    assert.deepEqual(await call(writer, "assignments.cancel", cancel), cancelled);
    await assert.rejects(
      call(writer, "assignments.cancel", { ...cancel, idempotencyKey: "stale-cancel" }),
      { code: "CONFLICT" },
    );
    const page = await call(agent, "assignments.history", {
      delegationId: assigned.id,
      limit: 2,
    });
    assert.equal(page.total, 3);
    assert.equal(page.nextOffset, 2);
    assert.deepEqual(
      page.items.map((x: any) => x.action),
      ["cancelled", "reassigned"],
    );
    const original = await call(agent, "assignments.history", {
      delegationId: assigned.id,
      offset: 2,
    });
    assert.deepEqual(original.items[0].assignment, assigned);
    assert.equal(original.items[0].actor.memberName, "Writer");
    assert.equal(
      (await call(writer, "assignments.delegations", { projectId: p.id })).total,
      0,
    );
    assert.equal(
      (
        await call(writer, "assignments.delegations", {
          projectId: p.id,
          state: "all",
          threadId: thread.id,
          userId: owner.userId,
        })
      ).total,
      1,
    );
    assert.equal(
      (await call(owner, "threads.get", { threadId: thread.id })).externalIssues.length,
      0,
    );
    // Crossing decimal digit boundaries must not sort the text cursor alias.
    for (let n = 0; n < 12; n++)
      await f.db.query(
        "INSERT INTO events(project_id,entity_id,kind,actor,data) VALUES($1,$2,'synthetic.cursor','{}','{}')",
        [p.id, thread.id],
      );
    const changes = await call(owner, "context.changes", {
      projectId: p.id,
      cursor: "0",
      limit: 100,
    });
    for (let n = 1; n < changes.items.length; n++)
      assert.ok(BigInt(changes.items[n].cursor) > BigInt(changes.items[n - 1].cursor));
  } finally {
    await f.pg.close();
  }
});

test("delegation authorization, open scope validation and claim ownership prevent conflicting work", async () => {
  const f = await fixture();
  const {
    call,
    owner,
    writer,
    assignee,
    viewer,
    outsider,
    request,
    p,
    points,
    thread,
    ops,
    db,
  } = f;
  try {
    for (const actor of [viewer, outsider])
      await assert.rejects(call(actor, "assignments.assign", request), {
        code: "FORBIDDEN",
      });
    for (const target of [viewer, outsider])
      await assert.rejects(
        call(writer, "assignments.assign", { ...request, userId: target.userId }),
        { code: "VALIDATION" },
      );
    await assert.rejects(
      call(writer, "assignments.assign", { ...request, threadRevision: 99 }),
      { code: "CONFLICT" },
    );
    await assert.rejects(
      call(writer, "assignments.assign", { ...request, annotationIds: [randomUUID()] }),
      { code: "VALIDATION" },
    );
    const old = await call(writer, "tokens.create", {
      name: "Old",
      projectIds: [p.id],
      scopes: ["assignments.list"],
    });
    await assert.rejects(
      call(await ops.auth.authenticate(old.token), "assignments.assign", request),
      { code: "FORBIDDEN" },
    );
    await assert.rejects(
      call(writer, "assignments.assign", {
        ...request,
        githubDecision: "already_linked",
      }),
      { code: "VALIDATION" },
    );
    await assert.rejects(
      call(writer, "assignments.assign", { ...request, delegationId: randomUUID() }),
      { code: "VALIDATION" },
    );
    await assert.rejects(
      call(writer, "assignments.delegations", { projectId: p.id, limit: 51 }),
      { code: "VALIDATION" },
    );
    await assert.rejects(
      call(writer, "assignments.assign", {
        ...request,
        tags: Array.from({ length: 13 }, (_, n) => `tag${n}`),
      }),
      { code: "VALIDATION" },
    );
    const assigned = await call(writer, "assignments.assign", request);
    await assert.rejects(
      call(outsider, "assignments.history", { delegationId: assigned.id }),
      { code: "FORBIDDEN" },
    );
    await assert.rejects(
      call(viewer, "assignments.cancel", {
        delegationId: assigned.id,
        revision: 1,
        idempotencyKey: "deny",
        reason: "No",
      }),
      { code: "FORBIDDEN" },
    );
    await assert.rejects(
      call(writer, "assignments.assign", { ...request, idempotencyKey: "overlap" }),
      { code: "CONFLICT" },
    );
    await assert.rejects(
      call(writer, "assignments.assign", {
        ...request,
        annotationIds: [],
        idempotencyKey: "whole",
      }),
      { code: "CONFLICT" },
    );
    const second = await call(writer, "assignments.assign", {
      ...request,
      annotationIds: [points[1]],
      userId: writer.userId,
      idempotencyKey: "second",
    });
    const claim = {
      threadId: thread.id,
      revision: thread.revision,
      annotationIds: [points[0]],
      summary: "Working",
      idempotencyKey: "claim",
    };
    await assert.rejects(call(writer, "assignments.claim", claim), { code: "CONFLICT" });
    await assert.rejects(
      call(owner, "assignments.claim", { ...claim, annotationIds: [] }),
      { code: "CONFLICT" },
    );
    const workerKey = await call(assignee, "tokens.create", {
      name: "Assignee Codex",
      projectIds: [p.id],
      scopes: ["assignments.claim", "assignments.renew"],
    });
    const worker = await ops.auth.authenticate(workerKey.token);
    const claimed = await call(worker, "assignments.claim", claim);
    assert.equal(claimed.userId, assignee.userId);
    await assert.rejects(
      call(writer, "assignments.assign", {
        ...request,
        delegationId: assigned.id,
        revision: 1,
        userId: writer.userId,
        idempotencyKey: "busy",
      }),
      { code: "CONFLICT" },
    );
    await call(writer, "assignments.cancel", {
      delegationId: assigned.id,
      revision: 1,
      idempotencyKey: "cancel",
      reason: "New plan",
    });
    await assert.rejects(
      call(writer, "assignments.assign", {
        ...request,
        userId: writer.userId,
        idempotencyKey: "busy-new",
      }),
      { code: "CONFLICT" },
    );
    await db.query(
      "UPDATE work_claims SET expires_at=now()-interval '1 minute' WHERE id=$1",
      [claimed.id],
    );
    await db.query("UPDATE users SET active=false WHERE id=$1", [assignee.userId]);
    await assert.rejects(
      call(writer, "assignments.assign", { ...request, idempotencyKey: "inactive" }),
      { code: "VALIDATION" },
    );
    await db.query(
      "UPDATE threads SET data=jsonb_set(data,'{annotationStates}', $2::jsonb) WHERE id=$1",
      [thread.id, JSON.stringify({ [points[0]]: { state: "resolved" } })],
    );
    await assert.rejects(
      call(writer, "assignments.assign", {
        ...request,
        userId: writer.userId,
        idempotencyKey: "closed-point",
      }),
      { code: "CONFLICT" },
    );
    await db.query(
      "UPDATE threads SET data=jsonb_set(data,'{work,state}','\"resolved\"') WHERE id=$1",
      [thread.id],
    );
    await assert.rejects(
      call(writer, "assignments.assign", {
        ...request,
        delegationId: second.id,
        revision: 1,
        annotationIds: [points[1]],
        userId: writer.userId,
        idempotencyKey: "closed-thread",
      }),
      { code: "CONFLICT" },
    );
  } finally {
    await f.pg.close();
  }
});

test("personal GitHub issue scope requires maintainer on every selected project", async () => {
  const f = await fixture();
  const { call, writer, owner, p, ops } = f;
  try {
    const input = {
      name: "Optional GitHub",
      projectIds: [p.id],
      scopes: ["github.issueCreate"],
    };
    await assert.rejects(call(writer, "tokens.create", input), { code: "FORBIDDEN" });
    await f.db.query(
      "UPDATE grants SET role='maintainer' WHERE project_id=$1 AND user_id=$2",
      [p.id, writer.userId],
    );
    const key = await call(writer, "tokens.create", input);
    const agent = await ops.auth.authenticate(key.token);
    assert.ok(agent.scopes?.includes("github.issueCreate"));
    const other = await call(owner, "projects.create", {
      name: "Other",
      origins: ["https://other.test"],
    });
    await assert.rejects(
      call(writer, "tokens.create", { ...input, projectIds: [p.id, other.id] }),
      { code: "FORBIDDEN" },
    );
  } finally {
    await f.pg.close();
  }
});
