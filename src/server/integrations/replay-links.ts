import { randomUUID } from "node:crypto";
import type { Database } from "../db.js";
import type { Actor } from "../../shared/contracts.js";
import { access, event } from "../access.js";
import { threadRow, checkRevision } from "../feedback.js";
import { hash } from "../auth.js";
import { normalizeUrl } from "../views.js";
import { fail } from "../errors.js";
export const replayLinksMigrationSql = `CREATE TABLE external_replay_links(id uuid PRIMARY KEY,thread_id uuid NOT NULL REFERENCES threads(id),project_id uuid NOT NULL REFERENCES projects(id),provider text NOT NULL,session_url text NOT NULL,page_url text NOT NULL,captured_at timestamptz NOT NULL,created_by uuid NOT NULL REFERENCES users(id),idempotency_key text NOT NULL,input_hash text NOT NULL,UNIQUE(created_by,idempotency_key)); CREATE INDEX external_replay_links_thread ON external_replay_links(thread_id);`;
export function reviewedReplayUrl(provider: "fullstory" | "logrocket", raw: string) {
  const url = new URL(raw);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.hash ||
    /[\x00-\x1f]/.test(raw)
  )
    fail("VALIDATION", "Use a provider session URL without credentials or fragment");
  const valid =
    provider === "fullstory"
      ? ["app.fullstory.com", "app.eu1.fullstory.com"].includes(url.hostname) &&
        /^\/ui\/[^/]+\/(?:client-session|session)\/[^/]+\/?$/.test(url.pathname)
      : url.hostname === "app.logrocket.com" &&
        /^\/[^/]+\/[^/]+\/s\/[^/]+(?:\/[^/]+)?\/?$/.test(url.pathname);
  if (
    !valid ||
    [...url.searchParams.keys()].some((key) =>
      /token|auth|secret|password|email|key|code|signature|credential/i.test(key),
    )
  )
    fail(
      "VALIDATION",
      "Use the session link returned by the selected provider, without an authentication token",
    );
  return url.toString();
}
export async function replayLinksOperation(
  db: Database,
  actor: Actor,
  name: string,
  input: any,
) {
  if (name === "replayLinks.remove") {
    const row = await db.one("SELECT * FROM external_replay_links WHERE id=$1", [
      input.linkId,
    ]);
    if (!row) fail("NOT_FOUND", "Session link not found", 404);
    if (actor.kind !== "human")
      fail("FORBIDDEN", "A human reviewer must manage session links", 403);
    const thread = await threadRow(db, actor, row.thread_id, "write");
    if (thread.project_id !== row.project_id)
      fail(
        "CONFLICT",
        "This feedback moved to another project; review its session links",
        409,
      );
    await db.query("DELETE FROM external_replay_links WHERE id=$1", [row.id]);
    await event(db, actor, thread.project_id, thread.id, "replay_link.removed", {
      linkId: row.id,
    });
    return { removed: true };
  }
  const thread = await threadRow(
    db,
    actor,
    input.threadId,
    name === "replayLinks.list" ? "read" : "write",
  );
  if (name === "replayLinks.list")
    return {
      items: (
        await db.query(
          "SELECT * FROM external_replay_links WHERE thread_id=$1 AND project_id=$2 ORDER BY captured_at DESC,id LIMIT 30",
          [thread.id, thread.project_id],
        )
      ).map((r) => ({
        id: r.id,
        threadId: r.thread_id,
        provider: r.provider,
        sessionUrl: r.session_url,
        pageUrl: r.page_url,
        capturedAt: r.captured_at.toISOString(),
        attribution: "reviewer_provided",
      })),
    };
  if (actor.kind !== "human")
    fail("FORBIDDEN", "A human reviewer must manage session links", 403);
  await access(db, actor, thread.project_id, "write");
  const inputHash = hash(JSON.stringify(input)),
    existing = await db.one(
      "SELECT * FROM external_replay_links WHERE created_by=$1 AND idempotency_key=$2",
      [actor.userId, input.idempotencyKey],
    );
  if (existing) {
    if (existing.input_hash !== inputHash)
      fail(
        "IDEMPOTENCY_CONFLICT",
        "This retry key was used for a different session link",
        409,
      );
    return { id: existing.id };
  }
  checkRevision(thread, input.revision);
  if (!thread.data.context?.url)
    fail("REPLAY_PAGE_MISMATCH", "This feedback does not have a web page to match", 409);
  const pageUrl = normalizeUrl(input.pageUrl);
  if (pageUrl !== normalizeUrl(thread.data.context.url))
    fail(
      "REPLAY_PAGE_MISMATCH",
      "The session's reviewed page must exactly match this feedback's normalized page URL",
      409,
    );
  if (Date.parse(input.capturedAt) > Date.now() + 60000)
    fail("VALIDATION", "Capture time cannot be in the future");
  if (
    (
      await db.one(
        "SELECT count(*)::int n FROM external_replay_links WHERE thread_id=$1",
        [thread.id],
      )
    ).n >= 30
  )
    fail("LIMIT_REACHED", "Remove an old session link before adding another", 429);
  const id = randomUUID();
  await db.query(
    "INSERT INTO external_replay_links(id,thread_id,project_id,provider,session_url,page_url,captured_at,created_by,idempotency_key,input_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
    [
      id,
      thread.id,
      thread.project_id,
      input.provider,
      reviewedReplayUrl(input.provider, input.sessionUrl),
      pageUrl,
      input.capturedAt,
      actor.userId,
      input.idempotencyKey,
      inputHash,
    ],
  );
  await event(db, actor, thread.project_id, thread.id, "replay_link.added", {
    linkId: id,
    provider: input.provider,
    attribution: "reviewer_provided",
  });
  return { id };
}
