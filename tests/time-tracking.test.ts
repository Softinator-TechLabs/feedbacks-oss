import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { Database } from "../src/server/db.js";
import { migrate } from "../src/server/migrations.js";
import { Operations } from "../src/server/operations.js";
import { configFromEnv } from "../src/server/config.js";
import {
  TimeTrackingClient,
  timeTrackingOperation,
  timeTrackingMigrationSql,
  processTimeEntries,
} from "../src/server/integrations/time-tracking.js";
const json = (data: any) => new Response(JSON.stringify(data));
test("Harvest and Time Doctor create explicit stopped or pending-approval entries using provider auth and exact destinations", async () => {
  const destination = { accountId: "12", projectId: "34", taskId: "56", userId: "78" };
  const entry = {
    threadId: "synthetic-thread",
    spentDate: "2026-10-20",
    minutes: 90,
    note: "Reviewed work note",
    startedAt: "2026-10-20T12:00:00.000Z",
  };
  const calls: { url: string; init: RequestInit }[] = [];
  const transport = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (url.endsWith("/company")) return json({ wants_timestamp_timers: false });
    if (url.includes("/task_assignments"))
      return json({ task_assignments: [{ task: { id: 56 }, is_active: true }] });
    if (url.endsWith("/projects/34")) return json({ name: "Synthetic project" });
    if (url.includes("/tasks/56"))
      return json({ data: { name: "Synthetic task", project: { id: "34", weight: 0 } } });
    return url.includes("harvestapp")
      ? json({ id: 90, is_running: false, project: { id: 34 }, task: { id: 56 } })
      : json({ data: { id: "entry90" } });
  };
  const harvest = new TimeTrackingClient(
    { provider: "harvest", destination },
    "synthetic-token",
    transport,
  );
  await harvest.test();
  assert.equal(
    await harvest.log(entry, "https://feedback.example.test/threads/synthetic"),
    "90",
  );
  const harvestWrite = calls.find((c) => c.init.method === "POST")!;
  const payload = JSON.parse(String(harvestWrite.init.body));
  assert.equal(payload.hours, 1.5);
  assert.equal(payload.user_id, 78);
  assert.equal(payload.external_reference.id, "synthetic-thread");
  assert.equal((harvestWrite.init.headers as any)["Harvest-Account-Id"], "12");
  calls.length = 0;
  const doctor = new TimeTrackingClient(
    { provider: "timedoctor", destination },
    "synthetic-jwt",
    transport,
  );
  await doctor.test();
  assert.equal(
    await doctor.log(entry, "https://feedback.example.test/threads/synthetic"),
    "entry90",
  );
  const doctorWrite = calls.find((c) => c.init.method === "POST")!,
    doctorPayload = JSON.parse(String(doctorWrite.init.body));
  assert.equal(doctorPayload.approved, false);
  assert.equal(doctorPayload.end, "2026-10-20T13:30:00.000Z");
  assert.equal((doctorWrite.init.headers as any).authorization, "JWT synthetic-jwt");
  assert.equal(new URL(doctorWrite.url).origin, "https://api2.timedoctor.com");
  await assert.rejects(
    new TimeTrackingClient(
      { provider: "harvest", destination },
      "synthetic-token",
      async () => json({ wants_timestamp_timers: true }),
    ).test(),
    { code: "HARVEST_DURATION_MODE_REQUIRED" },
  );
});

test("time queue encrypts credentials, deduplicates retries, prevents blind replay and rechecks revocation after private storage reads", async () => {
  const pg = new PGlite();
  try {
    const db = new Database(pg as any);
    await migrate(db);
    if (!(await db.one("SELECT to_regclass('time_connections') AS name")).name)
      for (const sql of timeTrackingMigrationSql.split(";").filter((s) => s.trim()))
        await db.query(sql);
    const objects = new Map<string, Buffer>(),
      store: any = {
        put: async (key: string, bytes: Buffer) => objects.set(key, bytes),
        get: async (key: string) => objects.get(key)!,
      };
    const config = configFromEnv({ DATABASE_URL: "postgres://synthetic" }),
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
      thread = await ops.executeOperation(owner, "threads.create", {
        projectId: project.id,
        body: "Synthetic",
        context: {
          url: "https://example.test",
          viewport: { width: 1440, height: 900 },
          devicePixelRatio: 1,
        },
        idempotencyKey: "time-thread",
      });
    let writes = 0,
      lost = false;
    const transport = async (url: string, init: RequestInit) => {
      if (init.method === "POST") {
        writes++;
        if (lost) throw Error("Lost response");
        return json({ id: 90, is_running: false, project: { id: 34 }, task: { id: 56 } });
      }
      if (url.endsWith("/company")) return json({ wants_timestamp_timers: false });
      if (url.includes("/task_assignments"))
        return json({ task_assignments: [{ task: { id: 56 }, is_active: true }] });
      return json({ name: "Synthetic" });
    };
    const run = (name: string, input: any) =>
      timeTrackingOperation(db, store, config, owner, name, input, transport);
    const c = await run("timeTracking.save", {
      projectId: project.id,
      provider: "harvest",
      label: "Synthetic Harvest",
      destination: { accountId: "12", projectId: "34", taskId: "56" },
      token: "synthetic-secret",
    });
    assert.ok(!JSON.stringify(c).includes("synthetic-secret"));
    assert.equal((await run("timeTracking.test", { connectionId: c.id })).healthy, true);
    const input = {
      connectionId: c.id,
      threadId: thread.id,
      revision: thread.revision,
      spentDate: "2026-10-20",
      minutes: 45,
      note: "Reviewed work",
      idempotencyKey: "time-first",
    };
    const entry = await run("timeTracking.log", input);
    assert.equal((await run("timeTracking.log", input)).id, entry.id);
    await assert.rejects(run("timeTracking.log", { ...input, minutes: 60 }), {
      code: "IDEMPOTENCY_CONFLICT",
    });
    await processTimeEntries(db, store, config, transport);
    assert.equal(writes, 1);
    assert.equal(
      (await db.one("SELECT status FROM external_time_entries WHERE id=$1", [entry.id]))
        .status,
      "delivered",
    );
    lost = true;
    const uncertain = await run("timeTracking.log", {
      ...input,
      idempotencyKey: "time-uncertain",
    });
    await processTimeEntries(db, store, config, transport);
    await processTimeEntries(db, store, config, transport);
    assert.equal(writes, 2);
    assert.equal(
      (
        await db.one("SELECT status FROM external_time_entries WHERE id=$1", [
          uncertain.id,
        ])
      ).status,
      "uncertain",
    );
    await run("timeTracking.reconcile", {
      entryId: uncertain.id,
      delivered: true,
      remoteId: "90",
    });
    await run("timeTracking.log", { ...input, idempotencyKey: "time-revoked" });
    let revoked = false;
    store.get = async (key: string) => {
      if (!revoked) {
        revoked = true;
        await db.query(
          "UPDATE time_connections SET enabled=false,revision=revision+1 WHERE id=$1",
          [c.id],
        );
      }
      return objects.get(key)!;
    };
    await processTimeEntries(db, store, config, transport);
    assert.equal(writes, 2);
    assert.equal(
      (
        await db.one(
          "SELECT status FROM external_time_entries WHERE idempotency_key='time-revoked'",
        )
      ).status,
      "failed",
    );
  } finally {
    await pg.close();
  }
});
