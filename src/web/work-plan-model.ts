import type { WorkPlan } from "../shared/contracts.js";

export const planPriorities = { high: "High", normal: "Normal", low: "Low" } as const;
export const planTimings = {
  unscheduled: "Unscheduled",
  today: "Today",
  tomorrow: "Tomorrow",
  next_week: "Next week",
  later: "Later",
} as const;
export type PlanField = "priority" | "timing";

export function localTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}
export function defaultWorkPlan(
  plan: WorkPlan | undefined,
  timeZone = localTimeZone(),
): WorkPlan {
  return (
    plan ?? { priority: "normal", schedule: "unscheduled", scheduledFor: null, timeZone }
  );
}
export function calendarDate(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((entry) => entry.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function addCalendarDays(date: string, days: number) {
  // Arithmetic on an isolated calendar date avoids adding 24-hour durations across DST.
  const next = new Date(`${date}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}
export function selectPlanTiming(
  plan: WorkPlan,
  schedule: WorkPlan["schedule"],
  now = new Date(),
  timeZone = localTimeZone(),
): WorkPlan {
  const days =
    schedule === "today"
      ? 0
      : schedule === "tomorrow"
        ? 1
        : schedule === "next_week"
          ? 7
          : null;
  return {
    ...plan,
    schedule,
    scheduledFor:
      days === null ? null : addCalendarDays(calendarDate(now, timeZone), days),
    timeZone,
  };
}
export function timingSelection(
  plan: WorkPlan,
  now = new Date(),
  timeZone = localTimeZone(),
): WorkPlan["schedule"] | "scheduled" {
  if (!plan.scheduledFor) return plan.schedule === "later" ? "later" : "unscheduled";
  // Relative options use the reader's calendar; retain an explicit date for another zone.
  if (plan.timeZone !== timeZone) return "scheduled";
  const today = calendarDate(now, timeZone);
  if (plan.scheduledFor === today) return "today";
  if (plan.scheduledFor === addCalendarDays(today, 1)) return "tomorrow";
  if (plan.scheduledFor === addCalendarDays(today, 7)) return "next_week";
  return "scheduled";
}
export function plannedDateLabel(date: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${date}T12:00:00Z`));
}
export function timingLabel(plan: WorkPlan, now = new Date()) {
  const selection = timingSelection(plan, now, plan.timeZone);
  if (!plan.scheduledFor) return planTimings[selection as "unscheduled" | "later"];
  const date = plannedDateLabel(plan.scheduledFor);
  return selection === "scheduled"
    ? `Planned ${date}`
    : `${planTimings[selection]} · ${date}`;
}
export function rebaseWorkPlanChoice(
  chosen: WorkPlan,
  latest: WorkPlan,
  field: PlanField,
): WorkPlan {
  return field === "priority"
    ? { ...latest, priority: chosen.priority }
    : {
        ...latest,
        schedule: chosen.schedule,
        scheduledFor: chosen.scheduledFor,
        timeZone: chosen.timeZone,
      };
}
export function sameWorkPlan(a: WorkPlan, b: WorkPlan) {
  return (
    a.priority === b.priority &&
    a.schedule === b.schedule &&
    a.scheduledFor === b.scheduledFor &&
    a.timeZone === b.timeZone
  );
}
