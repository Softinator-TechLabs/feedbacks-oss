import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { PGlite } from "@electric-sql/pglite";
import { Database } from "../src/server/db.js";
import { migrate } from "../src/server/migrations.js";
import { Operations } from "../src/server/operations.js";
import { documentRow } from "../src/server/documents.js";
import { prepareDocumentUpload } from "../src/server/documents.js";

function syntheticPdf() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>",
    "<< /Length 0 >>\nstream\n\nendstream",
  ];
  let content = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(content));
    content += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(content);
  content += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1))
    content += `${String(offset).padStart(10, "0")} 00000 n \n`;
  content += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(content);
}

test("valid PDF upload derives a trusted page count and keeps original bytes", async () => {
  const bytes = syntheticPdf();
  const prepared = await prepareDocumentUpload(
    {
      projectId: "6a535fd6-27c6-4b04-b6b7-12237f8b70f0",
      name: "notes.pdf",
      fileBase64: bytes.toString("base64"),
    },
    { organizationId: "fixture", production: false } as any,
  );
  assert.equal(prepared.data.kind, "pdf");
  assert.equal(prepared.data.pageCount, 1);
  assert.deepEqual(prepared.data.pages, [{ width: 612, height: 792 }]);
  assert.deepEqual(prepared.output, bytes);
});

test("private project images become page-positioned discussions with current grants", async () => {
  const pg = new PGlite();
  const objects = new Map<string, Buffer>();
  const db = new Database(pg as any);
  const store = {
    async put(key: string, bytes: Buffer) {
      objects.set(key, bytes);
    },
    async get(key: string) {
      return objects.get(key)!;
    },
    async remove(key: string) {
      objects.delete(key);
    },
  };
  try {
    await migrate(db);
    const ops = new Operations(db, store, {
      appOrigin: "http://localhost:3000",
      organizationId: "fixture",
      production: false,
    } as any);
    const owner = await ops.auth.bootstrap(
      "owner@example.test",
      "Owner",
      "Correct-Horse-Battery-123",
    );
    const project = await ops.executeOperation(owner, "projects.create", {
      name: "Design",
      origins: ["https://example.test"],
    });
    const other = await ops.executeOperation(owner, "projects.create", {
      name: "Other",
      origins: ["https://other.test"],
    });
    const invited = await ops.executeOperation(owner, "members.invite", {
      email: "viewer@example.test",
      projectId: project.id,
      role: "viewer",
    });
    await ops.auth.acceptInvite(invited.token, "Viewer", "Correct-Horse-Battery-123");
    const viewer = (
      await ops.auth.login("viewer@example.test", "Correct-Horse-Battery-123")
    ).actor;
    const bytes = await sharp({
      create: { width: 80, height: 60, channels: 3, background: "#f6f2e9" },
    })
      .png()
      .toBuffer();
    const input = {
      projectId: project.id,
      name: "layout.png",
      fileBase64: bytes.toString("base64"),
      idempotencyKey: "document-image-fixture",
    };
    const document = await ops.executeOperation(owner, "documents.upload", input);
    assert.equal(document.kind, "image");
    assert.equal(document.pageCount, 1);
    assert.equal(document.width, 80);
    assert.equal(document.height, 60);
    assert.equal(
      (await ops.executeOperation(owner, "documents.upload", input)).id,
      document.id,
    );
    assert.equal(
      (await ops.executeOperation(viewer, "documents.list", { projectId: project.id }))
        .items[0].id,
      document.id,
    );
    await assert.rejects(
      ops.executeOperation(viewer, "documents.upload", {
        ...input,
        idempotencyKey: "viewer-upload-test",
      }),
      { code: "FORBIDDEN" },
    );
    await assert.rejects(
      ops.executeOperation(owner, "threads.create", {
        projectId: other.id,
        body: "Wrong project",
        document: { documentId: document.id, page: 1, x: 0.5, y: 0.5 },
        idempotencyKey: "wrong-project-document",
      }),
      { code: "FORBIDDEN" },
    );
    await assert.rejects(
      ops.executeOperation(owner, "threads.create", {
        projectId: project.id,
        body: "Wrong page",
        document: { documentId: document.id, page: 2, x: 0.5, y: 0.5 },
        idempotencyKey: "wrong-page-document",
      }),
      { code: "VALIDATION" },
    );
    const thread = await ops.executeOperation(owner, "threads.create", {
      projectId: project.id,
      body: "Increase contrast here",
      document: { documentId: document.id, page: 1, x: 0.25, y: 0.75 },
      idempotencyKey: "document-thread-fixture",
    });
    assert.deepEqual(thread.context.document, {
      id: document.id,
      name: "layout.png",
      kind: "image",
      page: 1,
      x: 0.25,
      y: 0.75,
    });
    assert.equal(thread.response.state, "unanswered");
    const discussions = await ops.executeOperation(owner, "documents.threads", {
      documentId: document.id,
      page: 1,
    });
    assert.deepEqual(
      discussions.items.map((item: any) => item.threadId),
      [thread.id],
    );
    assert.equal(discussions.items[0].x, 0.25);
    assert.equal(discussions.nextCursor, null);
    const original = await db.one("SELECT data FROM threads WHERE id=$1", [thread.id]);
    await db.query(
      `INSERT INTO threads(id,project_id,data,created_at)
       SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,$1,
         jsonb_set($2::jsonb,'{body}',to_jsonb('Synthetic point '||n::text)),
         now() - interval '1 day' + n * interval '1 second'
       FROM generate_series(1,510) AS n`,
      [project.id, JSON.stringify(original.data)],
    );
    const seen = new Set<string>();
    let cursor: string | null = null;
    let batches = 0;
    do {
      const batch = await ops.executeOperation(owner, "documents.threads", {
        documentId: document.id,
        page: 1,
        ...(cursor ? { cursor } : {}),
      });
      batches++;
      for (const marker of batch.items) {
        assert.equal(seen.has(marker.threadId), false);
        seen.add(marker.threadId);
      }
      if (batches === 1) assert.equal(batch.items[0].threadId, thread.id);
      cursor = batch.nextCursor;
    } while (cursor);
    assert.equal(batches, 6);
    assert.equal(seen.size, 511);
    await assert.rejects(
      ops.executeOperation(owner, "documents.threads", {
        documentId: document.id,
        page: 2,
      }),
      { code: "VALIDATION" },
    );
    await assert.rejects(
      ops.executeOperation(owner, "documents.threads", {
        documentId: document.id,
        page: 1,
        cursor: other.id,
      }),
      { code: "VALIDATION" },
    );
    assert.equal((await documentRow(db, viewer, document.id)).id, document.id);
    await assert.rejects(
      documentRow(db, { ...viewer, projects: [other.id] }, document.id),
      { code: "FORBIDDEN" },
    );
  } finally {
    await pg.close();
  }
});

