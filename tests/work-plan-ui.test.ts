import test from "node:test";
import assert from "node:assert/strict";
import {
  calendarDate,
  addCalendarDays,
  defaultWorkPlan,
  selectPlanTiming,
  timingSelection,
  timingLabel,
  rebaseWorkPlanChoice,
  sameWorkPlan,
} from "../src/web/work-plan-model.js";

const plan = {
  priority: "normal",
  schedule: "unscheduled",
  scheduledFor: null,
  timeZone: "UTC",
} as const;

test("calendar planning follows the selected timezone and crosses DST and year boundaries", () => {
  assert.equal(
    calendarDate(new Date("2026-01-01T01:00:00Z"), "America/Los_Angeles"),
    "2025-12-31",
  );
  assert.equal(
    calendarDate(new Date("2026-01-01T01:00:00Z"), "Asia/Kolkata"),
    "2026-01-01",
  );
  assert.equal(addCalendarDays("2026-03-07", 1), "2026-03-08");
  assert.equal(addCalendarDays("2026-11-01", 1), "2026-11-02");
  assert.equal(addCalendarDays("2026-12-28", 7), "2027-01-04");
  assert.equal(addCalendarDays("2028-02-28", 1), "2028-02-29");
  assert.equal(addCalendarDays("2028-02-29", 1), "2028-03-01");
  const next = selectPlanTiming(
    plan,
    "next_week",
    new Date("2026-03-07T23:30:00Z"),
    "America/New_York",
  );
  assert.deepEqual(next, {
    priority: "normal",
    schedule: "next_week",
    scheduledFor: "2026-03-14",
    timeZone: "America/New_York",
  });
});

test("stored dates remain fixed and relative timing labels expire", () => {
  const scheduled = selectPlanTiming(
    plan,
    "tomorrow",
    new Date("2026-12-31T10:00:00Z"),
    "Asia/Kolkata",
  );
  assert.equal(scheduled.scheduledFor, "2027-01-01");
  assert.equal(
    timingSelection(scheduled, new Date("2026-12-31T10:00:00Z"), "Asia/Kolkata"),
    "tomorrow",
  );
  assert.equal(
    timingSelection(scheduled, new Date("2027-01-01T10:00:00Z"), "Asia/Kolkata"),
    "today",
  );
  assert.equal(
    timingSelection(scheduled, new Date("2027-01-02T10:00:00Z"), "Asia/Kolkata"),
    "scheduled",
  );
  assert.match(timingLabel(scheduled, new Date("2027-01-02T10:00:00Z")), /1 Jan 2027/);
  assert.doesNotMatch(
    timingLabel(scheduled, new Date("2027-01-02T10:00:00Z")),
    /Tomorrow/,
  );
  assert.equal(
    timingSelection(scheduled, new Date("2026-12-31T10:00:00Z"), "America/New_York"),
    "scheduled",
  );
  assert.equal(scheduled.scheduledFor, "2027-01-01");
});

test("old threads default to Normal and Unscheduled; Later clears date", () => {
  assert.deepEqual(defaultWorkPlan(undefined, "Asia/Kolkata"), {
    ...plan,
    timeZone: "Asia/Kolkata",
  });
  const dated = selectPlanTiming(
    plan,
    "today",
    new Date("2026-09-28T10:00:00Z"),
    "Asia/Kolkata",
  );
  assert.deepEqual(selectPlanTiming(dated, "later", new Date(), "Asia/Kolkata"), {
    ...plan,
    schedule: "later",
    timeZone: "Asia/Kolkata",
  });
});

test("conflict recovery reapplies only the human-selected field to the latest plan", () => {
  const chosen = { ...plan, priority: "high" } as const;
  const latest = {
    ...plan,
    priority: "low",
    schedule: "tomorrow",
    scheduledFor: "2026-09-29",
    timeZone: "Asia/Kolkata",
  } as const;
  assert.deepEqual(rebaseWorkPlanChoice(chosen, latest, "priority"), {
    ...latest,
    priority: "high",
  });
  assert.deepEqual(rebaseWorkPlanChoice(chosen, latest, "timing"), {
    ...plan,
    priority: "low",
  });
  assert.ok(sameWorkPlan(latest, { ...latest }));
  assert.ok(!sameWorkPlan(latest, { ...latest, scheduledFor: "2026-09-30" }));
});
