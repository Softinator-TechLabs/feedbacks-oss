import React, { useEffect, useRef, useState } from "react";
import type { WorkPlan } from "../shared/contracts.js";
import { api, type Thread } from "./api.js";
import { ErrorNotice, showToast, useAction } from "./ui.js";
import { useUnsavedChanges } from "./navigation.js";
import {
  defaultWorkPlan,
  localTimeZone,
  planPriorities,
  planTimings,
  plannedDateLabel,
  rebaseWorkPlanChoice,
  sameWorkPlan,
  selectPlanTiming,
  timingLabel,
  timingSelection,
  type PlanField,
} from "./work-plan-model.js";
import { Icon } from "./icons.js";
import "./thread-work-plan.css";

type PlanDraft = { workPlan: WorkPlan; revision: number; field: PlanField };

export function WorkPlanSummary({ workPlan }: { workPlan?: WorkPlan }) {
  const plan = defaultWorkPlan(workPlan);
  return (
    <span
      className="work-plan-summary"
      title={plan.scheduledFor ? `Planned calendar date in ${plan.timeZone}` : undefined}
    >
      {planPriorities[plan.priority]} priority · {timingLabel(plan)}
      {plan.scheduledFor && <span className="work-plan-zone"> · {plan.timeZone}</span>}
    </span>
  );
}

export function ThreadWorkPlan({
  thread,
  onSaved,
  canWrite,
}: {
  thread: Thread;
  onSaved: (thread: Thread) => void;
  canWrite: boolean;
}) {
  const [draft, setDraft] = useState<PlanDraft>();
  const [latest, setLatest] = useState<Thread>();
  const [now, setNow] = useState(() => new Date());
  const pending = useRef(false);
  const action = useAction();
  const timeZone = localTimeZone();
  const persisted = defaultWorkPlan(thread.workPlan, timeZone);
  const current = draft?.workPlan ?? persisted;
  const choice = timingSelection(current, now, timeZone);
  const changed = !!draft && draft.revision !== thread.revision;
  const conflict = changed || action.error.includes("CONFLICT");
  const fresh = latest && latest.revision === thread.revision ? latest : undefined;
  useUnsavedChanges(!!draft || action.busy);
  useEffect(() => {
    const update = () => setNow(new Date());
    const timer = setInterval(update, 60_000);
    document.addEventListener("visibilitychange", update);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  async function save(submitted: PlanDraft) {
    if (pending.current || !canWrite || submitted.revision !== thread.revision) return;
    pending.current = true;
    setDraft(submitted);
    setLatest(undefined);
    try {
      await action.run(async () => {
        const result = await api<Thread>("threads.plan", {
          threadId: thread.id,
          revision: submitted.revision,
          workPlan: submitted.workPlan,
        });
        onSaved(result);
        setDraft(undefined);
        showToast(
          submitted.field === "priority"
            ? `Priority saved: ${planPriorities[submitted.workPlan.priority]}.`
            : `Timing saved: ${timingLabel(submitted.workPlan)}.`,
        );
      });
    } finally {
      pending.current = false;
    }
  }
  async function loadLatest() {
    if (pending.current || !draft) return;
    pending.current = true;
    try {
      await action.run(async () => {
        const result = await api<Thread>("threads.get", { threadId: thread.id });
        onSaved(result);
        const rebased = rebaseWorkPlanChoice(
          draft.workPlan,
          defaultWorkPlan(result.workPlan, timeZone),
          draft.field,
        );
        if (sameWorkPlan(rebased, defaultWorkPlan(result.workPlan, timeZone))) {
          setDraft(undefined);
          setLatest(undefined);
          showToast("Your planning choice is already saved.");
        } else setLatest(result);
      });
    } finally {
      pending.current = false;
    }
  }
  return (
    <section
      className="thread-work-plan"
      aria-label="Work planning"
      aria-busy={action.busy}
    >
      <div className="work-plan-controls">
        <label
          className="work-plan-icon"
          data-tooltip={`Priority: ${planPriorities[current.priority]}`}
          data-active={current.priority !== "normal" || undefined}
        >
          <Icon name="flag" />
          <select
            aria-label="Work priority"
            value={current.priority}
            disabled={!canWrite || action.busy || !!draft}
            onChange={(event) =>
              void save({
                revision: thread.revision,
                field: "priority",
                workPlan: {
                  ...persisted,
                  priority: event.target.value as WorkPlan["priority"],
                },
              })
            }
          >
            {Object.entries(planPriorities).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label
          className="work-plan-icon"
          data-tooltip={`Timing: ${timingLabel(current)}${current.scheduledFor ? ` · ${plannedDateLabel(current.scheduledFor)} · ${current.timeZone}` : ""}`}
          data-active={current.schedule !== "unscheduled" || undefined}
        >
          <Icon name="calendar" />
          <select
            aria-label="Work timing"
            value={choice}
            disabled={!canWrite || action.busy || !!draft}
            onChange={(event) =>
              void save({
                revision: thread.revision,
                field: "timing",
                workPlan: selectPlanTiming(
                  persisted,
                  event.target.value as WorkPlan["schedule"],
                  new Date(),
                  timeZone,
                ),
              })
            }
          >
            {Object.entries(planTimings).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
            {choice === "scheduled" && current.scheduledFor && (
              <option value="scheduled" disabled>
                Planned {plannedDateLabel(current.scheduledFor)}
              </option>
            )}
          </select>
        </label>
        {action.busy && (
          <span className="muted" role="status">
            Saving…
          </span>
        )}
      </div>
      {(action.error || (draft && !action.busy)) && (
        <div className="work-plan-feedback">
          <ErrorNotice error={action.error} />
          {draft && !action.busy && (
            <div className="work-plan-recovery">
              {fresh ? (
                <>
                  <p>
                    Current plan: <WorkPlanSummary workPlan={fresh.workPlan} />
                  </p>
                  <p>
                    Your choice:{" "}
                    {draft.field === "priority"
                      ? `${planPriorities[draft.workPlan.priority]} priority`
                      : timingLabel(draft.workPlan)}
                    . Other planning choices will stay as shown above.
                  </p>
                  <div className="actions">
                    <button
                      type="button"
                      disabled={!canWrite}
                      onClick={() =>
                        void save({
                          revision: fresh.revision,
                          field: draft.field,
                          workPlan: rebaseWorkPlanChoice(
                            draft.workPlan,
                            defaultWorkPlan(fresh.workPlan, timeZone),
                            draft.field,
                          ),
                        })
                      }
                    >
                      Apply my {draft.field} choice
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDraft(undefined);
                        setLatest(undefined);
                        action.setError("");
                      }}
                    >
                      Use current plan
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p>
                    {conflict
                      ? "This thread changed. Your planning choice is preserved."
                      : "Your planning choice has not been confirmed saved."}
                  </p>
                  <div className="actions">
                    {!conflict && (
                      <button
                        type="button"
                        disabled={!canWrite}
                        onClick={() => void save(draft)}
                      >
                        Retry planning update
                      </button>
                    )}
                    <button type="button" onClick={() => void loadLatest()}>
                      Load current plan
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDraft(undefined);
                        setLatest(undefined);
                        action.setError("");
                      }}
                    >
                      Discard my choice
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
