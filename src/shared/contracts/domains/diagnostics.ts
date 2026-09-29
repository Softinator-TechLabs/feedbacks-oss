import { z } from "zod";
import {
  diagnosticManifestSchema,
  DIAGNOSTIC_CHUNK_BYTES,
} from "../../screenshot-diagnostics.js";
import { id, revision } from "../common.js";
import { diagnosticEvidenceSummaryOutput, threadOutput } from "../output-common.js";

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
  "diagnostics.list": z.object({
    threadId: id,
    offset: z.number().int().min(0).max(100_000).default(0),
    limit: z.number().int().min(1).max(100).default(20),
  }),
  "diagnostics.describe": z.object({
    evidenceId: id,
    offset: z.number().int().min(0).max(100_000).default(0),
    limit: z.number().int().min(1).max(100).default(20),
  }),
  "diagnostics.read": z.object({
    evidenceId: id,
    fileId: id,
    sequence: z.number().int().nonnegative(),
    byteOffset: z.number().int().nonnegative(),
    limitBytes: z.number().int().min(1).max(32_768).default(32_768),
  }),
  "diagnostics.search": z
    .object({
      evidenceId: id,
      requestId: z.string().min(1).max(512).optional(),
      fromMs: z.number().int().nonnegative().safe().optional(),
      toMs: z.number().int().nonnegative().safe().optional(),
      cursor: z
        .object({
          ingressAt: z.number().int().nonnegative().safe(),
          ordinal: z.number().int().nonnegative().max(49_999),
        })
        .optional(),
      limit: z.number().int().min(1).max(50).default(20),
    })
    .superRefine((value, ctx) => {
      if (
        value.requestId === undefined &&
        value.fromMs === undefined &&
        value.toMs === undefined
      )
        ctx.addIssue({ code: "custom", message: "Select a request ID or time range" });
      if (
        value.fromMs !== undefined &&
        value.toMs !== undefined &&
        value.fromMs > value.toMs
      )
        ctx.addIssue({ code: "custom", message: "Time range is reversed" });
    }),
};

export const diagnosticsOutputs = {
  "diagnostics.begin": z.object({ evidence: diagnosticEvidenceSummaryOutput }),
  "diagnostics.putChunk": z.object({ sha256: z.string(), byteLength: z.number().int() }),
  "diagnostics.finalize": z.object({
    evidence: diagnosticEvidenceSummaryOutput,
    thread: threadOutput,
  }),
  "diagnostics.list": z.object({
    items: z.array(diagnosticEvidenceSummaryOutput),
    total: z.number().int().nonnegative(),
    nextOffset: z.number().int().nonnegative().nullable(),
  }),
  "diagnostics.describe": z.object({
    evidence: diagnosticEvidenceSummaryOutput,
    coverage: diagnosticManifestSchema.shape.coverage.optional(),
    files: z.array(diagnosticManifestSchema.shape.files.element),
    total: z.number().int().nonnegative(),
    nextOffset: z.number().int().nonnegative().nullable(),
  }),
  "diagnostics.read": z.object({
    byteLength: z.number().int().min(0).max(32_768),
    encoding: z.enum(["utf8", "base64"]),
    text: z.string().optional(),
    dataBase64: z.string().optional(),
    next: z
      .object({
        sequence: z.number().int().nonnegative(),
        byteOffset: z.number().int().nonnegative(),
      })
      .nullable(),
  }),
  "diagnostics.search": z.object({
    index: z.object({
      status: z.enum(["complete", "partial", "unavailable"]),
      indexedCount: z.number().int().nonnegative().max(50_000),
      reasons: z.array(z.string()),
    }),
    items: z
      .array(
        z.object({
          fileId: id,
          sequence: z.number().int().nonnegative(),
          byteOffset: z.number().int().nonnegative(),
          byteLength: z.number().int().positive(),
          ingressAt: z.number().int().nonnegative().safe(),
          requestId: z.string().nullable(),
          method: z.string(),
        }),
      )
      .max(50),
    next: z
      .object({
        ingressAt: z.number().int().nonnegative().safe(),
        ordinal: z.number().int().nonnegative().max(49_999),
      })
      .nullable(),
  }),
};
