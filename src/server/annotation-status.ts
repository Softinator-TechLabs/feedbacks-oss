import type { Actor, ReviewFilters } from "../shared/contracts.js";
import type { Database } from "./db.js";
import { access } from "./access.js";
import { publicActor } from "./auth.js";
import { fail } from "./errors.js";
import { threadQuery } from "./review-views.js";

// Keep captured notes and pixel evidence immutable. Decisions are separately
// attributed and every change is emitted by saveThread into the event history.
export async function setAnnotationStatus(
  db: Database,
  actor: Actor,
  row: any,
  input: any,
) {
  if (
    !row.data.context.annotations?.some((point: any) => point.id === input.annotationId)
  )
    fail("NOT_FOUND", "Point not found in this thread", 404);
  const previous = row.data.annotationStates?.[input.annotationId]?.state ?? "open";
  await access(
    db,
    actor,
    row.project_id,
    input.state === "removed" || previous === "removed" ? "maintain" : "resolve",
  );
  if (
    ["resolved", "declined"].includes(row.data.work.state) &&
    input.state === "open" &&
    previous !== "removed"
  )
    fail("VALIDATION", "Reopen the thread before reopening one of its points");
  row.data.annotationStates ??= {};
  row.data.annotationStates[input.annotationId] = {
    state: input.state,
    actor: publicActor(actor),
    at: new Date().toISOString(),
  };
}

export async function setAnnotationPlan(
  db: Database,
  actor: Actor,
  row: any,
  input: any,
) {
  if (
    !row.data.context.annotations?.some((point: any) => point.id === input.annotationId)
  )
    fail("NOT_FOUND", "Point not found in this thread", 404);
  await access(db, actor, row.project_id, "write");
  if (
    ["resolved", "declined"].includes(row.data.work.state) ||
    (row.data.annotationStates?.[input.annotationId]?.state ?? "open") !== "open"
  )
    fail("VALIDATION", "Reopen the point and thread before planning it");
  row.data.annotationPlans ??= {};
  row.data.annotationPlans[input.annotationId] = input.workPlan;
}

export async function annotationSummary(
  db: Database,
  projectId: string,
  filters: ReviewFilters,
) {
  // Status totals describe all matching feedback even when the list hides closed
  // threads. Compute before LIMIT/OFFSET; never infer totals from loaded pins.
  const { filter, args } = threadQuery(projectId, { ...filters, showResolved: true });
  const result = await db.one(
    `WITH matched AS (
    SELECT data FROM threads WHERE ${filter}
  ), points AS (
    SELECT CASE
      WHEN data->'annotationStates'->(point->>'id')->>'state'='removed' THEN 'removed'
      WHEN data->'work'->>'state'='declined' THEN 'closed'
      WHEN data->'work'->>'state'='resolved' OR data->'annotationStates'->(point->>'id')->>'state'='resolved' THEN 'resolved'
      ELSE 'open' END AS state
    FROM matched CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_array_length(COALESCE(data->'context'->'annotations','[]'::jsonb)) > 0
        THEN data->'context'->'annotations'
        WHEN data->'context'->'anchor' IS NOT NULL THEN '[{}]'::jsonb
        ELSE '[]'::jsonb END
    ) point
  ) SELECT
    (SELECT count(*)::integer FROM matched) AS threads_total,
    (SELECT count(*)::integer FROM matched WHERE data->'work'->>'state' IN ('resolved','declined')) AS threads_closed,
    count(*) FILTER (WHERE state='open')::integer AS points_open,
    count(*) FILTER (WHERE state='resolved')::integer AS points_resolved,
    count(*) FILTER (WHERE state='closed')::integer AS points_closed,
    count(*) FILTER (WHERE state='removed')::integer AS points_removed
  FROM points`,
    args,
  );
  return {
    threads: {
      total: result.threads_total,
      closed: result.threads_closed,
      open: result.threads_total - result.threads_closed,
    },
    points: {
      total: result.points_open + result.points_resolved + result.points_closed,
      open: result.points_open,
      resolved: result.points_resolved,
      closed: result.points_closed,
      removed: result.points_removed,
    },
  };
}