test("document upload rejects forged PDF, oversized content and unsupported formats", async () => {
  const pg = new PGlite();
  try {
    const db = new Database(pg as any);
    await migrate(db);
    const ops = new Operations(
      db,
      { put: async () => {}, get: async () => Buffer.alloc(0), remove: async () => {} },
      {
        appOrigin: "http://localhost:3000",
        organizationId: "fixture",
        production: false,
      } as any,
    );
    const owner = await ops.auth.bootstrap(
      "owner@example.test",
      "Owner",
      "Correct-Horse-Battery-123",
    );
    const project = await ops.executeOperation(owner, "projects.create", {
      name: "Design",
      origins: ["https://example.test"],
    });
    const upload = (name: string, content: Buffer, key: string) =>
      ops.executeOperation(owner, "documents.upload", {
        projectId: project.id,
        name,
        fileBase64: content.toString("base64"),
        idempotencyKey: key,
      });
    await assert.rejects(
      upload("fake.pdf", Buffer.from("%PDF-1.7\nmalformed"), "bad-pdf-fixture"),
      { code: "INVALID_DOCUMENT" },
    );
    await assert.rejects(
      upload("trick.html", Buffer.from("<script>alert(1)</script>"), "html-fixture"),
      { code: "VALIDATION" },
    );
    await assert.rejects(
      upload("large.pdf", Buffer.alloc(8 * 1024 * 1024 + 1), "large-fixture"),
      { code: "DOCUMENT_TOO_LARGE" },
    );
  } finally {
    await pg.close();
  }
});
