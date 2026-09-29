import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { Database } from "../src/server/db.js";
import { migrate } from "../src/server/migrations.js";
import { Operations } from "../src/server/operations.js";
import { drainExpiredDiagnosticEvidence } from "../src/server/diagnostics/evidence.js";
import {
  diagnosticKinds,
  splitDiagnosticBytes,
} from "../src/shared/screenshot-diagnostics.js";

const sha = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
const raw = new TextEncoder().encode(
  'Cookie: sid=fake-cookie\nAuthorization: Bearer fake-token\n{"password":"fake-password"}',
);

async function fixture() {
  const pg = new PGlite();
  const db = new Database(pg as any);
  const objects = new Map<string, Buffer>();
  const store = {
    put: async (key: string, bytes: Buffer) => {
      objects.set(key, bytes);
    },
    get: async (key: string) => {
      const found = objects.get(key);
      if (!found) throw new Error("missing object");
      return found;
    },
    remove: async (key: string) => {
      objects.delete(key);
    },
  };
  await migrate(db);
  const ops = new Operations(
    db,
    store as any,
    {
      production: false,
      organizationId: "synthetic",
    } as any,
  );
  const owner = await ops.auth.bootstrap(
    "diag-owner@example.test",
    "Owner",
    "Correct-Horse-Battery-123",
  );
  const project = await ops.executeOperation(owner, "projects.create", {
    name: "Diagnostic site",
    origins: ["https://example.test"],
  });
  const thread = await ops.executeOperation(owner, "threads.create", {
    projectId: project.id,
    body: "Synthetic issue",
    context: { url: "https://example.test/page", viewport: { width: 1000, height: 800 } },
    idempotencyKey: randomUUID(),
  });
  return { pg, db, ops, store, objects, owner, project, thread };
}

function manifest(evidenceId: string, fileId: string, startedAt: string) {
  return {
    schemaVersion: 1,
    id: evidenceId,
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
              capturedBytes: raw.byteLength,
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
        byteLength: raw.byteLength,
        sha256: sha(raw),
        chunks: [{ sequence: 0, byteLength: raw.byteLength, sha256: sha(raw) }],
      },
    ],
    totalBytes: raw.byteLength,
  };
}

test("private upload keeps raw bytes, is retry-safe, and commits only complete manifests", async () => {
  const f = await fixture();
  try {
    const evidenceId = randomUUID();
    const fileId = randomUUID();
    const startedAt = new Date().toISOString();
    const beginInput = {
      threadId: f.thread.id,
      revision: f.thread.revision,
      evidenceId,
      idempotencyKey: randomUUID(),
      sourceUrl: "https://example.test/page?token=fake",
      startedAt,
    };
    await assert.rejects(
      f.ops.executeOperation(f.owner, "diagnostics.begin", {
        ...beginInput,
        sourceUrl: "https://other.test/page",
      }),
      { code: "VALIDATION" },
    );
    const begun = await f.ops.executeOperation(f.owner, "diagnostics.begin", beginInput);
    assert.equal(begun.evidence.status, "pending");
    assert.equal(
      (await f.ops.executeOperation(f.owner, "diagnostics.begin", beginInput)).evidence
        .id,
      evidenceId,
    );
    const parts = await splitDiagnosticBytes(raw, fileId);
    const putInput = {
      evidenceId,
      fileId,
      sequence: 0,
      sha256: parts[0].sha256,
      contentBase64: Buffer.from(parts[0].data).toString("base64"),
    };
    await f.ops.executeOperation(f.owner, "diagnostics.putChunk", putInput);
    await f.ops.executeOperation(f.owner, "diagnostics.putChunk", putInput);
    assert.equal(
      (
        await f.db.one(
          "SELECT count(*)::integer AS total FROM diagnostic_chunks WHERE evidence_id=$1",
          [evidenceId],
        )
      ).total,
      1,
    );
    await assert.rejects(
      f.ops.executeOperation(f.owner, "diagnostics.putChunk", {
        ...putInput,
        contentBase64: Buffer.from("changed").toString("base64"),
        sha256: sha(new TextEncoder().encode("changed")),
      }),
      { code: "CONFLICT" },
    );
    await assert.rejects(
      f.ops.executeOperation(f.owner, "diagnostics.finalize", {
        evidenceId,
        idempotencyKey: randomUUID(),
        manifest: { ...manifest(evidenceId, fileId, startedAt), files: [] },
      }),
      { code: "VALIDATION" },
    );
    await assert.rejects(
      f.ops.executeOperation(f.owner, "diagnostics.finalize", {
        evidenceId,
        idempotencyKey: randomUUID(),
        manifest: manifest(evidenceId, randomUUID(), startedAt),
      }),
      { code: "VALIDATION" },
    );
    const finalizeInput = {
      evidenceId,
      idempotencyKey: randomUUID(),
      manifest: manifest(evidenceId, fileId, startedAt),
    };
    const completed = await f.ops.executeOperation(
      f.owner,
      "diagnostics.finalize",
      finalizeInput,
    );
    assert.equal(completed.evidence.status, "complete");
    assert.equal(
      (await f.ops.executeOperation(f.owner, "diagnostics.finalize", finalizeInput))
        .evidence.id,
      evidenceId,
    );
    assert.ok(!JSON.stringify(completed).includes("fake-password"));
    assert.ok(!JSON.stringify(completed).includes("fake-cookie"));
    const rows = await f.db.query(
      "SELECT object_key FROM diagnostic_chunks WHERE evidence_id=$1",
      [evidenceId],
    );
    assert.equal(rows.length, 1);
    assert.deepEqual(await f.store.get(rows[0].object_key), Buffer.from(raw));
    await assert.rejects(
      f.ops.executeOperation(f.owner, "diagnostics.putChunk", putInput),
      { code: "CONFLICT" },
    );
  } finally {
    await f.pg.close();
  }
});

