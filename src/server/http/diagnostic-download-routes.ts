import type { Express, Request } from "express";
import type { Database } from "../db.js";
import type { AssetStore } from "../assets.js";
import type { Operations } from "../operations.js";
import { Auth, accountLock } from "../auth.js";
import { fail } from "../errors.js";
import { inputSchemas } from "../../shared/contracts.js";
import {
  prepareDiagnosticArchive,
  prepareDiagnosticFile,
  checkedDiagnosticBytes,
} from "../diagnostics/read.js";
import { streamDiagnosticArchive } from "../diagnostics/archive.js";

type RequestAuth = (req: Request) => string | undefined;

export function registerDiagnosticDownloadRoutes(
  app: Express,
  database: Database,
  assets: AssetStore,
  ops: Operations,
  bearer: RequestAuth,
  cookie: RequestAuth,
) {
  app.get(
    "/api/diagnostics/:id/files/:fileId/chunks/:sequence",
    async (req, res, next) => {
      try {
        const input = inputSchemas["diagnostics.read"].safeParse({
          evidenceId: String(req.params.id),
          fileId: String(req.params.fileId),
          sequence: Number(req.params.sequence),
          byteOffset: 0,
        });
        if (!input.success) fail("VALIDATION", "Invalid diagnostic chunk selector", 400);
        const actor = await ops.auth.authenticate(bearer(req), cookie(req));
        const prepared = await database.transaction(async (db) => {
          await accountLock(db);
          const current = await new Auth(db).current(actor);
          if (current.scopes && !current.scopes.includes("diagnostics.read"))
            fail("FORBIDDEN", "Diagnostic read scope required", 403);
          return prepareDiagnosticFile(
            db,
            current,
            input.data.evidenceId,
            input.data.fileId,
            input.data.sequence,
          );
        });
        const bytes = await checkedDiagnosticBytes(assets, prepared.chunk);
        res.set({
          "Cache-Control": "private, no-store",
          "Content-Type": "application/octet-stream",
          "Content-Length": String(bytes.length),
        });
        res.send(bytes);
      } catch (error) {
        next(error);
      }
    },
  );
  app.get("/api/diagnostics/:id/archive", async (req, res, next) => {
    try {
      const input = inputSchemas["diagnostics.describe"].safeParse({
        evidenceId: String(req.params.id),
      });
      if (!input.success) fail("VALIDATION", "Invalid diagnostic evidence ID", 400);
      const actor = await ops.auth.authenticate(bearer(req), cookie(req));
      const prepared = await database.transaction(async (db) => {
        await accountLock(db);
        const current = await new Auth(db).current(actor);
        if (current.scopes && !current.scopes.includes("diagnostics.read"))
          fail("FORBIDDEN", "Diagnostic read scope required", 403);
        return prepareDiagnosticArchive(db, current, input.data.evidenceId);
      });
      await streamDiagnosticArchive(res, assets, prepared.manifest, prepared.chunks);
    } catch (error) {
      if (res.headersSent) res.destroy(error as Error);
      else next(error);
    }
  });
}
