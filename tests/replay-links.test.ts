import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { Database } from "../src/server/db.js";
import { migrate } from "../src/server/migrations.js";
import { Operations } from "../src/server/operations.js";
import { accountLock } from "../src/server/auth.js";
import {
  reviewedReplayUrl,
  replayLinksOperation,
  replayLinksMigrationSql,
} from "../src/server/integrations/replay-links.js";
test("reviewed external replay links enforce provider, exact page, current permissions and retry identity", async () => {
  assert.match(
    reviewedReplayUrl(
      "fullstory",
      "https://app.fullstory.com/ui/synthetic/client-session/user:session",
    ),
    /client-session/,
  );
  assert.match(
    reviewedReplayUrl("logrocket", "https://app.logrocket.com/synthetic/app/s/session/1"),
    /logrocket/,
  );
  for (const url of [
    "https://app.logrocket.com.evil.example/synthetic/app/s/session",
    "https://app.logrocket.com/synthetic/app/s/session?token=private",
    "https://user:password@app.logrocket.com/synthetic/app/s/session",
    "https://app.logrocket.com/synthetic/app",
  ])
    assert.throws(() => reviewedReplayUrl("logrocket", url), { code: "VALIDATION" });
  const pg = new PGlite();
  try {
    const db = new Database(pg as any);
    await migrate(db);
    if (!(await db.one("SELECT to_regclass('external_replay_links') AS name")).name)
      for (const sql of replayLinksMigrationSql.split(";").filter((s) => s.trim()))
        await db.query(sql);
    const ops = new Operations(
        db,
        {} as any,
        { appOrigin: "https://feedback.example.test" } as any,
      ),
      owner = await ops.auth.bootstrap(
        "owner@example.test",
        "Owner",
        "Correct-Horse-Battery-123",
      );
    const project = await ops.executeOperation(owner, "projects.create", {
      name: "Synthetic",
      origins: ["https://example.test"],
    });
    const thread = await ops.executeOperation(owner, "threads.create", {
      projectId: project.id,
      body: "Synthetic",
      context: {
        url: "https://example.test/page?variant=a",
        viewport: { width: 1440, height: 900 },
        devicePixelRatio: 1,
      },
      idempotencyKey: "replay-thread",
    });
    const run = (name: string, input: any) =>
      db.transaction(async (tx) => {
        await accountLock(tx);
        return replayLinksOperation(tx, owner, name, input);
      });
    const input = {
      threadId: thread.id,
      revision: thread.revision,
      provider: "logrocket",
      sessionUrl: "https://app.logrocket.com/synthetic/app/s/session/1",
      pageUrl: "https://example.test/page?variant=a&token=secret",
      capturedAt: "2026-10-20T12:00:00.000Z",
      idempotencyKey: "replay-link",
    };
    await assert.rejects(
      run("replayLinks.add", { ...input, pageUrl: "https://example.test/other" }),
      { code: "REPLAY_PAGE_MISMATCH" },
    );
    const link = await run("replayLinks.add", input);
    assert.equal((await run("replayLinks.add", input)).id, link.id);
    await assert.rejects(
      run("replayLinks.add", { ...input, sessionUrl: input.sessionUrl + "?t=30" }),
      { code: "IDEMPOTENCY_CONFLICT" },
    );
    const listed = await run("replayLinks.list", { threadId: thread.id });
    assert.equal(listed.items[0].pageUrl, "https://example.test/page?variant=a");
    assert.equal(listed.items[0].attribution, "reviewer_provided");
    await run("replayLinks.remove", { linkId: link.id });
    assert.equal(
      (await run("replayLinks.list", { threadId: thread.id })).items.length,
      0,
    );
  } finally {
    await pg.close();
  }
});
