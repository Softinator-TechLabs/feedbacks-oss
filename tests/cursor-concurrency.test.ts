import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Pool } from "pg";
import { Database } from "../src/server/db.js";
import { migrate } from "../src/server/migrations.js";
import { Operations } from "../src/server/operations.js";
import { feedback } from "../src/server/feedback.js";
import { GithubApp } from "../src/server/github-app.js";
import { pollGithubStatusSync } from "../src/server/github-status-worker.js";
import sharp from "sharp";
import {
  cleanupDeletedObjects,
  drainThreadDeletionQueue,
} from "../src/server/thread-deletion.js";

// Opt-in native PostgreSQL: PGlite intentionally serializes its one connection and
// cannot reproduce different transactions committing in reversed cursor order.
test(
  "project cursors cannot pass an uncommitted event; export handoff sees both later commits",
  { skip: process.env.FEEDBACKS_NATIVE_POSTGRES !== "1" },
  async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "feedbacks-cursor-")),
      data = path.join(dir, "data");
    let started = false,
      pool: Pool | undefined,
      a: any,
      b: any;
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
          `-k '${dir}' -p 55432 -h ''`,
          "-w",
          "start",
        ],
        { stdio: "pipe" },
      );
      started = true;
      pool = new Pool({
        host: dir,
        port: 55432,
        user: "feedbacks_test",
        database: "postgres",
        max: 5,
      });
      const db = new Database(pool),
        ops = new Operations(
          db,
          {} as any,
          { appOrigin: "http://localhost:3000" } as any,
        );
      await Promise.all([migrate(db), migrate(db)]);
      assert.deepEqual(
        (await db.query("SELECT version FROM migrations ORDER BY version")).map(
          (r) => r.version,
        ),
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21],
      );
      const owner = await ops.auth.bootstrap(
        "owner@example.test",
        "Owner",
        "Correct-Horse-Battery-123",
      );
      const p = await ops.executeOperation(owner, "projects.create", {
        name: "Cursor site",
        origins: ["https://example.test"],
      });
      const base = {
        projectId: p.id,
        body: "Request",
        context: { url: "https://example.test/", viewport: { width: 1440, height: 900 } },
      };
      const first = await ops.executeOperation(owner, "threads.create", {
        ...base,
        idempotencyKey: "cursor-first",
      });
      const second = await ops.executeOperation(owner, "threads.create", {
        ...base,
        idempotencyKey: "cursor-second",
      });
      const claims = await Promise.allSettled(
        ["worker-a", "worker-b"].map((idempotencyKey) =>
          ops.executeOperation(owner, "assignments.claim", {
            threadId: first.id,
            revision: first.revision,
            summary: "Concurrent claim",
            idempotencyKey,
          }),
        ),
      );
      assert.equal(claims.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal(
        claims.filter((r) => r.status === "rejected" && r.reason.code === "CONFLICT")
          .length,
        1,
      );
      const activeClaim = claims.find((r) => r.status === "fulfilled");
      assert.ok(activeClaim?.status === "fulfilled");
      await ops.executeOperation(owner, "assignments.release", {
        assignmentId: activeClaim.value.id,
        revision: activeClaim.value.revision,
        outcome: "paused",
      });
      const delegationInput = {
        threadId: first.id,
        threadRevision: first.revision,
        userId: owner.userId,
        summary: "Concurrent delegation",
        category: "general",
        tags: [],
        githubDecision: "undecided",
        githubRationale: "Review evidence first",
      };
      const delegated = await Promise.allSettled(
        ["delegate-a", "delegate-b"].map((idempotencyKey) =>
          ops.executeOperation(owner, "assignments.assign", {
            ...delegationInput,
            idempotencyKey,
          }),
        ),
      );
      assert.equal(delegated.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal(
        delegated.filter((r) => r.status === "rejected" && r.reason.code === "CONFLICT")
          .length,
        1,
      );
      const activeDelegation = delegated.find((r) => r.status === "fulfilled");
      assert.ok(activeDelegation?.status === "fulfilled");
      const updates = await Promise.allSettled(
        ["update-a", "update-b"].map((idempotencyKey) =>
          ops.executeOperation(owner, "assignments.assign", {
            ...delegationInput,
            delegationId: activeDelegation.value.id,
            revision: 1,
            idempotencyKey,
          }),
        ),
      );
      assert.equal(updates.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal(
        updates.filter((r) => r.status === "rejected" && r.reason.code === "CONFLICT")
          .length,
        1,
      );
      assert.equal(
        (
          await ops.executeOperation(owner, "assignments.history", {
            delegationId: activeDelegation.value.id,
          })
        ).total,
        2,
      );
      await ops.executeOperation(owner, "assignments.cancel", {
        delegationId: activeDelegation.value.id,
        revision: 2,
        reason: "Concurrency verified",
        idempotencyKey: "cancel-delegation",
      });
      const planningProject = await ops.executeOperation(owner, "projects.create", {
        name: "Native planning",
        origins: ["https://planning.example.test"],
      });
      const planningThreads = [];
      for (let n = 0; n < 3; n++)
        planningThreads.push(
          await ops.executeOperation(owner, "threads.create", {
            ...base,
            projectId: planningProject.id,
            context: {
              url: "https://planning.example.test",
              viewport: { width: 1440, height: 900 },
            },
            idempotencyKey: `native-planning-${n}`,
          }),
        );
      for (let n = 0; n < 2; n++) {
        const planned = await ops.executeOperation(owner, "threads.plan", {
          threadId: planningThreads[n].id,
          revision: 1,
          workPlan: {
            priority: n === 0 ? "high" : "normal",
            schedule: n === 0 ? "later" : "today",
            scheduledFor: n === 0 ? null : "2026-09-30",
            timeZone: "Asia/Kolkata",
          },
        });
        await ops.executeOperation(owner, "assignments.assign", {
          ...delegationInput,
          threadId: planned.id,
          threadRevision: planned.revision,
          idempotencyKey: `native-planning-assignment-${n}`,
        });
      }
      const planningFilters = {
        projectId: planningProject.id,
        assignedTo: owner.userId,
        sort: "workPlan",
        planningDate: "2026-09-30",
        limit: 1,
      };
      const planningFirst = await ops.executeOperation(
        owner,
        "threads.list",
        planningFilters,
      );
      assert.equal(planningFirst.total, 2);
      assert.equal(planningFirst.items[0].id, planningThreads[1].id);
      const planningNext = await ops.executeOperation(owner, "threads.list", {
        ...planningFilters,
        offset: planningFirst.nextOffset,
      });
      assert.equal(planningNext.items[0].id, planningThreads[0].id);
      assert.equal(planningNext.nextOffset, null);
      a = await pool.connect();
      b = await pool.connect();
      await a.query("BEGIN");
      await b.query("BEGIN");
      await feedback(new Database(a), owner, "threads.reply", {
        threadId: first.id,
        revision: 1,
        body: "First delayed commit",
        mentions: [],
        idempotencyKey: "cursor-reply-first",
      });
      let secondAllocated = false;
      const secondWrite = feedback(new Database(b), owner, "threads.reply", {
        threadId: second.id,
        revision: 1,
        body: "Second commit",
        mentions: [],
        idempotencyKey: "cursor-reply-second",
      }).then(() => {
        secondAllocated = true;
      });
      // Wait for PostgreSQL itself to report the advisory wait, or for the buggy
      // second allocation to complete. No assumption about transaction timing.
      const deadline = Date.now() + 3000;
      let waiting = false;
      while (!secondAllocated && !waiting && Date.now() < deadline) {
        const result = await pool.query(
          "SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND wait_event='advisory'",
          [b.processID],
        );
        waiting = result.rowCount === 1;
        if (!waiting && !secondAllocated) await new Promise((r) => setTimeout(r, 10));
      }
      assert.equal(
        secondAllocated,
        false,
        "later project event allocated before earlier transaction committed",
      );
      assert.equal(waiting, true, "second writer must wait on the project advisory lock");
      const snapshot = await ops.executeOperation(owner, "context.export", {
        projectId: p.id,
      });
      assert.equal(snapshot.items.find((t: any) => t.id === first.id).revision, 1);
      assert.equal(snapshot.items.find((t: any) => t.id === second.id).revision, 1);
      await a.query("COMMIT");
      await secondWrite;
      await b.query("COMMIT");
      const changes = await ops.executeOperation(owner, "context.changes", {
        projectId: p.id,
        cursor: snapshot.cursor,
      });
      assert.deepEqual(
        changes.items.map((e: any) => e.entityId),
        [first.id, second.id],
      );
      assert.ok(BigInt(changes.items[1].cursor) > BigInt(changes.items[0].cursor));
      const concurrentExports = await Promise.allSettled(
        Array.from({ length: 6 }, () =>
          ops.executeOperation(owner, "context.export", { projectId: p.id, limit: 1 }),
        ),
      );
      assert.equal(
        concurrentExports.filter((result) => result.status === "fulfilled").length,
        3,
      );
      assert.ok(
        concurrentExports
          .filter((result) => result.status === "rejected")
          .every((result) => result.reason.code === "EXPORT_CAPACITY"),
      );
      assert.equal(
        (await db.one("SELECT count(*)::integer AS count FROM export_snapshots")).count,
        4,
        "concurrent connections cannot exceed the shared snapshot budget",
      );

      const image = await sharp({
        create: { width: 4, height: 4, channels: 3, background: "#ffffff" },
      })
        .png()
        .toBuffer();
      let releasePut: (() => void) | undefined;
      let putStarted: (() => void) | undefined;
      const putReady = () =>
        new Promise<void>((resolve) => {
          putStarted = resolve;
        });
      const removed: string[] = [];
      const uploadOps = new Operations(
        db,
        {
          put: async () => {
            putStarted?.();
            await new Promise<void>((resolve) => {
              releasePut = resolve;
            });
          },
          get: async () => image,
          remove: async (key) => {
            removed.push(key);
          },
        },
        { organizationId: "test", production: false } as any,
      );
      const third = await ops.executeOperation(owner, "threads.create", {
        ...base,
        idempotencyKey: "upload-lock-third",
      });
      let startedPut = putReady();
      const upload = uploadOps.executeOperation(owner, "assets.upload", {
        threadId: third.id,
        revision: third.revision,
        imageBase64: image.toString("base64"),
        idempotencyKey: "upload-lock-success",
      });
      await startedPut;
      try {
        const list = await Promise.race([
          ops.executeOperation(owner, "projects.list", {}),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error("account lock held during object upload")),
              2000,
            ),
          ),
        ]);
        assert.ok((list as any).items.some((item: any) => item.id === p.id));
      } finally {
        releasePut?.();
      }
      const uploaded = await upload;
      assert.equal(uploaded.asset.contentType, "image/webp");
      assert.deepEqual(removed, []);

      startedPut = putReady();
      const staleUpload = uploadOps.executeOperation(owner, "assets.upload", {
        threadId: third.id,
        revision: uploaded.thread.revision,
        imageBase64: image.toString("base64"),
        idempotencyKey: "upload-lock-stale",
      });
      await startedPut;
      try {
        await ops.executeOperation(owner, "threads.reply", {
          threadId: third.id,
          revision: uploaded.thread.revision,
          body: "Change during upload",
          mentions: [],
          idempotencyKey: "upload-lock-reply",
        });
      } finally {
        releasePut?.();
      }
      await assert.rejects(staleUpload, { code: "CONFLICT" });
      assert.equal(removed.length, 1, "uncommitted private object must be removed");
      assert.equal(
        (await db.one("SELECT count(*)::integer AS count FROM assets")).count,
        1,
      );

      // Both workers discover the same due object before either claims it.
      // Real PostgreSQL must allow only one lease owner into private storage.
      const deleteOps = new Operations(
        db,
        {
          remove: async () => {
            throw new Error("synthetic storage unavailable");
          },
        } as any,
        {} as any,
      );
      const currentThird = await ops.executeOperation(owner, "threads.get", {
        threadId: third.id,
      });
      const deletion = await deleteOps.executeOperation(owner, "threads.delete", {
        projectId: p.id,
        threads: [{ threadId: third.id, revision: currentThird.revision }],
        idempotencyKey: "native-concurrent-deletion",
        confirmation: "DELETE",
      });
      assert.equal(deletion.cleanup.state, "failed");
      await db.query(
        "UPDATE thread_deletion_objects SET next_at=now()-interval '1 second' WHERE deletion_id=$1",
        [deletion.id],
      );
      let discovered = 0;
      let releaseDiscovery!: () => void;
      const discoveryBarrier = new Promise<void>((resolve) => {
        releaseDiscovery = resolve;
      });
      const competingDb = new Database({
        query: async (sql: string, params?: any[]) => {
          const result = await pool!.query(sql, params);
          if (
            sql.startsWith(
              "SELECT deletion_id,object_key FROM thread_deletion_objects WHERE state",
            )
          ) {
            discovered++;
            if (discovered === 2) releaseDiscovery();
            await discoveryBarrier;
          }
          return result;
        },
      });
      let enteredStorage!: () => void;
      const storageStarted = new Promise<void>((resolve) => {
        enteredStorage = resolve;
      });
      let releaseStorage!: () => void;
      const storageBarrier = new Promise<void>((resolve) => {
        releaseStorage = resolve;
      });
      let removeCalls = 0,
        activeRemovals = 0,
        maxActiveRemovals = 0;
      const leasedStore = {
        remove: async () => {
          removeCalls++;
          activeRemovals++;
          maxActiveRemovals = Math.max(maxActiveRemovals, activeRemovals);
          enteredStorage();
          try {
            await storageBarrier;
            throw new Error("synthetic retryable failure");
          } finally {
            activeRemovals--;
          }
        },
      } as any;
      const drains = [
        drainThreadDeletionQueue(competingDb, leasedStore),
        drainThreadDeletionQueue(competingDb, leasedStore),
      ];
      await storageStarted;
      try {
        // The losing worker completes while the winner is still in storage.
        await Promise.race(drains);
        assert.equal(discovered, 2);
        assert.equal(removeCalls, 1);
        const duringClaim = await cleanupDeletedObjects(db, leasedStore, deletion.id);
        assert.equal(duringClaim.cleanup.remaining, 1);
        assert.equal(removeCalls, 1, "manual retry must respect the active worker lease");
        const leased = await db.one(
          "SELECT attempts,lease_id FROM thread_deletion_objects WHERE deletion_id=$1",
          [deletion.id],
        );
        assert.equal(
          leased.attempts,
          2,
          "only the initial failure and winning worker increment attempts",
        );
        assert.ok(leased.lease_id);
      } finally {
        releaseStorage();
      }
      await Promise.all(drains);
      const failedCleanup = await db.one(
        "SELECT state,lease_id,next_at>now() AS backed_off FROM thread_deletion_objects WHERE deletion_id=$1",
        [deletion.id],
      );
      assert.deepEqual(failedCleanup, {
        state: "failed",
        lease_id: null,
        backed_off: true,
      });
      await drainThreadDeletionQueue(db, leasedStore);
      assert.equal(
        removeCalls,
        1,
        "scheduled worker must honor persisted failure backoff",
      );
      const recovered = await cleanupDeletedObjects(
        db,
        {
          remove: async () => {
            removeCalls++;
            activeRemovals++;
            maxActiveRemovals = Math.max(maxActiveRemovals, activeRemovals);
            activeRemovals--;
          },
        } as any,
        deletion.id,
      );
      assert.equal(recovered.cleanup.state, "complete");
      assert.equal(
        removeCalls,
        2,
        "explicit retry bypasses backoff after the old lease is released",
      );
      assert.equal(maxActiveRemovals, 1);

      // Pause the worker after it has decided to record a failed read, but
      // before its status-row lock. A maintainer can reserve a PATCH here.
      const raceProject = await ops.executeOperation(owner, "projects.create", {
        name: "GitHub race",
        origins: ["https://example.test"],
        repositoryUrl: "https://github.com/acme/site",
      });
      const raceThread = await ops.executeOperation(owner, "threads.create", {
        ...base,
        projectId: raceProject.id,
        idempotencyKey: "status-race-thread",
      });
      const issueUrl = "https://github.com/acme/site/issues/13";
      await db.query(
        `UPDATE projects SET data=jsonb_set(jsonb_set(data,'{githubConnected}','true'::jsonb),
          '{githubStatusSync}','true'::jsonb) WHERE id=$1`,
        [raceProject.id],
      );
      await db.query(
        `UPDATE threads SET data=jsonb_set(data,'{externalIssues}',
          jsonb_build_array(jsonb_build_object('url',$2::text,'repository','acme/site',
          'number',13,'verification','github_verified','state','closed'))) WHERE id=$1`,
        [raceThread.id, issueUrl],
      );
      await db.query(
        `INSERT INTO github_status_sync(thread_id,issue_url,status,next_at)
         VALUES($1,$2,'ready',now()-interval '1 minute')`,
        [raceThread.id, issueUrl],
      );
      const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
      const githubConfig: any = {
        githubAppId: "123",
        githubAppSlug: "feedbacks-test",
        githubAppPrivateKey: privateKey
          .export({ type: "pkcs8", format: "pem" })
          .toString(),
      };
      const github = new GithubApp(githubConfig, async (input, init) => {
        const route = new URL(String(input)).pathname;
        if (route.endsWith("/installation")) return Response.json({ id: 91 });
        if (route.endsWith("/access_tokens"))
          return Response.json({ token: "installation-token" });
        if (route.endsWith("/issues/13")) throw new Error("worker read failed");
        throw new Error(`Unexpected GitHub API ${route}`);
      });
      let workerSelectEntered: (() => void) | undefined;
      let releaseWorkerSelect: (() => void) | undefined;
      const workerSelectStarted = new Promise<void>((resolve) => {
        workerSelectEntered = resolve;
      });
      let interceptWorkerSelect = true;
      const workerDb = new Database({
        query: (sql: string, params?: any[]) => pool!.query(sql, params),
        connect: async () => {
          const client = await pool!.connect();
          return {
            query: async (sql: string, params?: any[]) => {
              if (
                interceptWorkerSelect &&
                /FROM github_status_sync s\s+JOIN threads t ON t.id=s.thread_id/.test(sql)
              ) {
                interceptWorkerSelect = false;
                workerSelectEntered?.();
                await new Promise<void>((resolve) => {
                  releaseWorkerSelect = resolve;
                });
              }
              return client.query(sql, params);
            },
            release: () => client.release(),
          };
        },
      });
      const workerPoll = pollGithubStatusSync(workerDb, githubConfig, github);
      await workerSelectStarted;
      try {
        // Model the later PATCH reservation while the worker still holds its
        // earlier claim. The worker must not turn this uncertain write into error.
        await db.query(
          `UPDATE github_status_sync SET status='uncertain',pending_target='open',
            lease_until=clock_timestamp()+interval '2 minutes' WHERE thread_id=$1`,
          [raceThread.id],
        );
        releaseWorkerSelect?.();
        await workerPoll;
        const afterWorker = await db.one(
          "SELECT status,pending_target FROM github_status_sync WHERE thread_id=$1",
          [raceThread.id],
        );
        assert.deepEqual(afterWorker, { status: "uncertain", pending_target: "open" });
      } finally {
        releaseWorkerSelect?.();
      }
    } finally {
      if (a) {
        await a.query("ROLLBACK").catch(() => {});
        a.release();
      }
      if (b) {
        await b.query("ROLLBACK").catch(() => {});
        b.release();
      }
      await pool?.end();
      if (started)
        execFileSync("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"], {
          stdio: "pipe",
        });
      await rm(dir, { recursive: true, force: true });
    }
  },
);
