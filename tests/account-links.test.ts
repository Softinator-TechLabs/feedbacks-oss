import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { Database } from "../src/server/db.js";
import { migrate } from "../src/server/migrations.js";
import { Operations } from "../src/server/operations.js";
import { outputSchemas } from "../src/shared/contracts.js";

test("owner sign-in links retain a safe ending and older links remain unlabeled", async () => {
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
    await ops.executeOperation(owner, "members.create", {
      name: "Member",
      email: "member@example.test",
      password: "Another-Good-Password-123",
      grants: [],
    });
    const member = (
      await ops.auth.login("member@example.test", "Another-Good-Password-123")
    ).actor;
    await assert.rejects(ops.executeOperation(member, "account.links.list", {}), {
      code: "FORBIDDEN",
    });
    await assert.rejects(ops.executeOperation(member, "account.links.create", {}), {
      code: "FORBIDDEN",
    });
    const link = await ops.executeOperation(owner, "account.links.create", {});
    const suffix = link.loginPath.slice(-4);
    const listed = await ops.executeOperation(owner, "account.links.list", {});
    assert.equal(
      listed.items.find((item: { id: string }) => item.id === link.id)?.secretSuffix,
      suffix,
    );
    assert.notEqual(listed.items[0]?.secretSuffix, link.loginPath);
    assert.equal(
      outputSchemas["account.links.list"].parse(listed).items[0]?.secretSuffix,
      suffix,
    );

    await db.query("UPDATE account_links SET secret_suffix=NULL WHERE id=$1", [link.id]);
    const older = await ops.executeOperation(owner, "account.links.list", {});
    assert.equal(
      older.items.find((item: { id: string }) => item.id === link.id)?.secretSuffix,
      null,
    );
    assert.equal(
      outputSchemas["account.links.list"].parse(older).items[0]?.secretSuffix,
      null,
    );
  } finally {
    await pg.close();
  }
});
