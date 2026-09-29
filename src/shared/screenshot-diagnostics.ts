import { z } from "zod";

export const DIAGNOSTIC_CHUNK_BYTES = 2_097_152;
export const DIAGNOSTIC_MAX_BYTES = 268_435_456;
export const DIAGNOSTIC_READ_BYTES = 32_768;

export const diagnosticKinds = [
  "dom",
  "console",
  "network",
  "body",
  "storage",
  "environment",
  "performance",
  "coverage",
] as const;
export type DiagnosticChannel = (typeof diagnosticKinds)[number];

const uuid = z.uuid();
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const byteLength = z.number().int().nonnegative().max(DIAGNOSTIC_MAX_BYTES);
const coverageSchema = z
  .strictObject({
    status: z.enum(["complete", "partial", "unavailable", "stopped"]),
    observedCount: z.number().int().nonnegative(),
    capturedBytes: byteLength,
    reasons: z.array(z.string().min(1).max(240)).max(100),
  })
  .superRefine((coverage, ctx) => {
    if (coverage.status !== "complete" && coverage.reasons.length === 0)
      ctx.addIssue({
        code: "custom",
        path: ["reasons"],
        message: "Incomplete coverage needs a reason",
      });
  });

const chunkSchema = z.strictObject({
  sequence: z.number().int().nonnegative(),
  byteLength: z.number().int().positive().max(DIAGNOSTIC_CHUNK_BYTES),
  sha256,
});
const fileSchema = z
  .strictObject({
    fileId: uuid,
    kind: z.enum(diagnosticKinds),
    mimeType: z.string().min(1).max(200),
    byteLength,
    sha256,
    chunks: z.array(chunkSchema).max(131_072),
  })
  .superRefine((file, ctx) => {
    let sum = 0;
    for (let index = 0; index < file.chunks.length; index++) {
      const chunk = file.chunks[index];
      if (chunk.sequence !== index)
        ctx.addIssue({
          code: "custom",
          path: ["chunks", index, "sequence"],
          message: "Chunk sequence must be contiguous",
        });
      sum += chunk.byteLength;
    }
    if (sum !== file.byteLength)
      ctx.addIssue({
        code: "custom",
        path: ["byteLength"],
        message: "File length differs from chunks",
      });
  });

export const diagnosticManifestSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    id: uuid,
    sourceOrigin: z.url(),
    startedAt: z.iso.datetime({ offset: true }),
    endedAt: z.iso.datetime({ offset: true }),
    coverage: z.record(z.enum(diagnosticKinds), coverageSchema),
    files: z.array(fileSchema).max(16_384),
    totalBytes: byteLength,
  })
  .superRefine((manifest, ctx) => {
    const origin = new URL(manifest.sourceOrigin);
    if (
      !["https:", "http:"].includes(origin.protocol) ||
      origin.origin !== manifest.sourceOrigin
    )
      ctx.addIssue({
        code: "custom",
        path: ["sourceOrigin"],
        message: "Expected a web origin",
      });
    if (Date.parse(manifest.endedAt) < Date.parse(manifest.startedAt))
      ctx.addIssue({
        code: "custom",
        path: ["endedAt"],
        message: "Capture end precedes start",
      });
    const ids = new Set<string>();
    let sum = 0;
    for (const [index, file] of manifest.files.entries()) {
      if (ids.has(file.fileId))
        ctx.addIssue({
          code: "custom",
          path: ["files", index, "fileId"],
          message: "Duplicate file ID",
        });
      ids.add(file.fileId);
      sum += file.byteLength;
    }
    if (sum !== manifest.totalBytes)
      ctx.addIssue({
        code: "custom",
        path: ["totalBytes"],
        message: "Total length differs from files",
      });
  });

export type DiagnosticManifestV1 = z.infer<typeof diagnosticManifestSchema>;
export type DiagnosticFile = DiagnosticManifestV1["files"][number];
export type DiagnosticChunk = {
  sequence: number;
  data: Uint8Array;
  byteLength: number;
  sha256: string;
};

async function hashBytes(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function splitDiagnosticBytes(
  bytes: Uint8Array,
  _fileId: string,
): Promise<DiagnosticChunk[]> {
  if (bytes.byteLength > DIAGNOSTIC_MAX_BYTES)
    throw new RangeError("Diagnostic evidence exceeds 256 MiB");
  const result: DiagnosticChunk[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += DIAGNOSTIC_CHUNK_BYTES) {
    const data = bytes.slice(offset, offset + DIAGNOSTIC_CHUNK_BYTES);
    result.push({
      sequence: result.length,
      data,
      byteLength: data.byteLength,
      sha256: await hashBytes(data),
    });
  }
  return result;
}

export function nextDiagnosticPage(
  bytes: Uint8Array,
  offset: number,
  limit: number,
  text: boolean,
): {
  data: Uint8Array;
  nextOffset: number;
  text?: string;
} {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > bytes.byteLength)
    throw new RangeError("Invalid diagnostic page offset");
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new RangeError("Invalid diagnostic page size");
  const end = Math.min(bytes.byteLength, offset + Math.min(limit, DIAGNOSTIC_READ_BYTES));
  const raw = bytes.subarray(offset, end);
  if (text) {
    for (let trim = 0; trim <= 3 && trim < raw.byteLength; trim++) {
      const candidate = raw.subarray(0, raw.byteLength - trim);
      try {
        const decoded = new TextDecoder("utf-8", { fatal: true }).decode(candidate);
        return {
          data: candidate,
          nextOffset: offset + candidate.byteLength,
          text: decoded,
        };
      } catch {
        // A page may end inside one UTF-8 code point. Other invalid bytes stay binary.
      }
    }
  }
  return { data: raw, nextOffset: end };
}

export function diagnosticArchiveName(kind: DiagnosticChannel, fileId: string): string {
  if (!diagnosticKinds.includes(kind) || !uuid.safeParse(fileId).success)
    throw new TypeError("Invalid diagnostic file identifier");
  const suffix: Record<DiagnosticChannel, string> = {
    dom: ".html",
    console: ".jsonl",
    network: ".jsonl",
    body: ".bin",
    storage: ".json",
    environment: ".json",
    performance: ".jsonl",
    coverage: ".json",
  };
  return `${kind}/${fileId}${suffix[kind]}`;
}
