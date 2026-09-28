import type { Database } from "./db.js";
import type { Actor } from "../shared/contracts.js";
import { access, event, ownerOnly } from "./access.js";
import { fail } from "./errors.js";

// Called inside Operations' account transaction lock: the read/revision/write is atomic.
export async function memberContext(db: Database, a: Actor, op: string, i: any) {
  const profile = op.startsWith("members.profile.");
  const responsibility = op.startsWith("members.responsibility.");
  const save = op.endsWith(".save");
  const userId = profile || responsibility ? (i.userId ?? a.userId) : undefined;
  const admin = a.owner && (a.kind === "human" || !!a.ownerAdmin);
  let role: string | undefined;
  if (!profile || i.projectId) {
    const p = await access(db, a, i.projectId, save ? "write" : "read");
    role = p.permissions.role;
  }
  if (profile && userId !== a.userId) {
    if (save) ownerOnly(a);
    else if (!admin && !i.projectId)
      fail("FORBIDDEN", "Project context required to read another member profile", 403);
  }
  if (userId) {
    const user = await db.one(
      "SELECT id,owner FROM users WHERE id=$1 AND active=true AND removed_at IS NULL",
      [userId],
    );
    if (!user) fail("NOT_FOUND", "Active member not found", 404);
    if (
      i.projectId &&
      !user.owner &&
      !(await db.one("SELECT user_id FROM grants WHERE project_id=$1 AND user_id=$2", [
        i.projectId,
        userId,
      ]))
    )
      fail("NOT_FOUND", "Project member not found", 404);
  }
  if (responsibility && save && userId !== a.userId)
    await access(db, a, i.projectId, "maintain");
  const table = profile
    ? "member_profiles"
    : responsibility
      ? "member_responsibilities"
      : "project_context";
  const keys = profile
    ? ["user_id"]
    : responsibility
      ? ["project_id", "user_id"]
      : ["project_id"];
  const values = profile
    ? [userId]
    : responsibility
      ? [i.projectId, userId]
      : [i.projectId];
  const where = keys.map((key, n) => `${key}=$${n + 1}`).join(" AND ");
  const read = async () =>
    db.one(
      `SELECT body,revision,trust,updated_by AS "updatedBy",updated_at AS "updatedAt"${profile ? ',current_work AS "currentWork"' : ""} FROM ${table} WHERE ${where}`,
      values,
    );
  let row = await read();
  if (save) {
    if ((row?.revision ?? 0) !== i.revision)
      fail(
        "CONFLICT",
        "Context changed; reload and preserve the current text before saving",
        409,
      );
    const trust = admin
      ? "owner_authored_advisory"
      : profile || (responsibility && userId === a.userId)
        ? "self_authored_advisory"
        : role === "maintainer"
          ? "maintainer_authored_advisory"
          : "member_authored_advisory";
    const columns = [...keys, "body", "trust", "updated_by"];
    await db.query(
      `INSERT INTO ${table}(${columns.join(",")}) VALUES(${columns.map((_, n) => `$${n + 1}`).join(",")}) ON CONFLICT(${keys.join(",")}) DO UPDATE SET body=excluded.body,trust=excluded.trust,updated_by=excluded.updated_by,updated_at=now(),revision=${table}.revision+1`,
      [...values, i.body, trust, a.userId],
    );
    if (profile && i.currentWork !== undefined)
      await db.query("UPDATE member_profiles SET current_work=$1 WHERE user_id=$2", [
        i.currentWork,
        userId,
      ]);
    row = await read();
    await event(db, a, profile ? null : i.projectId, userId ?? i.projectId, op, {
      revision: row.revision,
    });
  }
  if (row?.updatedAt instanceof Date) row.updatedAt = row.updatedAt.toISOString();
  return {
    ...(row ?? {
      body: "",
      revision: 0,
      trust:
        profile || responsibility ? "self_authored_advisory" : "member_authored_advisory",
      updatedBy: null,
      updatedAt: null,
    }),
    ...(userId ? { userId } : {}),
    ...(profile && !row ? { currentWork: "" } : {}),
    ...(!profile ? { projectId: i.projectId } : {}),
  };
}
