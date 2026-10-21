import React, { useEffect, useRef, useState } from "react";
import { api, type Project } from "../api.js";
import { ErrorNotice, Field, Loading, useLoad } from "../ui.js";
import { SectionTabs, type SectionTab } from "../section-tabs.js";
import {
  analyticsCsv,
  analyticsDateBoundary,
  type AnalyticsInput,
  type AnalyticsReport,
} from "../../shared/analytics.js";
import "./analytics.css";

type Metric = keyof AnalyticsReport["counts"];
type Dimension = keyof AnalyticsReport["breakdowns"];
type Tab = "overview" | "trends" | "explore";
type Inspect = (
  metric: Metric,
  filter?: { dimension: Dimension; key: string },
  originId?: string,
) => void;
const tabs: SectionTab<Tab>[] = [
  { id: "overview", label: "Overview", panelId: "analytics-overview" },
  { id: "trends", label: "Trends", panelId: "analytics-trends" },
  { id: "explore", label: "Explore", panelId: "analytics-explore" },
];
const metricLabels: Record<Metric, string> = {
  incoming: "Incoming",
  triaged: "First triaged",
  resolved: "Resolved",
  reopened: "Reopened",
  declined: "Declined",
  duplicate: "Marked duplicate",
  backlog: "Pending tasks now",
  overdue: "Overdue tasks now",
  high_priority: "High priority tasks now",
  stalled: "In the same column for 7+ days",
};
const dimensionLabels: Record<Dimension, string> = {
  category: "Category",
  tag: "Tag",
  priority: "Priority",
  project: "Project",
  origin: "Origin",
  page: "Page",
  browser: "Browser",
  device: "Device",
  state: "Current state",
  column: "Current board column",
  age: "Backlog age",
  assignee: "Current assignee",
};
const currentMetrics = [
  { metric: "backlog", label: "Pending", note: "Tasks to finish" },
  { metric: "overdue", label: "Overdue", note: "Past planned date" },
  { metric: "high_priority", label: "High priority", note: "High or top priority" },
  { metric: "stalled", label: "Stalled", note: "7+ days in one column" },
] as const;
const periodMetrics = [
  "incoming",
  "resolved",
  "triaged",
  "reopened",
  "declined",
  "duplicate",
] as const;
const projectMetrics = [
  { metric: "backlog", key: "pending", label: "Pending" },
  { metric: "overdue", key: "overdue", label: "Overdue" },
  { metric: "high_priority", key: "highPriority", label: "High priority" },
] as const;
const shiftDay = (day: string, amount: number) =>
  new Date(Date.parse(`${day}T12:00:00Z`) + amount * 86400000).toISOString().slice(0, 10);
const dayAt = (date: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
function initialPreferences(key: string) {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    today = dayAt(new Date(), timeZone);
  const defaults = {
    fromDay: shiftDay(today, -29),
    throughDay: today,
    timeZone,
    tab: "overview" as Tab,
  };
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? "null");
    if (
      saved &&
      typeof saved.fromDay === "string" &&
      typeof saved.throughDay === "string" &&
      typeof saved.timeZone === "string"
    ) {
      const from = analyticsDateBoundary(saved.fromDay, saved.timeZone),
        to = analyticsDateBoundary(shiftDay(saved.throughDay, 1), saved.timeZone);
      if (
        Date.parse(to) > Date.parse(from) &&
        Date.parse(to) - Date.parse(from) <= 366 * 86400000
      )
        return {
          fromDay: saved.fromDay as string,
          throughDay: saved.throughDay as string,
          timeZone: saved.timeZone as string,
          tab: tabs.some((tab) => tab.id === saved.tab)
            ? (saved.tab as Tab)
            : ("overview" as Tab),
        };
    }
  } catch {}
  return defaults;
}
const hours = (value: number | null) =>
  value === null
    ? "—"
    : `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value)} h`;

