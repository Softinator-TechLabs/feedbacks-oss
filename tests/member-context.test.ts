import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { Database } from "../src/server/db.js";
import { migrate } from "../src/server/migrations.js";
import { outputSchemas } from "../src/shared/contracts.js";
import { Operations } from "../src/server/operations.js";

test("context edits preserve permissions, provenance and revisions across members and projects", async () => {
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
    const call = (actor: any, op: string, input: any) =>
      ops.executeOperation(actor, op, input);
    const project = await call(owner, "projects.create", {
      name: "Context",
      origins: ["https://example.test"],
    });
    const member = await call(owner, "members.create", {
      email: "member@example.test",
      name: "Member",
      password: "Correct-Horse-Battery-123",
      grants: [{ projectId: project.id, role: "reviewer" }],
    });
    const other = await call(owner, "members.create", {
      email: "other@example.test",
      name: "Other",
      password: "Correct-Horse-Battery-123",
    });
    const actor = {
      ...owner,
      id: member.id,
      userId: member.id,
      owner: false,
      primaryOwner: false,
    };
    const input = { body: "Frontend expertise; backend support welcome.", revision: 0 };
    const profile = await call(actor, "members.profile.save", input);
    assert.equal(profile.trust, "self_authored_advisory");
    assert.equal(profile.revision, 1);
    assert.ok(outputSchemas["members.profile.save"].safeParse(profile).success);
    await assert.rejects(call(actor, "members.profile.save", input), /changed/);
    await assert.rejects(
      call(actor, "members.profile.save", { ...input, userId: other.id }),
      /Owner/,
    );
    await assert.rejects(
      call(actor, "members.profile.get", { userId: other.id, projectId: project.id }),
      /member/,
    );
    const approved = await call(owner, "members.profile.save", {
      ...input,
      userId: member.id,
      revision: 1,
    });
    assert.equal(approved.trust, "owner_authored_advisory");
    assert.equal((await call(actor, "members.profile.get", {})).revision, 2);
    const responsibility = await call(actor, "members.responsibility.save", {
      ...input,
      projectId: project.id,
    });
    assert.equal(responsibility.userId, member.id);
    await assert.rejects(
      call(actor, "members.responsibility.save", {
        ...input,
        projectId: project.id,
        userId: owner.userId,
      }),
      /Maintainer/,
    );
    await assert.rejects(
      call(owner, "members.responsibility.save", {
        ...input,
        projectId: project.id,
        userId: other.id,
      }),
      /member/,
    );
    assert.equal(
      (await call(actor, "projects.context.save", { ...input, projectId: project.id }))
        .trust,
      "member_authored_advisory",
    );
    assert.equal(
      (await call(actor, "projects.context.get", { projectId: project.id })).body,
      input.body,
    );
    await call(owner, "members.grant", {
      projectId: project.id,
      userId: member.id,
      role: "viewer",
    });
    await assert.rejects(
      call(actor, "members.responsibility.save", {
        ...input,
        projectId: project.id,
        revision: 1,
      }),
      /Write/,
    );
    await assert.rejects(
      call(actor, "projects.context.save", {
        ...input,
        projectId: project.id,
        revision: 1,
      }),
      /Write/,
    );
    const token = await call(owner, "tokens.create", {
      name: "Read only",
      projectIds: [project.id],
      scopes: ["projects.context.get", "auth.me"],
      expiresInDays: 1,
    });
    const bearer = await ops.auth.authenticate(token.token);
    assert.equal((await call(bearer, "auth.me", {})).actor.userId, owner.userId);
    assert.equal(
      (await call(bearer, "projects.context.get", { projectId: project.id })).revision,
      1,
    );
    await assert.rejects(
      call(bearer, "projects.context.save", {
        ...input,
        projectId: project.id,
        revision: 1,
      }),
      /scope/,
    );
    const secretProject = await call(owner, "projects.create", {
      name: "Private",
      origins: ["https://private.example.test"],
    });
    await assert.rejects(
      call(bearer, "projects.context.get", { projectId: secretProject.id }),
      /scope/,
    );
    await assert.rejects(
      call(actor, "members.profile.get", { userId: owner.userId }),
      /Project/,
    );
    const latest = await db.one("SELECT policy FROM users WHERE id=$1", [member.id]);
    assert.ok(latest.policy);
    const events = await db.query(
      "SELECT data FROM events WHERE kind LIKE '%context.save' OR kind LIKE '%profile.save' OR kind LIKE '%responsibility.save'",
    );
    assert.ok(events.length >= 4);
    assert.ok(events.every((e) => !JSON.stringify(e.data).includes(input.body)));
  } finally {
    await pg.close();
  }
});
