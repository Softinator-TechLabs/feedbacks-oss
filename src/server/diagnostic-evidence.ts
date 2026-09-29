import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { Actor } from "../shared/contracts.js";
import type { DiagnosticManifestV1 } from "../shared/screenshot-diagnostics.js";
import {
  DIAGNOSTIC_CHUNK_BYTES,
  DIAGNOSTIC_MAX_BYTES,
} from "../shared/screenshot-diagnostics.js";
import type { AssetStore } from "./assets.js";
import type { Config } from "./config.js";
import type { Database } from "./db.js";
import { DomainError, fail } from "./errors.js";
import { checkRevision, fullThread, saveThread, threadRow } from "./feedback.js";

function summary(row: any) {
  return {
    id: row.id as string,
    threadId: row.thread_id as string,
    projectId: row.project_id as string,
    status: row.status as "pending" | "complete" | "expired",
    startedAt: new Date(row.started_at).toISOString(),
    createdAt: new Date(row.created_at).toISOString(),
    totalBytes: Number(row.summary?.totalBytes ?? 0),
    fileCount: Number(row.summary?.fileCount ?? 0),
    coverage: row.summary?.coverage ?? {},
  };
}

export async function diagnosticRow(
  db: Database,
  actor: Actor,
  id: string,
  write = false,
) {
  const row = await db.one("SELECT * FROM diagnostic_evidence WHERE id=$1", [id]);
  if (!row) fail("NOT_FOUND", "Diagnostic evidence not found", 404);
  const thread = await threadRow(db, actor, row.thread_id, write ? "write" : undefined);
  const current = write
    ? await db.one("SELECT * FROM diagnostic_evidence WHERE id=$1 FOR UPDATE", [id])
    : row;
  if (!current) fail("NOT_FOUND", "Diagnostic evidence not found", 404);
  if (thread.project_id !== current.project_id)
    fail("CONFLICT", "Feedback changed project; retry on the current project", 409);
  return { row: current, thread };
}

export async function beginDiagnosticEvidence(db: Database, actor: Actor, input: any) {
  const thread = await threadRow(db, actor, input.threadId, "write", true);
  const pageOrigin = new URL(input.sourceUrl).origin;
  const threadOrigin = new URL(thread.data.context?.url).origin;
  if (pageOrigin !== threadOrigin)
    fail("VALIDATION", "Diagnostic origin must match the feedback website", 400);
  const existing = await db.one(
    "SELECT * FROM diagnostic_evidence WHERE id=$1 OR (owner_id=$2 AND request_key=$3) FOR UPDATE",
    [input.evidenceId, actor.userId, input.idempotencyKey],
  );
  if (existing) {
    if (
      existing.id !== input.evidenceId ||
      existing.thread_id !== thread.id ||
      existing.project_id !== thread.project_id ||
      existing.owner_id !== actor.userId ||
      existing.request_key !== input.idempotencyKey ||
      existing.source_origin !== pageOrigin ||
      new Date(existing.started_at).toISOString() !== input.startedAt ||
      existing.status === "expired"
    )
      fail("CONFLICT", "Diagnostic upload identity changed", 409);
    return { evidence: summary(existing) };
  }
  checkRevision(thread, input.revision);
  const row = await db.one(
    `INSERT INTO diagnostic_evidence(id,project_id,thread_id,owner_id,status,request_key,source_origin,started_at)
     VALUES($1,$2,$3,$4,'pending',$5,$6,$7) RETURNING *`,
    [
      input.evidenceId,
      thread.project_id,
      thread.id,
      actor.userId,
      input.idempotencyKey,
      pageOrigin,
      input.startedAt,
    ],
  );
  return { evidence: summary(row) };
}

