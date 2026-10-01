import type { WorkPlan } from "../shared/contracts.js";
import { calendarDate } from "./work-plan-model.js";

export type PointProgress = {
  total: number;
  resolved: number;
  urgent: number;
  later: number;
  remaining: number;
  unscheduled: number;
  closed: number;
};

type ProgressThread = {
  context: { annotations?: Array<{ id: string }> };
  work: { state: string };
  annotationStates?: Record<string, { state: string }>;
  annotationPlans?: Record<string, WorkPlan>;
};

export function pointWorkState(thread: ProgressThread, id: string) {
  const state = thread.annotationStates?.[id]?.state;
  if (state === "removed") return "removed";
  if (thread.work.state === "declined") return "closed";
  if (thread.work.state === "resolved" || state === "resolved") return "resolved";
  return "open";
}

export function pointProgress(thread: ProgressThread, now = new Date()): PointProgress {
  const counts = {
    total: 0,
    resolved: 0,
    urgent: 0,
    later: 0,
    remaining: 0,
    unscheduled: 0,
    closed: 0,
  };
  for (const point of thread.context.annotations ?? []) {
    const state = pointWorkState(thread, point.id);
    if (state === "removed") continue;
    counts.total++;
    if (state === "closed") {
      counts.closed++;
    } else if (state === "resolved") {
      counts.resolved++;
    } else {
      counts.remaining++;
      const plan = thread.annotationPlans?.[point.id];
      if (!plan) {
        counts.unscheduled++;
        continue;
      }
      const today = calendarDate(now, plan.timeZone);
      if (plan.schedule === "later" || (plan.scheduledFor && plan.scheduledFor > today)) {
        counts.later++;
      } else if (
        plan.priority === "high" ||
        (plan.scheduledFor && plan.scheduledFor <= today)
      ) {
        counts.urgent++;
      } else {
        counts.unscheduled++;
      }
    }
  }
  return counts;
}

export function pointProgressLabel(progress: PointProgress) {
  const { total, resolved, urgent, later, remaining, unscheduled, closed } = progress;
  return `${resolved} of ${total} points resolved · ${remaining} remaining: ${urgent} urgent, ${later} later, ${unscheduled} unscheduled${closed ? ` · ${closed} closed` : ""}`;
}
