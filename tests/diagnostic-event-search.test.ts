import assert from "node:assert/strict";
import { test } from "node:test";
import { createDiagnosticEventIndexer } from "../src/server/diagnostics/event-index.js";
import { diagnosticFixture } from "./diagnostic-fixture.js";

const event = (method: string, ingressAt: number, requestId: string, payload = "") =>
  `${JSON.stringify({ method, ingressAt, params: { requestId, payload } })}\n`;

test("event index records an exact locator across chunk boundaries and marks row caps", () => {
  const first = event("Network.requestWillBeSent", 1000, "r1");
  const second = event("Network.responseReceived", 1001, "r1");
  const third = event("Network.loadingFinished", 1002, "r1");
  const bytes = Buffer.from(first + second + third);
  const split = Buffer.byteLength(first) + 7;
  const indexer = createDiagnosticEventIndexer("file-1", {
    maxRows: 2,
    maxLineBytes: 1024,
  });
  indexer.push(0, bytes.subarray(0, split));
  indexer.push(1, bytes.subarray(split));
  const result = indexer.finish();
  assert.equal(result.status, "partial");
  assert.deepEqual(result.reasons, ["index_row_limit"]);
  assert.deepEqual(
    result.rows.map(({ method, sequence, byteOffset, byteLength }) => ({
      method,
      sequence,
      byteOffset,
      byteLength,
    })),
    [
      {
        method: "Network.requestWillBeSent",
        sequence: 0,
        byteOffset: 0,
        byteLength: Buffer.byteLength(first),
      },
      {
        method: "Network.responseReceived",
        sequence: 0,
        byteOffset: Buffer.byteLength(first),
        byteLength: Buffer.byteLength(second),
      },
    ],
  );
});

test("oversized and malformed event lines are skipped with explicit partial coverage", () => {
  const indexer = createDiagnosticEventIndexer("file-1", {
    maxRows: 10,
    maxLineBytes: 128,
  });
  indexer.push(
    0,
    Buffer.from(
      event("Network.requestWillBeSent", 1000, "large", "x".repeat(200)) +
        "{bad json}\n" +
        event("Network.loadingFinished", 1002, "good"),
    ),
  );
  const result = indexer.finish();
  assert.equal(result.status, "partial");
  assert.deepEqual(result.reasons, ["event_too_large", "invalid_event"]);
  assert.deepEqual(
    result.rows.map((row) => row.requestId),
    ["good"],
  );
});

test("a scan cap stops parsing hostile streams with millions of tiny events", () => {
  const indexer = createDiagnosticEventIndexer("file-1", {
    maxRows: 10,
    maxEvents: 2,
  });
  indexer.push(
    0,
    Buffer.from(
      event("Network.requestWillBeSent", 1, "r1") +
        event("Network.responseReceived", 2, "r2") +
        event("Network.loadingFinished", 3, "r3"),
    ),
  );
  const result = indexer.finish();
  assert.equal(result.scannedCount, 2);
  assert.deepEqual(
    result.rows.map((row) => row.requestId),
    ["r1", "r2"],
  );
  assert.deepEqual(result.reasons, ["event_scan_limit"]);
});

test("agents can select a late network request by ID and time without paging through 5 MiB", async () => {
  const noise = event("Network.dataReceived", 1000, "noise", "x".repeat(180_000));
  const selected = [
    event("Network.requestWillBeSent", 2000, "target"),
    event("Network.responseReceived", 2000, "target"),
    event("Network.loadingFinished", 2001, "target"),
  ];
  const raw = Buffer.from(noise.repeat(30) + selected.join(""));
  assert.ok(raw.byteLength > 5 * 1024 * 1024);
  const f = await diagnosticFixture(raw);
  f.manifest.files[0].kind = "network";
  f.manifest.files[0].mimeType = "application/jsonl";
  try {
    await f.upload();
    const first = await f.ops.executeOperation(f.owner, "diagnostics.search", {
      evidenceId: f.evidenceId,
      requestId: "target",
      fromMs: 2000,
      toMs: 2001,
      limit: 2,
    });
    assert.equal(first.index.status, "complete");
    assert.equal(first.index.indexedCount, 33);
    assert.deepEqual(
      first.items.map((item: any) => item.method),
      ["Network.requestWillBeSent", "Network.responseReceived"],
    );
    assert.ok(first.next);
    const second = await f.ops.executeOperation(f.owner, "diagnostics.search", {
      evidenceId: f.evidenceId,
      requestId: "target",
      fromMs: 2000,
      toMs: 2001,
      limit: 2,
      cursor: first.next,
    });
    assert.deepEqual(
      second.items.map((item: any) => item.method),
      ["Network.loadingFinished"],
    );
    assert.equal(second.next, null);
    const locator = first.items[0];
    const page = await f.ops.executeOperation(f.owner, "diagnostics.read", {
      evidenceId: f.evidenceId,
      fileId: locator.fileId,
      sequence: locator.sequence,
      byteOffset: locator.byteOffset,
      limitBytes: 32_768,
    });
    assert.ok(page.text.startsWith(selected[0]));
    f.objects.clear();
    const metadataOnly = await f.ops.executeOperation(f.owner, "diagnostics.search", {
      evidenceId: f.evidenceId,
      fromMs: 2000,
      toMs: 2000,
    });
    assert.equal(metadataOnly.items.length, 2);
    assert.equal(metadataOnly.items[0].requestId, "target");
  } finally {
    await f.close();
  }
});

test("search enforces diagnostic scope and reports evidence without an index", async () => {
  const f = await diagnosticFixture(
    Buffer.from(event("Network.loadingFinished", 3000, "r1")),
  );
  f.manifest.files[0].kind = "network";
  f.manifest.files[0].mimeType = "application/jsonl";
  try {
    await f.upload();
    const noScope = await f.ops.auth.issueToken(f.db, f.owner, {
      name: "No diagnostic search",
      projectIds: [f.project.id],
      scopes: ["threads.get"],
      expiresInDays: 30,
    });
    await assert.rejects(
      f.ops.executeOperation(
        await f.ops.auth.authenticate(noScope.token),
        "diagnostics.search",
        { evidenceId: f.evidenceId, requestId: "r1" },
      ),
      { code: "FORBIDDEN" },
    );
    const searchOnly = await f.ops.auth.issueToken(f.db, f.owner, {
      name: "Search without raw read",
      projectIds: [f.project.id],
      scopes: ["diagnostics.search"],
      expiresInDays: 30,
    });
    await assert.rejects(
      f.ops.executeOperation(
        await f.ops.auth.authenticate(searchOnly.token),
        "diagnostics.search",
        { evidenceId: f.evidenceId, requestId: "r1" },
      ),
      { code: "FORBIDDEN" },
    );
    await f.db.query("DELETE FROM diagnostic_event_index_state WHERE evidence_id=$1", [
      f.evidenceId,
    ]);
    const old = await f.ops.executeOperation(f.owner, "diagnostics.search", {
      evidenceId: f.evidenceId,
      requestId: "r1",
    });
    assert.deepEqual(old.index, {
      status: "unavailable",
      indexedCount: 0,
      reasons: ["index_unavailable"],
    });
    assert.deepEqual(old.items, []);
  } finally {
    await f.close();
  }
});
