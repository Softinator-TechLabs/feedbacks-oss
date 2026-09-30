import React, { useRef, useState } from "react";
import type { WorkPlan } from "../shared/contracts.js";
import { api, type Thread } from "./api.js";
import { ErrorNotice, showToast, useAction } from "./ui.js";
import {
  defaultWorkPlan,
  localTimeZone,
  planPriorities,
  planTimings,
  rebaseWorkPlanChoice,
  sameWorkPlan,
  selectPlanTiming,
  timingLabel,
  timingSelection,
  type PlanField,
} from "./work-plan-model.js";

type Draft = { field: PlanField; workPlan: WorkPlan; revision: number };

export function PointWorkPlan({
  thread,
  annotationId,
  number,
  onSaved,
}: {
  thread: Thread;
  annotationId: string;
  number: number;
  onSaved: (thread: Thread) => void;
}) {
  const [draft, setDraft] = useState<Draft>();
  const action = useAction();
  const pending = useRef(false);
  const timeZone = localTimeZone();
  const persisted = defaultWorkPlan(thread.annotationPlans?.[annotationId], timeZone);
  const current = draft?.workPlan ?? persisted;
  const changed = !!draft && draft.revision !== thread.revision;

  async function save(next: Draft) {
    if (pending.current || next.revision !== thread.revision) return;
    pending.current = true;
    setDraft(next);
    try {
      await action.run(async () => {
        const updated = await api<Thread>("threads.annotationPlan", {
          threadId: thread.id,
          revision: next.revision,
          annotationId,
          workPlan: next.workPlan,
        });
        onSaved(updated);
        setDraft(undefined);
        showToast(`Point ${next.field} saved.`);
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
        const latest = await api<Thread>("threads.get", { threadId: thread.id });
        const latestPlan = defaultWorkPlan(
          latest.annotationPlans?.[annotationId],
          timeZone,
        );
        onSaved(latest);
        const rebased = rebaseWorkPlanChoice(draft.workPlan, latestPlan, draft.field);
        if (sameWorkPlan(rebased, latestPlan)) {
          setDraft(undefined);
          showToast("Your point plan is already saved.");
        } else {
          setDraft({ ...draft, revision: latest.revision, workPlan: rebased });
        }
      });
    } finally {
      pending.current = false;
    }
  }

  const planned = current.priority !== "normal" || current.schedule !== "unscheduled";
  return (
    <form
      className="review-point-plan"
      aria-busy={action.busy}
      data-unsaved={draft || action.busy ? "true" : undefined}
      onSubmit={(event) => event.preventDefault()}
    >
      <label>
        Priority
        <select
          aria-label={`Point ${number} priority`}
          value={current.priority}
          disabled={action.busy || !!draft}
          onChange={(event) =>
            void save({
              field: "priority",
              revision: thread.revision,
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
      <label>
        Schedule
        <select
          aria-label={`Point ${number} timing`}
          value={timingSelection(current, new Date(), timeZone)}
          disabled={action.busy || !!draft}
          onChange={(event) =>
            void save({
              field: "timing",
              revision: thread.revision,
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
          {timingSelection(current, new Date(), timeZone) === "scheduled" && (
            <option value="scheduled" disabled>
              {timingLabel(current)}
            </option>
          )}
        </select>
      </label>
      {planned && (
        <span className="review-point-plan-summary">
          {planPriorities[current.priority]} priority · {timingLabel(current)}
        </span>
      )}
      {action.busy && <span role="status">Saving…</span>}
      {(action.error || draft) && !action.busy && (
        <div className="review-point-plan-recovery">
          <ErrorNotice error={action.error} />
          {draft && (
            <>
              <p>
                {changed
                  ? "This thread changed. Load its current plan before retrying."
                  : "This point planning choice is not confirmed saved."}
              </p>
              <div className="actions">
                {!changed && (
                  <button type="button" onClick={() => void save(draft)}>
                    Retry point plan
                  </button>
                )}
                <button type="button" onClick={() => void loadLatest()}>
                  Load latest plan
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDraft(undefined);
                    action.setError("");
                  }}
                >
                  Discard choice
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </form>
  );
}
