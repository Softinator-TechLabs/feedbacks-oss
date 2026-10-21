import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { Database } from "../src/server/db.js";
import { migrate } from "../src/server/migrations.js";
import { Operations } from "../src/server/operations.js";
import { configFromEnv } from "../src/server/config.js";
import {
  validateChannelUrl,
  channelOperation,
  channelMigrationSql,
  enqueueChannels,
  processChannelDeliveries,
} from "../src/server/integrations/channels.js";
import { accountLock } from "../src/server/auth.js";

test("Slack/Teams channel destinations reject arbitrary hosts, credentials, redirects and lookalike domains", () => {
  assert.match(
    validateChannelUrl("slack", "https://hooks.slack.com/services/T1/B1/secret"),
    /^https:/,
  );
  assert.match(
    validateChannelUrl(
      "teams",
      "https://synthetic.environment.api.powerplatform.com/powerautomate/automations/direct/workflows/123/triggers/manual/paths/invoke?api-version=1&sig=synthetic",
    ),
    /powerplatform/,
  );
  for (const provider of ["slack", "teams"] as const)
    for (const url of [
      "http://localhost/hooks",
      "https://attacker.example/hooks",
      "https://hooks.slack.com.evil.example/services/T1/B1/secret",
      "https://user:pass@hooks.slack.com/services/T1/B1/secret",
      "https://hooks.slack.com:8443/services/T1/B1/secret",
    ])
      assert.throws(() => validateChannelUrl(provider, url), { code: "VALIDATION" });
});

test("opt-in channel delivery encrypts credentials, deduplicates events, protects private content, checks current access and reconciles uncertain sends", async () => {
  const pg = new PGlite();
  try {
    const db = new Database(pg as any);
    await migrate(db);
    if (!(await db.one("SELECT to_regclass('notification_channels') AS name")).name)
      for (const statement of channelMigrationSql.split(";").filter((s) => s.trim()))
        await db.query(statement);
    const config = configFromEnv({
      DATABASE_URL: "postgres://synthetic",
      APP_ORIGIN: "https://feedback.example.test",
    });
    const objects = new Map<string, Buffer>(),
      store: any = {
        put: async (key: string, value: Buffer) => objects.set(key, value),
        get: async (key: string) => objects.get(key)!,
      };
    const ops = new Operations(db, store, config),
      owner = await ops.auth.bootstrap(
        "owner@example.test",
        "Owner",
        "Correct-Horse-Battery-123",
      );
    const project = await ops.executeOperation(owner, "projects.create", {
      name: "Private synthetic project",
      origins: ["https://example.test"],
    });
    const thread = await ops.executeOperation(owner, "threads.create", {
      projectId: project.id,
      body: "Private synthetic feedback must not leave in channel payload",
      context: {
        url: "https://example.test/",
        viewport: { width: 1440, height: 900 },
        devicePixelRatio: 1,
      },
      idempotencyKey: "synthetic-thread",
    });
    const run = (actor: any, name: string, input: any) =>
      db.transaction(async (tx) => {
        await accountLock(tx);
        return channelOperation(tx, store, config, actor, name, input);
      });
    const c = await run(owner, "channels.save", {
      projectId: project.id,
      provider: "slack",
      label: "Synthetic channel",
      webhookUrl: "https://hooks.slack.com/services/T1/B1/syntheticsecret",
      events: ["created", "discussion"],
    });
    assert.ok(!JSON.stringify(c).includes("syntheticsecret"));
    assert.ok(
      !JSON.stringify(
        await db.one("SELECT * FROM notification_channels WHERE id=$1", [c.id]),
      ).includes("syntheticsecret"),
    );
    await enqueueChannels(db, project.id, thread.id, "thread.created", 1);
    await enqueueChannels(db, project.id, thread.id, "thread.created", 1);
    assert.equal((await db.one("SELECT count(*)::int n FROM channel_deliveries")).n, 1);
    let sends = 0;
    await processChannelDeliveries(db, store, config, async (url, body) => {
      sends++;
      assert.ok(url.includes("syntheticsecret"));
      assert.ok(body.includes(`/threads/${thread.id}`));
      assert.ok(!body.includes("Private synthetic"));
      return 200;
    });
    assert.equal(sends, 1);
    const test = await run(owner, "channels.test", {
      channelId: c.id,
      idempotencyKey: "synthetic-test",
    });
    assert.equal(
      (
        await run(owner, "channels.test", {
          channelId: c.id,
          idempotencyKey: "synthetic-test",
        })
      ).deliveryId,
      test.deliveryId,
    );
    await processChannelDeliveries(db, store, config, async () => {
      sends++;
      throw Error("Synthetic lost response");
    });
    await processChannelDeliveries(db, store, config, async () => {
      sends++;
      return 200;
    });
    assert.equal(sends, 2);
    assert.equal(
      (
        await db.one("SELECT status FROM channel_deliveries WHERE id=$1", [
          test.deliveryId,
        ])
      ).status,
      "uncertain",
    );
    await run(owner, "channels.reconcile", {
      deliveryId: test.deliveryId,
      delivered: true,
    });
    await assert.rejects(
      run({ ...owner, kind: "agent" }, "channels.list", { projectId: project.id }),
      { code: "FORBIDDEN" },
    );
    await enqueueChannels(db, project.id, thread.id, "threads.reply", 2);
    await run(owner, "channels.disable", { channelId: c.id, revision: c.revision });
    await processChannelDeliveries(db, store, config, async () => {
      sends++;
      return 200;
    });
    assert.equal(sends, 2);
  } finally {
    await pg.close();
  }
});
