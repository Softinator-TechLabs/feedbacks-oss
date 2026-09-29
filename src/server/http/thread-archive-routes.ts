import type { Express, Request } from "express";
import type { Database } from "../db.js";
import type { AssetStore } from "../assets.js";
import type { Operations } from "../operations.js";
import { fail } from "../errors.js";
import { prepareThreadArchive, streamThreadArchive } from "../thread-archive.js";

type RequestAuth = (req: Request) => string | undefined;

export function registerThreadArchiveRoutes(
  app: Express,
  database: Database,
  assets: AssetStore,
  ops: Operations,
  bearer: RequestAuth,
  cookie: RequestAuth,
) {
  app.get("/api/threads/:id/archive", async (req, res, next) => {
    try {
      const threadId = String(req.params.id);
      if (
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(threadId)
      )
        fail("VALIDATION", "Invalid thread ID", 400);
      const actor = await ops.auth.authenticate(bearer(req), cookie(req));
      if (actor.scopes && !actor.scopes.includes("threads.get"))
        fail("FORBIDDEN", "Thread read scope required", 403);
      const archive = await prepareThreadArchive(database, assets, ops, actor, threadId);
      await streamThreadArchive(res, archive);
    } catch (error) {
      if (res.headersSent) res.destroy(error as Error);
      else next(error);
    }
  });
}
