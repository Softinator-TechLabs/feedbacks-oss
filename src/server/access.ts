import type { Database } from "./db.js";
import type { Actor } from "../shared/contracts.js";
import { fail } from "./errors.js";
import { publicActor } from "./auth.js";
export function ownerOnly(actor: Actor) {
  if (
    !actor.owner ||
    !(actor.kind === "human" || (actor.kind === "agent" && actor.ownerAdmin))
  )
    fail("FORBIDDEN", "Owner account or explicitly delegated owner agent required", 403);
}
export async function access(
  db: Database,
  actor: Actor,
  projectId: string,
  mode: "read" | "write" | "maintain" | "resolve" = "read",
) {
  if (actor.mustChangePassword)
    fail(
      "PASSWORD_CHANGE_REQUIRED",
      "Replace your temporary password before continuing",
      403,
    );
  if (actor.projects && !actor.projects.includes(projectId))
    fail("FORBIDDEN", "Project outside token scope", 403);
  const p = await db.one("SELECT * FROM projects WHERE id=$1", [projectId]);
  if (!p) fail("NOT_FOUND", "Project not found", 404);
  const g = await db.one("SELECT * FROM grants WHERE project_id=$1 AND user_id=$2", [
    projectId,
    actor.userId,
  ]);
  if (!actor.owner && !g) fail("FORBIDDEN", "Project access required", 403);
  const role = actor.owner ? "maintainer" : g.role;
  if (mode === "write" && role === "viewer")
    fail("FORBIDDEN", "Write access required", 403);
  if (mode === "maintain" && role !== "maintainer")
    fail("FORBIDDEN", "Maintainer access required", 403);
  if (
    mode === "resolve" &&
    (!(actor.owner || g?.can_resolve || role === "maintainer") ||
      (actor.kind === "agent" && !actor.canResolve))
  )
    fail("FORBIDDEN", "Resolution permission required", 403);
  return {
    ...p.data,
    id: p.id,
    revision: p.revision,
    permissions: {
      role,
      canWrite: role !== "viewer",
      canMaintain: role === "maintainer",
      canResolve:
        (actor.owner || g?.can_resolve || role === "maintainer") &&
        (actor.kind !== "agent" || actor.canResolve),
    },
  };
}
export const canReadPolicy = (a: Actor) =>
  (a.kind === "human" && a.owner) ||
  (a.kind === "agent" && a.owner && !!a.ownerAdmin) ||
  (a.kind === "agent" && !!a.scopes?.includes("context.policy"));
export async function event(
  db: Database,
  a: Actor,
  projectId: string | null,
  entityId: string,
  kind: string,
  data: any,
) {
  // Sequence allocation alone does not order commits. Hold this project-specific
  // lock from the first event allocation until the enclosing transaction ends,
  // so a poll cannot observe a higher cursor while a lower one is uncommitted.
  // Event producers finish their domain row locks before reaching this point;
  // reads/export never acquire this lock, avoiding inverted lock ordering.
  await db.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('feedbacks.events:' || $1::text,0))",
    [projectId ?? "organization"],
  );
  await db.query(
    "INSERT INTO events(project_id,entity_id,kind,actor,data) VALUES($1,$2,$3,$4,$5)",
    [projectId, entityId, kind, JSON.stringify(publicActor(a)), JSON.stringify(data)],
  );
}
