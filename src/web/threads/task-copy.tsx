import React, { useRef, useState } from "react";
import { buildTaskHandoff } from "../../shared/task-handoff.js";
import { Icon } from "../icons.js";
import { api, type Project, type Thread } from "../api.js";
import { ErrorNotice, showToast, useAction } from "../ui.js";

export function ThreadTaskCopy({
  thread,
  project,
}: {
  thread: Thread;
  project: Project;
}) {
  const action = useAction();
  const pending = useRef(false);
  const [manual, setManual] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  async function copy() {
    if (pending.current) return;
    pending.current = true;
    try {
      await action.run(async () => {
        const fresh = await api<Thread>("threads.get", { threadId: thread.id });
        if (fresh.projectId !== project.id)
          throw new Error(
            "This task moved to another project. Reload it before copying.",
          );
        const result = buildTaskHandoff({
          thread: fresh,
          origin: location.origin,
          project,
        });
        try {
          await navigator.clipboard.writeText(result.text);
          showToast(
            result.truncated
              ? "Task preview copied. Your agent can read more when needed."
              : "Task copied. Paste it to review and discuss next steps.",
          );
        } catch {
          setManual(result.text);
          dialog.current?.showModal();
        }
      });
    } finally {
      pending.current = false;
    }
  }
  return (
    <div className="thread-task-copy">
      <button
        type="button"
        className="thread-icon-button"
        aria-label={action.busy ? "Preparing task…" : "Copy task for agent"}
        data-tooltip={
          action.busy ? "Preparing task…" : "Copy task: review and discuss next steps"
        }
        disabled={action.busy}
        onClick={() => void copy()}
      >
        <Icon name="copy" />
      </button>
      <ErrorNotice error={action.error} />
      <dialog ref={dialog} className="task-copy-dialog" aria-labelledby="task-copy-title">
        <h2 id="task-copy-title">Copy task for agent</h2>
        <p>
          Copy this task text to review it with your agent. Implementation needs your
          selected scope or a clear fix request. Discussion replies are reserved for
          important blockers or requested updates.
        </p>
        <textarea
          aria-label="Task prompt"
          readOnly
          value={manual}
          rows={12}
          onFocus={(event) => event.target.select()}
        />
        <div className="actions">
          <button
            type="button"
            onClick={() => dialog.current?.querySelector("textarea")?.focus()}
          >
            Select task text
          </button>
          <button type="button" onClick={() => dialog.current?.close()}>
            Close
          </button>
        </div>
      </dialog>
    </div>
  );
}
