import type { Database } from "./db.js";
import type { Config } from "./config.js";
import { hash } from "./auth.js";
import { fail } from "./errors.js";
import { requireTurnstile } from "./guest-links.js";

export async function widgetLink(
  db: Database,
  linkId: string,
  origin: string,
  token?: string,
) {
  const row = await db.one(
    `SELECT g.*,p.data AS project FROM guest_project_links g
     JOIN projects p ON p.id=g.project_id
     WHERE g.id=$1 AND g.widget_enabled=true AND g.revoked_at IS NULL
       AND g.expires_at>now() AND g.submissions<g.max_submissions`,
    [linkId],
  );
  if (!row) fail("INVALID_LINK", "This widget link is no longer available", 410);
  if (row.project.captureMode === "any" || !row.project.origins.includes(origin))
    fail("ORIGIN_DENIED", "This website is not approved for the widget", 403);
  if (token !== undefined && hash(token) !== row.hash)
    fail("INVALID_LINK", "This widget link is no longer available", 410);
  return row;
}

export async function widgetInspect(
  db: Database,
  input: { linkId: string; token: string },
  origin: string,
  config: Config,
) {
  const link = await widgetLink(db, input.linkId, origin, input.token);
  const { siteKey } = requireTurnstile(config);
  return { projectName: link.project.name, turnstileSiteKey: siteKey };
}
