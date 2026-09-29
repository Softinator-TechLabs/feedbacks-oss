import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { diagnosticFixture, hashDiagnostic } from "./diagnostic-fixture.js";

test("ordinary thread reads stay small while 5 MiB DOM pages reassemble exactly", async () => {
  const raw = Buffer.from(`${"a".repeat(2_097_151)}é${"b".repeat(3 * 1024 * 1024)}`);
  const f = await diagnosticFixture(raw);
  try {
    const pending = await f.ops.executeOperation(f.owner, "threads.get", {
      threadId: f.thread.id,
    });
    assert.equal(pending.diagnosticEvidence.count, 1);
    assert.equal(pending.diagnosticEvidence.latest[0].status, "pending");
    assert.ok(Buffer.byteLength(JSON.stringify(pending)) < 100_000);
    await assert.rejects(
      f.ops.executeOperation(f.owner, "diagnostics.read", {
        evidenceId: f.evidenceId,
        fileId: f.fileId,
        sequence: 0,
        byteOffset: 0,
        limitBytes: 32768,
      }),
      { code: "CONFLICT" },
    );
    await f.upload();
    const overview = await f.ops.executeOperation(f.owner, "threads.get", {
      threadId: f.thread.id,
    });
    assert.equal(overview.diagnosticEvidence.count, 1);
    assert.equal(overview.diagnosticEvidence.latest[0].totalBytes, raw.byteLength);
    assert.ok(!JSON.stringify(overview).includes("a".repeat(1000)));
    const listed = await f.ops.executeOperation(f.owner, "diagnostics.list", {
      threadId: f.thread.id,
      offset: 0,
      limit: 10,
    });
    assert.equal(listed.items.length, 1);
    const described = await f.ops.executeOperation(f.owner, "diagnostics.describe", {
      evidenceId: f.evidenceId,
      offset: 0,
      limit: 10,
    });
    assert.equal(described.files[0].fileId, f.fileId);
    assert.equal(described.files[0].byteLength, raw.byteLength);
    const pages: Buffer[] = [];
    let cursor: { sequence: number; byteOffset: number } | null = {
      sequence: 0,
      byteOffset: 0,
    };
    while (cursor) {
      const response = await f.ops.executeOperation(f.owner, "diagnostics.read", {
        evidenceId: f.evidenceId,
        fileId: f.fileId,
        ...cursor,
        limitBytes: 32768,
      });
      assert.ok(response.byteLength <= 32768);
      pages.push(
        response.encoding === "utf8"
          ? Buffer.from(response.text)
          : Buffer.from(response.dataBase64, "base64"),
      );
      cursor = response.next;
    }
    assert.equal(hashDiagnostic(Buffer.concat(pages)), hashDiagnostic(raw));
    assert.deepEqual(Buffer.concat(pages), raw);
  } finally {
    await f.close();
  }
});

test("binary evidence uses base64 and read scopes plus current project access are enforced", async () => {
  const raw = Buffer.from([0xff, 0x00, 0xfe, 0x41]);
  const f = await diagnosticFixture(raw, "body");
  try {
    await f.upload();
    const read = await f.ops.executeOperation(f.owner, "diagnostics.read", {
      evidenceId: f.evidenceId,
      fileId: f.fileId,
      sequence: 0,
      byteOffset: 0,
      limitBytes: 32768,
    });
    assert.equal(read.encoding, "base64");
    assert.deepEqual(Buffer.from(read.dataBase64, "base64"), raw);
    const noScope = await f.ops.auth.issueToken(f.db, f.owner, {
      name: "No diagnostic grant",
      projectIds: [f.project.id],
      scopes: ["threads.get"],
      expiresInDays: 30,
    });
    const scopedActor = await f.ops.auth.authenticate(noScope.token);
    for (const [operation, input] of [
      ["diagnostics.list", { threadId: f.thread.id }],
      ["diagnostics.describe", { evidenceId: f.evidenceId }],
      [
        "diagnostics.read",
        { evidenceId: f.evidenceId, fileId: f.fileId, sequence: 0, byteOffset: 0 },
      ],
    ] as const)
      await assert.rejects(f.ops.executeOperation(scopedActor, operation, input), {
        code: "FORBIDDEN",
      });
    const other = await f.ops.executeOperation(f.owner, "projects.create", {
      name: "Other",
      origins: ["https://example.test"],
    });
    const wrongProject = await f.ops.auth.issueToken(f.db, f.owner, {
      name: "Other project",
      projectIds: [other.id],
      scopes: ["diagnostics.list", "diagnostics.describe", "diagnostics.read"],
      expiresInDays: 30,
    });
    await assert.rejects(
      f.ops.executeOperation(
        await f.ops.auth.authenticate(wrongProject.token),
        "diagnostics.describe",
        {
          evidenceId: f.evidenceId,
        },
      ),
      { code: "FORBIDDEN" },
    );
  } finally {
    await f.close();
  }
});

test("describe pages thousands of generated file entries without enlarging a thread", async () => {
  const f = await diagnosticFixture(Buffer.from("<html>small</html>"));
  try {
    const emptyHash = hashDiagnostic(Buffer.alloc(0));
    for (let index = 0; index < 1500; index++)
      f.manifest.files.push({
        fileId: randomUUID(),
        kind: "coverage",
        mimeType: "application/json",
        byteLength: 0,
        sha256: emptyHash,
        chunks: [],
      } as any);
    await f.upload();
    const thread = await f.ops.executeOperation(f.owner, "threads.get", {
      threadId: f.thread.id,
    });
    assert.equal(thread.diagnosticEvidence.latest[0].fileCount, 1501);
    assert.ok(Buffer.byteLength(JSON.stringify(thread)) < 100_000);
    const first = await f.ops.executeOperation(f.owner, "diagnostics.describe", {
      evidenceId: f.evidenceId,
      offset: 0,
      limit: 100,
    });
    assert.equal(first.total, 1501);
    assert.equal(first.files.length, 100);
    assert.equal(first.nextOffset, 100);
    const last = await f.ops.executeOperation(f.owner, "diagnostics.describe", {
      evidenceId: f.evidenceId,
      offset: 1500,
      limit: 100,
    });
    assert.equal(last.files.length, 1);
    assert.equal(last.nextOffset, null);
  } finally {
    await f.close();
  }
});
