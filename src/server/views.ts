import { hash } from "./auth.js";
import { fail } from "./errors.js";
import type { Database } from "./db.js";
import type { Actor } from "../shared/contracts.js";
import { access, canReadPolicy, event } from "./access.js";
import { getDomain, getSubdomain } from "tldts";
export function normalizeUrl(raw: string) {
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
    fail("VALIDATION", "HTTP(S) URL without credentials required");
  url.hash = "";
  for (const key of [...url.searchParams.keys()])
    if (
      /token|secret|password|passwd|auth|session|cookie|email|key|code|signature|jwt|credential/i.test(
        key,
      )
    )
      url.searchParams.delete(key);
  url.searchParams.sort();
  return url.toString();
}
export function viewContext(input: any, project: any) {
  const url = normalizeUrl(input.url),
    u = new URL(url);
  if ((project.captureMode ?? "origins") !== "any" && !project.origins.includes(u.origin))
    fail("ORIGIN_NOT_ALLOWED", "This exact website origin is not approved", 403);
  const deviceClass =
    input.viewport.width < 600
      ? "mobile"
      : input.viewport.width < 1000
        ? "tablet"
        : "desktop";
  const fingerprint = hash(
    JSON.stringify([
      url,
      deviceClass,
      input.anchor?.recordIdentity ?? "",
      input.anchor?.fingerprint ??
        input.anchor?.selector ??
        (input.anchor?.screenshotPoint
          ? JSON.stringify([input.scroll ?? null, input.anchor.screenshotPoint])
          : ""),
    ]),
  );
  const hostname = u.hostname.toLowerCase();
  return {
    ...input,
    url,
    origin: u.origin,
    hostname,
    domain: getDomain(hostname, { allowPrivateDomains: true })?.toLowerCase() ?? hostname,
    subdomain:
      getSubdomain(hostname, { allowPrivateDomains: true })?.toLowerCase() ?? null,
    port: u.port || null,
    path: u.pathname,
    deviceClass,
    fingerprint,
  };
}
export async function viewStats(
  db: Database,
  a: Actor,
  projectId: string,
  fingerprint: string,
) {
  const row = await db.one(
    "SELECT count(*)::integer AS count,bool_or(user_id=$3) AS liked FROM view_likes WHERE project_id=$1 AND fingerprint=$2",
    [projectId, fingerprint, a.userId],
  );
  const comments = await db.one(
    "SELECT (count(*)+(SELECT count(*) FROM replies r JOIN threads t ON t.id=r.thread_id WHERE t.project_id=$1 AND t.data->'context'->>'fingerprint'=$2))::integer AS count FROM threads WHERE project_id=$1 AND data->'context'->>'fingerprint'=$2",
    [projectId, fingerprint],
  );
  const result: any = {
    fingerprint,
    uniqueLikes: row.count,
    liked: !!row.liked,
    discussionCount: comments.count,
  };
  if (canReadPolicy(a)) {
    const values = await db.query(
      "SELECT u.policy,g.policy AS override FROM view_likes v JOIN users u ON u.id=v.user_id LEFT JOIN grants g ON g.user_id=u.id AND g.project_id=v.project_id WHERE v.project_id=$1 AND v.fingerprint=$2",
      [projectId, fingerprint],
    );
    result.weightedPreference = values.reduce(
      (sum, u) => sum + (u.override?.general ?? u.policy.general ?? 1),
      0,
    );
  }
  return result;
}
export async function views(db: Database, a: Actor, op: string, i: any) {
  const p = await access(db, a, i.projectId, op === "views.like" ? "write" : "read");
  const context = viewContext(i.context, p);
  if (op === "views.like") {
    if (a.kind === "agent") fail("FORBIDDEN", "Likes belong to human reviewers", 403);
    if (i.liked)
      await db.query(
        "INSERT INTO view_likes(project_id,fingerprint,user_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
        [i.projectId, context.fingerprint, a.userId],
      );
    else
      await db.query(
        "DELETE FROM view_likes WHERE project_id=$1 AND fingerprint=$2 AND user_id=$3",
        [i.projectId, context.fingerprint, a.userId],
      );
    await event(db, a, i.projectId, context.fingerprint, "view.like", {
      liked: i.liked,
    });
  }
  return viewStats(db, a, i.projectId, context.fingerprint);
}