function decodedChunk(input: any): Buffer {
  const encoded: string = input.contentBase64;
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))
    fail("VALIDATION", "Diagnostic chunk must be canonical base64");
  const bytes = Buffer.from(encoded, "base64");
  if (
    bytes.length < 1 ||
    bytes.length > DIAGNOSTIC_CHUNK_BYTES ||
    bytes.toString("base64") !== encoded
  )
    fail("VALIDATION", "Diagnostic chunk exceeds the 2 MiB limit");
  if (createHash("sha256").update(bytes).digest("hex") !== input.sha256)
    fail("VALIDATION", "Diagnostic chunk checksum differs");
  return bytes;
}

function chunkKey(config: Config, row: any, input: any): string {
  return `feedbacks/${config.production ? "production" : "development"}/organizations/${config.organizationId}/projects/${row.project_id}/feedback/${row.thread_id}/diagnostics/${row.id}/${input.fileId}/${input.sequence}-${input.sha256}-${randomUUID()}.bin`;
}

async function preflightChunk(db: Database, actor: Actor, input: any, bytes: Buffer) {
  const { row } = await diagnosticRow(db, actor, input.evidenceId, true);
  if (row.owner_id !== actor.userId)
    fail("FORBIDDEN", "Diagnostic upload belongs to another account", 403);
  if (row.status !== "pending" || new Date(row.expires_at).getTime() <= Date.now())
    fail("CONFLICT", "Diagnostic upload is no longer pending", 409);
  const existing = await db.one(
    "SELECT * FROM diagnostic_chunks WHERE evidence_id=$1 AND file_id=$2 AND sequence=$3",
    [row.id, input.fileId, input.sequence],
  );
  if (existing) {
    if (existing.sha256 !== input.sha256 || existing.byte_size !== bytes.length)
      fail("CONFLICT", "Diagnostic chunk retry differs", 409);
    return { row, prior: true };
  }
  const total = await db.one(
    "SELECT coalesce(sum(byte_size),0)::bigint AS total FROM diagnostic_chunks WHERE evidence_id=$1",
    [row.id],
  );
  if (Number(total.total) + bytes.length > DIAGNOSTIC_MAX_BYTES)
    fail("LIMIT_REACHED", "Diagnostic evidence exceeds 256 MiB", 413);
  return { row, prior: false };
}

export async function putDiagnosticChunk(
  db: Database,
  store: AssetStore,
  config: Config,
  actor: Actor,
  input: any,
  current: (db: Database, actor: Actor, name: string) => Promise<Actor>,
) {
  const bytes = decodedChunk(input);
  const prior = await db.transaction(async (tx) => {
    const a = await current(tx, actor, "diagnostics.putChunk");
    return preflightChunk(tx, a, input, bytes);
  });
  if (prior.prior) return { sha256: input.sha256, byteLength: bytes.length };
  const key = chunkKey(config, prior.row, input);
  await db.query("INSERT INTO diagnostic_cleanup_objects(object_key) VALUES($1)", [key]);
  try {
    await store.put(key, bytes, "application/octet-stream");
  } catch {
    try {
      await store.remove(key);
      await db.query("DELETE FROM diagnostic_cleanup_objects WHERE object_key=$1", [key]);
    } catch {
      // The maintenance drain retains the key and retries its removal.
    }
    fail(
      "UPLOAD_FAILED",
      "Private diagnostic storage is unavailable; retry this chunk",
      503,
    );
  }
  let cleanupAllowed = false;
  try {
    const committed = await db.transaction(async (tx) => {
      const a = await current(tx, actor, "diagnostics.putChunk");
      const checked = await preflightChunk(tx, a, input, bytes);
      if (checked.prior) return false;
      await tx.query(
        `INSERT INTO diagnostic_chunks(evidence_id,file_id,sequence,sha256,byte_size,object_key)
         VALUES($1,$2,$3,$4,$5,$6)`,
        [input.evidenceId, input.fileId, input.sequence, input.sha256, bytes.length, key],
      );
      return true;
    });
    // A concurrent identical upload may own this same deterministic object key.
    if (!committed) {
      await store.remove(key);
      await db.query("DELETE FROM diagnostic_cleanup_objects WHERE object_key=$1", [key]);
      return { sha256: input.sha256, byteLength: bytes.length };
    }
    await db.query("DELETE FROM diagnostic_cleanup_objects WHERE object_key=$1", [key]);
    return { sha256: input.sha256, byteLength: bytes.length };
  } catch (error) {
    if (error instanceof DomainError) cleanupAllowed = true;
    throw error;
  } finally {
    if (cleanupAllowed) {
      try {
        await store.remove(key);
        await db.query("DELETE FROM diagnostic_cleanup_objects WHERE object_key=$1", [
          key,
        ]);
      } catch {
        // The maintenance drain retains the key and retries its removal.
      }
    }
  }
}