test("aggregate chunk quota prevents uploads above 256 MiB", async () => {
  const f = await fixture();
  try {
    const evidenceId = randomUUID(),
      fileId = randomUUID();
    await f.ops.executeOperation(f.owner, "diagnostics.begin", {
      threadId: f.thread.id,
      revision: f.thread.revision,
      evidenceId,
      idempotencyKey: randomUUID(),
      sourceUrl: "https://example.test/page",
      startedAt: new Date().toISOString(),
    });
    for (let sequence = 0; sequence < 128; sequence++)
      await f.db.query(
        `INSERT INTO diagnostic_chunks(evidence_id,file_id,sequence,sha256,byte_size,object_key)
         VALUES($1,$2,$3,$4,2097152,$5)`,
        [evidenceId, fileId, sequence, sha(raw), `synthetic/quota/${sequence}`],
      );
    await assert.rejects(
      f.ops.executeOperation(f.owner, "diagnostics.putChunk", {
        evidenceId,
        fileId,
        sequence: 128,
        sha256: sha(raw),
        contentBase64: Buffer.from(raw).toString("base64"),
      }),
      { code: "LIMIT_REACHED" },
    );
  } finally {
    await f.pg.close();
  }
});

test("upload requires an explicit new scope even when an extension has older thread grants", async () => {
  const f = await fixture();
  try {
    const token = await f.ops.auth.issueToken(
      f.db,
      f.owner,
      {
        name: "Old extension",
        projectIds: [f.project.id],
        scopes: ["threads.get", "threads.create", "recordings.upload"],
        expiresInDays: 30,
      },
      "extension",
    );
    const actor = await f.ops.auth.authenticate(token.token);
    await assert.rejects(
      f.ops.executeOperation(actor, "diagnostics.begin", {
        threadId: f.thread.id,
        revision: f.thread.revision,
        evidenceId: randomUUID(),
        idempotencyKey: randomUUID(),
        sourceUrl: "https://example.test/page",
        startedAt: new Date().toISOString(),
      }),
      { code: "FORBIDDEN" },
    );
  } finally {
    await f.pg.close();
  }
});

