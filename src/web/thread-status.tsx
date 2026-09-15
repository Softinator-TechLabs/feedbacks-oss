import React, { useState } from "react";
import { api, labels, type Thread } from "./api.js";
import { ActionState, Field, Notice, useAction } from "./ui.js";
import { useUnsavedChanges } from "./navigation.js";
type StatusDraft = {
  state: string;
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
    a = useAction();
  const current = draft ?? {
    state:
      !canResolve && ["resolved", "declined"].includes(thread.work.state)
        ? ""
        : thread.work.state,
    note: "",
    duplicateOf: "",
    revision: thread.revision,
  };
  const changed = !!draft && draft.revision !== thread.revision;
  useUnsavedChanges(!!draft || a.busy);
  const update = (patch: Partial<StatusDraft>) => setDraft({ ...current, ...patch });
  return (
    <details className="status-editor">
      <summary>Update status · {labels[thread.work.state]}</summary>
      {changed && (
        <Notice>
          Latest saved status: {labels[thread.work.state]} (revision {thread.revision}).
          Your unsent selection and note are preserved.{" "}
          <button
            type="button"
            disabled={a.busy}
            onClick={() => update({ revision: thread.revision })}
          >
            Use latest revision and keep draft
          </button>
        </Notice>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (a.busy || changed) return;
          const submitted = current;
          void a.run(async () => {
            const result = await api<Thread>("threads.status", {
              threadId: thread.id,
              revision: submitted.revision,
              state: submitted.state as "open",
              note: submitted.note,
              ...(submitted.duplicateOf ? { duplicateOf: submitted.duplicateOf } : {}),
            });
            onSaved(result);
            setDraft((value) => (value === submitted ? undefined : value));
          }, "Status saved.");
        }}
      >
        <Field label="Status">
          <select
            name="state"
            required
            value={current.state}
            onChange={(e) => update({ state: e.target.value })}
          >
            <option value="" disabled>
              Choose a new status
            </option>
            {[
              "open",
              "in_progress",
              "ready_for_review",
              ...(canResolve ? ["resolved", "declined"] : []),
            ].map((state) => (
              <option value={state} key={state}>
                {labels[state]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Outcome note" hint="Required when resolving or declining.">
          <textarea
            name="note"
            rows={3}
            maxLength={12000}
            value={current.note}
            onChange={(e) => update({ note: e.target.value })}
          />
        </Field>
        <details className="duplicate-details">
          <summary>Mark as duplicate</summary>
          <Field label="Original thread ID">
            <input
              name="duplicateOf"
              placeholder="UUID"
              value={current.duplicateOf}
              onChange={(e) => update({ duplicateOf: e.target.value })}
            />
          </Field>
        </details>
        <button disabled={a.busy || changed}>Update status</button>
        <ActionState action={a} />
      </form>
    </details>
  );
}
