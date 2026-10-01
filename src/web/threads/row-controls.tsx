import React from "react";
import { Icon } from "../icons.js";
import { api, labels, type Thread } from "../api.js";
import { ActionState, useAction } from "../ui.js";
export function ThreadQuickPriority({
  thread,
  onSaved,
}: {
  thread: Thread;
  onSaved: (thread: Thread) => void;
}) {
  const action = useAction();
  return (
    <div className="thread-row-priority">
      <button
        type="button"
        className="thread-row-priority-button"
        aria-label={`${thread.topPriority ? "Remove" : "Mark"} top priority for ${thread.body.slice(0, 80)}`}
        title={thread.topPriority ? "Remove top priority" : "Mark top priority"}
        aria-pressed={thread.topPriority}
        disabled={action.busy}
        onClick={() => {
          void action.run(async () => {
            onSaved(
              await api<Thread>("threads.priority", {
                threadId: thread.id,
                revision: thread.revision,
                topPriority: !thread.topPriority,
              }),
            );
          });
        }}
      >
        <Icon name="priority" />
      </button>
      <ActionState action={action} />
    </div>
  );
}
export function ThreadQuickStatus({
  thread,
  canWrite,
  canResolve,
  onSaved,
}: {
  thread: Thread;
  canWrite: boolean;
  canResolve: boolean;
  onSaved: (thread: Thread) => void;
}) {
  const action = useAction();
  if (!canWrite)
    return (
      <span className={`badge ${thread.work.state}`}>{labels[thread.work.state]}</span>
    );
  const states: Array<Thread["work"]["state"]> = [
    "open",
    "in_progress",
    "ready_for_review",
    "resolved",
    "declined",
  ];
  return (
    <>
      <select
        aria-label={`Status for ${thread.body.slice(0, 80)}`}
        value={thread.work.state}
        disabled={action.busy}
        onChange={(event) => {
          const state = event.target.value as
            | "open"
            | "in_progress"
            | "ready_for_review"
            | "resolved"
            | "declined";
          void action.run(async () => {
            onSaved(
              await api<Thread>("threads.status", {
                threadId: thread.id,
                revision: thread.revision,
                state,
              }),
            );
          });
        }}
      >
        {states.map((state) => (
          <option
            key={state}
            value={state}
            disabled={!canResolve && ["resolved", "declined"].includes(state)}
          >
            {labels[state]}
            {!canResolve && ["resolved", "declined"].includes(state)
              ? " (permission required)"
              : ""}
          </option>
        ))}
      </select>
      <ActionState action={action} />
    </>
  );
}
