import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { Database } from "../src/server/db.js";
import { migrate } from "../src/server/migrations.js";
import { Operations } from "../src/server/operations.js";
import { createApp } from "../src/server/app.js";
import { configFromEnv } from "../src/server/config.js";
import { testMuIntake, sendTestMuIntake } from "../scripts/lib/testmu-intake.mjs";
const report = {
  version: 1,
  reviewed: true,
  buildId: "build123",
  testId: "test456",
  checkpoint: "checkout-button",
  name: "Checkout button",
  status: "failed",
  summary: "Reviewed synthetic failure",
  pageUrl: "https://example.test/cart?variant=a&token=private",
  sessionUrl: "https://automation.lambdatest.com/test?build=123&test=456",
  capturedAt: "2026-10-20T12:00:00.000Z",
  viewport: { width: 1440, height: 900 },
};
test("TestMu intake uses explicit provider identity and reviewed context, with stable deduplication and no guessed viewport or credentials", () => {
  const projectId = "af413b45-9171-4a6d-8a32-9b17c78189b6",
    mapped = testMuIntake(projectId, report);
  assert.equal(mapped.context.url, "https://example.test/cart?variant=a");
  assert.equal(mapped.idempotencyKey, testMuIntake(projectId, report).idempotencyKey);
  assert.notEqual(
    mapped.idempotencyKey,
    testMuIntake(projectId, { ...report, testId: "another-test" }).idempotencyKey,
  );
  assert.throws(() => testMuIntake(projectId, { ...report, reviewed: false }));
  assert.throws(() => testMuIntake(projectId, { ...report, viewport: undefined }));
  assert.throws(() =>
    testMuIntake(projectId, {
      ...report,
      sessionUrl: "https://attacker.example/session",
    }),
  );
  assert.throws(() =>
    testMuIntake(projectId, {
      ...report,
      sessionUrl: report.sessionUrl + "&token=private",
    }),
  );
});
test("TestMu CI adapter calls real authenticated intake, deduplicates retries and respects project scope/origin/revocation", async () => {
  const pg = new PGlite();
  let server: any;
  try {
    const db = new Database(pg as any);
    await migrate(db);
    const config = configFromEnv({ DATABASE_URL: "postgres://synthetic" });
    const store: any = {},
      ops = new Operations(db, store, config),
      owner = await ops.auth.bootstrap(
        "owner@example.test",
        "Owner",
        "Correct-Horse-Battery-123",
      );
    const project = await ops.executeOperation(owner, "projects.create", {
        name: "Synthetic",
        origins: ["https://example.test"],
      }),
      other = await ops.executeOperation(owner, "projects.create", {
        name: "Other",
        origins: ["https://example.test"],
      });
    const token = await ops.executeOperation(owner, "tokens.create", {
      name: "TestMu CI intake",
      projectIds: [project.id],
      scopes: ["threads.create"],
    });
    server = createApp(config, db, store).listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const serverOrigin = `http://127.0.0.1:${server.address().port}`;
    const input = { serverOrigin, token: token.token, projectId: project.id, report },
      first = await sendTestMuIntake(input),
      repeated = await sendTestMuIntake(input);
    assert.equal(first.threadId, repeated.threadId);
    assert.equal(
      (
        await db.one("SELECT count(*)::int n FROM threads WHERE project_id=$1", [
          project.id,
        ])
      ).n,
      1,
    );
    await assert.rejects(
      sendTestMuIntake({ ...input, projectId: other.id }),
      /FORBIDDEN/,
    );
    await assert.rejects(
      sendTestMuIntake({
        ...input,
        report: {
          ...report,
          testId: "wrong-origin",
          pageUrl: "https://other.example.test/",
        },
      }),
      /ORIGIN_NOT_ALLOWED/,
    );
    await ops.executeOperation(owner, "tokens.revoke", { tokenId: token.id });
    await assert.rejects(
      sendTestMuIntake({ ...input, report: { ...report, testId: "revoked" } }),
      /UNAUTHENTICATED/,
    );
  } finally {
    await new Promise<void>((resolve) => (server ? server.close(resolve) : resolve()));
    await pg.close();
  }
});
