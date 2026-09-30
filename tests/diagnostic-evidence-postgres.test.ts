import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { AddressInfo } from "node:net";
import { Pool } from "pg";
import { Database } from "../src/server/db.js";
import { migrate } from "../src/server/migrations.js";
import { Operations } from "../src/server/operations.js";
import { drainExpiredDiagnosticEvidence } from "../src/server/diagnostics/evidence.js";
import { diagnosticKinds } from "../src/shared/screenshot-diagnostics.js";

const bytes = Buffer.from(
  "Cookie: fake\nAuthorization: Bearer synthetic\npassword=fake",
  "utf8",
);
const hash = createHash("sha256").update(bytes).digest("hex");

async function freePort() {
  const listener = createServer();
  await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = (listener.address() as AddressInfo).port;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  return port;
}

function manifest(id: string, fileId: string, startedAt: string) {
  return {
    schemaVersion: 1,
    id,
    sourceOrigin: "https://example.test",
    startedAt,
    endedAt: startedAt,
    coverage: Object.fromEntries(
      diagnosticKinds.map((kind) => [
        kind,
        kind === "network"
          ? {
              status: "complete",
              observedCount: 1,
              capturedBytes: bytes.length,
              reasons: [],
            }
          : {
              status: "unavailable",
              observedCount: 0,
              capturedBytes: 0,
              reasons: ["not-collected"],
            },
      ]),
    ),
    files: [
      {
        fileId,
        kind: "network",
        mimeType: "application/jsonl",
        byteLength: bytes.length,
        sha256: hash,
        chunks: [{ sequence: 0, byteLength: bytes.length, sha256: hash }],
      },
    ],
    totalBytes: bytes.length,
  };
}

test(
  "native PostgreSQL serializes finalize, expiry, project move and deletion receipts",
  {
    skip: process.env.FEEDBACKS_NATIVE_POSTGRES !== "1",
  },
  async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "feedbacks-diagnostics-"));
    const data = path.join(dir, "data");
    const port = await freePort();
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
          `-k '${dir}' -p ${port} -h ''`,
          "-w",
          "start",
        ],
        { stdio: "pipe" },
      );
      started = true;
      pool = new Pool({
        host: dir,
        port,
        user: "feedbacks_test",
        database: "postgres",
        max: 5,
      });
      const db = new Database(pool);
      await Promise.all([migrate(db), migrate(db)]);
      assert.equal(
        (await db.one("SELECT max(version)::integer AS version FROM migrations")).version,
        27,
      );
      const objects = new Map<string, Buffer>();
      const store = {
        put: async (key: string, value: Buffer) => {
          objects.set(key, value);
        },
        get: async (key: string) => {
          const value = objects.get(key);
          if (!value) throw new Error("missing object");
          return value;
        },
        remove: async (key: string) => {
          objects.delete(key);
        },
      };
      const ops = new Operations(
        db,
        store as any,
        { production: false, organizationId: "synthetic" } as any,
      );
      const owner = await ops.auth.bootstrap(
        "pg-diag@example.test",
        "Owner",
        "Correct-Horse-Battery-123",
      );
      const project = await ops.executeOperation(owner, "projects.create", {
        name: "Source",
        origins: ["https://example.test"],
      });
      const destination = await ops.executeOperation(owner, "projects.create", {
        name: "Destination",
        origins: ["https://example.test"],
      });
      const thread = await ops.executeOperation(owner, "threads.create", {
        projectId: project.id,
        body: "Synthetic",
        idempotencyKey: randomUUID(),
        context: {
          url: "https://example.test/page",
          viewport: { width: 800, height: 600 },
        },
      });
      const id = randomUUID(),
        fileId = randomUUID(),
        startedAt = new Date().toISOString();
      await ops.executeOperation(owner, "diagnostics.begin", {
        threadId: thread.id,
        revision: thread.revision,
        evidenceId: id,
        idempotencyKey: randomUUID(),
        sourceUrl: "https://example.test/page",
        startedAt,
      });
      await ops.executeOperation(owner, "diagnostics.putChunk", {
        evidenceId: id,
        fileId,
        sequence: 0,
        sha256: hash,
        contentBase64: bytes.toString("base64"),
      });
      const attempts = await Promise.allSettled(
        ["first-finalize", "second-finalize"].map((idempotencyKey) =>
          ops.executeOperation(owner, "diagnostics.finalize", {
            evidenceId: id,
            manifest: manifest(id, fileId, startedAt),
            idempotencyKey,
          }),
        ),
      );
      assert.equal(
        attempts.filter((attempt) => attempt.status === "fulfilled").length,
        1,
      );
      assert.equal(
        attempts.filter(
          (attempt) =>
            attempt.status === "rejected" && (attempt.reason as any).code === "CONFLICT",
        ).length,
        1,
      );
      const committed = attempts.find(
        (attempt) => attempt.status === "fulfilled",
      ) as PromiseFulfilledResult<any>;
      const moved = await ops.executeOperation(owner, "threads.move", {
        threadId: thread.id,
        revision: committed.value.thread.revision,
        projectId: destination.id,
      });
      assert.equal(
        (await db.one("SELECT project_id FROM diagnostic_evidence WHERE id=$1", [id]))
          .project_id,
        destination.id,
      );
      const pendingId = randomUUID(),
        pendingFileId = randomUUID();
      await ops.executeOperation(owner, "diagnostics.begin", {
        threadId: thread.id,
        revision: moved.revision,
        evidenceId: pendingId,
        idempotencyKey: randomUUID(),
        sourceUrl: "https://example.test/page",
        startedAt,
      });
      await ops.executeOperation(owner, "diagnostics.putChunk", {
        evidenceId: pendingId,
        fileId: pendingFileId,
        sequence: 0,
        sha256: hash,
        contentBase64: bytes.toString("base64"),
      });
      await db.query(
        "UPDATE diagnostic_evidence SET expires_at=now()-interval '1 minute' WHERE id=$1",
        [pendingId],
      );
      await drainExpiredDiagnosticEvidence(db, store as any);
      assert.equal(
        (await db.one("SELECT status FROM diagnostic_evidence WHERE id=$1", [pendingId]))
          .status,
        "expired",
      );
      const deleted = await ops.executeOperation(owner, "threads.delete", {
        projectId: destination.id,
        threads: [{ threadId: thread.id, revision: moved.revision }],
        idempotencyKey: randomUUID(),
        confirmation: "DELETE",
      });
      assert.equal(deleted.cleanup.remaining, 0);
      assert.equal(objects.size, 0);
    } finally {
      if (pool) await pool.end();
      if (started)
        execFileSync("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"], {
          stdio: "pipe",
        });
      await rm(dir, { recursive: true, force: true });
    }
  },
);