function ProjectTaskChart({
  rows,
  page,
  onPage,
  inspect,
}: {
  rows: AnalyticsReport["currentProjects"];
  page: number;
  onPage: (page: number) => void;
  inspect: Inspect;
}) {
  const pageSize = 8,
    currentPage = Math.min(page, Math.max(0, Math.ceil(rows.length / pageSize) - 1)),
    offset = currentPage * pageSize,
    visible = rows.slice(offset, offset + pageSize),
    maximum = rows.reduce((max, row) => Math.max(max, row.pending), 0);
  return (
    <section className="analytics-projects" aria-labelledby="analytics-projects-title">
      <div className="analytics-section-head">
        <h2 id="analytics-projects-title">Pending tasks by project</h2>
        <span className="muted analytics-project-scale">
          Common scale: 0–{maximum} tasks
        </span>
      </div>
      <p className="analytics-short-note">Overdue and high priority may overlap.</p>
      <ul className="analytics-project-list">
        {visible.map((project) => (
          <li key={project.projectId}>
            <h3>{project.projectName}</h3>
            <div className="analytics-project-bars">
              {projectMetrics.map(({ metric, key, label }) => {
                const count = project[key],
                  originId = `analytics-project-${project.projectId}-${metric}`;
                return (
                  <button
                    key={metric}
                    id={originId}
                    type="button"
                    className="analytics-project-metric"
                    onClick={() =>
                      inspect(
                        metric,
                        { dimension: "project", key: project.projectId },
                        originId,
                      )
                    }
                    aria-label={`View ${count} ${metricLabels[metric].toLowerCase()} for ${project.projectName}`}
                  >
                    <span>{label}</span>
                    <span className="analytics-project-track" aria-hidden="true">
                      <span
                        style={{ width: `${maximum ? (count / maximum) * 100 : 0}%` }}
                      />
                    </span>
                    <strong>{count}</strong>
                  </button>
                );
              })}
            </div>
          </li>
        ))}
      </ul>
      {!rows.length && <p>No accessible projects.</p>}
      {rows.length > pageSize && (
        <nav className="analytics-pagination" aria-label="Project chart pages">
          <button
            type="button"
            aria-label="Previous projects"
            disabled={!currentPage}
            onClick={() => onPage(currentPage - 1)}
          >
            Previous
          </button>
          <span>
            Projects {offset + 1}–{offset + visible.length} of {rows.length}
          </span>
          <button
            type="button"
            aria-label="Next projects"
            disabled={offset + pageSize >= rows.length}
            onClick={() => onPage(currentPage + 1)}
          >
            Next
          </button>
        </nav>
      )}
    </section>
  );
}

