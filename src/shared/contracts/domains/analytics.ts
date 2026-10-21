import { z } from "zod";
import { id } from "../common.js";

export const analyticsMetrics = [
  "incoming",
  "triaged",
  "resolved",
  "reopened",
  "declined",
  "duplicate",
  "backlog",
  "stalled",
] as const;
export const analyticsDimensions = [
  "category",
  "tag",
  "priority",
  "project",
  "origin",
  "page",
  "browser",
  "device",
  "state",
  "column",
  "age",
  "assignee",
] as const;
const timeZone = z
  .string()
  .max(100)
  .default("UTC")
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "Choose a valid IANA timezone");
const input = z
  .object({
    projectId: id.optional(),
    from: z.string().datetime({ offset: true }),
    to: z.string().datetime({ offset: true }),
    timeZone,
    detail: z
      .object({
        metric: z.enum(analyticsMetrics),
        dimension: z.enum(analyticsDimensions).optional(),
        key: z.string().max(4096).optional(),
        offset: z.number().int().min(0).max(10000).default(0),
        limit: z.number().int().min(1).max(100).default(25),
      })
      .refine(
        (value) => !!value.dimension === (value.key !== undefined),
        "Choose both a dimension and key",
      )
      .optional(),
  })
  .refine((value) => {
    const duration = Date.parse(value.to) - Date.parse(value.from);
    return duration > 0 && duration <= 366 * 86400000;
  }, "Choose a period between one moment and 366 days");
const count = z.number().int().nonnegative();
const duration = z.object({
  sample: count,
  medianHours: z.number().nonnegative().nullable(),
  p90Hours: z.number().nonnegative().nullable(),
  smallSample: z.boolean(),
});
const breakdown = z.object({ key: z.string().nullable(), label: z.string(), count });
const metricCounts = z.object({
  incoming: count,
  triaged: count,
  resolved: count,
  reopened: count,
  declined: count,
  duplicate: count,
  backlog: count,
  stalled: count,
});
const output = z.object({
  generatedAt: z.string(),
  period: z.object({ from: z.string(), to: z.string(), timeZone: z.string() }),
  projectCount: count,
  coverage: z.literal("current_records_and_recorded_history"),
  counts: metricCounts,
  durations: z.object({
    firstResponse: duration,
    firstTriage: duration,
    firstResolution: duration,
  }),
  trend: z.array(
    z.object({
      date: z.string(),
      incoming: count,
      triaged: count,
      resolved: count,
      reopened: count,
      declined: count,
      duplicate: count,
    }),
  ),
  breakdowns: z.object({
    category: z.array(breakdown),
    tag: z.array(breakdown),
    priority: z.array(breakdown),
    project: z.array(breakdown),
    origin: z.array(breakdown),
    page: z.array(breakdown),
    browser: z.array(breakdown),
    device: z.array(breakdown),
    state: z.array(breakdown),
    column: z.array(breakdown),
    age: z.array(breakdown),
    assignee: z.array(breakdown),
  }),
  details: z
    .object({
      total: count,
      nextOffset: count.nullable(),
      items: z.array(
        z.object({
          id,
          projectId: id,
          projectName: z.string(),
          state: z.string(),
          column: z.string(),
          createdAt: z.string(),
          ageDays: count,
        }),
      ),
    })
    .nullable(),
  notes: z.array(z.string()),
});
export const analyticsInputs = { "analytics.get": input };
export const analyticsOutputs = { "analytics.get": output };
export type AnalyticsInput = z.infer<typeof input>;
export type AnalyticsReport = z.infer<typeof output>;
