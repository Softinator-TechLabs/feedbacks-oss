import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Pool } from "pg";
import { Database } from "../src/server/db.js";
import { migrate } from "../src/server/migrations.js";
import { Operations } from "../src/server/operations.js";
import { feedback } from "../src/server/feedback.js";
import sharp from "sharp";

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
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
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
