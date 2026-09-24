import { randomUUID } from "node:crypto";
import type { Database } from "./db.js";
import type { Actor } from "../shared/contracts.js";
import { access, event } from "./access.js";
import { hash, secret } from "./auth.js";
import { fail } from "./errors.js";
import { saveThread } from "./feedback.js";
import type { Config } from "./config.js";

export function requireTurnstile(config: Config) {
  if (!config.turnstileSiteKey || !config.turnstileSecretKey)
    fail("FEATURE_UNAVAILABLE", "Guest replies require Turnstile configuration", 503);
  return { siteKey: config.turnstileSiteKey, secretKey: config.turnstileSecretKey };
}

export async function manageGuestLinks(
  db: Database,
  actor: Actor,
  op: string,
  input: any,
  config: Config,
) {
  if (actor.kind !== "human")
    fail("FORBIDDEN", "A signed-in project maintainer must manage guest links", 403);
  if (op === "guestLinks.revoke") {
    const link = await db.one(
      "SELECT id,project_id FROM guest_links WHERE id=$1 FOR UPDATE",
      [input.linkId],
    );
    if (!link) fail("NOT_FOUND", "Guest link not found", 404);
    await access(db, actor, link.project_id, "maintain");
    await db.query(
      "UPDATE guest_links SET revoked_at=coalesce(revoked_at,now()) WHERE id=$1",
      [link.id],
    );
    await event(db, actor, link.project_id, link.id, "guest_link.revoked", {});
    return { revoked: true };
  }
  const thread = await db.one("SELECT id,project_id FROM threads WHERE id=$1", [
    input.threadId,
  ]);
  if (!thread) fail("NOT_FOUND", "Feedback not found", 404);
  await access(db, actor, thread.project_id, "maintain");
  if (op === "guestLinks.list") {
    const rows = await db.query(
      "SELECT id,label,expires_at,revoked_at,replies FROM guest_links WHERE thread_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100",
      [thread.id],
    );
    return {
      items: rows.map((row) => ({
        id: row.id,
        label: row.label,
        expiresAt: new Date(row.expires_at).toISOString(),
        revokedAt: row.revoked_at ? new Date(row.revoked_at).toISOString() : null,
        replies: row.replies,
      })),
    };
  }
  requireTurnstile(config);
  const active = await db.one(
    "SELECT count(*)::integer AS count FROM guest_links WHERE thread_id=$1 AND revoked_at IS NULL AND expires_at>now()",
    [thread.id],
  );
  if (active.count >= 10)
    fail("LIMIT_REACHED", "Revoke an active guest link before creating another", 429);
  const token = secret();
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + input.expiresInDays * 86400000).toISOString();
  await db.query(
    "INSERT INTO guest_links(id,hash,thread_id,project_id,label,created_by,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [id, hash(token), thread.id, thread.project_id, input.label, actor.userId, expiresAt],
  );
  await event(db, actor, thread.project_id, id, "guest_link.created", {
    threadId: thread.id,
    expiresAt,
  });
  return { id, token, expiresAt, path: `/guest#token=${token}` };
}

async function validLink(db: Database, token: string, lock = false) {
  const link = await db.one(
    `SELECT g.*,p.data AS project,t.data AS thread FROM guest_links g
     JOIN projects p ON p.id=g.project_id JOIN threads t ON t.id=g.thread_id
     WHERE g.hash=$1 AND g.revoked_at IS NULL AND g.expires_at>now() AND g.replies<50
     ${lock ? "FOR UPDATE OF g,t" : ""}`,
    [hash(token)],
  );
  if (!link) fail("INVALID_LINK", "This guest link expired or was revoked", 410);
  return link;
}

export async function guestInspect(db: Database, token: string, config: Config) {
  const { siteKey } = requireTurnstile(config);
  const link = await validLink(db, token);
  return {
    projectName: link.project.name,
    threadBody: link.thread.body,
    expiresAt: new Date(link.expires_at).toISOString(),
    turnstileSiteKey: siteKey,
  };
}

export async function guestReply(
  db: Database,
  input: { token: string; name: string; body: string },
) {
  const link = await validLink(db, input.token, true);
  const author: Actor = {
    id: link.id,
    userId: link.id,
    kind: "guest",
    name: input.name,
    owner: false,
  };
  const thread = await db.one("SELECT * FROM threads WHERE id=$1 FOR UPDATE", [
    link.thread_id,
  ]);
  if (!thread) fail("NOT_FOUND", "Feedback not found", 404);
  const at = new Date().toISOString();
  await db.query("INSERT INTO replies(id,thread_id,data) VALUES($1,$2,$3)", [
    randomUUID(),
    thread.id,
    JSON.stringify({
      body: input.body,
      intent: "request",
      author: {
        id: author.id,
        userId: author.userId,
        kind: "guest",
        name: author.name,
      },
      mentions: [],
      trust: "untrusted_discussion",
    }),
  ]);
  const response = thread.data.response ?? { lastResponse: null };
  thread.data.response = {
    ...response,
    state: response.lastResponse ? "needs-follow-up" : "unanswered",
    lastHumanRequest: {
      actor: { id: author.id, userId: author.userId, kind: "guest", name: author.name },
      at,
    },
  };
  await saveThread(db, author, thread, "guest.reply");
  await db.query("UPDATE guest_links SET replies=replies+1 WHERE id=$1", [link.id]);
  return { posted: true };
}
