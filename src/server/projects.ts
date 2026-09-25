import { randomUUID } from "node:crypto";
import type { Database } from "./db.js";
import type { Actor } from "../shared/contracts.js";
import { access, canReadPolicy, event, ownerOnly } from "./access.js";
import { hash, secret, revokeCredentials } from "./auth.js";
import { protectPrimary } from "./accounts.js";
import { fail } from "./errors.js";
export async function projects(db: Database, a: Actor, op: string, i: any) {
  if (op === "projects.list") {
    const rows = await db.query(
      a.owner
        ? "SELECT id FROM projects ORDER BY data->>'name'"
        : "SELECT p.id FROM projects p JOIN grants g ON g.project_id=p.id WHERE g.user_id=$1 ORDER BY p.data->>'name'",
      a.owner ? [] : [a.userId],
    );
    const allowed = rows.filter((p) => !a.projects || a.projects.includes(p.id));
    return {
      items: await Promise.all(allowed.map((p) => access(db, a, p.id))),
    };
  }
  if (op === "projects.get") return access(db, a, i.projectId);
  let current: Awaited<ReturnType<typeof access>> | undefined;
  if (op === "projects.create") ownerOnly(a);
  else {
    current = await access(db, a, i.projectId, "maintain");
    if ((i.captureMode ?? "origins") !== (current.captureMode ?? "origins")) ownerOnly(a);
  }
  const origins = [
    ...new Set(
      i.origins.map((raw: string) => {
        const u = new URL(raw);
        if (
          !["http:", "https:"].includes(u.protocol) ||
          u.username ||
          u.password ||
          u.origin !== raw
        )
          fail(
            "VALIDATION",
            "Origins must be exact: scheme://host[:port], no trailing slash or path",
          );
        return u.origin;
      }),
    ),
  ];
  const data = {
    name: i.name,
    origins,
    ...(i.captureMode === "any" ? { captureMode: "any" } : {}),
    repositoryUrl: i.repositoryUrl ?? null,
    githubConnected:
      op !== "projects.create" &&
      current?.githubConnected === true &&
      (i.repositoryUrl ?? null) === current.repositoryUrl,
    githubStatusSync:
      op !== "projects.create" &&
      current?.githubConnected === true &&
      current?.githubStatusSync === true &&
      (i.repositoryUrl ?? null) === current.repositoryUrl,
  };
  let id = i.projectId;
  if (op === "projects.create") {
    id = randomUUID();
    await db.query("INSERT INTO projects(id,data) VALUES($1,$2)", [
      id,
      JSON.stringify(data),
    ]);
  } else {
    const saved = await db.one(
      "UPDATE projects SET data=$1,revision=revision+1 WHERE id=$2 AND revision=$3 RETURNING id",
      [JSON.stringify(data), id, i.revision],
    );
    if (!saved) fail("CONFLICT", "Project changed; reload first", 409);
    if ((i.repositoryUrl ?? null) !== current?.repositoryUrl)
      await db.query(
        "DELETE FROM github_status_sync WHERE thread_id IN (SELECT id FROM threads WHERE project_id=$1) AND status<>'uncertain'",
        [id],
      );
  }
  await event(db, a, id, id, op, {});
  return access(db, a, id);
}
export async function members(db: Database, a: Actor, op: string, i: any) {
  if (op === "members.list") {
    if (!i.projectId) ownerOnly(a);
    else await access(db, a, i.projectId);
    if (i.includeRemoved && !a.owner) fail("FORBIDDEN", "Owner required", 403);
    const rows = await db.query(
      i.projectId
        ? 'SELECT u.id,u.name,u.email,u.active,u.owner,u.removed_at AS "removedAt",u.classification,u.expertise,u.policy,u.policy_version,g.role,g.can_resolve,g.policy AS project_policy FROM users u LEFT JOIN grants g ON g.user_id=u.id AND g.project_id=$1 WHERE (u.owner=true OR g.user_id IS NOT NULL) AND (u.removed_at IS NULL OR $2=true)'
        : 'SELECT id,name,email,active,owner,removed_at AS "removedAt",classification,expertise,policy,policy_version FROM users WHERE removed_at IS NULL OR $1=true',
      i.projectId ? [i.projectId, !!i.includeRemoved] : [!!i.includeRemoved],
    );
    const primary = await db.one("SELECT primary_owner_id FROM organization_identity");
    const aliases =
      a.owner && (a.kind === "human" || a.ownerAdmin)
        ? await db.query("SELECT id,username FROM users")
        : [];
    return {
      items: rows.map((u) => {
        u.primaryOwner = u.id === primary?.primary_owner_id;
        if (a.owner && (a.kind === "human" || a.ownerAdmin))
          u.username = aliases.find((x) => x.id === u.id)?.username ?? null;
        if (!canReadPolicy(a)) {
          delete u.policy;
          delete u.policy_version;
          delete u.project_policy;
          delete u.email;
          delete u.classification;
          delete u.expertise;
        }
        return u;
      }),
    };
  }
  ownerOnly(a);
  if (op === "members.invite") {
    await access(db, a, i.projectId);
    const token = secret(),
      expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
    await db.query(
      "INSERT INTO invites(hash,email,project_id,role,expires_at) VALUES($1,$2,$3,$4,$5)",
      [hash(token), i.email.toLowerCase(), i.projectId, i.role, expiresAt],
    );
    await event(db, a, i.projectId, i.projectId, op, { role: i.role });
    return { token, expiresAt, invitePath: `/invite#token=${token}` };
  }
  if (!(await db.one("SELECT id FROM users WHERE id=$1", [i.userId])))
    fail("NOT_FOUND", "Member not found", 404);
  await protectPrimary(db, a, i.userId);
  if (op === "members.grant") {
    await access(db, a, i.projectId);
    if (i.remove)
      await db.query("DELETE FROM grants WHERE project_id=$1 AND user_id=$2", [
        i.projectId,
        i.userId,
      ]);
    else
      await db.query(
        "INSERT INTO grants(project_id,user_id,role,can_resolve) VALUES($1,$2,$3,$4) ON CONFLICT(project_id,user_id) DO UPDATE SET role=excluded.role,can_resolve=excluded.can_resolve",
        [i.projectId, i.userId, i.role, i.canResolve],
      );
  } else if (op === "members.policy") {
    await access(db, a, i.projectId);
    const updated = await db.one(
      "UPDATE grants SET policy=$1 WHERE project_id=$2 AND user_id=$3 RETURNING user_id",
      [i.policy === null ? null : JSON.stringify(i.policy), i.projectId, i.userId],
    );
    if (!updated) fail("NOT_FOUND", "Grant not found", 404);
    await db.query("UPDATE users SET policy_version=policy_version+1 WHERE id=$1", [
      i.userId,
    ]);
  } else if (op === "members.update") {
    if (
      i.active &&
      (await db.one("SELECT id FROM users WHERE id=$1 AND removed_at IS NOT NULL", [
        i.userId,
      ]))
    )
      fail("VALIDATION", "Restore this person to People before enabling the account");
    if (i.userId === a.userId && !i.active)
      fail("VALIDATION", "Owner cannot disable their own account");
    await db.query(
      "UPDATE users SET name=$1,active=$2,classification=$3,expertise=$4,policy=$5,policy_version=policy_version+1 WHERE id=$6",
      [
        i.name,
        i.active,
        i.classification,
        JSON.stringify(i.expertise),
        JSON.stringify(i.policy),
        i.userId,
      ],
    );
    if (!i.active) await revokeCredentials(db, i.userId);
  }
  await event(db, a, i.projectId ?? null, i.userId, op, {});
  return { updated: true };
}
