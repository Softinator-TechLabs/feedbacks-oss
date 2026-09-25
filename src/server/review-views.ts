import { randomUUID } from "node:crypto";
import type { Database } from "./db.js";
import type { Actor, ReviewFilters } from "../shared/contracts.js";
import { access } from "./access.js";
import { fail } from "./errors.js";
import { normalizeUrl } from "./views.js";

// A priority queue is available only with policy-reading authority. It uses
// current category importance for the author plus the weighted likes on that
// captured view. Keep the expression shared by list pagination and neighbors.
const category = "COALESCE(threads.data->>'category','general')";
const policyWeight = (user: string, grant: string) =>
  `COALESCE((${grant}.policy->>${category})::double precision,(${grant}.policy->>'general')::double precision,(${user}.policy->>${category})::double precision,(${user}.policy->>'general')::double precision,1::double precision)`;
export const priorityScore = `(
  COALESCE((SELECT ${policyWeight("author_user", "author_grant")}
    FROM users author_user LEFT JOIN grants author_grant
    ON author_grant.user_id=author_user.id AND author_grant.project_id=threads.project_id
    WHERE author_user.id=(threads.data->'author'->>'userId')::uuid),1::double precision)
  + COALESCE((SELECT SUM(${policyWeight("voter_user", "voter_grant")})
    FROM view_likes vote JOIN users voter_user ON voter_user.id=vote.user_id
    LEFT JOIN grants voter_grant ON voter_grant.user_id=voter_user.id
      AND voter_grant.project_id=vote.project_id
    WHERE vote.project_id=threads.project_id
      AND vote.fingerprint=threads.data->'context'->>'fingerprint'),0::double precision)
)`;

// One predicate/order for the inbox and cross-page keyboard navigation.
export function threadQuery(projectId: string, i: ReviewFilters) {
  const args: unknown[] = [projectId];
  let filter = "project_id=$1 AND COALESCE((data->>'archived')::boolean,false)=false";
  if (i.search) {
    args.push(`%${i.search}%`);
    filter += ` AND (data->>'body' ILIKE $${args.length} OR EXISTS(SELECT 1 FROM replies r WHERE r.thread_id=threads.id AND r.data->>'body' ILIKE $${args.length}))`;
  }
  if (!i.showResolved)
    filter += " AND data->'work'->>'state' NOT IN ('resolved','declined')";
  for (const key of ["url", "domain", "hostname", "deviceClass"] as const) {
    if (!i[key]) continue;
    args.push(key === "url" ? normalizeUrl(i.url!) : i[key]!.toLowerCase());
    filter += ` AND data->'context'->>'${key}'=$${args.length}`;
  }
  if (i.category) {
    args.push(i.category);
    filter += ` AND COALESCE(data->>'category','general')=$${args.length}`;
  }
  if (i.tag) {
    args.push(JSON.stringify([i.tag]));
    filter += ` AND data->'tags' @> $${args.length}::jsonb`;
  }
  const order =
    (i.sort === "newest"
      ? "created_at DESC"
      : i.sort === "likes"
        ? "(SELECT count(*) FROM view_likes v WHERE v.project_id=threads.project_id AND v.fingerprint=threads.data->'context'->>'fingerprint') DESC,updated_at DESC"
        : i.sort === "priority"
          ? `CASE WHEN threads.data->'work'->>'state' IN ('resolved','declined') THEN 1 ELSE 0 END,${priorityScore} DESC,updated_at DESC`
          : "updated_at DESC") + ",id";
  return { filter, args, order };
}

export async function reviewViews(db: Database, a: Actor, op: string, i: any) {
  await access(db, a, i.projectId);
  // Personal preferences are scoped to the authenticated user, including owner keys.
  if (op === "reviewViews.list")
    return {
      items: await db.query(
        "SELECT id,name,filters,revision FROM review_views WHERE project_id=$1 AND user_id=$2 ORDER BY lower(name),id",
        [i.projectId, a.userId],
      ),
    };
  if (i.viewId) {
    const row = await db.one(
      "SELECT * FROM review_views WHERE id=$1 AND project_id=$2 AND user_id=$3 FOR UPDATE",
      [i.viewId, i.projectId, a.userId],
    );
    if (!row) fail("NOT_FOUND", "Saved view not found", 404);
    if (row.revision !== i.revision)
      fail("CONFLICT", "Saved view changed; reload before retrying", 409);
    if (op === "reviewViews.delete") {
      await db.query("DELETE FROM review_views WHERE id=$1", [row.id]);
      return { deleted: true };
    }
    return db.one(
      "UPDATE review_views SET name=$1,filters=$2,revision=revision+1 WHERE id=$3 RETURNING id,name,filters,revision",
      [i.name, JSON.stringify(i.filters), row.id],
    );
  }
  if (i.revision !== 0) fail("VALIDATION", "A new saved view starts at revision 0");
  // Operations holds the account lock: parallel creates cannot bypass this quota.
  const count = await db.one(
    "SELECT count(*)::integer AS total FROM review_views WHERE user_id=$1 AND project_id=$2",
    [a.userId, i.projectId],
  );
  if (count.total >= 30)
    fail("LIMIT_REACHED", "Keep up to 30 saved views per project; remove one first", 409);
  return db.one(
    "INSERT INTO review_views(id,project_id,user_id,name,filters) VALUES($1,$2,$3,$4,$5) RETURNING id,name,filters,revision",
    [randomUUID(), i.projectId, a.userId, i.name, JSON.stringify(i.filters)],
  );
}
