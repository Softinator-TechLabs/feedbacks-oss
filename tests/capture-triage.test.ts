import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { Database } from "../src/server/db.js";
import { migrate } from "../src/server/migrations.js";
import { Operations } from "../src/server/operations.js";

test("capture triage is atomic, scoped, retry-safe and uses durable assignments", async () => {
  const pg = new PGlite(),
    db = new Database(pg as any);
  try {
    await migrate(db);
    const ops = new Operations(db, {} as any, {} as any);
    const owner = await ops.auth.bootstrap(
      "owner@example.test",
      "Owner",
      "Correct-Horse-Battery-123",
    );
    const call = (actor: any, operation: string, input: any) =>
      ops.executeOperation(actor, operation, input);
    const project = await call(owner, "projects.create", {
      name: "Capture triage",
      origins: ["https://example.test"],
    });
    const member = await call(owner, "members.create", {
      name: "Developer",
      email: "developer@example.test",
      password: "Correct-Horse-Battery-123",
      grants: [{ projectId: project.id, role: "reviewer" }],
    });
    const input = {
      projectId: project.id,
      body: "Repair the login field",
      context: { url: "https://example.test", viewport: { width: 1280, height: 800 } },
      triage: { priority: "high", assigneeId: member.id },
      idempotencyKey: "capture-triage",
    };
    const created = await call(owner, "threads.create", input);
    assert.equal(created.workPlan.priority, "high");
    assert.equal(created.workPlan.schedule, "unscheduled");
    const assigned = await call(owner, "assignments.delegations", {
      projectId: project.id,
      threadId: created.id,
    });
    assert.equal(assigned.items.length, 1);
    assert.equal(assigned.items[0].userId, member.id);
    assert.equal(assigned.items[0].githubDecision, "undecided");
    assert.deepEqual(assigned.items[0].annotationIds, []);
    assert.equal((await call(owner, "threads.create", input)).id, created.id);
    assert.equal(
      (
        await call(owner, "assignments.delegations", {
          projectId: project.id,
          threadId: created.id,
        })
      ).total,
      1,
    );
    await assert.rejects(
      call(owner, "threads.create", {
        ...input,
        triage: { ...input.triage, priority: "low" },
      }),
      /different content/,
    );
    const before = await db.one("SELECT count(*) FROM threads");
    await assert.rejects(
      call(owner, "threads.create", {
        ...input,
        idempotencyKey: "missing-assignee",
        triage: { assigneeId: randomUUID(), priority: "high" },
      }),
      /active writable/,
    );
    assert.equal((await db.one("SELECT count(*) FROM threads")).count, before.count);
    const limited = await ops.auth.issueToken(
      db,
      owner,
      {
        name: "Old extension",
        projectIds: [project.id],
        scopes: ["threads.create"],
        expiresInDays: 30,
      },
      "extension",
    );
    const oldActor = await ops.auth.authenticate(limited.token);
    await assert.rejects(
      call(oldActor, "threads.create", { ...input, idempotencyKey: "old-extension" }),
      /threads.plan/,
    );
    await assert.rejects(
      call(oldActor, "threads.create", {
        ...input,
        triage: { assigneeId: member.id },
        idempotencyKey: "old-assignment",
      }),
      /assignments.assign/,
    );
    assert.equal(
      (
        await call(oldActor, "threads.create", {
          ...input,
          triage: undefined,
          idempotencyKey: "old-normal-capture",
        })
      ).work.state,
      "open",
    );
    await db.query("UPDATE users SET active=false WHERE id=$1", [member.id]);
    await assert.rejects(
      call(owner, "threads.create", { ...input, idempotencyKey: "inactive-assignee" }),
      /active writable/,
    );
  } finally {
    await pg.close();
  }
});

test("assignee search stays bounded, minimal and inside the writable project population", async () => {
  const pg = new PGlite(),
    db = new Database(pg as any);
  try {
    await migrate(db);
    const ops = new Operations(db, {} as any, {} as any);
    const owner = await ops.auth.bootstrap(
      "owner@example.test",
      "Owner",
      "Correct-Horse-Battery-123",
    );
    const call = (operation: string, input: any) =>
      ops.executeOperation(owner, operation, input);
    const project = await call("projects.create", {
      name: "Large team",
      origins: ["https://example.test"],
    });
    for (let index = 0; index < 102; index++) {
      const id = randomUUID(),
        name = `Developer ${String(index).padStart(3, "0")}`;
      await db.query(
        "INSERT INTO users(id,email,name,password_hash,active) SELECT $1,$2,$3,password_hash,$4 FROM users WHERE id=$5",
        [id, `developer${index}@example.test`, name, index !== 100, owner.userId],
      );
      if (index !== 101)
        await db.query("INSERT INTO grants(project_id,user_id,role) VALUES($1,$2,$3)", [
          project.id,
          id,
          index === 99 ? "viewer" : "reviewer",
        ]);
    }
    const page = (search = "", offset = 0) =>
      call("members.list", { projectId: project.id, assignees: { search, offset } });
    const first = await page("Developer");
    assert.equal(first.total, 99);
    assert.equal(first.items.length, 10);
    assert.equal(first.nextOffset, 10);
    assert.deepEqual(Object.keys(first.items[0]).sort(), [
      "active",
      "id",
      "name",
      "owner",
      "role",
    ]);
    const second = await page("Developer", first.nextOffset);
    assert.equal(second.items.length, 10);
    assert.ok(
      second.items.every(
        (item: any) => !first.items.some((prior: any) => prior.id === item.id),
      ),
    );
    const late = await page("developer 098");
    assert.equal(late.items.length, 1);
    assert.equal(late.items[0].name, "Developer 098");
    assert.equal(late.nextOffset, null);
    assert.equal((await page("Developer 099")).total, 0);
    assert.equal((await page("Developer 100")).total, 0);
    assert.equal((await page("Developer 101")).total, 0);
    assert.equal((await page("%")).total, 0);
    await assert.rejects(call("members.list", { assignees: {} }), /requires a project/);
    await assert.rejects(
      call("members.list", { projectId: project.id, assignees: { limit: 11 } }),
      /10/,
    );
    const scoped = await ops.auth.issueToken(
      db,
      owner,
      {
        name: "Scoped extension",
        projectIds: [],
        scopes: ["members.list"],
        expiresInDays: 30,
      },
      "extension",
    );
    const actor = await ops.auth.authenticate(scoped.token);
    await assert.rejects(
      ops.executeOperation(actor, "members.list", {
        projectId: project.id,
        assignees: {},
      }),
      /outside token scope/,
    );
  } finally {
    await pg.close();
  }
});
