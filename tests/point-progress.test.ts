import test from "node:test";
import assert from "node:assert/strict";
import { pointProgress, pointProgressLabel } from "../src/web/point-progress.js";

const normal = {
  priority: "normal" as const,
  schedule: "unscheduled" as const,
  scheduledFor: null,
  timeZone: "Asia/Kolkata",
};
const point = (id: string) => ({ id });
const at = new Date("2026-09-28T10:00:00Z");

test("progress separates resolved, urgent, later and unscheduled points", () => {
  const thread = {
    context: { annotations: "abcdefgh".split("").map(point) },
    work: { state: "open" },
    annotationStates: { a: { state: "resolved" }, b: { state: "resolved" } },
    annotationPlans: {
      c: { ...normal, schedule: "later" },
      d: {
        ...normal,
        priority: "high" as const,
        schedule: "tomorrow" as const,
        scheduledFor: "2026-09-29",
      },
      e: {
        ...normal,
        priority: "high" as const,
        schedule: "today" as const,
        scheduledFor: "2026-09-28",
      },
    },
  };
  const progress = pointProgress(thread, at);
  assert.deepEqual(progress, {
    total: 8,
    resolved: 2,
    urgent: 1,
    later: 2,
    remaining: 6,
    unscheduled: 3,
    closed: 0,
  });
  assert.match(pointProgressLabel(progress), /6 remaining.*3 unscheduled/);
});

test("removed points leave the denominator and closed threads retain honest counts", () => {
  const thread = {
    context: { annotations: [point("a"), point("b"), point("c")] },
    work: { state: "open" },
    annotationStates: { a: { state: "removed" }, b: { state: "resolved" } },
    annotationPlans: { a: { ...normal, priority: "high" as const } },
  };
  assert.deepEqual(pointProgress(thread, at), {
    total: 2,
    resolved: 1,
    urgent: 0,
    later: 0,
    remaining: 1,
    unscheduled: 1,
    closed: 0,
  });
  assert.deepEqual(pointProgress({ ...thread, work: { state: "resolved" } }, at), {
    total: 2,
    resolved: 2,
    urgent: 0,
    later: 0,
    remaining: 0,
    unscheduled: 0,
    closed: 0,
  });
  assert.deepEqual(pointProgress({ ...thread, work: { state: "declined" } }, at), {
    total: 2,
    resolved: 0,
    urgent: 0,
    later: 0,
    remaining: 0,
    unscheduled: 0,
    closed: 2,
  });
});

test("due dates use their saved timezone and future high priority stays later", () => {
  const thread = {
    context: { annotations: [point("a"), point("b"), point("c")] },
    work: { state: "open" },
    annotationPlans: {
      a: { ...normal, schedule: "today" as const, scheduledFor: "2026-09-27" },
      b: {
        ...normal,
        priority: "high" as const,
        schedule: "tomorrow" as const,
        scheduledFor: "2026-09-29",
      },
      c: { ...normal, priority: "high" as const },
    },
  };
  assert.deepEqual(pointProgress(thread, at), {
    total: 3,
    resolved: 0,
    urgent: 2,
    later: 1,
    remaining: 3,
    unscheduled: 0,
    closed: 0,
  });
  assert.equal(
    pointProgress({ context: { annotations: [] }, work: { state: "open" } }, at).total,
    0,
  );
});
