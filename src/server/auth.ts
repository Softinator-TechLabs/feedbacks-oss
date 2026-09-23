import { randomBytes, randomUUID, createHash } from "node:crypto";
import argon2 from "argon2";
import type { Database } from "./db.js";
import { ownerTokenScopes, type Actor } from "../shared/contracts.js";
import { fail } from "./errors.js";
export const secret = () => randomBytes(32).toString("base64url");
export const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export const person = (u: any): Actor => ({
  id: u.id,
  userId: u.id,
  kind: "human",
  name: u.name,
  owner: u.owner,
  primaryOwner: !!u.primary_owner,
  mustChangePassword: !!u.must_change_password,
});
export const accountLock = (db: Database) =>
  db.query("SELECT pg_advisory_xact_lock(hashtextextended('feedbacks.accounts',0))");
const pendingPairingLimit = 1000;
export const purgeExpiredPairings = (db: Database) =>
  db.query(
    "DELETE FROM pairing WHERE id IN (SELECT id FROM pairing WHERE expires_at<=now() ORDER BY expires_at LIMIT 10000)",
  );
export async function revokeCredentials(db: Database, userId: string) {
  await db.query("DELETE FROM sessions WHERE user_id=$1", [userId]);
  await db.query(
    "UPDATE tokens SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL",
    [userId],
  );
  await db.query(
    "UPDATE pairing SET consumed_at=now() WHERE approved_by=$1 AND consumed_at IS NULL",
    [userId],
  );
  await db.query(
    "UPDATE account_links SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL",
    [userId],
  );
}
export const publicActor = (a: Actor) => ({
  id: a.id,
  userId: a.userId,
  kind: a.kind,
  name: a.name,
});
export class Auth {
  constructor(private db: Database) {}
  async bootstrap(email: string, name: string, password: string) {
    if (password.length < 10)
      fail("VALIDATION", "Password must contain at least 10 characters");
    const passwordHash = await argon2.hash(password);
    return this.db.transaction(async (tx) => {
      await tx.query("LOCK TABLE users IN EXCLUSIVE MODE");
      if (await tx.one("SELECT id FROM users WHERE owner=true"))
        fail("BOOTSTRAP_DISABLED", "An owner already exists", 409);
      const u = await tx.one(
        "INSERT INTO users(id,email,name,password_hash,owner) VALUES($1,$2,$3,$4,true) RETURNING id,name,owner",
        [randomUUID(), email.toLowerCase(), name, passwordHash],
      );
      await tx.query("INSERT INTO organization_identity(primary_owner_id) VALUES($1)", [
        u.id,
      ]);
      return person({ ...u, primary_owner: true });
    });
  }
  async login(email: string, password: string) {
    return this.db.transaction(async (tx) => {
      await accountLock(tx);
      const u = await tx.one(
        "SELECT u.*,EXISTS(SELECT 1 FROM organization_identity WHERE primary_owner_id=u.id) AS primary_owner FROM users u WHERE lower(email)=$1 OR lower(username)=$1",
        [email.trim().toLowerCase()],
      );
      if (!u || !u.active || !(await argon2.verify(u.password_hash, password)))
        fail("UNAUTHENTICATED", "Invalid email or password", 401);
      const token = secret(),
        csrf = secret(),
        expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
      await tx.query(
        "INSERT INTO sessions(hash,user_id,csrf_hash,expires_at) VALUES($1,$2,$3,$4)",
        [hash(token), u.id, hash(csrf), expiresAt],
      );
      return { actor: person(u), token, csrf, expiresAt };
    });
  }
  async acceptInvite(token: string, name: string, password: string) {
    const passwordHash = await argon2.hash(password);
    return this.db.transaction(async (tx) => {
      await accountLock(tx);
      const invite = await tx.one(
        "SELECT * FROM invites WHERE hash=$1 AND used_at IS NULL AND expires_at>now() FOR UPDATE",
        [hash(token)],
      );
      if (!invite) fail("INVALID_INVITE", "Invitation expired or already used", 400);
      if (await tx.one("SELECT id FROM users WHERE email=$1", [invite.email]))
        fail(
          "CONFLICT",
          "Account already exists; ask the owner to grant project access",
          409,
        );
      const userId = randomUUID();
      await tx.query(
        "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,$4)",
        [userId, invite.email, name, passwordHash],
      );
      await tx.query("INSERT INTO grants(project_id,user_id,role) VALUES($1,$2,$3)", [
        invite.project_id,
        userId,
        invite.role,
      ]);
      await tx.query("UPDATE invites SET used_at=now() WHERE hash=$1", [hash(token)]);
      return { accepted: true };
    });
  }
  async authenticate(bearer?: string, cookie?: string): Promise<Actor> {
    if (bearer) {
      const t = await this.db.one(
        "SELECT t.*,u.name AS human_name,u.owner,u.active,u.must_change_password FROM tokens t JOIN users u ON u.id=t.user_id WHERE t.hash=$1 AND revoked_at IS NULL AND expires_at>now()",
        [hash(bearer)],
      );
      if (!t || !t.active || t.must_change_password || (t.owner_admin && !t.owner))
        fail("UNAUTHENTICATED", "Token expired or revoked", 401);
      return {
        id: t.kind === "agent" ? t.id : t.user_id,
        userId: t.user_id,
        name: t.kind === "agent" ? t.name : t.human_name,
        kind: t.kind,
        owner: t.owner,
        tokenId: t.id,
        projects: t.projects,
        scopes: t.scopes,
        canResolve: t.can_resolve,
        ownerAdmin: t.kind === "agent" && t.owner_admin,
      };
    }
    if (cookie) {
      const s = await this.db.one(
        "SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.hash=$1 AND s.expires_at>now() AND u.active=true",
        [hash(cookie)],
      );
      if (s) return { ...person(s), sessionHash: hash(cookie) };
    }
    return fail("UNAUTHENTICATED", "Sign in required", 401);
  }
  async csrf(actor: Actor, value?: string) {
    const s = await this.db.one("SELECT csrf_hash FROM sessions WHERE hash=$1", [
      actor.sessionHash,
    ]);
    if (!s || !value || s.csrf_hash !== hash(value))
      fail("CSRF", "Refresh your session before trying again", 403);
  }
  async current(actor: Actor) {
    const u = await this.db.one(
      "SELECT u.*,EXISTS(SELECT 1 FROM organization_identity WHERE primary_owner_id=u.id) AS primary_owner FROM users u WHERE id=$1 AND active=true",
      [actor.userId],
    );
    if (!u) fail("UNAUTHENTICATED", "Account disabled", 401);
    if (
      actor.sessionHash &&
      !(await this.db.one(
        "SELECT hash FROM sessions WHERE hash=$1 AND user_id=$2 AND expires_at>now()",
        [actor.sessionHash, actor.userId],
      ))
    )
      fail("UNAUTHENTICATED", "Session expired or revoked", 401);
    if (actor.tokenId) {
      const t = await this.db.one(
        "SELECT * FROM tokens WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL AND expires_at>now()",
        [actor.tokenId, actor.userId],
      );
      if (!t || u.must_change_password || (t.owner_admin && !u.owner))
        fail("UNAUTHENTICATED", "Token expired or revoked", 401);
      const ownerAdmin = t.kind === "agent" && t.owner_admin === true && u.owner === true;
      return {
        ...actor,
        id: t.kind === "agent" ? t.id : t.user_id,
        kind: t.kind as Actor["kind"],
        name: t.kind === "agent" ? t.name : u.name,
        owner: u.owner,
        ownerAdmin,
        primaryOwner: ownerAdmin && !!u.primary_owner,
        mustChangePassword: !!u.must_change_password,
        projects: ownerAdmin ? undefined : t.projects,
        scopes: t.scopes,
        canResolve: t.can_resolve,
      };
    }
    return { ...actor, ...person(u) };
  }
  async changePassword(actor: Actor, currentPassword: string, password: string) {
    if (actor.kind !== "human") fail("FORBIDDEN", "Use your web account", 403);
    const u = await this.db.one("SELECT password_hash FROM users WHERE id=$1", [
      actor.userId,
    ]);
    if (!(await argon2.verify(u.password_hash, currentPassword)))
      fail("UNAUTHENTICATED", "Current password is incorrect", 401);
    if (password.length < 10 || password === currentPassword)
      fail("VALIDATION", "Choose a different password with at least 10 characters");
    const passwordHash = await argon2.hash(password);
    await this.db.query(
      "UPDATE users SET password_hash=$1,must_change_password=false WHERE id=$2",
      [passwordHash, actor.userId],
    );
    await revokeCredentials(this.db, actor.userId);
    return { changed: true, signInRequired: true };
  }
  async resetPassword(token: string, password: string) {
    return this.db.transaction(async (tx) => {
      await accountLock(tx);
      const link = await tx.one(
        "SELECT l.* FROM account_links l JOIN users u ON u.id=l.user_id WHERE l.hash=$1 AND l.kind='reset' AND l.used_at IS NULL AND l.revoked_at IS NULL AND l.expires_at>now() AND u.active=true FOR UPDATE OF l",
        [hash(token)],
      );
      if (!link) fail("INVALID_LINK", "Link expired, revoked or already used", 400);
      if (password.length < 10) fail("VALIDATION", "Use at least 10 characters");
      await tx.query(
        "UPDATE users SET password_hash=$1,must_change_password=false WHERE id=$2",
        [await argon2.hash(password), link.user_id],
      );
      await tx.query("UPDATE account_links SET used_at=now() WHERE id=$1", [link.id]);
      await revokeCredentials(tx, link.user_id);
      return { changed: true, signInRequired: true };
    });
  }
  async consumeLoginLink(value: string) {
    return this.db.transaction(async (tx) => {
      await accountLock(tx);
      const link = await tx.one(
        "SELECT l.* FROM account_links l JOIN users u ON u.id=l.user_id WHERE l.hash=$1 AND l.kind='login' AND l.used_at IS NULL AND l.revoked_at IS NULL AND l.expires_at>now() AND u.active=true AND u.owner=true AND u.must_change_password=false FOR UPDATE OF l",
        [hash(value)],
      );
      if (!link) fail("INVALID_LINK", "Link expired, revoked or already used", 400);
      const u = await tx.one(
        "SELECT u.*,EXISTS(SELECT 1 FROM organization_identity WHERE primary_owner_id=u.id) AS primary_owner FROM users u WHERE id=$1",
        [link.user_id],
      );
      const token = secret(),
        csrf = secret(),
        expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
      await tx.query(
        "INSERT INTO sessions(hash,user_id,csrf_hash,expires_at) VALUES($1,$2,$3,$4)",
        [hash(token), u.id, hash(csrf), expiresAt],
      );
      await tx.query(
        "UPDATE account_links SET used_at=now(),session_hash=$1 WHERE id=$2",
        [hash(token), link.id],
      );
      return { actor: person(u), token, csrf, expiresAt };
    });
  }
  async issueToken(tx: Database, actor: Actor, input: any, kind = "agent") {
    const ownerAdmin = input.ownerAdmin === true;
    if (ownerAdmin && (kind !== "agent" || actor.kind !== "human" || !actor.owner))
      fail("FORBIDDEN", "Only a human owner can delegate owner administration", 403);
    const token = secret(),
      id = randomUUID(),
      expiresAt = new Date(Date.now() + input.expiresInDays * 86400000).toISOString();
    await tx.query(
      "INSERT INTO tokens(id,hash,user_id,kind,name,projects,scopes,can_resolve,expires_at,owner_admin) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [
        id,
        hash(token),
        actor.userId,
        kind,
        input.name,
        JSON.stringify(ownerAdmin ? [] : input.projectIds),
        JSON.stringify(ownerAdmin ? ownerTokenScopes : input.scopes),
        ownerAdmin || (input.canResolve ?? false),
        expiresAt,
        ownerAdmin,
      ],
    );
    return { id, token, expiresAt, kind, name: input.name, ownerAdmin };
  }
  async requestPairing(name: string) {
    const id = randomUUID(),
      deviceSecret = secret(),
      expiresAt = new Date(Date.now() + 10 * 60000).toISOString();
    await this.db.transaction(async (tx) => {
      // Bound public device requests across app replicas without taking the
      // organization-wide account lock used by signed-in operations.
      await tx.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('feedbacks.pairing',0))",
      );
      const pending = await tx.one(
        "SELECT count(*)::integer AS count FROM pairing WHERE expires_at>now() AND consumed_at IS NULL",
      );
      if (pending.count >= pendingPairingLimit)
        fail("RATE_LIMITED", "Too many pending devices; retry shortly", 429);
      await tx.query(
        "INSERT INTO pairing(id,secret_hash,name,expires_at) VALUES($1,$2,$3,$4)",
        [id, hash(deviceSecret), name, expiresAt],
      );
    });
    return {
      pairingId: id,
      deviceSecret,
      expiresAt,
      intervalSeconds: 3,
      approvalPath: `/pair?pairingId=${id}`,
    };
  }
  async verifyPairing(id: string, deviceSecret: string) {
    const p = await this.db.one(
      "SELECT id,expires_at FROM pairing WHERE id=$1 AND secret_hash=$2 AND expires_at>now() AND consumed_at IS NULL",
      [id, hash(deviceSecret)],
    );
    if (!p) fail("PAIRING_EXPIRED", "Pairing expired or already consumed", 410);
    return { id: p.id, expiresAt: new Date(p.expires_at).getTime() };
  }
  async pollPairing(id: string, deviceSecret: string) {
    return this.db.transaction(async (tx) => {
      await accountLock(tx);
      const p = await tx.one(
        "SELECT * FROM pairing WHERE id=$1 AND secret_hash=$2 AND expires_at>now() AND consumed_at IS NULL FOR UPDATE",
        [id, hash(deviceSecret)],
      );
      if (!p) fail("PAIRING_EXPIRED", "Pairing expired or already consumed", 410);
      if (!p.approved_by) return { status: "pending" };
      const u = await tx.one(
        "SELECT * FROM users WHERE id=$1 AND active=true AND must_change_password=false",
        [p.approved_by],
      );
      if (!u) fail("FORBIDDEN", "Approving account is unavailable", 403);
      const projects = await tx.query(
        u.owner
          ? "SELECT id FROM projects"
          : "SELECT project_id AS id FROM grants WHERE user_id=$1",
        u.owner ? [] : [u.id],
      );
      const result = await this.issueToken(
        tx,
        person(u),
        {
          name: p.name,
          projectIds: projects.map((p) => p.id),
          scopes: [
            "auth.me",
            "projects.list",
            "projects.get",
            "threads.list",
            "threads.get",
            "threads.create",
            "threads.reply",
            "views.get",
            "views.like",
            "assets.upload",
            "assets.get",
            "context.changes",
          ],
          expiresInDays: 30,
        },
        "extension",
      );
      await tx.query("UPDATE pairing SET consumed_at=now() WHERE id=$1", [id]);
      return { status: "approved", ...result };
    });
  }
}
