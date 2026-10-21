import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { Database } from "../src/server/db.js";
import { migrate } from "../src/server/migrations.js";
import { Operations } from "../src/server/operations.js";
import { configFromEnv } from "../src/server/config.js";
import { deliverNotifications } from "../src/server/notifications/worker.js";
import { accountLock } from "../src/server/auth.js";
import { feedback } from "../src/server/feedback.js";
import { MailSendError } from "../src/server/notifications/transport.js";

test(
  "native concurrent notification workers lease each message once and recover ambiguous sends without duplicates",
  { skip: process.env.FEEDBACKS_NATIVE_POSTGRES !== "1" },
  async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "feedbacks-mail-"));
    const data = path.join(dir, "data");
    let started = false;
    let pool: Pool | undefined;
    try {
      execFileSync(
        "initdb",
        ["-D", data, "-U", "feedbacks_test", "-A", "trust", "--no-locale", "-E", "UTF8"],
        { stdio: "pipe" },
      );
      execFileSync(
        "pg_ctl",
        [
          "-D",
          data,
          "-l",
          path.join(dir, "postgres.log"),
          "-o",
          `-k '${dir}' -p 55439 -h ''`,
          "-w",
          "start",
        ],
        { stdio: "pipe" },
      );
      started = true;
      pool = new Pool({
        host: dir,
        port: 55439,
        user: "feedbacks_test",
        database: "postgres",
        max: 8,
      });
      const db = new Database(pool);
      await Promise.all([migrate(db), migrate(db)]);
      const config = configFromEnv({
        DATABASE_URL: "postgres://synthetic",
        APP_ORIGIN: "http://localhost:3000",
      });
      const keys = new Map<string, Buffer>();
      const store = {
        put: async (k: string, v: Buffer) => {
          keys.set(k, v);
        },
        get: async (k: string) => keys.get(k)!,
        remove: async (k: string) => {
          keys.delete(k);
        },
      };
      const ops = new Operations(db, store, config);
      const owner = await ops.auth.bootstrap(
        "owner@example.test",
        "Owner",
        "Correct-Horse-Battery-123",
      );
      const project = await ops.executeOperation(owner, "projects.create", {
        name: "Concurrent mail",
        origins: ["https://example.test"],
      });
      await ops.executeOperation(owner, "notifications.configure", {
        revision: 0,
        enabled: true,
        templates: {},
        identity: { fromName: "Feedbacks", fromEmail: "sender@example.test" },
        transport: {
          provider: "smtp",
          host: "smtp.example.test",
          port: 465,
          user: "synthetic-user",
          password: "synthetic-password",
        },
      });
      await ops.executeOperation(owner, "notifications.subscribe", {
        projectId: project.id,
        revision: 0,
        events: ["created"],
        includeSelf: true,
        includeContent: false,
      });
      for (let n = 0; n < 4; n++)
        await ops.executeOperation(owner, "threads.create", {
          projectId: project.id,
          body: `Synthetic ${n}`,
          context: {
            url: "https://example.test",
            viewport: { width: 1280, height: 800 },
          },
          idempotencyKey: `mail-concurrency-${n}`,
        });
      const sends = new Map<string, number>();
      const sender = async (_transport: any, _identity: any, mail: any) => {
        sends.set(mail.messageId, (sends.get(mail.messageId) ?? 0) + 1);
        await new Promise((resolve) => setTimeout(resolve, 25));
      };
      await Promise.all([
        deliverNotifications(db, config, store, sender),
        deliverNotifications(db, config, store, sender),
      ]);
      assert.equal(sends.size, 4);
      assert.ok([...sends.values()].every((n) => n === 1));

      const pending = await ops.executeOperation(owner, "threads.create", {
        projectId: project.id,
        body: "Unsubscribe during credential storage read",
        idempotencyKey: randomUUID(),
      });
      let opened!: () => void,
        release!: () => void,
        hold = true;
      const storageStarted = new Promise<void>((resolve) => (opened = resolve));
      const storageReleased = new Promise<void>((resolve) => (release = resolve));
      const originalGet = store.get;
      store.get = async (key) => {
        if (hold) {
          hold = false;
          opened();
          await storageReleased;
        }
        return originalGet(key);
      };
      let forbiddenSends = 0;
      const loading = deliverNotifications(db, config, store, async () => {
        forbiddenSends++;
      });
      await storageStarted;
      try {
        await ops.executeOperation(owner, "notifications.subscribe", {
          projectId: project.id,
          revision: 1,
          events: [],
          includeSelf: true,
          includeContent: false,
        });
      } finally {
        release();
      }
      await loading;
      store.get = originalGet;
      assert.equal(forbiddenSends, 0);
      assert.equal(
        (
          await db.one("SELECT status FROM notification_deliveries WHERE thread_id=$1", [
            pending.id,
          ])
        ).status,
        "suppressed",
      );

      await ops.executeOperation(owner, "notifications.subscribe", {
        projectId: project.id,
        revision: 2,
        events: ["created"],
        includeSelf: true,
        includeContent: false,
      });
      const leasedThread = await ops.executeOperation(owner, "threads.create", {
        projectId: project.id,
        body: "Attempt fencing",
        idempotencyKey: randomUUID(),
      });
      let firstStarted!: () => void,
        firstRelease!: () => void,
        secondStarted!: () => void,
        secondRelease!: () => void;
      const startedA = new Promise<void>((resolve) => (firstStarted = resolve));
      const barrierA = new Promise<void>((resolve) => (firstRelease = resolve));
      const startedB = new Promise<void>((resolve) => (secondStarted = resolve));
      const barrierB = new Promise<void>((resolve) => (secondRelease = resolve));
      const originalSend = deliverNotifications(db, config, store, async () => {
        firstStarted();
        await barrierA;
      });
      await startedA;
      await db.query(
        "UPDATE notification_deliveries SET lease_until=now()-interval '1 second' WHERE thread_id=$1",
        [leasedThread.id],
      );
      await deliverNotifications(db, config, store, async () => {
        throw Error("Expired sends cannot automatically retry");
      });
      const expired = await db.one(
        "SELECT * FROM notification_deliveries WHERE thread_id=$1",
        [leasedThread.id],
      );
      await ops.executeOperation(owner, "notifications.reconcile", {
        projectId: project.id,
        deliveryId: expired.id,
        revision: expired.revision,
        decision: "retry",
        confirmedNotAccepted: true,
      });
      const replacementSend = deliverNotifications(db, config, store, async () => {
        secondStarted();
        await barrierB;
        throw new MailSendError("UNKNOWN_REPLACEMENT", "uncertain");
      });
      await startedB;
      firstRelease();
      await originalSend;
      assert.equal(
        (
          await db.one("SELECT status FROM notification_deliveries WHERE id=$1", [
            expired.id,
          ])
        ).status,
        "sending",
      );
      secondRelease();
      await replacementSend;
      assert.equal(
        (
          await db.one("SELECT status FROM notification_deliveries WHERE id=$1", [
            expired.id,
          ])
        ).status,
        "uncertain",
      );

      await ops.executeOperation(owner, "notifications.subscribe", {
        projectId: project.id,
        revision: 3,
        events: ["reply"],
        includeSelf: true,
        includeContent: true,
      });
      const discussion = await ops.executeOperation(owner, "threads.create", {
        projectId: project.id,
        body: "Transaction clock ordering",
        idempotencyKey: randomUUID(),
      });
      const olderConnection = await pool.connect();
      try {
        await olderConnection.query("BEGIN");
        await olderConnection.query("SELECT now()");
        const laterTransaction = await ops.executeOperation(owner, "threads.reply", {
          threadId: discussion.id,
          revision: discussion.revision,
          body: "Later transaction, earlier reply",
          mentions: [],
          idempotencyKey: randomUUID(),
        });
        const earlierTransaction = new Database(olderConnection);
        await accountLock(earlierTransaction);
        await feedback(earlierTransaction, owner, "threads.reply", {
          threadId: discussion.id,
          revision: laterTransaction.revision,
          body: "Earlier transaction, later reply",
          mentions: [],
          idempotencyKey: randomUUID(),
        });
        await olderConnection.query("COMMIT");
      } finally {
        await olderConnection.query("ROLLBACK");
        olderConnection.release();
      }
      const chronological = await db.query(
        "SELECT data->>'body' AS body FROM replies WHERE thread_id=$1 ORDER BY created_at,id",
        [discussion.id],
      );
      assert.deepEqual(
        chronological.map((row) => row.body),
        ["Earlier transaction, later reply", "Later transaction, earlier reply"],
      );
      const excerpts = await db.query(
        "SELECT payload->>'comment' AS body FROM notification_deliveries WHERE thread_id=$1",
        [discussion.id],
      );
      assert.deepEqual(
        new Set(excerpts.map((row) => row.body)),
        new Set(["Earlier transaction, later reply", "Later transaction, earlier reply"]),
      );
      assert.equal(
        (
          await db.one(
            "SELECT count(*)::integer n FROM notification_deliveries WHERE status='accepted'",
          )
        ).n,
        4,
      );
      const uncertainBefore = (
        await db.one(
          "SELECT count(*)::integer n FROM notification_deliveries WHERE status='uncertain'",
        )
      ).n;
      await db.query(
        "UPDATE notification_deliveries SET status='sending',lease_until=now()-interval '1 second' WHERE id=(SELECT id FROM notification_deliveries WHERE status='accepted' ORDER BY id LIMIT 1)",
      );
      await Promise.all([
        deliverNotifications(db, config, store, sender),
        deliverNotifications(db, config, store, sender),
      ]);
      assert.equal(
        (
          await db.one(
            "SELECT count(*)::integer n FROM notification_deliveries WHERE status='uncertain'",
          )
        ).n,
        uncertainBefore + 1,
      );
      assert.ok([...sends.values()].every((n) => n === 1));
    } finally {
      await pool?.end();
      if (started)
        execFileSync("pg_ctl", ["-D", data, "-m", "fast", "-w", "stop"], {
          stdio: "pipe",
        });
      await rm(dir, { recursive: true, force: true });
    }
  },
);