test("24-hour pending expiry retains a visible receipt and cleans private chunks", async () => {
  const f = await fixture();
  try {
    const evidenceId = randomUUID(),
      fileId = randomUUID();
    await f.ops.executeOperation(f.owner, "diagnostics.begin", {
      threadId: f.thread.id,
      revision: f.thread.revision,
      evidenceId,
      idempotencyKey: randomUUID(),
      sourceUrl: "https://example.test/page",
      startedAt: new Date().toISOString(),
    });
    await f.ops.executeOperation(f.owner, "diagnostics.putChunk", {
      evidenceId,
      fileId,
      sequence: 0,
      sha256: sha(raw),
      contentBase64: Buffer.from(raw).toString("base64"),
    });
    assert.equal(f.objects.size, 1);
    await f.db.query(
      "UPDATE diagnostic_evidence SET expires_at=now()-interval '1 minute' WHERE id=$1",
      [evidenceId],
    );
    await drainExpiredDiagnosticEvidence(f.db, f.store as any);
    assert.equal(
      (await f.db.one("SELECT status FROM diagnostic_evidence WHERE id=$1", [evidenceId]))
        .status,
      "expired",
    );
    assert.equal(
      (
        await f.db.one(
          "SELECT count(*)::integer AS total FROM diagnostic_chunks WHERE evidence_id=$1",
          [evidenceId],
        )
      ).total,
      0,
    );
    assert.equal(f.objects.size, 0);
    await assert.rejects(
      f.ops.executeOperation(f.owner, "diagnostics.putChunk", {
        evidenceId,
        fileId,
        sequence: 0,
        sha256: sha(raw),
        contentBase64: Buffer.from(raw).toString("base64"),
      }),
      { code: "CONFLICT" },
    );
  } finally {
    await f.pg.close();
  }
});

test("an uncertain object write does not strand untracked private bytes", async () => {
  const f = await fixture();
  try {
    const evidenceId = randomUUID(),
      fileId = randomUUID();
    await f.ops.executeOperation(f.owner, "diagnostics.begin", {
      threadId: f.thread.id,
      revision: f.thread.revision,
      evidenceId,
      idempotencyKey: randomUUID(),
      sourceUrl: "https://example.test/page",
      startedAt: new Date().toISOString(),
    });
    f.store.put = async (key: string, bytes: Buffer) => {
      f.objects.set(key, bytes);
      throw new Error("synthetic timeout after storing");
    };
    await assert.rejects(
      f.ops.executeOperation(f.owner, "diagnostics.putChunk", {
        evidenceId,
        fileId,
        sequence: 0,
        sha256: sha(raw),
        contentBase64: Buffer.from(raw).toString("base64"),
      }),
      { code: "UPLOAD_FAILED" },
    );
    assert.equal(f.objects.size, 0);
  } finally {
    await f.pg.close();
  }
});

test("thread move transfers evidence ownership and deletion queues its object", async () => {
  const f = await fixture();
  try {
    const evidenceId = randomUUID(),
      fileId = randomUUID(),
      startedAt = new Date().toISOString();
    await f.ops.executeOperation(f.owner, "diagnostics.begin", {
      threadId: f.thread.id,
      revision: f.thread.revision,
      evidenceId,
      idempotencyKey: randomUUID(),
      sourceUrl: "https://example.test/page",
      startedAt,
    });
    await f.ops.executeOperation(f.owner, "diagnostics.putChunk", {
      evidenceId,
      fileId,
      sequence: 0,
      sha256: sha(raw),
      contentBase64: Buffer.from(raw).toString("base64"),
    });
    const committed = await f.ops.executeOperation(f.owner, "diagnostics.finalize", {
      evidenceId,
      idempotencyKey: randomUUID(),
      manifest: manifest(evidenceId, fileId, startedAt),
    });
    const destination = await f.ops.executeOperation(f.owner, "projects.create", {
      name: "Destination",
      origins: ["https://example.test"],
    });
    const moved = await f.ops.executeOperation(f.owner, "threads.move", {
      threadId: f.thread.id,
      revision: committed.thread.revision,
      projectId: destination.id,
    });
    assert.equal(
      (
        await f.db.one("SELECT project_id FROM diagnostic_evidence WHERE id=$1", [
          evidenceId,
        ])
      ).project_id,
      destination.id,
    );
    const deleted = await f.ops.executeOperation(f.owner, "threads.delete", {
      projectId: destination.id,
      threads: [{ threadId: f.thread.id, revision: moved.revision }],
      idempotencyKey: randomUUID(),
      confirmation: "DELETE",
    });
    assert.equal(deleted.cleanup.remaining, 0);
    assert.equal(f.objects.size, 0);
  } finally {
    await f.pg.close();
  }
});
