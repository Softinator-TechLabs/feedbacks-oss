import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { Actor } from "../shared/contracts.js";
import type { DiagnosticManifestV1 } from "../shared/screenshot-diagnostics.js";
import {
  DIAGNOSTIC_CHUNK_BYTES,
  DIAGNOSTIC_MAX_BYTES,
  nextDiagnosticPage,
} from "../shared/screenshot-diagnostics.js";
import type { AssetStore } from "./assets.js";
import type { Config } from "./config.js";
import type { Database } from "./db.js";
import { DomainError, fail } from "./errors.js";
import { checkRevision, fullThread, saveThread, threadRow } from "./feedback.js";
import { diagnosticSummary as summary } from "./diagnostic-summary.js";
import {
  createDiagnosticEventIndexer,
  DIAGNOSTIC_EVENT_INDEX_ROWS,
  DIAGNOSTIC_EVENT_SCAN_LINES,
  type DiagnosticEventLocator,
} from "./diagnostic-event-index.js";

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
  const indexRows: DiagnosticEventLocator[] = [];
  const indexReasons = new Set<string>();
  let scannedEvents = 0;
  for (const file of manifest.files) {
    const digest = createHash("sha256");
    const indexer = ["console", "network", "performance"].includes(file.kind)
      ? createDiagnosticEventIndexer(file.fileId, {
          maxRows: DIAGNOSTIC_EVENT_INDEX_ROWS - indexRows.length,
          maxEvents: DIAGNOSTIC_EVENT_SCAN_LINES - scannedEvents,
        })
      : null;
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
      indexer?.push(chunk.sequence, bytes);
    }
    if (digest.digest("hex") !== file.sha256)
      fail("VALIDATION", "Diagnostic file checksum differs from stored bytes");
    if (indexer) {
      const indexed = indexer.finish();
      indexRows.push(...indexed.rows);
      scannedEvents += indexed.scannedCount;
      for (const reason of indexed.reasons) indexReasons.add(reason);
    }
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
    for (let offset = 0; offset < indexRows.length; offset += 250) {
      const batch = indexRows.slice(offset, offset + 250);
      const values: unknown[] = [];
      const slots = batch.map((event, index) => {
        const start = values.length;
        values.push(
          row.id,
          offset + index,
          event.fileId,
          event.sequence,
          event.byteOffset,
          event.byteLength,
          event.ingressAt,
          event.requestId,
          event.method,
        );
        return `(${Array.from({ length: 9 }, (_, column) => `$${start + column + 1}`).join(",")})`;
      });
      await tx.query(
        `INSERT INTO diagnostic_event_index(evidence_id,ordinal,file_id,sequence,byte_offset,byte_length,ingress_at,request_id,method) VALUES ${slots.join(",")}`,
        values,
      );
    }
    await tx.query(
      "INSERT INTO diagnostic_event_index_state(evidence_id,status,indexed_count,reasons) VALUES($1,$2,$3,$4)",
      [
        row.id,
        indexReasons.size ? "partial" : "complete",
        indexRows.length,
        [...indexReasons],
      ],
    );
    const publicSummary = {
      totalBytes: manifest.totalBytes,
      fileCount: manifest.files.length,
      endedAt: manifest.endedAt,
      domBytes: manifest.files
        .filter(
          (file) =>
            file.kind === "dom" &&
            file.mimeType.split(";")[0].trim().toLowerCase() === "text/html",
        )
        .reduce((sum, file) => sum + file.byteLength, 0),
      ...(manifest.stats ? { stats: manifest.stats } : {}),
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

export async function listDiagnosticEvidence(db: Database, actor: Actor, input: any) {
  await threadRow(db, actor, input.threadId);
  const count = Number(
    (
      await db.one(
        "SELECT count(*)::integer AS total FROM diagnostic_evidence WHERE thread_id=$1",
        [input.threadId],
      )
    ).total,
  );
  const rows = await db.query(
    `SELECT id,project_id,thread_id,status,summary,started_at,created_at
     FROM diagnostic_evidence WHERE thread_id=$1 ORDER BY created_at DESC,id DESC LIMIT $2 OFFSET $3`,
    [input.threadId, input.limit, input.offset],
  );
  return {
    items: rows.map(summary),
    total: count,
    nextOffset: input.offset + rows.length < count ? input.offset + rows.length : null,
  };
}

export async function describeDiagnosticEvidence(db: Database, actor: Actor, input: any) {
  const { row } = await diagnosticRow(db, actor, input.evidenceId);
  const manifest =
    row.status === "complete" ? (row.manifest as DiagnosticManifestV1) : null;
  const files = manifest?.files ?? [];
  return {
    evidence: summary(row),
    ...(manifest ? { coverage: manifest.coverage } : {}),
    files: files.slice(input.offset, input.offset + input.limit),
    total: files.length,
    nextOffset:
      input.offset + input.limit < files.length ? input.offset + input.limit : null,
  };
}

export async function prepareDiagnosticFile(
  db: Database,
  actor: Actor,
  evidenceId: string,
  fileId: string,
  sequence: number,
) {
  const { row } = await diagnosticRow(db, actor, evidenceId);
  if (row.status !== "complete")
    fail("CONFLICT", "Diagnostic evidence is not complete", 409);
  const manifest = row.manifest as DiagnosticManifestV1;
  const file = manifest.files.find((value) => value.fileId === fileId);
  if (!file) fail("NOT_FOUND", "Diagnostic file not found", 404);
  const part = file.chunks[sequence];
  if (!part || part.sequence !== sequence)
    fail("NOT_FOUND", "Diagnostic chunk not found", 404);
  const chunk = await db.one(
    "SELECT object_key,sha256,byte_size FROM diagnostic_chunks WHERE evidence_id=$1 AND file_id=$2 AND sequence=$3",
    [evidenceId, fileId, sequence],
  );
  if (!chunk || chunk.sha256 !== part.sha256 || chunk.byte_size !== part.byteLength)
    fail("EVIDENCE_UNAVAILABLE", "Diagnostic chunk metadata is unavailable", 503);
  return { file, part, chunk };
}

export async function checkedDiagnosticBytes(
  store: AssetStore,
  chunk: any,
): Promise<Buffer> {
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
    fail("EVIDENCE_UNAVAILABLE", "Private diagnostic chunk failed integrity check", 503);
  return bytes;
}

export async function readDiagnosticPage(
  db: Database,
  store: AssetStore,
  actor: Actor,
  input: any,
  current: (db: Database, actor: Actor, name: string) => Promise<Actor>,
) {
  const prepared = await db.transaction(async (tx) => {
    const a = await current(tx, actor, "diagnostics.read");
    return prepareDiagnosticFile(tx, a, input.evidenceId, input.fileId, input.sequence);
  });
  const bytes = await checkedDiagnosticBytes(store, prepared.chunk);
  if (input.byteOffset > bytes.length)
    fail("VALIDATION", "Diagnostic byte offset exceeds chunk length");
  const page = nextDiagnosticPage(
    bytes,
    input.byteOffset,
    input.limitBytes,
    /^(text\/|application\/(?:json|xml|javascript|.*\+json))/.test(
      prepared.file.mimeType,
    ),
  );
  const next =
    page.nextOffset < bytes.length
      ? { sequence: input.sequence, byteOffset: page.nextOffset }
      : input.sequence + 1 < prepared.file.chunks.length
        ? { sequence: input.sequence + 1, byteOffset: 0 }
        : null;
  return {
    byteLength: page.data.byteLength,
    encoding: page.text === undefined ? ("base64" as const) : ("utf8" as const),
    ...(page.text === undefined
      ? { dataBase64: Buffer.from(page.data).toString("base64") }
      : { text: page.text }),
    next,
  };
}

export async function searchDiagnosticEvents(db: Database, actor: Actor, input: any) {
  const { row } = await diagnosticRow(db, actor, input.evidenceId);
  if (row.status !== "complete")
    fail("CONFLICT", "Diagnostic evidence is not complete", 409);
  const state = await db.one(
    "SELECT status,indexed_count,reasons FROM diagnostic_event_index_state WHERE evidence_id=$1",
    [row.id],
  );
  if (!state)
    return {
      index: { status: "unavailable", indexedCount: 0, reasons: ["index_unavailable"] },
      items: [],
      next: null,
    };
  const values: unknown[] = [row.id];
  const bind = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };
  const where = ["evidence_id=$1"];
  if (input.requestId !== undefined) where.push(`request_id=${bind(input.requestId)}`);
  if (input.fromMs !== undefined) where.push(`ingress_at>=${bind(input.fromMs)}`);
  if (input.toMs !== undefined) where.push(`ingress_at<=${bind(input.toMs)}`);
  if (input.cursor)
    where.push(
      `(ingress_at,ordinal)>(${bind(input.cursor.ingressAt)},${bind(input.cursor.ordinal)})`,
    );
  const rows = await db.query(
    `SELECT ordinal,file_id,sequence,byte_offset,byte_length,ingress_at,request_id,method
     FROM diagnostic_event_index WHERE ${where.join(" AND ")}
     ORDER BY ingress_at,ordinal LIMIT ${bind(input.limit + 1)}`,
    values,
  );
  const selected = rows.slice(0, input.limit);
  const last = selected.at(-1);
  return {
    index: {
      status: state.status,
      indexedCount: state.indexed_count,
      reasons: state.reasons,
    },
    items: selected.map((event) => ({
      fileId: event.file_id,
      sequence: event.sequence,
      byteOffset: event.byte_offset,
      byteLength: event.byte_length,
      ingressAt: Number(event.ingress_at),
      requestId: event.request_id,
      method: event.method,
    })),
    next:
      rows.length > input.limit && last
        ? { ingressAt: Number(last.ingress_at), ordinal: last.ordinal }
        : null,
  };
}

export async function prepareDiagnosticArchive(
  db: Database,
  actor: Actor,
  evidenceId: string,
) {
  const { row } = await diagnosticRow(db, actor, evidenceId);
  if (row.status !== "complete")
    fail("CONFLICT", "Diagnostic evidence is not complete", 409);
  const manifest = row.manifest as DiagnosticManifestV1;
  const chunks = await db.query(
    "SELECT file_id,sequence,sha256,byte_size,object_key FROM diagnostic_chunks WHERE evidence_id=$1 ORDER BY file_id,sequence",
    [evidenceId],
  );
  if (!rowsMatchManifest(chunks, manifest))
    fail("EVIDENCE_UNAVAILABLE", "Diagnostic archive metadata is incomplete", 503);
  return { manifest, chunks };
}
