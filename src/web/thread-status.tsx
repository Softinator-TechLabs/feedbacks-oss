import React, { useRef, useState } from "react";
import { api, labels, type Thread } from "./api.js";
import { ErrorNotice, Field, Notice, useAction } from "./ui.js";
import { useUnsavedChanges } from "./navigation.js";
type StatusDraft = {
  state: "open" | "in_progress" | "ready_for_review" | "resolved" | "declined";
  note: string;
  duplicateOf: string;
  revision: number;
};
export function ThreadStatus({
  thread,
  canResolve,
  onSaved,
}: {
  thread: Thread;
  canResolve: boolean;
  onSaved: (thread: Thread) => void;
}) {
  const [draft, setDraft] = useState<StatusDraft>(),
    pending = useRef(false),
    a = useAction();
  const current: StatusDraft = draft ?? {
    state: thread.work.state as StatusDraft["state"],
    note: "",
    duplicateOf: thread.work.duplicateOf ?? "",
    revision: thread.revision,
  };
  const changed = !!draft && draft.revision !== thread.revision;
  const canSave = canResolve || !["resolved", "declined"].includes(current.state);
  useUnsavedChanges(!!draft || a.busy);
  const update = (patch: Partial<StatusDraft>) => setDraft({ ...current, ...patch });
  async function save(submitted: StatusDraft) {
    if (pending.current || changed) return;
    pending.current = true;
    setDraft(submitted);
    try {
      await a.run(async () => {
        const result = await api<Thread>("threads.status", {
          threadId: thread.id,
          revision: submitted.revision,
          state: submitted.state,
          ...(submitted.note.trim() ? { note: submitted.note.trim() } : {}),
          ...(submitted.duplicateOf ? { duplicateOf: submitted.duplicateOf } : {}),
        });
        onSaved(result);
        setDraft(undefined);
      }, `Status saved: ${labels[submitted.state]}.`);
    } finally {
      pending.current = false;
    }
  }
  return (
    <section className="status-editor" aria-label="Thread status" aria-busy={a.busy}>
      <div className="status-controls">
        <Field label="Status">
          <select
            name="state"
            aria-label="Status"
            disabled={a.busy || changed}
            value={current.state}
            onChange={(e) =>
              void save({ ...current, state: e.target.value as StatusDraft["state"] })
            }
          >
            {[
              "open",
              "in_progress",
              "ready_for_review",
              ...(canResolve ? ["resolved", "declined"] : []),
              ...(!canResolve && ["resolved", "declined"].includes(thread.work.state)
                ? [thread.work.state]
                : []),
            ].map((state) => (
              <option
                value={state}
                key={state}
                disabled={!canResolve && ["resolved", "declined"].includes(state)}
              >
                {labels[state]}
              </option>
            ))}
          </select>
        </Field>
        {canResolve && thread.work.state !== "resolved" && (
          <button
            type="button"
            className="primary"
            disabled={a.busy || changed}
            onClick={() => void save({ ...current, state: "resolved" })}
          >
            Resolve
          </button>
        )}
        {thread.work.state === "resolved" && (
          <button
            type="button"
            disabled={a.busy || changed}
            onClick={() => void save({ ...current, state: "open" })}
          >
            Reopen
          </button>
        )}
        {a.busy && (
          <span className="muted" role="status">
            Saving…
          </span>
        )}
      </div>
      <ErrorNotice error={a.error} />
      {draft && !changed && !a.busy && !a.error.includes("CONFLICT") && (
        <button
          type="button"
          disabled={a.busy || !canSave}
          onClick={() => void save(current)}
        >
          {a.error ? "Retry status update" : "Save pending status"}
        </button>
      )}
      {(changed || a.error.includes("CONFLICT")) && (
        <Notice>
          This thread changed. Your selection and note are preserved.{" "}
          <button
            type="button"
            disabled={a.busy}
            onClick={() =>
              void a.run(async () => {
                const latest = await api<Thread>("threads.get", { threadId: thread.id });
                onSaved(latest);
                setDraft({ ...current, revision: latest.revision });
              })
            }
          >
            Load latest status and keep draft
          </button>
        </Notice>
      )}
      <details className="status-options">
        <summary
          aria-label="Add a status note or duplicate link"
          data-tooltip="Add a status note or duplicate link"
        >
          More
        </summary>
        <Field label="Outcome note (optional)">
          <textarea
            name="note"
            rows={2}
            maxLength={12000}
            disabled={a.busy}
            value={current.note}
            onChange={(e) => update({ note: e.target.value })}
          />
        </Field>
        <Field label="Duplicate of thread ID (optional)">
          <input
            name="duplicateOf"
            placeholder="UUID"
            disabled={a.busy}
            value={current.duplicateOf}
            onChange={(e) => update({ duplicateOf: e.target.value })}
          />
        </Field>
        <button
          type="button"
          disabled={a.busy || changed || !draft || !canSave}
          onClick={() => void save(current)}
        >
          Save details
        </button>
      </details>
    </section>
  );
}
