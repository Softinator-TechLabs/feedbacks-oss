import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";

test("optional project tabs start off and settings persist independently", async () => {
  const { migrate } = await import("../src/server/migrations.js");
  const { Database } = await import("../src/server/db.js");
  const { Operations } = await import("../src/server/operations.js");
  const pg = new PGlite();
  try {
    const db = new Database(pg as any);
    await migrate(db);
    const ops = new Operations(
      db,
      {} as any,
      { appOrigin: "http://localhost:3000" } as any,
    );
    const owner = await ops.auth.bootstrap(
      "owner@example.test",
      "Owner",
      "Correct-Horse-Battery-123",
    );
    const created = await ops.executeOperation(owner, "projects.create", {
      name: "Simple project",
      origins: ["https://example.test"],
    });
    assert.equal(created.documentsEnabled, false);
    assert.equal(created.surveysEnabled, false);
    const enabled = await ops.executeOperation(owner, "projects.update", {
      projectId: created.id,
      revision: created.revision,
      name: created.name,
      origins: created.origins,
      documentsEnabled: true,
      surveysEnabled: false,
    });
    assert.equal(enabled.documentsEnabled, true);
    assert.equal(enabled.surveysEnabled, false);
    const fetched = await ops.executeOperation(owner, "projects.get", {
      projectId: created.id,
    });
    assert.equal(fetched.documentsEnabled, true);
    assert.equal(fetched.surveysEnabled, false);
  } finally {
    await pg.close();
  }
});
