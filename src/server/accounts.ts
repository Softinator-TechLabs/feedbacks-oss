import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import type { Database } from "./db.js";
import type { Actor } from "../shared/contracts.js";
import { access, ownerOnly, canReadPolicy, event } from "./access.js";
import { hash, secret, revokeCredentials } from "./auth.js";
import { fail } from "./errors.js";
export function primaryOnly(a: Actor) {
  ownerOnly(a);
  if (!a.primaryOwner) fail("FORBIDDEN", "Primary owner required", 403);
}
export async function protectPrimary(db: Database, a: Actor, userId: string) {
  if (
    !a.primaryOwner &&
    (await db.one(
      "SELECT singleton FROM organization_identity WHERE primary_owner_id=$1",
      [userId],
    ))
  )
    fail("FORBIDDEN", "Only the primary owner can change this account", 403);
}
export async function reviewerContext(
  db: Database,
  a: Actor,
  projectId: string,
  userIds?: string[],
) {
  await access(db, a, projectId);
  if (!canReadPolicy(a))
    fail("FORBIDDEN", "Reviewer context requires context.policy", 403);
  const rows = await db.query(
    `SELECT u.id AS "userId",u.name,COALESCE(r.body,'') AS guidance,COALESCE(r.revision,0) AS revision,COALESCE(g.policy,u.policy) AS policy,u.policy_version AS "policyVersion" FROM users u LEFT JOIN grants g ON g.user_id=u.id AND g.project_id=$1 LEFT JOIN reviewer_guidance r ON r.user_id=u.id WHERE (g.user_id IS NOT NULL OR EXISTS(SELECT 1 FROM threads t WHERE t.project_id=$1 AND t.data->'author'->>'userId'=u.id::text) OR EXISTS(SELECT 1 FROM replies r JOIN threads t ON t.id=r.thread_id WHERE t.project_id=$1 AND r.data->'author'->>'userId'=u.id::text)) ORDER BY u.id`,
    [projectId],
  );
  return {
    trust: "owner_approved_advisory_reviewer_context" as const,
    items: userIds ? rows.filter((r) => userIds.includes(r.userId)) : rows,
  };
}
export async function accounts(db: Database, a: Actor, op: string, i: any) {
  ownerOnly(a);
  if (op === "account.links.create" && a.kind !== "human")
    fail("FORBIDDEN", "Owner sign-in links require a human browser session", 403);
  if (op === "account.links.list")
    return {
      items: await db.query(
        'SELECT id,expires_at AS "expiresAt",used_at AS "usedAt",revoked_at AS "revokedAt" FROM account_links WHERE user_id=$1 AND kind=\'login\' ORDER BY expires_at DESC',
        [a.userId],
      ),
    };
  if (op === "account.links.create") {
    const id = randomUUID(),
      token = secret(),
      expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
    await db.query(
      "INSERT INTO account_links(id,hash,user_id,kind,expires_at) VALUES($1,$2,$3,'login',$4)",
      [id, hash(token), a.userId, expiresAt],
    );
    return { id, loginPath: `/owner-login#token=${token}`, expiresAt };
  }
  if (op === "account.links.revoke") {
    const link = await db.one(
      "UPDATE account_links SET revoked_at=now() WHERE id=$1 AND user_id=$2 AND kind='login' RETURNING session_hash",
      [i.linkId, a.userId],
    );
    if (!link) fail("NOT_FOUND", "Link not found", 404);
    if (link.session_hash)
      await db.query("DELETE FROM sessions WHERE hash=$1", [link.session_hash]);
    return { revoked: true };
  }
  if (op === "members.create") {
    const email = i.email.toLowerCase(),
      username = i.username?.toLowerCase() ?? null;
    if (
      await db.one(
        "SELECT id FROM users WHERE lower(email)=$1 OR ($2::text IS NOT NULL AND lower(username)=$2)",
        [email, username],
      )
    )
      fail(
        "CONFLICT",
        username
          ? "Email or username already exists. Your draft is preserved."
          : "Email already exists. Your draft is preserved.",
        409,
      );
    for (const g of i.grants) await access(db, a, g.projectId);
    const id = randomUUID();
    await db.query(
      "INSERT INTO users(id,email,name,username,password_hash,must_change_password) VALUES($1,$2,$3,$4,$5,false)",
      [id, email, i.name, username, await argon2.hash(i.password)],
    );
    for (const g of i.grants)
      await db.query(
        "INSERT INTO grants(project_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT(project_id,user_id) DO UPDATE SET role=excluded.role",
        [g.projectId, id, g.role],
      );
    return { id };
  }
  const user = await db.one("SELECT id,owner,active FROM users WHERE id=$1", [i.userId]);
  if (!user) fail("NOT_FOUND", "Member not found", 404);
  if (op.startsWith("members.notes.") || op.startsWith("members.guidance.")) {
    primaryOnly(a);
    const table = op.startsWith("members.notes.")
      ? "private_member_notes"
      : "reviewer_guidance";
    const row = await db.one(`SELECT body,revision FROM ${table} WHERE user_id=$1`, [
      i.userId,
    ]);
    if (op.endsWith(".get")) return row ?? { body: "", revision: 0 };
    if ((row?.revision ?? 0) !== i.revision)
      fail("CONFLICT", "Text changed. Reload before saving your draft.", 409);
    const result = await db.one(
      `INSERT INTO ${table}(user_id,body) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET body=excluded.body,revision=${table}.revision+1 RETURNING body,revision`,
      [i.userId, i.body],
    );
    if (table === "reviewer_guidance") {
      const projects = await db.query(
        "SELECT project_id FROM grants WHERE user_id=$1 UNION SELECT project_id FROM threads WHERE data->'author'->>'userId'=$2 UNION SELECT t.project_id FROM replies r JOIN threads t ON t.id=r.thread_id WHERE r.data->'author'->>'userId'=$2",
        [i.userId, i.userId],
      );
      for (const p of projects)
        await event(db, a, p.project_id, i.userId, "reviewer.guidance.changed", {
          revision: result.revision,
        });
    }
    return result;
  }
  await protectPrimary(db, a, i.userId);
  if (op === "members.owner") {
    primaryOnly(a);
    if (i.userId === a.userId && !i.owner)
      fail("VALIDATION", "The primary owner cannot be demoted");
    if (!user.active && i.owner)
      fail("VALIDATION", "Enable this account before making it an owner");
    await db.query("UPDATE users SET owner=$1 WHERE id=$2", [i.owner, i.userId]);
    await revokeCredentials(db, i.userId);
    return { updated: true };
  }
  if (op === "members.resetPassword") {
    if (a.kind === "agent" && user.owner)
      fail("FORBIDDEN", "Owner credential recovery requires a human owner session", 403);
    if (!user.active)
      fail("VALIDATION", "Enable this account before resetting its password");
    await revokeCredentials(db, i.userId);
    if (i.password) {
      await db.query(
        "UPDATE users SET password_hash=$1,must_change_password=false WHERE id=$2",
        [await argon2.hash(i.password), i.userId],
      );
      return { updated: true };
    }
    // Issuing recovery also invalidates the old password: revoking only sessions
    // would let a compromised password immediately establish unrestricted access.
    await db.query(
      "UPDATE users SET password_hash=$1,must_change_password=true WHERE id=$2",
      [await argon2.hash(secret()), i.userId],
    );
    const token = secret(),
      expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
    await db.query(
      "INSERT INTO account_links(id,hash,user_id,kind,expires_at) VALUES($1,$2,$3,'reset',$4)",
      [randomUUID(), hash(token), i.userId, expiresAt],
    );
    return { updated: true, resetPath: `/reset#token=${token}`, expiresAt };
  }
  fail("NOT_FOUND", "Unknown account operation", 404);
}
