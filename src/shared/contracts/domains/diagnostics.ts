import { z } from "zod";
import {
  diagnosticManifestSchema,
  DIAGNOSTIC_CHUNK_BYTES,
} from "../../screenshot-diagnostics.js";
import { id, revision } from "../common.js";
import { threadOutput } from "../output-common.js";

const evidenceSummary = z.object({
  id,
  threadId: id,
  projectId: id,
  status: z.enum(["pending", "complete", "expired"]),
  startedAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  totalBytes: z.number().int().nonnegative(),
  fileCount: z.number().int().nonnegative(),
  coverage: z.record(
    z.string(),
    z.enum(["complete", "partial", "unavailable", "stopped"]),
  ),
});

export const diagnosticsInputs = {
  "diagnostics.begin": z.object({
    threadId: id,
    revision,
    evidenceId: id,
    idempotencyKey: z.string().min(8).max(200),
    sourceUrl: z.url().max(4096),
    startedAt: z.iso.datetime({ offset: true }),
  }),
  "diagnostics.putChunk": z.object({
    evidenceId: id,
    fileId: id,
    sequence: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    contentBase64: z
      .string()
      .min(4)
      .max(Math.ceil(DIAGNOSTIC_CHUNK_BYTES / 3) * 4),
  }),
  "diagnostics.finalize": z.object({
    evidenceId: id,
    manifest: diagnosticManifestSchema,
    idempotencyKey: z.string().min(8).max(200),
  }),
};

export const diagnosticsOutputs = {
  "diagnostics.begin": z.object({ evidence: evidenceSummary }),
  "diagnostics.putChunk": z.object({ sha256: z.string(), byteLength: z.number().int() }),
  "diagnostics.finalize": z.object({ evidence: evidenceSummary, thread: threadOutput }),
};
