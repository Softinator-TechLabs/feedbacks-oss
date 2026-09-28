import React, { useRef, useState } from "react";
import { buildTaskHandoff, type HandoffAssignments } from "../shared/task-handoff.js";
import { api, type Project, type Thread } from "./api.js";
import { ErrorNotice, showToast, useAction } from "./ui.js";

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
        const [fresh, assignments] = await Promise.all([
          api<Thread>("threads.get", { threadId: thread.id }),
          api<HandoffAssignments>("assignments.delegations", {
            projectId: project.id,
            threadId: thread.id,
            state: "active",
            limit: 50,
            offset: 0,
          }),
        ]);
        const result = buildTaskHandoff({
          thread: fresh,
          project,
          assignments,
          origin: location.origin,
          copiedAt: new Date().toISOString(),
        });
        try {
          await navigator.clipboard.writeText(result.text);
          showToast(
            result.truncated
              ? "Task copied. Long sections have explicit MCP continuation instructions."
              : "Task copied. Paste it into your coding agent.",
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
      <button type="button" disabled={action.busy} onClick={() => void copy()}>
        {action.busy ? "Preparing task…" : "Copy task for agent"}
      </button>
      <ErrorNotice error={action.error} />
      <dialog ref={dialog} className="task-copy-dialog" aria-labelledby="task-copy-title">
        <h2 id="task-copy-title">Copy task for agent</h2>
        <p>Your browser blocked clipboard access. Select and copy this task text.</p>
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
