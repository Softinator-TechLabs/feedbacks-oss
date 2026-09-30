import type { Express, Request } from "express";
import type { Database } from "../db.js";
import type { Operations } from "../operations.js";
import { assetListThumbnail, assetRow, type AssetStore } from "../assets.js";
import { documentRow } from "../documents.js";
import { Auth, accountLock } from "../auth.js";
import { fail } from "../errors.js";

type RequestAuth = (req: Request) => string | undefined;

function videoByteRange(value: string, size: number): [number, number] | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2]) || size === 0) return null;
  if (!match[1]) {
    const suffix = Number(match[2]);
    return Number.isSafeInteger(suffix) && suffix > 0
      ? [Math.max(0, size - suffix), size - 1]
      : null;
  }
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start >= size ||
    end < start
  )
    return null;
  return [start, Math.min(end, size - 1)];
}

export function registerAssetDownloadRoutes(
  app: Express,
  database: Database,
  assets: AssetStore,
  ops: Operations,
  bearer: RequestAuth,
  cookie: RequestAuth,
) {
  app.get("/api/assets/:id", async (req, res, next) => {
    try {
      const actor = await ops.auth.authenticate(bearer(req), cookie(req));
      if (req.query.preview === "agent") {
        const result = await ops.executeOperation(actor, "assets.get", {
          assetId: String(req.params.id),
          includeImage: true,
          maxDimension: 1280,
        });
        if (!result.image) fail("PREVIEW_UNAVAILABLE", "Media preview unavailable", 422);
        res
          .set("Cache-Control", "private, no-store")
          .type("image/webp")
          .send(Buffer.from(result.image.data, "base64"));
        return;
      }
      const objectKey = await database.transaction(async (db) => {
        await accountLock(db);
        const current = await new Auth(db).current(actor);
        if (current.scopes && !current.scopes.includes("assets.get"))
          fail("FORBIDDEN", "Asset scope required", 403);
        const row = await assetRow(db, current, String(req.params.id));
        return {
          key: row.object_key as string,
          contentType: row.data.contentType as string,
        };
      });
      // Revocation governs new requests; an authorized in-flight read may finish.
      // Do not hold the organization transaction lock during remote storage I/O.
      if (!["image/webp", "video/webm"].includes(objectKey.contentType))
        fail("VALIDATION", "Unsupported asset type");
      if (req.query.preview === "list") {
        if (objectKey.contentType !== "image/webp")
          fail("VALIDATION", "Image preview is available only for screenshots");
        res.type("image/webp").send(await assetListThumbnail(assets, objectKey.key));
        return;
      }
      const bytes = await assets.get(objectKey.key);
      res.type(objectKey.contentType);
      if (objectKey.contentType === "video/webm") {
        res.set("Accept-Ranges", "bytes");
        const requestedRange = req.get("Range");
        // Stored assets expose no strong ETag or Last-Modified validator, so an
        // If-Range condition cannot match: return the complete representation.
        if (req.method === "GET" && requestedRange && !req.get("If-Range")) {
          const range = videoByteRange(requestedRange, bytes.length);
          if (!range) {
            res
              .status(416)
              .set({
                "Content-Range": `bytes */${bytes.length}`,
                "Content-Length": "0",
              })
              .end();
            return;
          }
          const [start, end] = range;
          res
            .status(206)
            .set({
              "Content-Range": `bytes ${start}-${end}/${bytes.length}`,
              "Content-Length": String(end - start + 1),
            })
            .end(bytes.subarray(start, end + 1));
          return;
        }
      }
      res.send(bytes);
    } catch (e) {
      next(e);
    }
  });
  app.get("/api/documents/:id/file", async (req, res, next) => {
    try {
      const actor = await ops.auth.authenticate(bearer(req), cookie(req));
      const document = await database.transaction(async (db) => {
        await accountLock(db);
        const current = await new Auth(db).current(actor);
        if (current.scopes && !current.scopes.includes("documents.get"))
          fail("FORBIDDEN", "Document read scope required", 403);
        const row = await documentRow(db, current, String(req.params.id));
        return { key: row.object_key as string, data: row.data };
      });
      const extension = document.data.kind === "pdf" ? "pdf" : "webp";
      res.set(
        "Content-Disposition",
        `attachment; filename="review-document.${extension}"`,
      );
      res.type(document.data.contentType).send(await assets.get(document.key));
    } catch (error) {
      next(error);
    }
  });
}
