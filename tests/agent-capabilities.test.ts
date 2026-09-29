import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { Database } from "../src/server/db.js";
import { migrate } from "../src/server/migrations.js";
import { Operations } from "../src/server/operations.js";
import {
  outputSchemas,
  ownerTokenScopes,
  ownerEvidenceReadScopes,
} from "../src/shared/contracts.js";

test("identity distinguishes the member, token scope and project role without upgrading old keys", async () => {
  const pg = new PGlite();
  try {
    const db = new Database(pg as any);
    await migrate(db);
    const ops = new Operations(
      db,
      {} as any,
      { appOrigin: "https://feedback.example.test" } as any,
    );
    const owner = await ops.auth.bootstrap(
      "owner@example.test",
      "Human owner",
      "Correct-Horse-Battery-123",
    );
    const project = await ops.executeOperation(owner, "projects.create", {
      name: "Review",
      origins: ["https://example.test"],
    });
    const key = await ops.executeOperation(owner, "tokens.create", {
      name: "Shared assistant",
      projectIds: [project.id],
      scopes: ["auth.me", "threads.get"],
    });
    const agent = await ops.auth.authenticate(key.token);
    const me = outputSchemas["auth.me"].parse(
      await ops.executeOperation(agent, "auth.me", {}),
    ) as any;
    assert.deepEqual(me.member, { id: owner.userId, name: "Human owner" });
    assert.equal(me.actor.name, "Shared assistant");
    assert.equal(me.serverOrigin, "https://feedback.example.test");
    assert.equal(me.projects[0].permissions.canMaintain, true);
    assert.deepEqual(me.credential.scopes, ["auth.me", "threads.get"]);
    assert.ok(me.credential.operationScopes.includes("threads.activity"));
    assert.ok(!me.credential.operationScopes.includes("assignments.list"));
    await assert.rejects(
      ops.executeOperation(agent, "assignments.list", { projectId: project.id }),
      (error: any) => {
        assert.equal(error.code, "FORBIDDEN");
        assert.equal(error.details.operation, "assignments.list");
        assert.deepEqual(error.details.requiredScopes, ["assignments.list"]);
        assert.match(error.message, /assignments.list/);
        assert.match(error.details.recovery, /Account/);
        return true;
      },
    );
    await db.query("UPDATE tokens SET revoked_at=now() WHERE id=$1", [key.id]);
    await assert.rejects(ops.executeOperation(agent, "auth.me", {}), {
      code: "UNAUTHENTICATED",
    });
  } finally {
    await pg.close();
  }
});

test("thread activity preserves saved upload and move receipts without revealing event payloads", async () => {
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
    const source = await ops.executeOperation(owner, "projects.create", {
      name: "General",
      origins: ["https://example.test"],
    });
    const target = await ops.executeOperation(owner, "projects.create", {
      name: "Target",
      origins: ["https://example.test"],
    });
    let thread = await ops.executeOperation(owner, "threads.create", {
      projectId: source.id,
      body: "Synthetic feedback",
      context: { url: "https://example.test", viewport: { width: 1000, height: 800 } },
      idempotencyKey: randomUUID(),
    });
    await db.query(
      "INSERT INTO events(project_id,entity_id,kind,actor,data) VALUES($1,$2,'thread.asset',$3,$4)",
      [
        source.id,
        thread.id,
        JSON.stringify(owner),
        JSON.stringify({ revision: 1, privatePayload: "NEVER EXPOSE" }),
      ],
    );
    thread = await ops.executeOperation(owner, "threads.move", {
      threadId: thread.id,
      revision: thread.revision,
      projectId: target.id,
    });
    const key = await ops.executeOperation(owner, "tokens.create", {
      name: "Reader",
      projectIds: [target.id],
      scopes: ["threads.get"],
    });
    const reader = await ops.auth.authenticate(key.token);
    const first = await ops.executeOperation(reader, "threads.activity", {
      threadId: thread.id,
      limit: 2,
    });
    assert.equal(first.items.length, 2);
    assert.equal(first.items[0].kind, "threads.move");
    assert.equal(first.items[1].kind, "thread.asset");
    assert.ok(first.nextBefore);
    assert.ok(!JSON.stringify(first).includes("NEVER EXPOSE"));
    const next = await ops.executeOperation(reader, "threads.activity", {
      threadId: thread.id,
      limit: 2,
      before: first.nextBefore,
    });
    assert.equal(next.items[0].kind, "thread.created");
    assert.equal(next.nextBefore, null);
    assert.match(first.coverage, /recorded/);
    assert.match(first.limitation, /attempt/);
    const deniedKey = await ops.executeOperation(owner, "tokens.create", {
      name: "Wrong project",
      projectIds: [source.id],
      scopes: ["threads.get"],
    });
    await assert.rejects(
      ops.executeOperation(
        await ops.auth.authenticate(deniedKey.token),
        "threads.activity",
        { threadId: thread.id },
      ),
      { code: "FORBIDDEN" },
    );
  } finally {
    await pg.close();
  }
});

test("new owner keys read captured evidence only when explicitly selected", async () => {
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
    const normal = await ops.executeOperation(owner, "tokens.create", {
      name: "Admin",
      ownerAdmin: true,
      scopes: ["auth.me"],
    });
    const evidence = await ops.executeOperation(owner, "tokens.create", {
      name: "Evidence admin",
      ownerAdmin: true,
      scopes: [...ownerTokenScopes, ...ownerEvidenceReadScopes],
    });
    const normalMe = await ops.executeOperation(
      await ops.auth.authenticate(normal.token),
      "auth.me",
      {},
    );
    const evidenceMe = await ops.executeOperation(
      await ops.auth.authenticate(evidence.token),
      "auth.me",
      {},
    );
    assert.ok(!normalMe.credential.operationScopes.includes("recordings.list"));
    assert.ok(evidenceMe.credential.operationScopes.includes("recordings.list"));
    assert.ok(evidenceMe.credential.operationScopes.includes("diagnostics.read"));
    assert.ok(!evidenceMe.credential.operationScopes.includes("diagnostics.begin"));
    await assert.rejects(
      ops.executeOperation(owner, "tokens.create", {
        name: "No hidden upload",
        ownerAdmin: true,
        scopes: ["diagnostics.begin"],
      }),
      { code: "VALIDATION" },
    );
  } finally {
    await pg.close();
  }
});
