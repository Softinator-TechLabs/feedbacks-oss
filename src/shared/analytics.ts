import type { AnalyticsReport } from "./contracts/domains/analytics.js";
export type { AnalyticsInput, AnalyticsReport } from "./contracts/domains/analytics.js";
export { analyticsMetrics, analyticsDimensions } from "./contracts/domains/analytics.js";

// Export aggregates only: no names, URLs, thread text, email addresses or thread IDs.
// Formula-like labels never come from user content.
export function analyticsCsv(report: AnalyticsReport) {
  const rows: Array<Array<string | number>> = [
    ["Feedbacks analytics"],
    ["Generated at", report.generatedAt],
    ["From inclusive", report.period.from],
    ["To exclusive", report.period.to],
    ["Timezone", report.period.timeZone],
    ["Accessible projects", report.projectCount],
    ["Metric", "Threads"],
    ...Object.entries(report.counts),
    [],
    ["Duration for incoming cohort", "Completed sample", "Median hours", "P90 hours"],
    ...Object.entries(report.durations).map(([name, value]) => [
      name,
      value.sample,
      value.medianHours ?? "",
      value.p90Hours ?? "",
    ]),
    [],
    ["Date", "Incoming", "Triaged", "Resolved", "Reopened", "Declined", "Duplicate"],
    ...report.trend.map((day) => [
      day.date,
      day.incoming,
      day.triaged,
      day.resolved,
      day.reopened,
      day.declined,
      day.duplicate,
    ]),
    [],
    ["Coverage", report.coverage],
    ...report.notes.map((note) => [note]),
  ];
  return rows
    .map((row) =>
      row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(","),
    )
    .join("\r\n");
}

export function analyticsDateBoundary(day: string, timeZone: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("Choose a valid date");
  const target = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(target) || new Date(target).toISOString().slice(0, 10) !== day)
    throw new Error("Choose a valid date");
  const format = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  let at = target;
  for (let attempt = 0; attempt < 4; attempt++) {
    const parts = Object.fromEntries(
      format.formatToParts(new Date(at)).map((part) => [part.type, part.value]),
    );
    const represented = Date.parse(
      `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`,
    );
    if (represented === target) return new Date(at).toISOString();
    at += target - represented;
  }
  throw new Error("Midnight does not exist on this date in the chosen timezone");
}