function rowsMatchManifest(rows: any[], manifest: DiagnosticManifestV1): boolean {
  const expected = new Map(
    manifest.files.flatMap((file) =>
      file.chunks.map(
        (chunk) =>
          [
            `${file.fileId}:${chunk.sequence}`,
            `${chunk.sha256}:${chunk.byteLength}`,
          ] as const,
      ),
    ),
  );
  return (
    rows.length === expected.size &&
    rows.every(
      (row) =>
        expected.get(`${row.file_id}:${row.sequence}`) ===
        `${row.sha256}:${row.byte_size}`,
    )
  );
}

export async function finalizeDiagnosticEvidence(
  db: Database,
  store: AssetStore,
  actor: Actor,
  input: any,
  current: (db: Database, actor: Actor, name: string) => Promise<Actor>,
) {
  const manifest = input.manifest as DiagnosticManifestV1;
  if (manifest.id !== input.evidenceId)
    fail("VALIDATION", "Manifest identifies another upload");
  const preflight = await db.transaction(async (tx) => {
    const a = await current(tx, actor, "diagnostics.finalize");
    const { row, thread } = await diagnosticRow(tx, a, input.evidenceId, true);
    if (row.owner_id !== a.userId)
      fail("FORBIDDEN", "Diagnostic upload belongs to another account", 403);
    if (row.status === "complete") {
      if (
        row.finalize_key !== input.idempotencyKey ||
        !isDeepStrictEqual(row.manifest, manifest)
      )
        fail("CONFLICT", "Diagnostic evidence is already finalized", 409);
      return {
        prior: { evidence: summary(row), thread: await fullThread(tx, a, thread) },
      };
    }
    if (row.status !== "pending" || new Date(row.expires_at).getTime() <= Date.now())
      fail("CONFLICT", "Diagnostic upload expired", 409);
    if (
      row.source_origin !== manifest.sourceOrigin ||
      new Date(row.started_at).toISOString() !== manifest.startedAt
    )
      fail("VALIDATION", "Manifest source differs from upload");
    const chunks = await tx.query(
      "SELECT * FROM diagnostic_chunks WHERE evidence_id=$1 ORDER BY file_id,sequence",
      [row.id],
    );
    if (!rowsMatchManifest(chunks, manifest))
      fail("VALIDATION", "Manifest does not match uploaded chunks");
    return { prior: null, chunks };
  });
  if (preflight.prior) return preflight.prior;
  const byFile = new Map<string, any[]>();
  for (const chunk of preflight.chunks!) {
    const values = byFile.get(chunk.file_id) ?? [];
    values.push(chunk);
    byFile.set(chunk.file_id, values);
  }
  for (const file of manifest.files) {
    const digest = createHash("sha256");
    for (const chunk of byFile.get(file.fileId) ?? []) {
      let bytes: Buffer;
      try {
        bytes = await store.get(chunk.object_key);
      } catch {
        fail("EVIDENCE_UNAVAILABLE", "Private diagnostic chunk is unavailable", 503);
      }
      if (
        bytes.length !== chunk.byte_size ||
        createHash("sha256").update(bytes).digest("hex") !== chunk.sha256
      )
        fail(
          "EVIDENCE_UNAVAILABLE",
          "Private diagnostic chunk failed integrity check",
          503,
        );
      digest.update(bytes);
    }
    if (digest.digest("hex") !== file.sha256)
      fail("VALIDATION", "Diagnostic file checksum differs from stored bytes");
  }
  return db.transaction(async (tx) => {
    const a = await current(tx, actor, "diagnostics.finalize");
    const { row, thread } = await diagnosticRow(tx, a, input.evidenceId, true);
    if (row.owner_id !== a.userId)
      fail("FORBIDDEN", "Diagnostic upload belongs to another account", 403);
    if (row.status !== "pending" || new Date(row.expires_at).getTime() <= Date.now())
      fail("CONFLICT", "Diagnostic evidence was finalized or expired", 409);
    const chunks = await tx.query(
      "SELECT * FROM diagnostic_chunks WHERE evidence_id=$1",
      [row.id],
    );
    if (!rowsMatchManifest(chunks, manifest))
      fail("CONFLICT", "Diagnostic upload changed during finalization", 409);
    const publicSummary = {
      totalBytes: manifest.totalBytes,
      fileCount: manifest.files.length,
      coverage: Object.fromEntries(
        Object.entries(manifest.coverage).map(([kind, value]) => [kind, value.status]),
      ),
    };
    const completed = await tx.one(
      `UPDATE diagnostic_evidence SET status='complete',summary=$2,manifest=$3,finalize_key=$4
       WHERE id=$1 RETURNING *`,
      [
        row.id,
        JSON.stringify(publicSummary),
        JSON.stringify(manifest),
        input.idempotencyKey,
      ],
    );
    const saved = await saveThread(tx, a, thread, "thread.diagnostics");
    return { evidence: summary(completed), thread: await fullThread(tx, a, saved) };
  });
}

