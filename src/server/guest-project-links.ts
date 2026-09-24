import { randomUUID } from "node:crypto";
import type { Database } from "./db.js";
import type { Actor } from "../shared/contracts.js";
import type { Config } from "./config.js";
import { access, event } from "./access.js";
import { hash, publicActor, secret } from "./auth.js";
import { fail } from "./errors.js";
import { requireTurnstile } from "./guest-links.js";
import { viewContext } from "./views.js";

export async function manageGuestProjectLinks(
  db: Database,
  actor: Actor,
  op: string,
  input: any,
  config: Config,
) {
  if (actor.kind !== "human")
    fail("FORBIDDEN", "A signed-in project maintainer must manage guest links", 403);
  if (op === "guestProjectLinks.revoke") {
    const link = await db.one(
      "SELECT id,project_id FROM guest_project_links WHERE id=$1 FOR UPDATE",
      [input.linkId],
    );
    if (!link) fail("NOT_FOUND", "Guest project link not found", 404);
    await access(db, actor, link.project_id, "maintain");
    await db.query(
      "UPDATE guest_project_links SET revoked_at=coalesce(revoked_at,now()) WHERE id=$1",
      [link.id],
    );
    await event(db, actor, link.project_id, link.id, "guest_project_link.revoked", {});
    return { revoked: true };
  }
  await access(db, actor, input.projectId, "maintain");
  if (op === "guestProjectLinks.list") {
    const rows = await db.query(
      "SELECT id,label,expires_at,revoked_at,submissions,max_submissions FROM guest_project_links WHERE project_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100",
      [input.projectId],
    );
    return {
      items: rows.map((row) => ({
        id: row.id,
        label: row.label,
        expiresAt: new Date(row.expires_at).toISOString(),
        revokedAt: row.revoked_at ? new Date(row.revoked_at).toISOString() : null,
        submissions: row.submissions,
        maxSubmissions: row.max_submissions,
      })),
    };
  }
  requireTurnstile(config);
  const active = await db.one(
    "SELECT count(*)::integer AS count FROM guest_project_links WHERE project_id=$1 AND revoked_at IS NULL AND expires_at>now() AND submissions<max_submissions",
    [input.projectId],
  );
  if (active.count >= 10)
    fail("LIMIT_REACHED", "Revoke an active guest link before creating another", 429);
  const token = secret(),
    id = randomUUID();
  const expiresAt = new Date(Date.now() + input.expiresInDays * 86400000).toISOString();
  await db.query(
    "INSERT INTO guest_project_links(id,hash,project_id,label,created_by,expires_at,max_submissions) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [
      id,
      hash(token),
      input.projectId,
      input.label,
      actor.userId,
      expiresAt,
      input.maxSubmissions,
    ],
  );
  await event(db, actor, input.projectId, id, "guest_project_link.created", {
    expiresAt,
    maxSubmissions: input.maxSubmissions,
  });
  return { id, token, expiresAt, path: `/guest-project#token=${token}` };
}

async function validLink(db: Database, token: string, lock = false) {
  const link = await db.one(
    `SELECT g.*,p.data AS project FROM guest_project_links g
     JOIN projects p ON p.id=g.project_id
     WHERE g.hash=$1 AND g.revoked_at IS NULL AND g.expires_at>now()
       AND g.submissions<g.max_submissions
     ${lock ? "FOR UPDATE OF g" : ""}`,
    [hash(token)],
  );
  if (!link)
    fail(
      "INVALID_LINK",
      "This guest link expired, reached its limit or was revoked",
      410,
    );
  return link;
}

export async function guestProjectInspect(db: Database, token: string, config: Config) {
  const { siteKey } = requireTurnstile(config);
  const link = await validLink(db, token);
  return {
    projectName: link.project.name,
    expiresAt: new Date(link.expires_at).toISOString(),
    turnstileSiteKey: siteKey,
  };
}

export async function guestProjectSubmit(
  db: Database,
  input: { token: string; name: string; body: string; url: string },
) {
  const link = await validLink(db, input.token, true);
  const context = {
    ...viewContext(
      { url: input.url, viewport: { width: 1280, height: 800 } },
      link.project,
    ),
    source: "guest_project_link",
    viewportKnown: false,
  };
  const author: Actor = {
    id: link.id,
    userId: link.id,
    kind: "guest",
    name: input.name,
    owner: false,
  };
  const actor = publicActor(author),
    at = new Date().toISOString(),
    id = randomUUID();
  const data = {
    body: input.body,
    category: "general",
    tags: [],
    context,
    author: actor,
    lastActor: actor,
    lastActivityAt: at,
    archived: false,
    response: {
      state: "unanswered",
      lastHumanRequest: { actor, at },
      lastResponse: null,
    },
    work: { state: "open", history: [] },
    review: { round: 1, state: "open", history: [] },
    externalIssues: [],
    fixEvidence: [],
    trust: "untrusted_discussion",
  };
  await db.query("INSERT INTO threads(id,project_id,data) VALUES($1,$2,$3)", [
    id,
    link.project_id,
    JSON.stringify(data),
  ]);
  await db.query("UPDATE guest_project_links SET submissions=submissions+1 WHERE id=$1", [
    link.id,
  ]);
  await event(db, author, link.project_id, id, "thread.created", {
    revision: 1,
    guestProjectLinkId: link.id,
  });
  return { posted: true };
}
