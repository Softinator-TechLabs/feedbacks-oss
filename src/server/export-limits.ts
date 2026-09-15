import { randomUUID } from "node:crypto";
import type { Database } from "./db.js";
import type { Actor } from "../shared/contracts.js";
import { access } from "./access.js";
import { accountLock, Auth } from "./auth.js";
import { fail } from "./errors.js";

// Shared by HTTP, MCP and CLI. These are safety ceilings, not capacity claims.
export const exportLimits = {
  threads: 1000,
  replies: 5000,
  sourceBytes: 4 * 1024 * 1024,
  snapshotBytes: 8 * 1024 * 1024,
  activePerUser: 4,
  activePerProject: 8,
  activeTotal: 24,
  activeBytes: 64 * 1024 * 1024,
  requestsPerUser: 12,
  requestsPerProject: 24,
  requestsTotal: 60,
} as const;

export async function purgeExpiredExports(db: Database) {
  await db.query("DELETE FROM export_snapshots WHERE expires_at<=now()");
  await db.query(
    "DELETE FROM export_requests WHERE created_at<=now()-interval '1 minute'",
  );
}

export async function reserveExportRequest(
  db: Database,
  actor: Actor,
  projectId: string,
) {
  // Commit the attempt before construction. An oversized/failed export must still
  // consume its budget; otherwise transaction rollback makes the throttle bypassable.
  await db.transaction(async (tx) => {
    await accountLock(tx);
    const current = await new Auth(tx).current(actor);
    if (current.scopes && !current.scopes.includes("context.export"))
      fail("FORBIDDEN", "Operation outside token scope", 403);
    await access(tx, current, projectId);
    await purgeExpiredExports(tx);
    const requests = await tx.one(
      "SELECT count(*)::integer AS total, count(*) FILTER (WHERE user_id=$1)::integer AS personal, count(*) FILTER (WHERE project_id=$2)::integer AS project FROM export_requests",
      [current.userId, projectId],
    );
    if (
      requests.total >= exportLimits.requestsTotal ||
      requests.personal >= exportLimits.requestsPerUser ||
      requests.project >= exportLimits.requestsPerProject
    )
      fail(
        "EXPORT_RATE_LIMITED",
        "Too many new exports; reuse a snapshot or try again in one minute",
        429,
      );
    await tx.query(
      "INSERT INTO export_requests(id,user_id,project_id) VALUES($1,$2,$3)",
      [randomUUID(), current.userId, projectId],
    );
  });
}

export async function availableExportBytes(
  db: Database,
  actor: Actor,
  projectId: string,
) {
  // The enclosing operation holds accountLock, so quotas cannot race across replicas.
  const active = await db.one(
    "SELECT count(*)::integer AS total, count(*) FILTER (WHERE user_id=$1 OR actor_id=$2)::integer AS personal, count(*) FILTER (WHERE project_id=$3)::integer AS project, COALESCE(sum(byte_length),0)::bigint AS bytes FROM export_snapshots WHERE expires_at>now()",
    [actor.userId, actor.id, projectId],
  );
  const remaining = exportLimits.activeBytes - Number(active.bytes);
  if (
    active.total >= exportLimits.activeTotal ||
    active.personal >= exportLimits.activePerUser ||
    active.project >= exportLimits.activePerProject ||
    remaining <= 0
  )
    fail(
      "EXPORT_CAPACITY",
      "Active export limit reached; reuse a snapshot or wait for its 15-minute expiry",
      429,
    );
  return Math.min(remaining, exportLimits.snapshotBytes);
}

export function requireExportSize(bytes: number, maximum: number) {
  if (bytes > maximum)
    fail(
      "EXPORT_TOO_LARGE",
      "Project export exceeds its content budget; use incremental changes",
      413,
    );
}

export async function checkExportSource(db: Database, projectId: string) {
  // Aggregate in PostgreSQL before transferring or expanding project data.
  const size = await db.one(
    `SELECT
      (SELECT count(*) FROM threads WHERE project_id=$1) AS threads,
      (SELECT count(*) FROM replies r JOIN threads t ON t.id=r.thread_id WHERE t.project_id=$1) AS replies,
      COALESCE((SELECT sum(octet_length(data::text)) FROM threads WHERE project_id=$1),0)
      + COALESCE((SELECT sum(octet_length(r.data::text)) FROM replies r JOIN threads t ON t.id=r.thread_id WHERE t.project_id=$1),0)
      + COALESCE((SELECT sum(octet_length(data::text)) FROM assets WHERE project_id=$1 AND status='validated'),0)
      + COALESCE((SELECT sum(octet_length(body)+octet_length(actor::text)+128) FROM instructions WHERE project_id=$1),0) AS bytes`,
    [projectId],
  );
  if (
    Number(size.threads) > exportLimits.threads ||
    Number(size.replies) > exportLimits.replies
  )
    fail(
      "EXPORT_TOO_LARGE",
      "Project export exceeds 1000 threads or 5000 replies; use incremental changes",
      413,
    );
  requireExportSize(Number(size.bytes), exportLimits.sourceBytes);
}
