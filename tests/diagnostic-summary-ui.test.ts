import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { summarizeLocalDiagnostics } from "../extension/diagnostics/summary.js";
import {
  diagnosticKinds,
  diagnosticManifestSchema,
} from "../src/shared/screenshot-diagnostics.js";

test("manifest accepts optional counters and rejects invalid observed totals", () => {
  const manifest = {
    schemaVersion: 1,
    id: randomUUID(),
    sourceOrigin: "https://example.test",
    startedAt: "2026-09-29T08:00:00.000Z",
    endedAt: "2026-09-29T08:01:00.000Z",
    coverage: Object.fromEntries(
      diagnosticKinds.map((kind) => [
        kind,
        {
          status: "unavailable",
          observedCount: 0,
          capturedBytes: 0,
          reasons: ["not_collected"],
        },
      ]),
    ),
    files: [],
    totalBytes: 0,
  };
  const stats = {
    consoleCount: 4,
    errorCount: 2,
    httpRequestCount: 7,
    responseCount: 6,
    responseBodyCount: 5,
  };
  assert.equal(diagnosticManifestSchema.safeParse(manifest).success, true);
  assert.equal(diagnosticManifestSchema.safeParse({ ...manifest, stats }).success, true);
  assert.equal(
    diagnosticManifestSchema.safeParse({
      ...manifest,
      stats: { ...stats, httpRequestCount: -1 },
    }).success,
    false,
  );
});

test("local review uses explicit counters and DOM file bytes, not CDP event totals", () => {
  const summary = summarizeLocalDiagnostics({
    startedAt: "2026-09-29T08:00:00.000Z",
    endedAt: "2026-09-29T08:01:00.000Z",
    coverage: {
      network: { observedCount: 38 },
      console: { observedCount: 25 },
      body: { observedCount: 8 },
    },
    files: [
      { kind: "dom", mimeType: "text/html; charset=utf-8", byteLength: 5_242_880 },
      { kind: "network", byteLength: 50_000 },
      { kind: "dom", mimeType: "application/jsonl", byteLength: 120 },
      { kind: "dom", mimeType: "text/html", byteLength: 100 },
    ],
    stats: {
      consoleCount: 4,
      errorCount: 2,
      httpRequestCount: 7,
      responseCount: 6,
      responseBodyCount: 5,
    },
  });
  assert.deepEqual(summary, {
    startedAt: "2026-09-29T08:00:00.000Z",
    endedAt: "2026-09-29T08:01:00.000Z",
    domBytes: 5_242_980,
    consoleCount: 4,
    errorCount: 2,
    httpRequestCount: 7,
    responseCount: 6,
    responseBodyCount: 5,
  });
});

test("older local evidence reports unknown counts rather than relabeling event totals", () => {
  const summary = summarizeLocalDiagnostics({
    startedAt: "2026-09-29T08:00:00.000Z",
    endedAt: "2026-09-29T08:01:00.000Z",
    coverage: { network: { observedCount: 38 } },
    files: [{ kind: "dom", mimeType: "text/html", byteLength: 100 }],
  });
  assert.equal(summary.httpRequestCount, null);
  assert.equal(summary.consoleCount, null);
  assert.equal(summary.responseBodyCount, null);
  assert.equal(summary.domBytes, 100);
});