function TrendChart({ report }: { report: AnalyticsReport }) {
  const maximum = Math.max(
    1,
    ...report.trend.flatMap((day) => [day.incoming, day.resolved]),
  );
  const ticks = [...new Set([maximum, Math.ceil(maximum / 2), 0])];
  const x = (index: number) =>
    report.trend.length > 1 ? (index / (report.trend.length - 1)) * 800 : 400;
  const y = (count: number) => 12 + (1 - count / maximum) * 176;
  const points = (metric: "incoming" | "resolved") =>
    report.trend.map((day, index) => `${x(index)},${y(day[metric])}`).join(" ");
  const dates = [
    ...new Set([0, Math.floor((report.trend.length - 1) / 2), report.trend.length - 1]),
  ].filter((index) => index >= 0);
  return (
    <section className="analytics-trend-chart" aria-labelledby="analytics-trend-heading">
      <div className="analytics-section-head">
        <h2 id="analytics-trend-heading">Incoming and resolved</h2>
        <div className="analytics-legend">
          <span className="analytics-legend-incoming">Incoming</span>
          <span className="analytics-legend-resolved">Resolved</span>
        </div>
      </div>
      <div className="analytics-line-frame">
        <div className="analytics-y-axis" aria-hidden="true">
          {ticks.map((tick) => (
            <span key={tick} style={{ top: `${(y(tick) / 200) * 100}%` }}>
              {tick}
            </span>
          ))}
        </div>
        <svg
          viewBox="0 0 800 200"
          preserveAspectRatio="none"
          role="img"
          aria-labelledby="analytics-line-title"
          aria-describedby="analytics-line-description"
        >
          <title id="analytics-line-title">Daily incoming and resolved threads</title>
          <desc id="analytics-line-description">
            {report.trend.length} days in {report.period.timeZone}.{" "}
            {report.counts.incoming} incoming and {report.counts.resolved} resolved
            threads in the selected period. Daily values are available in the data table.
          </desc>
          {ticks.map((tick) => (
            <line
              key={tick}
              x1="0"
              x2="800"
              y1={y(tick)}
              y2={y(tick)}
              className="analytics-grid-line"
            />
          ))}
          <polyline points={points("incoming")} className="analytics-line-incoming" />
          <polyline points={points("resolved")} className="analytics-line-resolved" />
          {report.trend.length === 1 && (
            <>
              <circle
                cx="400"
                cy={y(report.trend[0].incoming)}
                r="3"
                className="analytics-dot-incoming"
              />
              <circle
                cx="400"
                cy={y(report.trend[0].resolved)}
                r="3"
                className="analytics-dot-resolved"
              />
            </>
          )}
        </svg>
      </div>
      <div className="analytics-x-axis" aria-hidden="true">
        {dates.map((index) => (
          <span key={index}>{report.trend[index].date.slice(5)}</span>
        ))}
      </div>
      <details className="analytics-data-table">
        <summary>Daily data table</summary>
        <div className="analytics-table-wrap">
          <table>
            <caption>Distinct threads per local day</caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                {periodMetrics.map((metric) => (
                  <th scope="col" key={metric}>
                    {metricLabels[metric]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.trend.map((day) => (
                <tr key={day.date}>
                  <th scope="row">{day.date}</th>
                  {periodMetrics.map((metric) => (
                    <td key={metric}>{day[metric]}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
function DurationChart({ report }: { report: AnalyticsReport }) {
  const maximum = Math.max(
    1,
    ...Object.values(report.durations).map((value) => value.p90Hours ?? 0),
  );
  return (
    <section
      className="analytics-duration-chart"
      aria-labelledby="analytics-duration-heading"
    >
      <h2 id="analytics-duration-heading">Time from creation</h2>
      {Object.entries(report.durations).map(([key, value]) => (
        <div className="analytics-duration-row" key={key}>
          <div>
            <h3>
              {
                {
                  firstResponse: "First response",
                  firstTriage: "First triage",
                  firstResolution: "Resolution",
                }[key]
              }
            </h3>
            <span className="muted">
              {value.sample} completed{value.smallSample ? " · Small sample" : ""}
            </span>
          </div>
          <div className="analytics-duration-values">
            {value.medianHours === null ? (
              <span>No completed sample</span>
            ) : (
              <>
                <strong>Median {hours(value.medianHours)}</strong>
                <span>P90 {hours(value.p90Hours)}</span>
              </>
            )}
          </div>
          <div className="analytics-duration-track" aria-hidden="true">
            <span
              style={{
                width: `${value.medianHours === null ? 0 : (value.medianHours / maximum) * 100}%`,
              }}
            />
          </div>
        </div>
      ))}
      <p className="analytics-short-note">
        Completed observations from threads created in this period.
      </p>
    </section>
  );
}
function Totals({ report }: { report: AnalyticsReport }) {
  return (
    <section className="analytics-print" aria-label="Aggregate totals for printing">
      <p>
        Generated: {report.generatedAt} · {report.projectCount} accessible projects
      </p>
      <p>
        Period: {report.period.from} to {report.period.to} (exclusive) ·{" "}
        {report.period.timeZone}
      </p>
      <p>
        Pending, overdue, high priority and stalled counts are current snapshots,
        independent of this period.
      </p>
      <table>
        <caption>Thread counts</caption>
        <thead>
          <tr>
            <th scope="col">Metric</th>
            <th scope="col">Threads</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(report.counts).map(([key, value]) => (
            <tr key={key}>
              <th scope="row">{metricLabels[key as Metric]}</th>
              <td>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <table>
        <caption>Time to first response, triage and resolution</caption>
        <thead>
          <tr>
            <th scope="col">From creation</th>
            <th scope="col">Sample</th>
            <th scope="col">Median</th>
            <th scope="col">P90</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(report.durations).map(([key, value]) => (
            <tr key={key}>
              <th scope="row">
                {
                  {
                    firstResponse: "Response",
                    firstTriage: "Triage",
                    firstResolution: "Resolution",
                  }[key]
                }
              </th>
              <td>{value.sample}</td>
              <td>{hours(value.medianHours)}</td>
              <td>{hours(value.p90Hours)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <table>
        <caption>Distinct threads per local day</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            {periodMetrics.map((metric) => (
              <th scope="col" key={metric}>
                {metricLabels[metric]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {report.trend.map((day) => (
            <tr key={day.date}>
              <th scope="row">{day.date}</th>
              {periodMetrics.map((metric) => (
                <td key={metric}>{day[metric]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function Analytics({
  projectId,
  projects,
  userId,
}: {
  projectId?: string;
  projects: Project[];
  userId?: string;
}) {
  const preferenceKey = `feedbacks:analytics:${userId ?? "session"}:${projectId ?? "workspace"}`;
  const [preferences] = useState(() => initialPreferences(preferenceKey));
  const appliedPreferences = useRef(preferences);
  const [fromDay, setFromDay] = useState(preferences.fromDay),
    [throughDay, setThroughDay] = useState(preferences.throughDay),
    [timeZone, setTimeZone] = useState(preferences.timeZone),
    [tab, setTab] = useState<Tab>(preferences.tab);
  const [formError, setFormError] = useState("");
  const [input, setInput] = useState<AnalyticsInput>(() => ({
    ...(projectId ? { projectId } : {}),
    from: analyticsDateBoundary(preferences.fromDay, preferences.timeZone),
    to: analyticsDateBoundary(shiftDay(preferences.throughDay, 1), preferences.timeZone),
    timeZone: preferences.timeZone,
  }));
  const [detail, setDetail] = useState<AnalyticsInput["detail"]>(),
    [version, setVersion] = useState(0),
    [projectPage, setProjectPage] = useState(0);
  const detailHeading = useRef<HTMLHeadingElement>(null),
    focusAfterLoad = useRef<"detail" | "origin" | undefined>(undefined),
    inspectOrigin = useRef<string | undefined>(undefined);
  const [dimension, setDimension] = useState<Dimension>("category");
  const backlogDimension = ["state", "column", "age", "assignee"].includes(dimension);
  const requestKey = JSON.stringify({ ...input, detail });
  const result = useLoad(
    async () => ({
      key: requestKey,
      report: await api<AnalyticsReport>("analytics.get", { ...input, detail }),
    }),
    [requestKey, version],
  );
  const report = result.data?.key === requestKey ? result.data.report : undefined;
  useEffect(() => {
    try {
      localStorage.setItem(
        preferenceKey,
        JSON.stringify({ ...appliedPreferences.current, tab }),
      );
    } catch {}
  }, [preferenceKey, tab, input]);
  useEffect(() => {
    if (!report) return;
    if (focusAfterLoad.current === "detail" && detail && report.details) {
      detailHeading.current?.focus({ preventScroll: true });
      detailHeading.current?.scrollIntoView({ block: "start" });
      focusAfterLoad.current = undefined;
    } else if (focusAfterLoad.current === "origin" && !detail) {
      if (inspectOrigin.current) document.getElementById(inspectOrigin.current)?.focus();
      focusAfterLoad.current = undefined;
    }
  }, [report, detail]);
  function clearDetail() {
    focusAfterLoad.current = undefined;
    inspectOrigin.current = undefined;
    setDetail(undefined);
  }
  function selectTab(next: Tab) {
    setTab(next);
    setFormError("");
    clearDetail();
  }
  function chooseProject(value: string) {
    setFormError("");
    setInput((current) => ({ ...current, projectId: value || undefined }));
    setProjectPage(0);
    clearDetail();
  }
  function apply(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const next = {
        ...input,
        from: analyticsDateBoundary(fromDay, timeZone),
        to: analyticsDateBoundary(shiftDay(throughDay, 1), timeZone),
        timeZone,
      };
      const duration = Date.parse(next.to) - Date.parse(next.from);
      if (duration <= 0 || duration > 366 * 86400000)
        throw new Error(
          "Choose a period of at most 366 days, with the end after the start.",
        );
      appliedPreferences.current = { fromDay, throughDay, timeZone, tab };
      setFormError("");
      setInput(next);
      clearDetail();
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "Choose a valid period and timezone.",
      );
    }
  }
  function inspect(
    metric: Metric,
    filter?: { dimension: Dimension; key: string },
    originId?: string,
  ) {
    inspectOrigin.current = originId;
    focusAfterLoad.current = "detail";
    setDetail({ metric, ...filter, offset: 0, limit: 25 });
  }
  function closeList() {
    if (inspectOrigin.current) focusAfterLoad.current = "origin";
    setDetail(undefined);
  }
  function exportCsv() {
    if (!report) return;
    const url = URL.createObjectURL(
      new Blob(["\uFEFF", analyticsCsv(report)], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `feedbacks-analytics-${input.from.slice(0, 10)}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const groupRows = report?.breakdowns[dimension] ?? [],
    groupMaximum = groupRows.reduce((max, row) => Math.max(max, row.count), 0);
  return (
    <section className="analytics-page">
      <div className="analytics-head">
        <h1>Analytics</h1>
        <div className="analytics-scopebar">
          {!projectId && (
            <Field label="Project">
              <select
                aria-label="Project"
                value={input.projectId ?? ""}
                onChange={(event) => chooseProject(event.target.value)}
              >
                <option value="">All accessible projects</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <div className="analytics-actions">
            <button
              type="button"
              onClick={() => setVersion((value) => value + 1)}
              disabled={result.refreshing}
            >
              Refresh
            </button>
            <button type="button" onClick={exportCsv} disabled={!report}>
              Export totals CSV
            </button>
            <button type="button" onClick={() => window.print()} disabled={!report}>
              Print totals
            </button>
          </div>
        </div>
      </div>
      <SectionTabs
        label="Analytics views"
        idPrefix="analytics-tab"
        tabs={tabs}
        selected={tab}
        onSelect={selectTab}
      />
      {(tab === "trends" || (tab === "explore" && !backlogDimension)) && (
        <form className="analytics-filters" onSubmit={apply}>
          <Field label="From">
            <input
              type="date"
              required
              value={fromDay}
              onChange={(event) => setFromDay(event.target.value)}
            />
          </Field>
          <Field label="Through">
            <input
              type="date"
              required
              value={throughDay}
              onChange={(event) => setThroughDay(event.target.value)}
            />
          </Field>
          <Field label="Timezone">
            <input
              required
              list="analytics-timezones"
              value={timeZone}
              onChange={(event) => setTimeZone(event.target.value)}
              spellCheck={false}
            />
            <datalist id="analytics-timezones">
              {[
                ...new Set([
                  preferences.timeZone,
                  "UTC",
                  "Asia/Kolkata",
                  "America/New_York",
                  "Europe/London",
                ]),
              ].map((zone) => (
                <option key={zone} value={zone} />
              ))}
            </datalist>
          </Field>
          <button type="submit" disabled={result.refreshing}>
            Apply
          </button>
        </form>
      )}
      <ErrorNotice error={formError || result.error} />
      {result.refreshing && <Loading />}
      {report && (
        <>
          <div className="analytics-readline">
            {report.projectCount} accessible{" "}
            {report.projectCount === 1 ? "project" : "projects"} · Updated{" "}
            {new Date(report.generatedAt).toLocaleString(undefined, {
              timeZone: input.timeZone,
            })}
          </div>
          <section
            id="analytics-overview"
            role="tabpanel"
            aria-labelledby="analytics-tab-overview"
            hidden={tab !== "overview"}
          >
            <div className="analytics-panel-heading">
              <h2>Work right now</h2>
            </div>
            <div className="analytics-current-stats">
              {currentMetrics.map(({ metric, label, note }) => (
                <button
                  id={`analytics-current-${metric}`}
                  className={`analytics-stat analytics-stat-${metric}${metric === "backlog" ? " primary" : ""}`}
                  key={metric}
                  type="button"
                  onClick={() =>
                    inspect(metric, undefined, `analytics-current-${metric}`)
                  }
                  aria-label={`View ${report.counts[metric]} ${metricLabels[metric].toLowerCase()} threads`}
                >
                  <span>{label}</span>
                  <strong>{report.counts[metric]}</strong>
                  <small>{note}</small>
                </button>
              ))}
            </div>
            <ProjectTaskChart
              rows={report.currentProjects}
              page={projectPage}
              onPage={setProjectPage}
              inspect={inspect}
            />
          </section>
          <section
            id="analytics-trends"
            role="tabpanel"
            aria-labelledby="analytics-tab-trends"
            hidden={tab !== "trends"}
          >
            <div className="analytics-panel-heading">
              <h2>Feedback over time</h2>
              <p className="analytics-short-note">Selected period · {input.timeZone}</p>
            </div>
            <div className="analytics-period-stats">
              {periodMetrics.map((metric) => (
                <button
                  key={metric}
                  id={`analytics-period-${metric}`}
                  type="button"
                  onClick={() => inspect(metric, undefined, `analytics-period-${metric}`)}
                  aria-label={`View ${report.counts[metric]} ${metricLabels[metric].toLowerCase()} threads`}
                >
                  <strong>{report.counts[metric]}</strong>
                  <span>{metricLabels[metric]}</span>
                </button>
              ))}
            </div>
            <div className="analytics-trends-layout">
              <TrendChart report={report} />
              <DurationChart report={report} />
            </div>
          </section>
          <section
            id="analytics-explore"
            role="tabpanel"
            aria-labelledby="analytics-tab-explore"
            hidden={tab !== "explore"}
          >
            <div className="analytics-section-head analytics-explore-head">
              <div className="analytics-panel-heading">
                <h2>Explore feedback</h2>
                <p className="analytics-short-note">
                  {backlogDimension
                    ? "Pending now"
                    : `Incoming in selected period · ${input.timeZone}`}
                </p>
              </div>
              <Field label="Group by">
                <select
                  aria-label="Group by"
                  value={dimension}
                  onChange={(event) => {
                    setDimension(event.target.value as Dimension);
                    clearDetail();
                  }}
                >
                  {Object.entries(dimensionLabels).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <ul className="analytics-group-list">
              {groupRows.map((row, index) => (
                <li key={row.key ?? "__other__"}>
                  {row.key === null ? (
                    <div className="analytics-group-row">
                      <span>{row.label}</span>
                      <span className="analytics-project-track" aria-hidden="true">
                        <span
                          style={{
                            width: `${groupMaximum ? (row.count / groupMaximum) * 100 : 0}%`,
                          }}
                        />
                      </span>
                      <strong>{row.count}</strong>
                    </div>
                  ) : (
                    <button
                      id={`analytics-group-${dimension}-${index}`}
                      type="button"
                      className="analytics-group-row"
                      onClick={() =>
                        inspect(
                          backlogDimension ? "backlog" : "incoming",
                          { dimension, key: row.key! },
                          `analytics-group-${dimension}-${index}`,
                        )
                      }
                      aria-label={`View ${row.count} threads for ${row.label}`}
                    >
                      <span>{row.label}</span>
                      <span className="analytics-project-track" aria-hidden="true">
                        <span
                          style={{
                            width: `${groupMaximum ? (row.count / groupMaximum) * 100 : 0}%`,
                          }}
                        />
                      </span>
                      <strong>{row.count}</strong>
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {!groupRows.length && <p>No threads in this group.</p>}
            <details className="analytics-data-table">
              <summary>Group data table</summary>
              <div className="analytics-table-wrap">
                <table>
                  <caption>{dimensionLabels[dimension]}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{dimensionLabels[dimension]}</th>
                      <th scope="col">Threads</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupRows.map((row) => (
                      <tr key={row.key ?? "__other__"}>
                        <th scope="row">{row.label}</th>
                        <td>{row.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </section>
          {detail && report.details && (
            <section className="analytics-detail" aria-label="Matching threads">
              <div className="analytics-section-head">
                <h2 ref={detailHeading} tabIndex={-1}>
                  {metricLabels[detail.metric]}
                  {detail.dimension &&
                    ` · ${detail.dimension === "project" ? (report.currentProjects.find((project) => project.projectId === detail.key)?.projectName ?? "Project") : dimensionLabels[detail.dimension]}`}
                </h2>
                <button type="button" onClick={closeList}>
                  Close list
                </button>
              </div>
              <p>
                {report.details.total} matching threads. Open a thread to read its
                discussion.
              </p>
              <div className="analytics-table-wrap">
                <table>
                  <caption>Matching threads</caption>
                  <thead>
                    <tr>
                      <th scope="col">Thread</th>
                      <th scope="col">Project</th>
                      <th scope="col">Current state</th>
                      <th scope="col">Current column</th>
                      <th scope="col">Age</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.details.items.map((thread) => (
                      <tr key={thread.id}>
                        <th scope="row">
                          <a href={`/threads/${thread.id}`}>
                            Thread {thread.id.slice(0, 8)}
                          </a>
                        </th>
                        <td>{thread.projectName}</td>
                        <td>{thread.state.replaceAll("_", " ")}</td>
                        <td>{thread.column}</td>
                        <td>{thread.ageDays} d</td>
                      </tr>
                    ))}
                    {!report.details.items.length && (
                      <tr>
                        <td colSpan={5}>No matching threads.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="analytics-pagination">
                <button
                  type="button"
                  disabled={!detail.offset}
                  onClick={() =>
                    setDetail({
                      ...detail,
                      offset: Math.max(0, detail.offset - detail.limit),
                    })
                  }
                >
                  Previous
                </button>
                <span>
                  {report.details.total
                    ? `${detail.offset + 1}–${detail.offset + report.details.items.length} of ${report.details.total}`
                    : "0 threads"}
                </span>
                <button
                  type="button"
                  disabled={report.details.nextOffset === null}
                  onClick={() =>
                    setDetail({ ...detail, offset: report.details!.nextOffset! })
                  }
                >
                  Next
                </button>
              </div>
            </section>
          )}
          <details className="analytics-method">
            <summary>How these numbers work</summary>
            <p>
              Overview and current Explore groups show the current snapshot, independent
              of the selected period. Overdue and high priority are overlapping subsets of
              pending tasks.
            </p>
            {report.notes.map((note) => (
              <p key={note}>{note}</p>
            ))}
            <p>
              CSV and print include aggregate totals and dates from every view. Project
              and member names, URLs, discussion and matching thread IDs are excluded.
              Your view and period preferences stay in this browser for your account.
            </p>
          </details>
          <Totals report={report} />
        </>
      )}
    </section>
  );
}
