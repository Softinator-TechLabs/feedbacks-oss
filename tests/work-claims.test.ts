import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { Database } from "../src/server/db.js";
import { migrate } from "../src/server/migrations.js";
import { Operations } from "../src/server/operations.js";

test("personal keys identify their member; point claims prevent overlapping agent work", async () => {
  const pg = new PGlite();
  try {
    const db = new Database(pg as any);
    await migrate(db);
    const ops = new Operations(db, {} as any, {} as any);
    const owner = await ops.auth.bootstrap(
      "owner@example.test",
      "Owner",
      "Correct-Horse-Battery-123",
    );
    const call = (a: any, n: string, i: any) => ops.executeOperation(a, n, i);
    const p = await call(owner, "projects.create", {
      name: "Claims",
      origins: ["https://example.test"],
    });
    const member = await call(owner, "members.create", {
      email: "member@example.test",
      name: "Member",
      password: "Correct-Horse-Battery-123",
      grants: [{ projectId: p.id, role: "reviewer" }],
    });
    const human = {
      ...owner,
      id: member.id,
      userId: member.id,
      owner: false,
      primaryOwner: false,
    };
    const scopes = [
      "auth.me",
      "members.profile.get",
      "members.profile.save",
      "assignments.list",
      "assignments.claim",
      "assignments.renew",
      "assignments.release",
      "threads.get",
    ];
    const key = await call(human, "tokens.create", {
      name: "My Codex",
      projectIds: [p.id],
      scopes,
    });
    const agent = await ops.auth.authenticate(key.token);
    assert.equal((await call(agent, "auth.me", {})).actor.userId, member.id);
    await assert.rejects(
      call(agent, "tokens.create", { name: "Descendant", projectIds: [p.id], scopes }),
      /scope|human/,
    );
    await assert.rejects(
      call(human, "tokens.create", {
        name: "Admin",
        projectIds: [p.id],
        scopes,
        ownerAdmin: true,
      }),
      /owner|Owner/,
    );
    await assert.rejects(
      call(human, "tokens.create", {
        name: "Policy",
        projectIds: [p.id],
        scopes: ["context.policy"],
      }),
      /scope/,
    );
    const profile = await call(agent, "members.profile.save", {
      body: "Backend developer",
      currentWork: "API migration",
      revision: 0,
    });
    assert.equal(profile.currentWork, "API migration");
    const edited = await call(agent, "members.profile.save", {
      body: "Backend and Python",
      revision: profile.revision,
    });
    assert.equal(edited.currentWork, "API migration");
    const point1 = randomUUID(),
      point2 = randomUUID();
    const thread = await call(owner, "threads.create", {
      projectId: p.id,
      body: "Fix fields",
      context: {
        url: "https://example.test",
        viewport: { width: 1000, height: 800 },
        annotations: [
          { id: point1, body: "A", anchor: { selector: "#a" } },
          { id: point2, body: "B", anchor: { selector: "#b" } },
        ],
      },
      idempotencyKey: "claim-thread",
    });
    const request = {
      threadId: thread.id,
      revision: thread.revision,
      annotationIds: [point1],
      summary: "Fix field A",
      idempotencyKey: "claim-a",
    };
    const claimed = await call(agent, "assignments.claim", request);
    assert.equal(claimed.userId, member.id);
    assert.equal(claimed.agentId, agent.id);
    assert.equal((await call(agent, "assignments.claim", request)).id, claimed.id);
    await assert.rejects(
      call(owner, "assignments.claim", { ...request, idempotencyKey: "overlap" }),
      /claimed/,
    );
    const second = await call(owner, "assignments.claim", {
      ...request,
      annotationIds: [point2],
      idempotencyKey: "point-b",
    });
    assert.notEqual(second.id, claimed.id);
    await assert.rejects(
      call(owner, "assignments.claim", {
        ...request,
        annotationIds: [],
        idempotencyKey: "whole",
      }),
      /claimed/,
    );
    await assert.rejects(
      call(agent, "assignments.claim", {
        ...request,
        annotationIds: [randomUUID()],
        idempotencyKey: "unknown",
      }),
      /point/,
    );
    const listed = await call(agent, "assignments.list", { projectId: p.id });
    assert.equal(listed.total, 2);
    await assert.rejects(
      call(agent, "assignments.release", {
        assignmentId: second.id,
        revision: 1,
        outcome: "paused",
      }),
      /Maintainer/,
    );
    const renewed = await call(agent, "assignments.renew", {
      assignmentId: claimed.id,
      revision: 1,
    });
    assert.equal(renewed.revision, 2);
    await assert.rejects(
      call(agent, "assignments.release", {
        assignmentId: claimed.id,
        revision: 1,
        outcome: "completed",
      }),
      /changed/,
    );
    await call(agent, "assignments.release", {
      assignmentId: claimed.id,
      revision: 2,
      outcome: "completed",
    });
    assert.equal(
      (await call(agent, "threads.get", { threadId: thread.id })).work.state,
      "open",
    );
    assert.equal((await call(agent, "assignments.list", { projectId: p.id })).total, 1);
    await db.query(
      "UPDATE work_claims SET expires_at=now()-interval '1 minute' WHERE id=$1",
      [second.id],
    );
    assert.equal((await call(agent, "assignments.list", { projectId: p.id })).total, 0);
    await call(agent, "assignments.claim", {
      ...request,
      annotationIds: [],
      idempotencyKey: "whole-after-expiry",
    });
    const orphan = await call(owner, "members.create", {
      email: "python@example.test",
      name: "Python Developer",
      password: "Correct-Horse-Battery-123",
    });
    const orphanHuman = { ...human, id: orphan.id, userId: orphan.id };
    const personal = await call(orphanHuman, "tokens.create", {
      name: "Profile only",
      projectIds: [],
      scopes: ["auth.me", "projects.list", "members.profile.get", "members.profile.save"],
    });
    const personalAgent = await ops.auth.authenticate(personal.token);
    assert.equal((await call(personalAgent, "auth.me", {})).projects.length, 0);
    await call(personalAgent, "members.profile.save", {
      body: "Python",
      currentWork: "Non-UI service",
      revision: 0,
    });
    await assert.rejects(
      call(orphanHuman, "tokens.create", {
        name: "Outside project",
        projectIds: [p.id],
        scopes,
      }),
      /access/,
    );
  } finally {
    await pg.close();
  }
});
