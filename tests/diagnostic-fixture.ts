import { createHash, randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { Database } from "../src/server/db.js";
import { migrate } from "../src/server/migrations.js";
import { Operations } from "../src/server/operations.js";
import {
  diagnosticKinds,
  splitDiagnosticBytes,
} from "../src/shared/screenshot-diagnostics.js";

export const hashDiagnostic = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

export async function diagnosticFixture(raw: Buffer, kind: "dom" | "body" = "dom") {
  const pg = new PGlite();
  const db = new Database(pg as any);
  await migrate(db);
  const objects = new Map<string, Buffer>();
  const store = {
    put: async (key: string, bytes: Buffer) => {
      objects.set(key, bytes);
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
  const config = {
    appOrigin: "http://localhost:3000",
    production: false,
    organizationId: "synthetic",
  } as any;
  const ops = new Operations(db, store as any, config);
  const owner = await ops.auth.bootstrap(
    "read-owner@example.test",
    "Owner",
    "Correct-Horse-Battery-123",
  );
  const project = await ops.executeOperation(owner, "projects.create", {
    name: "Evidence project",
    origins: ["https://example.test"],
  });
  const thread = await ops.executeOperation(owner, "threads.create", {
    projectId: project.id,
    body: "Synthetic diagnostic review",
    idempotencyKey: randomUUID(),
    context: { url: "https://example.test/page", viewport: { width: 1000, height: 800 } },
  });
  const evidenceId = randomUUID(),
    fileId = randomUUID(),
    startedAt = new Date().toISOString();
  await ops.executeOperation(owner, "diagnostics.begin", {
    threadId: thread.id,
    revision: thread.revision,
    evidenceId,
    idempotencyKey: randomUUID(),
    sourceUrl: "https://example.test/page",
    startedAt,
  });
  const chunks = await splitDiagnosticBytes(raw, fileId);
  const manifest = {
    schemaVersion: 1,
    id: evidenceId,
    sourceOrigin: "https://example.test",
    startedAt,
    endedAt: startedAt,
    coverage: Object.fromEntries(
      diagnosticKinds.map((channel) => [
        channel,
        channel === kind
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
        kind,
        mimeType:
          kind === "dom" ? "text/html; charset=utf-8" : "application/octet-stream",
        byteLength: raw.byteLength,
        sha256: hashDiagnostic(raw),
        chunks: chunks.map(({ sequence, byteLength, sha256 }) => ({
          sequence,
          byteLength,
          sha256,
        })),
      },
    ],
    totalBytes: raw.byteLength,
  };
  const upload = async () => {
    for (const chunk of chunks)
      await ops.executeOperation(owner, "diagnostics.putChunk", {
        evidenceId,
        fileId,
        sequence: chunk.sequence,
        sha256: chunk.sha256,
        contentBase64: Buffer.from(chunk.data).toString("base64"),
      });
    return ops.executeOperation(owner, "diagnostics.finalize", {
      evidenceId,
      manifest,
      idempotencyKey: randomUUID(),
    });
  };
  return {
    pg,
    db,
    ops,
    store,
    objects,
    config,
    owner,
    project,
    thread,
    evidenceId,
    fileId,
    startedAt,
    chunks,
    manifest,
    upload,
    close: () => pg.close(),
  };
}
