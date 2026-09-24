import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { Database } from "../src/server/db.js";
import { migrate } from "../src/server/migrations.js";
import { Operations } from "../src/server/operations.js";
import { memberWelcomeMessage } from "../src/web/account-admin.js";

test("disabled people can be removed from the list and restored without losing their record", async () => {
  const pg = new PGlite();
  const db = new Database(pg as any);
  try {
    await migrate(db);
    const ops = new Operations(db, {} as any, {} as any);
    const owner = await ops.auth.bootstrap(
      "owner@example.test",
      "Owner",
      "Correct-Horse-Battery-123",
    );
    const member = await ops.executeOperation(owner, "members.create", {
      name: "Release reviewer",
      email: "reviewer@example.test",
      password: "Another-Good-Password-123",
      grants: [],
    });
    await assert.rejects(
      ops.executeOperation(owner, "members.archive", {
        userId: member.id,
        archived: true,
      }),
      { code: "VALIDATION" },
    );
    await ops.executeOperation(owner, "members.update", {
      userId: member.id,
      name: "Release reviewer",
      active: false,
      classification: "external",
      expertise: [],
      policy: { general: 1 },
    });
    await ops.executeOperation(owner, "members.archive", {
      userId: member.id,
      archived: true,
    });
    const listed = await ops.executeOperation(owner, "members.list", {});
    assert.equal(
      listed.items.some((item: { id: string }) => item.id === member.id),
      false,
    );
    const removed = await ops.executeOperation(owner, "members.list", {
      includeRemoved: true,
    });
    assert.equal(
      removed.items.find((item: { id: string }) => item.id === member.id)?.active,
      false,
    );
    assert.ok(
      removed.items.find((item: { id: string }) => item.id === member.id)?.removedAt,
    );
    await assert.rejects(
      ops.executeOperation(owner, "members.update", {
        userId: member.id,
        name: "Release reviewer",
        active: true,
        classification: "external",
        expertise: [],
        policy: { general: 1 },
      }),
      { code: "VALIDATION" },
    );
    await ops.executeOperation(owner, "members.archive", {
      userId: member.id,
      archived: false,
    });
    const restored = await ops.executeOperation(owner, "members.list", {});
    assert.equal(
      restored.items.find((item: { id: string }) => item.id === member.id)?.active,
      false,
    );
    assert.equal(
      restored.items.find((item: { id: string }) => item.id === member.id)?.removedAt,
      null,
    );
  } finally {
    await pg.close();
  }
});

test("new keys show their actual ending, while older keys stay unlabeled", async () => {
  const pg = new PGlite();
  const db = new Database(pg as any);
  try {
    await migrate(db);
    const ops = new Operations(db, {} as any, {} as any);
    const owner = await ops.auth.bootstrap(
      "owner@example.test",
      "Owner",
      "Correct-Horse-Battery-123",
    );
    const project = await ops.executeOperation(owner, "projects.create", {
      name: "Review",
      origins: ["https://example.test"],
    });
    const key = await ops.executeOperation(owner, "tokens.create", {
      name: "Internal agents",
      projectIds: [project.id],
      scopes: ["threads.get"],
    });
    const listed = await ops.executeOperation(owner, "tokens.list", {});
    assert.equal(
      listed.items.find((item: { id: string }) => item.id === key.id)?.secretSuffix,
      key.token.slice(-4),
    );
    await db.query("UPDATE tokens SET secret_suffix=NULL WHERE id=$1", [key.id]);
    const older = await ops.executeOperation(owner, "tokens.list", {});
    assert.equal(
      older.items.find((item: { id: string }) => item.id === key.id)?.secretSuffix,
      null,
    );
  } finally {
    await pg.close();
  }
});

test("welcome message uses the installed app and help page", () => {
  const message = memberWelcomeMessage(
    { name: "Asha", email: "asha@example.test", password: "Secret-For-Test" },
    "https://feedbacks.example.test",
  );
  assert.match(message, /Hey Asha/);
  assert.match(message, /https:\/\/feedbacks\.example\.test\/help/);
  assert.match(message, /Email: asha@example\.test/);
  assert.match(message, /Password: Secret-For-Test/);
});
