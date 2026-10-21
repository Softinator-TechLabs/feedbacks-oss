import { builtInCategories } from "../shared/taxonomy.js";
import { defaultBoardConfiguration, type BoardColumn } from "../shared/board.js";
import type { Actor } from "../shared/contracts.js";
import type { AnalyticsInput, AnalyticsReport } from "../shared/analytics.js";
import { analyticsDimensions, analyticsMetrics } from "../shared/analytics.js";
import { analyticsInputs } from "../shared/contracts/domains/analytics.js";
import type { Database } from "./db.js";
import { access } from "./access.js";
import { fail } from "./errors.js";

const dayMs = 86400000;
const activeStates = new Set(["open", "in_progress", "ready_for_review"]);
type Metric = (typeof analyticsMetrics)[number];
type Dimension = (typeof analyticsDimensions)[number];
export type AnalyticsRecord = {
  id: string;
  projectId: string;
  projectName: string;
  createdAt: string;
  state: string;
  archived: boolean;
  category: string;
  categoryLabel?: string;
  columns?: BoardColumn[];
  tags: string[];
  priority: string;
  origin: string;
  page: string;
  device: string;
  history: Array<{ state: string; at: string; duplicate?: boolean }>;
  firstResponse: string | null;
  firstTriage: string | null;
  assignees: Array<{ id: string; name: string }>;
};
const instant = (value: string | null | undefined) => (value ? Date.parse(value) : NaN);
const iso = (value: unknown) => (value ? new Date(value as string).toISOString() : null);

function distribution(values: number[]) {
  values.sort((a, b) => a - b);
  const size = values.length;
  return {
    sample: size,
    medianHours: size
      ? (values[Math.floor((size - 1) / 2)] + values[Math.ceil((size - 1) / 2)]) / 2
      : null,
    p90Hours: size ? values[Math.ceil(size * 0.9) - 1] : null,
    smallSample: size > 0 && size < 5,
  };
}
function pageLabel(value: unknown) {
  try {
    const url = new URL(String(value));
    return ["http:", "https:"].includes(url.protocol)
      ? url.origin + url.pathname
      : "Unknown";
  } catch {
    return "Unknown";
  }
}