// Mark before object removal so a crash leaves a retryable cleanup receipt.
export async function drainExpiredDiagnosticEvidence(db: Database, store: AssetStore) {
  await db.transaction(async (tx) => {
    const expired = await tx.query(
      `SELECT id FROM diagnostic_evidence WHERE status='pending' AND expires_at<=now()
       ORDER BY expires_at,id LIMIT 20 FOR UPDATE SKIP LOCKED`,
    );
    for (const item of expired)
      await tx.query("UPDATE diagnostic_evidence SET status='expired' WHERE id=$1", [
        item.id,
      ]);
  });
  const chunks = await db.query(
    `SELECT c.evidence_id,c.file_id,c.sequence,c.object_key FROM diagnostic_chunks c
     JOIN diagnostic_evidence e ON e.id=c.evidence_id WHERE e.status='expired'
     ORDER BY e.expires_at,c.evidence_id,c.file_id,c.sequence LIMIT 20`,
  );
  for (const chunk of chunks) {
    try {
      await store.remove(chunk.object_key);
      await db.query(
        "DELETE FROM diagnostic_chunks WHERE evidence_id=$1 AND file_id=$2 AND sequence=$3 AND object_key=$4",
        [chunk.evidence_id, chunk.file_id, chunk.sequence, chunk.object_key],
      );
    } catch {
      // Keep the row so the bounded maintenance loop retries object removal.
    }
  }
  const abandoned = await db.query(
    "SELECT object_key FROM diagnostic_cleanup_objects WHERE created_at<now()-interval '10 minutes' ORDER BY created_at,object_key LIMIT 20",
  );
  for (const item of abandoned) {
    const committed = await db.one(
      "SELECT 1 FROM diagnostic_chunks WHERE object_key=$1",
      [item.object_key],
    );
    if (committed) {
      await db.query("DELETE FROM diagnostic_cleanup_objects WHERE object_key=$1", [
        item.object_key,
      ]);
      continue;
    }
    try {
      await store.remove(item.object_key);
      await db.query("DELETE FROM diagnostic_cleanup_objects WHERE object_key=$1", [
        item.object_key,
      ]);
    } catch {
      // Retain for the next bounded drain.
    }
  }
}
