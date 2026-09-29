import { createHash } from "node:crypto";
import type { Actor } from "../../shared/contracts.js";
import type { DiagnosticManifestV1 } from "../../shared/screenshot-diagnostics.js";
import { nextDiagnosticPage } from "../../shared/screenshot-diagnostics.js";
import type { AssetStore } from "../assets.js";
import type { Database } from "../db.js";
import { fail } from "../errors.js";
import { threadRow } from "../feedback.js";
import { diagnosticRow, rowsMatchManifest } from "./evidence.js";
import { diagnosticSummary as summary } from "./summary.js";

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