/** Pure projection; server supplies only records from currently accessible projects. */
export function buildAnalytics(
  records: AnalyticsRecord[],
  input: AnalyticsInput,
  generatedAt = new Date().toISOString(),
  projectCount = new Set(records.map((row) => row.projectId)).size,
): AnalyticsReport {
  const from = instant(input.from),
    to = instant(input.to),
    now = instant(generatedAt);
  const inPeriod = (at: number) =>
    Number.isFinite(at) && at >= from && at < to && at <= now;
  const dateFormat = new Intl.DateTimeFormat("en-CA", {
    timeZone: input.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const day = (at: number) => dateFormat.format(new Date(at));
  const trend = new Map<
    string,
    {
      date: string;
      incoming: number;
      triaged: number;
      resolved: number;
      reopened: number;
      declined: number;
      duplicate: number;
    }
  >();
  // Seed local calendar days from UTC instants; include DST boundaries and empty days.
  for (let at = from; at < to; at += dayMs / 2) {
    const date = day(at);
    trend.set(date, {
      date,
      incoming: 0,
      triaged: 0,
      resolved: 0,
      reopened: 0,
      declined: 0,
      duplicate: 0,
    });
  }
  const lastDate = day(to - 1);
  if (!trend.has(lastDate))
    trend.set(lastDate, {
      date: lastDate,
      incoming: 0,
      triaged: 0,
      resolved: 0,
      reopened: 0,
      declined: 0,
      duplicate: 0,
    });
  const selected = Object.fromEntries(
    analyticsMetrics.map((metric) => [metric, new Set<string>()]),
  ) as Record<Metric, Set<string>>;
  const dimensions = new Map<
    string,
    Record<Dimension, Array<{ key: string; label: string }>>
  >();
  const firstResponse: number[] = [],
    firstTriage: number[] = [],
    firstResolution: number[] = [];
  function add(metric: Metric, record: AnalyticsRecord, at?: number) {
    selected[metric].add(record.id);
    if (at !== undefined && metric !== "backlog" && metric !== "stalled") {
      const bucket = trend.get(day(at));
      if (bucket) bucket[metric]++;
    }
  }
  for (const record of records) {
    const created = instant(record.createdAt);
    const columns = record.columns ?? defaultBoardConfiguration.columns;
    const columnFor = (state: string) =>
      columns.find((column) => column.states.some((item) => item === state));
    const currentColumn = columnFor(record.state);
    const history = record.history
      .filter(
        (entry) =>
          Number.isFinite(instant(entry.at)) &&
          instant(entry.at) >= created &&
          instant(entry.at) <= now,
      )
      .sort((a, b) => instant(a.at) - instant(b.at));
    const triage = Math.min(
      ...[
        instant(record.firstTriage),
        ...history
          .filter((entry) => entry.state !== "open")
          .map((entry) => instant(entry.at)),
      ].filter((at) => Number.isFinite(at) && at >= created && at <= now),
    );
    if (inPeriod(created)) add("incoming", record, created);
    if (inPeriod(triage)) add("triaged", record, triage);
    const marks: Partial<Record<Metric, Set<string>>> = {};
    let previous = "open",
      previousDuplicate = false;
    for (const entry of history) {
      const at = instant(entry.at);
      const metrics: Metric[] = [];
      if (entry.state === "resolved" && previous !== "resolved") metrics.push("resolved");
      if (entry.state === "declined" && previous !== "declined") metrics.push("declined");
      if (!activeStates.has(previous) && activeStates.has(entry.state))
        metrics.push("reopened");
      if (entry.duplicate && !previousDuplicate) metrics.push("duplicate");
      if (inPeriod(at))
        for (const metric of metrics) {
          // Each period total is distinct threads. Daily totals are distinct per day,
          // so a thread resolved on two different days appears in both daily rows.
          const date = day(at);
          marks[metric] ??= new Set();
          if (!marks[metric]!.has(date)) {
            add(metric, record, at);
            marks[metric]!.add(date);
          }
        }
      previous = entry.state;
      previousDuplicate = !!entry.duplicate;
    }
    const age = Math.max(0, Math.floor((now - created) / dayMs));
    const ageKey =
      age < 3 ? "0-2" : age < 8 ? "3-7" : age < 15 ? "8-14" : age < 31 ? "15-30" : "31+";
    const one = (key: string, label = key) => [{ key, label }];
    dimensions.set(record.id, {
      category: one(
        record.category || "Unknown",
        record.categoryLabel ??
          builtInCategories.find((item) => item.id === record.category)?.name ??
          (record.category || "Unknown"),
      ),
      tag: record.tags.length
        ? [...new Set(record.tags)].map((key) => ({ key, label: key }))
        : one("Untagged"),
      priority: one(record.priority || "normal"),
      project: one(record.projectId, record.projectName),
      origin: one(record.origin || "Unknown"),
      page: one(pageLabel(record.page)),
      browser: one("Unknown"),
      device: one(record.device || "Unknown"),
      state: one(record.state || "Unknown"),
      column: one(
        `${record.projectId}:${currentColumn?.id ?? record.state}`,
        `${record.projectName} · ${currentColumn?.name ?? record.state}`,
      ),
      age: one(ageKey, `${ageKey} days`),
      assignee: record.assignees.length
        ? record.assignees.map((member) => ({ key: member.id, label: member.name }))
        : one("unassigned", "Unassigned"),
    });
    if (!record.archived && activeStates.has(record.state)) {
      add("backlog", record);
      // Interpret retained work history through the current board mapping. A
      // transition between states in one column does not restart column dwell.
      let stateSince = created,
        prior = columnFor("open")?.id ?? "open";
      for (const entry of history) {
        const column = columnFor(entry.state)?.id ?? entry.state;
        if (column !== prior) stateSince = instant(entry.at);
        prior = column;
      }
      if (now - stateSince >= 7 * dayMs) add("stalled", record);
    }
    if (inPeriod(created)) {
      const response = instant(record.firstResponse);
      const resolved = history.find((entry) => entry.state === "resolved");
      if (response >= created && response <= now)
        firstResponse.push((response - created) / 3600000);
      if (Number.isFinite(triage)) firstTriage.push((triage - created) / 3600000);
      if (resolved) firstResolution.push((instant(resolved.at) - created) / 3600000);
    }
  }
  const breakdowns = {} as AnalyticsReport["breakdowns"];
  for (const dimension of analyticsDimensions) {
    const totals = new Map<string, { key: string; label: string; count: number }>();
    const cohort = ["state", "column", "age", "assignee"].includes(dimension)
      ? selected.backlog
      : selected.incoming;
    for (const id of cohort)
      for (const value of dimensions.get(id)![dimension]) {
        const existing = totals.get(value.key) ?? { ...value, count: 0 };
        existing.count++;
        totals.set(value.key, existing);
      }
    const rows = [...totals.values()].sort((a, b) =>
      dimension === "assignee"
        ? a.label.localeCompare(b.label)
        : b.count - a.count || a.label.localeCompare(b.label),
    );
    breakdowns[dimension] = rows.slice(0, 30);
    if (rows.length > 30)
      breakdowns[dimension].push({
        key: null,
        label: "Other",
        count: rows.slice(30).reduce((sum, row) => sum + row.count, 0),
      });
  }
  let details: AnalyticsReport["details"] = null;
  if (input.detail) {
    const detail = input.detail;
    const matching = records
      .filter(
        (record) =>
          selected[detail.metric].has(record.id) &&
          (!detail.dimension ||
            dimensions
              .get(record.id)!
              [detail.dimension].some((value) => value.key === detail.key)),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
    details = {
      total: matching.length,
      nextOffset:
        detail.offset + detail.limit < matching.length
          ? detail.offset + detail.limit
          : null,
      items: matching
        .slice(detail.offset, detail.offset + detail.limit)
        .map((record) => ({
          id: record.id,
          projectId: record.projectId,
          projectName: record.projectName,
          state: record.state,
          column: dimensions.get(record.id)!.column[0].label,
          createdAt: record.createdAt,
          ageDays: Math.max(0, Math.floor((now - instant(record.createdAt)) / dayMs)),
        })),
    };
  }
  return {
    generatedAt,
    period: { from: input.from, to: input.to, timeZone: input.timeZone },
    projectCount,
    coverage: "current_records_and_recorded_history",
    counts: Object.fromEntries(
      analyticsMetrics.map((metric) => [metric, selected[metric].size]),
    ) as AnalyticsReport["counts"],
    durations: {
      firstResponse: distribution(firstResponse),
      firstTriage: distribution(firstTriage),
      firstResolution: distribution(firstResolution),
    },
    trend: [...trend.values()].sort((a, b) => a.date.localeCompare(b.date)),
    breakdowns,
    details,
    notes: [
      "Period bounds are inclusive from and exclusive to. Period totals count distinct threads; daily totals count distinct threads per local day and can sum above period totals.",
      "Incoming means created in the period. Triaged means first recorded organization, planning, assignment, priority change or departure from Open; classification supplied during capture alone has no separate recorded triage time. Reopened means a recorded closed-to-active transition. Resolved, declined and duplicate count recorded transitions independently.",
      "Backlog, state, column, age, assignee and stalled are current non-archived active threads, independent of the date filter. Stalled means at least seven elapsed days in the current board column, deriving retained status history through the current column mapping. Changes between states within one column do not reset dwell. This is not historical board-configuration reconstruction or time since discussion activity.",
      "Category, tag, priority, project, origin, page, browser and device describe the incoming cohort using current metadata. Tag and assignee rows overlap. Page URLs omit credentials, query strings and fragments. Browser was not collected and is Unknown.",
      "Durations are elapsed hours from creation for threads created in the period, to their first currently retained response, first recorded triage or first resolution, observed up to generation time. Incomplete observations are excluded; samples under five are marked. Median averages the middle pair; P90 uses nearest rank.",
      "Response means a retained response-intent reply by another participant (or a legacy agent reply). Deleted replies and threads disappear from analytics. Edits, moves, archival and later classification changes can change historical reports; original first-triage events may be unavailable after a project move.",
      "Reads are live with no analytics cache or additional retention. No historical backlog snapshot or employee performance ranking is inferred. Current assignment is workload only. Breakdowns show thirty rows plus Other; all totals and drilldowns use the complete bounded cohort.",
    ],
  };
}

export async function analyticsGet(
  db: Database,
  actor: Actor,
  raw: AnalyticsInput,
): Promise<AnalyticsReport> {
  const input = analyticsInputs["analytics.get"].parse(raw);
  if (actor.mustChangePassword)
    fail(
      "PASSWORD_CHANGE_REQUIRED",
      "Replace your temporary password before continuing",
      403,
    );
  if (input.projectId) await access(db, actor, input.projectId);
  const projects = await db.query(
    `SELECT p.id,p.data->>'name' AS name,p.data->'taxonomy'->'categories' AS categories,b.configuration AS board FROM projects p LEFT JOIN project_boards b ON b.project_id=p.id
     WHERE ($1::boolean OR EXISTS(SELECT 1 FROM grants g WHERE g.project_id=p.id AND g.user_id=$2))
     AND ($3::jsonb IS NULL OR $3::jsonb ? p.id::text) AND ($4::uuid IS NULL OR p.id=$4)
     ORDER BY p.id LIMIT 1001`,
    [
      !!actor.owner,
      actor.userId,
      actor.projects ? JSON.stringify(actor.projects) : null,
      input.projectId ?? null,
    ],
  );
  if (projects.length > 1000)
    fail(
      "VALIDATION",
      "Select a project to analyze a workspace with more than 1,000 projects",
    );
  const generatedAt = new Date().toISOString();
  if (!projects.length) return buildAnalytics([], input, generatedAt, 0);
  const projectIds = projects.map((project) => project.id);
  const condition = `t.project_id=ANY($1::uuid[]) AND t.created_at <= $3::timestamptz
    AND (t.created_at >= $2::timestamptz OR t.updated_at >= $2::timestamptz OR
    (COALESCE(t.data->'archived','false'::jsonb)='false'::jsonb AND COALESCE(t.data->'work'->>'state','open') IN ('open','in_progress','ready_for_review')))`;
  const params = [projectIds, input.from, generatedAt];
  const size = await db.one(
    `SELECT count(*)::integer AS threads,COALESCE(sum(jsonb_array_length(COALESCE(t.data->'work'->'history','[]'::jsonb))),0) AS history FROM (SELECT t.data FROM threads t WHERE ${condition} LIMIT 10001) t`,
    params,
  );
  if (size.threads > 10000 || size.history > 100000)
    fail(
      "VALIDATION",
      "Analytics exceeds 10,000 threads or 100,000 history entries. Select a project or shorter period; no sampled totals are shown.",
    );
  const rows = await db.query(
    `SELECT t.id,t.project_id,t.created_at,
    t.data->>'category' AS category,t.data->'tags' AS tags,t.data->>'archived' AS archived,
    COALESCE(t.data->'work'->>'state','open') AS state,t.data->'workPlan'->>'priority' AS priority,
    t.data->>'topPriority' AS top_priority,t.data->'context'->>'origin' AS origin,
    t.data->'context'->>'url' AS page,t.data->'context'->>'deviceClass' AS device,
    (SELECT jsonb_agg(jsonb_build_object('state',h->>'state','at',h->>'at','duplicate',h->>'duplicateOf' IS NOT NULL)) FROM jsonb_array_elements(COALESCE(t.data->'work'->'history','[]'::jsonb)) h) AS history,
    (SELECT min(r.created_at) FROM replies r WHERE r.thread_id=t.id
      AND COALESCE(r.data->'author'->>'userId','')<>COALESCE(t.data->'author'->>'userId','')
      AND (r.data->>'intent'='response' OR (r.data->>'intent' IS NULL AND r.data->'author'->>'kind'='agent'))) AS first_response
    FROM threads t WHERE ${condition} ORDER BY t.id LIMIT 10001`,
    params,
  );
  if (rows.length > 10000)
    fail(
      "VALIDATION",
      "Analytics exceeds 10,000 threads. Select a project or shorter period; no sampled totals are shown.",
    );
  const triage = await db.query(
    `SELECT t.id,min(e.created_at) AS at FROM threads t JOIN events e
    ON e.project_id=t.project_id AND (e.entity_id=t.id::text OR e.data->>'threadId'=t.id::text)
    AND e.kind IN ('threads.organize','threads.plan','threads.priority','assignments.assign')
    WHERE ${condition} GROUP BY t.id`,
    params,
  );
  const assignments = await db.query(
    `SELECT DISTINCT d.thread_id,d.user_id,u.name FROM work_delegations d
    JOIN users u ON u.id=d.user_id JOIN threads t ON t.id=d.thread_id
    WHERE ${condition} AND d.project_id=t.project_id AND d.state='active'
    AND (jsonb_array_length(d.annotation_ids)=0 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(d.annotation_ids) point WHERE COALESCE(t.data->'annotationStates'->point->>'state','open')='open')) LIMIT 100001`,
    params,
  );
  if (assignments.length > 100000)
    fail(
      "VALIDATION",
      "Analytics exceeds 100,000 active assignment pairs. Select a project or shorter period; no sampled totals are shown.",
    );
  const triageMap = new Map(triage.map((row) => [row.id, iso(row.at)]));
  const members = new Map<string, Array<{ id: string; name: string }>>();
  for (const assignment of assignments) {
    const current = members.get(assignment.thread_id) ?? [];
    current.push({ id: assignment.user_id, name: assignment.name });
    members.set(assignment.thread_id, current);
  }
  const names = new Map(
    projects.map((project) => [project.id, project.name ?? "Project"]),
  );
  return buildAnalytics(
    rows.map((row) => {
      const at = triageMap.get(row.id) ?? null;
      return {
        id: row.id,
        projectId: row.project_id,
        projectName: names.get(row.project_id)!,
        createdAt: iso(row.created_at)!,
        state: row.state,
        archived: row.archived === "true",
        category: row.category ?? "Unknown",
        categoryLabel: projects
          .find((project) => project.id === row.project_id)
          ?.categories?.find(
            (category: { id: string; name: string }) => category.id === row.category,
          )?.name,
        columns: projects.find((project) => project.id === row.project_id)?.board
          ?.columns,
        tags: row.tags ?? [],
        priority: row.top_priority === "true" ? "top" : (row.priority ?? "normal"),
        origin: row.origin ?? "Unknown",
        page: row.page ?? "",
        device: row.device ?? "Unknown",
        history: row.history ?? [],
        firstResponse: iso(row.first_response),
        firstTriage: at,
        assignees: members.get(row.id) ?? [],
      };
    }),
    input,
    generatedAt,
    projects.length,
  );
}
