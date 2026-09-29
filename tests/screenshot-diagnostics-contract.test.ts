import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  DIAGNOSTIC_CHUNK_BYTES,
  DIAGNOSTIC_MAX_BYTES,
  DIAGNOSTIC_READ_BYTES,
  diagnosticManifestSchema,
  diagnosticArchiveName,
  nextDiagnosticPage,
  splitDiagnosticBytes,
} from "../src/shared/screenshot-diagnostics.ts";

const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

test("a DOM above 5 MiB retains every byte when a multibyte character crosses a chunk", async () => {
  const bytes = new TextEncoder().encode(
    `${"a".repeat(DIAGNOSTIC_CHUNK_BYTES - 1)}é${"b".repeat(3 * 1024 * 1024)}`,
  );
  const parts = await splitDiagnosticBytes(bytes, randomUUID());
  assert.ok(bytes.byteLength > 5 * 1024 * 1024);
  assert.ok(parts.every((part) => part.byteLength <= 2_097_152));
  assert.deepEqual(
    parts.map((part) => part.sequence),
    [0, 1, 2],
  );
  assert.ok(parts.every((part) => part.sha256 === hash(part.data)));
  assert.deepEqual(
    Buffer.concat(parts.map((part) => Buffer.from(part.data))),
    Buffer.from(bytes),
  );
});

test("bounded text pages resume at complete UTF-8 code points", () => {
  const bytes = new TextEncoder().encode(`${"x".repeat(32_767)}éz`);
  const first = nextDiagnosticPage(bytes, 0, DIAGNOSTIC_READ_BYTES, true);
  assert.equal(first.nextOffset, 32_767);
  assert.equal(first.text, "x".repeat(32_767));
  const second = nextDiagnosticPage(bytes, first.nextOffset, DIAGNOSTIC_READ_BYTES, true);
  assert.equal(second.text, "éz");
  assert.equal(second.nextOffset, bytes.byteLength);
  assert.deepEqual(
    Buffer.concat([Buffer.from(first.data), Buffer.from(second.data)]),
    Buffer.from(bytes),
  );
});

test("invalid UTF-8 stays binary and callers cannot exceed the read ceiling", () => {
  const bytes = Uint8Array.of(0xff, 0xfe, 0x00);
  const page = nextDiagnosticPage(bytes, 0, DIAGNOSTIC_READ_BYTES * 2, true);
  assert.deepEqual(page.data, bytes);
  assert.equal(page.text, undefined);
  assert.throws(() => nextDiagnosticPage(bytes, 0, 0, false));
});

test("manifest rejects oversized evidence and client archive paths", () => {
  const id = randomUUID();
  const fileId = randomUUID();
  const manifest = {
    schemaVersion: 1,
    id,
    sourceOrigin: "https://example.test",
    startedAt: "2026-09-29T00:00:00.000Z",
    endedAt: "2026-09-29T00:01:00.000Z",
    coverage: {
      dom: { status: "complete", observedCount: 1, capturedBytes: 3, reasons: [] },
      console: {
        status: "unavailable",
        observedCount: 0,
        capturedBytes: 0,
        reasons: ["not-started"],
      },
      network: {
        status: "unavailable",
        observedCount: 0,
        capturedBytes: 0,
        reasons: ["not-started"],
      },
      body: {
        status: "unavailable",
        observedCount: 0,
        capturedBytes: 0,
        reasons: ["not-started"],
      },
      storage: {
        status: "unavailable",
        observedCount: 0,
        capturedBytes: 0,
        reasons: ["not-captured"],
      },
      environment: {
        status: "unavailable",
        observedCount: 0,
        capturedBytes: 0,
        reasons: ["not-captured"],
      },
      performance: {
        status: "unavailable",
        observedCount: 0,
        capturedBytes: 0,
        reasons: ["not-captured"],
      },
      coverage: {
        status: "unavailable",
        observedCount: 0,
        capturedBytes: 0,
        reasons: ["not-captured"],
      },
    },
    files: [
      {
        fileId,
        kind: "dom",
        mimeType: "text/html; charset=utf-8",
        byteLength: 3,
        sha256: hash(new TextEncoder().encode("abc")),
        chunks: [
          { sequence: 0, byteLength: 3, sha256: hash(new TextEncoder().encode("abc")) },
        ],
      },
    ],
    totalBytes: 3,
  };
  assert.equal(diagnosticManifestSchema.safeParse(manifest).success, true);
  assert.equal(
    diagnosticManifestSchema.safeParse({
      ...manifest,
      totalBytes: DIAGNOSTIC_MAX_BYTES + 1,
    }).success,
    false,
  );
  assert.equal(
    diagnosticManifestSchema.safeParse({ ...manifest, archiveName: "../escape" }).success,
    false,
  );
  assert.equal(
    diagnosticManifestSchema.safeParse({
      ...manifest,
      coverage: {
        ...manifest.coverage,
        console: {
          ...manifest.coverage.console,
          reasons: ["Authorization: Bearer fake-token"],
        },
      },
    }).success,
    false,
  );
  assert.equal(diagnosticArchiveName("dom", fileId), `dom/${fileId}.html`);
});
