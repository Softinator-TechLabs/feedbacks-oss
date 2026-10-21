import React, { useState } from "react";
import { api, type Project } from "../api.js";
import { ErrorNotice, Field, Loading, useLoad } from "../ui.js";
import {
  analyticsCsv,
  analyticsDateBoundary,
  type AnalyticsInput,
  type AnalyticsReport,
} from "../../shared/analytics.js";
import "./analytics.css";

const metricLabels: Record<keyof AnalyticsReport["counts"], string> = {
  incoming: "Incoming",
  triaged: "First triaged",
  resolved: "Resolved",
  reopened: "Reopened",
  declined: "Declined",
  duplicate: "Marked duplicate",
  backlog: "Active backlog now",
  stalled: "In the same column for 7+ days",
};
const dimensionLabels: Record<keyof AnalyticsReport["breakdowns"], string> = {
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
const shiftDay = (day: string, amount: number) =>
  new Date(Date.parse(`${day}T12:00:00Z`) + amount * 86400000).toISOString().slice(0, 10);
const currentDay = (timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
function initialPreferences(key: string) {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const today = currentDay(timeZone);
  const defaults = { fromDay: shiftDay(today, -29), throughDay: today, timeZone };
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
          fromDay: saved.fromDay,
          throughDay: saved.throughDay,
          timeZone: saved.timeZone,
        };
    }
  } catch {}
  return defaults;
}
const hours = (value: number | null) =>
  value === null
    ? "—"
    : `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value)} h`;

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
  const [fromDay, setFromDay] = useState(preferences.fromDay),
    [throughDay, setThroughDay] = useState(preferences.throughDay),
    [timeZone, setTimeZone] = useState(preferences.timeZone);
  const [selectedProject, setSelectedProject] = useState(projectId ?? ""),
    [formError, setFormError] = useState("");
  const [input, setInput] = useState<AnalyticsInput>(() => ({
    ...(projectId ? { projectId } : {}),
    from: analyticsDateBoundary(preferences.fromDay, preferences.timeZone),
    to: analyticsDateBoundary(shiftDay(preferences.throughDay, 1), preferences.timeZone),
    timeZone: preferences.timeZone,
  }));
  const [detail, setDetail] = useState<AnalyticsInput["detail"]>(),
    [version, setVersion] = useState(0);
  const [dimension, setDimension] =
    useState<keyof AnalyticsReport["breakdowns"]>("category");
  const requestKey = JSON.stringify({ ...input, detail });
  const result = useLoad(
    async () => ({
      key: requestKey,
      report: await api<AnalyticsReport>("analytics.get", { ...input, detail }),
    }),
    [requestKey, version],
  );
  const report = result.data?.key === requestKey ? result.data.report : undefined;
  function apply(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const next = {
        ...(selectedProject ? { projectId: selectedProject } : {}),
        from: analyticsDateBoundary(fromDay, timeZone),
        to: analyticsDateBoundary(shiftDay(throughDay, 1), timeZone),
        timeZone,
      };
      const duration = Date.parse(next.to) - Date.parse(next.from);
      if (duration <= 0 || duration > 366 * 86400000)
        throw new Error(
          "Choose a period of at most 366 days, with the end after the start.",
        );
      setFormError("");
      setInput(next);
      setDetail(undefined);
      try {
        localStorage.setItem(
          preferenceKey,
          JSON.stringify({ fromDay, throughDay, timeZone }),
        );
      } catch {}
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "Choose a valid period and timezone.",
      );
    }
  }
  function inspect(
    metric: keyof AnalyticsReport["counts"],
    filter?: { dimension: keyof AnalyticsReport["breakdowns"]; key: string },
  ) {
    setDetail({ metric, ...filter, offset: 0, limit: 25 });
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
  const backlogDimension = ["state", "column", "age", "assignee"].includes(dimension);
  return (
    <section className="analytics-page">
      <div className="page-head">
        <div>
          <h1>Analytics</h1>
          <p className="muted">
            Understand incoming feedback and the work that needs attention.
          </p>
        </div>
      </div>
      <form className="analytics-filters" onSubmit={apply}>
        {!projectId && (
          <Field label="Project">
            <select
              aria-label="Project"
              value={selectedProject}
              onChange={(event) => setSelectedProject(event.target.value)}
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
      <ErrorNotice error={formError || result.error} />
      {result.refreshing && <Loading />}
      {report && (
        <>
          <div className="analytics-actions">
            <p className="muted">
              Live read:{" "}
              {new Date(report.generatedAt).toLocaleString(undefined, {
                timeZone: input.timeZone,
              })}{" "}
              · {report.projectCount} accessible{" "}
              {report.projectCount === 1 ? "project" : "projects"}
            </p>
            <div>
              <button
                type="button"
                onClick={() => setVersion((value) => value + 1)}
                disabled={result.refreshing}
              >
                Refresh
              </button>
              <button type="button" onClick={exportCsv}>
                Export totals CSV
              </button>
              <button type="button" onClick={() => window.print()}>
                Print totals
              </button>
            </div>
          </div>
          {!report.counts.incoming && !report.counts.backlog && (
            <p className="notice">
              No incoming feedback in this period and no active backlog. Try another
              period or project.
            </p>
          )}
          <div className="analytics-columns">
            <div className="analytics-table-wrap">
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
                      <th scope="row">
                        {metricLabels[key as keyof typeof metricLabels]}
                      </th>
                      <td>
                        <button
                          className="analytics-count"
                          type="button"
                          onClick={() => inspect(key as keyof typeof metricLabels)}
                          aria-label={`View ${value} ${metricLabels[key as keyof typeof metricLabels].toLowerCase()} threads`}
                        >
                          {value}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="analytics-table-wrap">
              <table className="analytics-durations">
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
                        {value.smallSample && <small>Small sample</small>}
                      </th>
                      <td>{value.sample}</td>
                      <td
                        aria-label={
                          value.medianHours === null ? "No completed sample" : undefined
                        }
                      >
                        {hours(value.medianHours)}
                      </td>
                      <td
                        aria-label={
                          value.p90Hours === null ? "No completed sample" : undefined
                        }
                      >
                        {hours(value.p90Hours)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="muted">
                Threads created in the selected period; completed observations through
                this live read. Pending observations are excluded.
              </p>
            </div>
          </div>
          <details className="analytics-trend">
            <summary>Daily trend in {input.timeZone}</summary>
            <div className="analytics-table-wrap">
              <table>
                <caption>Distinct threads per local day</caption>
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    {[
                      "Incoming",
                      "Triaged",
                      "Resolved",
                      "Reopened",
                      "Declined",
                      "Duplicate",
                    ].map((label) => (
                      <th key={label} scope="col">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.trend.map((day) => (
                    <tr key={day.date}>
                      <th scope="row">{day.date}</th>
                      <td>{day.incoming}</td>
                      <td>{day.triaged}</td>
                      <td>{day.resolved}</td>
                      <td>{day.reopened}</td>
                      <td>{day.declined}</td>
                      <td>{day.duplicate}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          <section className="analytics-breakdown">
            <div className="analytics-breakdown-head">
              <h2>Explore feedback</h2>
              <Field label="Group by">
                <select
                  aria-label="Group by"
                  value={dimension}
                  onChange={(event) =>
                    setDimension(event.target.value as typeof dimension)
                  }
                >
                  {Object.entries(dimensionLabels).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <p className="muted">
              {backlogDimension
                ? "Current active backlog"
                : "Threads created in the selected period"}
              .
              {dimension === "assignee" &&
                " Workload by current assignment; a thread can belong to multiple people."}
              {dimension === "browser" && " Browser identity was not collected."}
            </p>
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
                  {report.breakdowns[dimension].map((row) => (
                    <tr key={row.key ?? "__other__"}>
                      <th scope="row">{row.label}</th>
                      <td>
                        {row.key === null ? (
                          row.count
                        ) : (
                          <button
                            className="analytics-count"
                            type="button"
                            onClick={() =>
                              inspect(backlogDimension ? "backlog" : "incoming", {
                                dimension,
                                key: row.key!,
                              })
                            }
                            aria-label={`View ${row.count} threads for ${row.label}`}
                          >
                            {row.count}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!report.breakdowns[dimension].length && (
                    <tr>
                      <td colSpan={2}>No threads in this group.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
          {detail && report.details && (
            <section className="analytics-detail" aria-label="Matching threads">
              <div className="analytics-breakdown-head">
                <h2>
                  {metricLabels[detail.metric]}
                  {detail.dimension && ` · ${dimensionLabels[detail.dimension]}`}
                </h2>
                <button type="button" onClick={() => setDetail(undefined)}>
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
            <summary>Metric definitions and data coverage</summary>
            {report.notes.map((note) => (
              <p key={note}>{note}</p>
            ))}
            <p>
              CSV and print include aggregate totals and dates. They exclude discussion
              content, project and member names, page URLs and matching thread IDs.
              Preferences are saved in this browser for your account and view.
            </p>
          </details>
        </>
      )}
    </section>
  );
}
