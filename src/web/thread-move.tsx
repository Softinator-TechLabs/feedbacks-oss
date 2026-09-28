import React, { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, type Project, type Thread } from "./api.js";
import { ErrorNotice, Field, showToast, useAction } from "./ui.js";

export function ThreadMove({
  thread,
  onMoved,
}: {
  thread: Thread;
  onMoved: (thread: Thread) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const pending = useRef(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [destination, setDestination] = useState("");
  const [loaded, setLoaded] = useState(false);
  const action = useAction();
  const titleId = React.useId();
  async function loadProjects() {
    setLoaded(false);
    await action.run(async () => {
      const result = await api<{ items: Project[] }>("projects.list", {});
      setProjects(
        result.items.filter(
          (p) => p.id !== thread.projectId && p.permissions.canMaintain,
        ),
      );
      setLoaded(true);
    });
  }
  async function move() {
    if (pending.current || !destination) return;
    pending.current = true;
    try {
      await action.run(async () => {
        const result = await api<Thread>("threads.move", {
          threadId: thread.id,
          revision: thread.revision,
          projectId: destination,
        });
        dialog.current?.close();
        onMoved(result);
        showToast(
          `Moved to ${projects.find((p) => p.id === result.projectId)?.name ?? "the selected project"}.`,
        );
      });
    } finally {
      pending.current = false;
    }
  }
  return (
    <>
      <button
        type="button"
        onClick={(event) => {
          returnFocus.current =
            event.currentTarget.closest("details")?.querySelector("summary") ??
            event.currentTarget;
          setDestination("");
          dialog.current?.showModal();
          void loadProjects();
        }}
      >
        Move to project…
      </button>
      {createPortal(
        <dialog
          ref={dialog}
          className="thread-move-dialog"
          aria-labelledby={titleId}
          onCancel={(event) => {
            if (action.busy) event.preventDefault();
          }}
          onClose={() => returnFocus.current?.focus()}
        >
          <h2 id={titleId}>Move to project</h2>
          <p>
            The thread link, points, media and discussion stay together. Access follows
            the destination project; existing guest links are revoked.
          </p>
          <ErrorNotice error={action.error} />
          {!loaded ? (
            <>
              {action.busy ? (
                <p role="status">Loading projects…</p>
              ) : (
                <button type="button" onClick={() => void loadProjects()}>
                  Retry loading projects
                </button>
              )}
            </>
          ) : projects.length ? (
            <Field label="Destination project">
              <select
                value={destination}
                disabled={action.busy}
                onChange={(event) => setDestination(event.target.value)}
              >
                <option value="">Choose a project</option>
                {projects.map((p) => (
                  <option value={p.id} key={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <p>
              No other projects are available to move into. You need maintainer access to
              both projects.
            </p>
          )}
          {loaded && action.error && (
            <button
              type="button"
              disabled={action.busy}
              onClick={() =>
                void action.run(async () => {
                  const latest = await api<Thread>("threads.get", {
                    threadId: thread.id,
                  });
                  dialog.current?.close();
                  onMoved(latest);
                  showToast(
                    "Thread refreshed. Choose the destination again if a move is still needed.",
                  );
                })
              }
            >
              Reload current thread
            </button>
          )}
          <div className="actions">
            <button
              type="button"
              disabled={action.busy}
              onClick={() => dialog.current?.close()}
            >
              Cancel
            </button>
            <button
              className="primary"
              type="button"
              disabled={action.busy || !destination || !loaded}
              onClick={() => void move()}
            >
              {action.busy && loaded ? "Moving…" : "Move thread"}
            </button>
          </div>
        </dialog>,
        document.body,
      )}
    </>
  );
}
