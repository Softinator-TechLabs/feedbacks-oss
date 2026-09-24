import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { Database } from "./db.js";
import type { Actor } from "../shared/contracts.js";
import type { Config } from "./config.js";
import type { AssetStore } from "./assets.js";
import { access, event } from "./access.js";
import { fail } from "./errors.js";
import { retry, remember } from "./feedback.js";

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_PAGES = 25;

export async function documentRow(
  db: Database,
  actor: Actor,
  documentId: string,
  mode: "read" | "write" = "read",
) {
  const row = await db.one("SELECT * FROM documents WHERE id=$1", [documentId]);
  if (!row) fail("NOT_FOUND", "Document not found", 404);
  await access(db, actor, row.project_id, mode);
  return row;
}

function metadata(row: any) {
  return {
    id: row.id,
    projectId: row.project_id,
    ...row.data,
    url: `/api/documents/${row.id}/file`,
  };
}

export async function documents(
  db: Database,
  actor: Actor,
  operation: string,
  input: any,
) {
  if (operation === "documents.list") {
    await access(db, actor, input.projectId);
    const rows = await db.query(
      "SELECT * FROM documents WHERE project_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100",
      [input.projectId],
    );
    return { items: rows.map(metadata) };
  }
  const row = await documentRow(db, actor, input.documentId);
  if (operation === "documents.get") return metadata(row);
  if (operation === "documents.threads") {
    const rows = await db.query(
      "SELECT id,data FROM threads WHERE project_id=$1 AND data->'context'->'document'->>'id'=$2 ORDER BY created_at,id LIMIT 500",
      [row.project_id, row.id],
    );
    return {
      items: rows.map((thread) => ({
        threadId: thread.id,
        body: thread.data.body,
        page: thread.data.context.document.page,
        x: thread.data.context.document.x,
        y: thread.data.context.document.y,
        state: thread.data.work.state,
      })),
    };
  }
  fail("NOT_FOUND", "Unknown document operation", 404);
}

export async function documentUploadPreflight(db: Database, actor: Actor, input: any) {
  await access(db, actor, input.projectId, "maintain");
  if (actor.kind !== "human")
    fail("FORBIDDEN", "A human maintainer must upload a document", 403);
  const prior = await retry(db, actor, "documents.upload", input);
  if (!prior) {
    const count = await db.one(
      "SELECT count(*)::integer AS count FROM documents WHERE project_id=$1",
      [input.projectId],
    );
    if (count.count >= 100) fail("LIMIT_REACHED", "This project has 100 documents", 409);
  }
  return prior ? metadata(await documentRow(db, actor, prior)) : null;
}

export async function prepareDocumentUpload(input: any, config: Config) {
  const bytes = Buffer.from(input.fileBase64, "base64");
  if (!bytes.length || bytes.length > MAX_BYTES)
    fail("DOCUMENT_TOO_LARGE", "Document must be between 1 byte and 8 MiB", 413);
  if (bytes.toString("base64") !== input.fileBase64)
    fail("VALIDATION", "Document must use canonical base64 encoding");
  const lowerName = input.name.toLowerCase();
  let output = bytes;
  let data: {
    kind: "pdf" | "image";
    contentType: "application/pdf" | "image/webp";
    pageCount: number;
    pages?: Array<{ width: number; height: number }>;
    width?: number;
    height?: number;
  };
  if (lowerName.endsWith(".pdf")) {
    if (!bytes.subarray(0, 8).toString("latin1").startsWith("%PDF-"))
      fail("INVALID_DOCUMENT", "The file is not a PDF");
    let task: ReturnType<typeof getDocument> | undefined;
    try {
      task = getDocument({
        data: new Uint8Array(bytes),
        isEvalSupported: false,
        useSystemFonts: false,
        stopAtErrors: true,
      });
      const pdf = await task.promise;
      if (pdf.numPages < 1 || pdf.numPages > MAX_PAGES)
        fail("VALIDATION", "PDF must have 1 to 25 pages");
      const pages = [];
      for (let page = 1; page <= pdf.numPages; page++) {
        const viewport = (await pdf.getPage(page)).getViewport({ scale: 1 });
        if (viewport.width > 10000 || viewport.height > 10000)
          fail("VALIDATION", "PDF page exceeds 10000 points");
        pages.push({
          width: Math.round(viewport.width),
          height: Math.round(viewport.height),
        });
      }
      data = {
        kind: "pdf",
        contentType: "application/pdf",
        pageCount: pdf.numPages,
        pages,
      };
    } catch (error) {
      if (error instanceof Error && "code" in error) throw error;
      fail("INVALID_DOCUMENT", "PDF could not be parsed safely");
    } finally {
      await task?.destroy().catch(() => undefined);
    }
  } else if (/\.(png|jpe?g|webp)$/.test(lowerName)) {
    try {
      const decoder = sharp(bytes, {
        limitInputPixels: 40000000,
        animated: false,
        failOn: "error",
      });
      const image = await decoder.metadata();
      if (
        !image.width ||
        !image.height ||
        image.width > 12000 ||
        image.height > 12000 ||
        !["png", "jpeg", "webp"].includes(image.format ?? "") ||
        (image.pages ?? 1) > 1
      )
        fail("VALIDATION", "Unsupported image format or dimensions");
      output = await decoder.rotate().webp({ quality: 85 }).toBuffer();
      const normalized = await sharp(output).metadata();
      data = {
        kind: "image",
        contentType: "image/webp",
        pageCount: 1,
        width: normalized.width,
        height: normalized.height,
      };
    } catch (error) {
      if (error instanceof Error && "code" in error) throw error;
      fail("INVALID_DOCUMENT", "Image could not be decoded safely");
    }
  } else fail("VALIDATION", "Choose a PDF, PNG, JPEG or WebP file");
  const id = randomUUID();
  const key = `feedbacks/${config.production ? "production" : "development"}/organizations/${config.organizationId}/projects/${input.projectId}/documents/${id}/source.${data.kind === "pdf" ? "pdf" : "webp"}`;
  return {
    id,
    key,
    output,
    data: {
      ...data,
      name: input.name,
      bytes: output.length,
      createdAt: new Date().toISOString(),
    },
  };
}

export async function commitDocumentUpload(
  db: Database,
  actor: Actor,
  input: any,
  prepared: Awaited<ReturnType<typeof prepareDocumentUpload>>,
) {
  await access(db, actor, input.projectId, "maintain");
  if (actor.kind !== "human")
    fail("FORBIDDEN", "A human maintainer must upload a document", 403);
  const prior = await retry(db, actor, "documents.upload", input);
  if (prior)
    return { committed: false, result: metadata(await documentRow(db, actor, prior)) };
  const count = await db.one(
    "SELECT count(*)::integer AS count FROM documents WHERE project_id=$1",
    [input.projectId],
  );
  if (count.count >= 100) fail("LIMIT_REACHED", "This project has 100 documents", 409);
  const row = await db.one(
    "INSERT INTO documents(id,project_id,object_key,data) VALUES($1,$2,$3,$4) RETURNING *",
    [prepared.id, input.projectId, prepared.key, JSON.stringify(prepared.data)],
  );
  await remember(db, actor, "documents.upload", input, prepared.id);
  await event(db, actor, input.projectId, prepared.id, "document.created", {
    kind: prepared.data.kind,
  });
  return { committed: true, result: metadata(row) };
}
