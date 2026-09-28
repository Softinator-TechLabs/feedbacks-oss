import React, { useEffect, useRef, useState } from "react";
import { api, uid, type Thread } from "./api.js";
import { ActionState, useAction, useLoad, ErrorNotice } from "./ui.js";

type Receipt = {
  id: string;
  deletedCount: number;
  createdAt: string;
  cleanup: { state: "pending" | "failed" | "complete"; total: number; remaining: number };
};
export function DeleteThreadsButton({
  projectId,
  threads,
  onDeleted,
}: {
  projectId: string;
  threads: Thread[];
  onDeleted: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [selection, setSelection] = useState<Thread[]>([]);
  const request = useRef("");
  const action = useAction();
  const titleId = React.useId();
  return (
    <>
      <button
        type="button"
        className="danger"
        disabled={!threads.length || action.busy}
        onClick={() => {
          setSelection(threads);
          request.current = uid();
          dialog.current?.showModal();
          dialog.current
            ?.querySelector<HTMLButtonElement>("button[data-cancel]")
            ?.focus();
        }}
      >
        {threads.length === 1 ? "Delete thread" : `Delete selected (${threads.length})`}
      </button>
      <dialog
        ref={dialog}
        className="thread-delete-dialog"
        aria-labelledby={titleId}
        onCancel={(event) => {
          if (action.busy) event.preventDefault();
        }}
      >
        <h2 id={titleId}>
          Permanently delete{" "}
          {selection.length === 1 ? "this thread" : `${selection.length} threads`}?
        </h2>
        <p>This cannot be undone. The following will be removed:</p>
        <ul>
          <li>
            Selected feedback, every point and annotation, discussions, replies and review
            history.
          </li>
          <li>
            All screenshots, recordings, thumbnails and files owned by these threads,
            including their current private storage objects.
          </li>
          <li>
            Guest discussion links and saved project export snapshots containing feedback.
          </li>
        </ul>
        <p>
          Shared project documents and linked GitHub issues stay available. Archive keeps
          the feedback and attachments if you only want to hide them from the inbox.
        </p>
        <p>
          Storage failures remain visible in the cleanup panel. Older object versions,
          retention-locked copies and backups follow your storage provider’s retention
          settings.
        </p>
        <details>
          <summary>Review selected feedback ({selection.length})</summary>
          <ul>
            {selection.map((thread) => (
              <li key={thread.id}>{thread.body.slice(0, 160)}</li>
            ))}
          </ul>
        </details>
        <ActionState action={action} />
        <div className="actions">
          <button
            type="button"
            data-cancel
            autoFocus
            disabled={action.busy}
            onClick={() => dialog.current?.close()}
          >
            Cancel
          </button>
          <button
            type="button"
            className="danger"
            disabled={action.busy}
            onClick={() =>
              void action.run(async () => {
                await api<Receipt>("threads.delete", {
                  projectId,
                  threads: selection.map((thread) => ({
                    threadId: thread.id,
                    revision: thread.revision,
                  })),
                  idempotencyKey: request.current,
                  confirmation: "DELETE",
                });
                dialog.current?.close();
                onDeleted();
              })
            }
          >
            {action.busy
              ? "Deleting…"
              : `Permanently delete ${selection.length === 1 ? "thread" : `${selection.length} threads`}`}
          </button>
        </div>
      </dialog>
    </>
  );
}

export function ThreadDeletionCleanup({
  projectId,
  version,
}: {
  projectId: string;
  version: number;
}) {
  const [refresh, setRefresh] = useState(0);
  const action = useAction();
  const { data, error } = useLoad(
    () => api<{ items: Receipt[] }>("threads.deletions", { projectId }),
    [projectId, version, refresh],
    true,
  );
  const pending = data?.items.filter((item) => item.cleanup.state !== "complete") ?? [];
  useEffect(() => {
    if (!pending.length) return;
    const timer = window.setInterval(() => setRefresh((value) => value + 1), 30000);
    return () => window.clearInterval(timer);
  }, [pending.length]);
  return (
    <>
      <ErrorNotice
        error={error ? `Could not check deleted-file cleanup: ${error}` : ""}
      />
      {error && (
        <button onClick={() => setRefresh((value) => value + 1)}>
          Retry cleanup status
        </button>
      )}
      {pending.length > 0 && (
        <details className="thread-cleanup" open>
          <summary>
            Deleted feedback · {pending.length} cleanup{" "}
            {pending.length === 1 ? "batch needs" : "batches need"} attention
          </summary>
          <p>
            Thread content is deleted. Each cleanup retry removes up to 12 current storage
            objects. Older versions, retention locks and backups follow storage settings;
            this is not proof of physical erasure.
          </p>
          <ActionState action={action} />
          {pending.map((item) => (
            <div className="thread-cleanup-row" key={item.id}>
              <span>
                {item.deletedCount} {item.deletedCount === 1 ? "thread" : "threads"}{" "}
                deleted · {new Date(item.createdAt).toLocaleString()} ·{" "}
                {item.cleanup.remaining} files{" "}
                {item.cleanup.state === "failed" ? "failed or pending" : "pending"}
              </span>
              <button
                disabled={action.busy}
                onClick={() =>
                  void action.run(async () => {
                    await api("threads.retryDeletion", {
                      projectId,
                      deletionId: item.id,
                    });
                    setRefresh((value) => value + 1);
                  })
                }
              >
                {item.cleanup.state === "failed"
                  ? "Retry file cleanup"
                  : "Check file cleanup now"}
              </button>
            </div>
          ))}
        </details>
      )}
    </>
  );
}

export function ArchiveThreadButton({
  thread,
  onSaved,
}: {
  thread: Thread;
  onSaved: (thread: Thread) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const action = useAction();
  const titleId = React.useId();
  return (
    <>
      <button
        type="button"
        onClick={() => {
          dialog.current?.showModal();
          dialog.current
            ?.querySelector<HTMLButtonElement>("button[data-cancel]")
            ?.focus();
        }}
      >
        {thread.archived ? "Unarchive thread" : "Archive thread"}
      </button>
      <dialog
        ref={dialog}
        className="thread-delete-dialog"
        aria-labelledby={titleId}
        onCancel={(event) => {
          if (action.busy) event.preventDefault();
        }}
      >
        <h2 id={titleId}>
          {thread.archived ? "Return this thread to the inbox?" : "Archive this thread?"}
        </h2>
        <p>
          {thread.archived
            ? "This thread returns to the feedback inbox, subject to its status filters."
            : "This thread moves from the inbox to Archive. Open Archive from the feedback list to find or restore it."}
        </p>
        <p>
          All screenshots, recordings, files, points, discussions and reviews are kept.
          Guest discussion links remain active. No storage objects are deleted.
        </p>
        <ActionState action={action} />
        <div className="actions">
          <button
            type="button"
            data-cancel
            autoFocus
            disabled={action.busy}
            onClick={() => dialog.current?.close()}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={action.busy}
            onClick={() =>
              void action.run(async () => {
                const updated = await api<Thread>("threads.archive", {
                  threadId: thread.id,
                  revision: thread.revision,
                  archived: !thread.archived,
                });
                onSaved(updated);
                dialog.current?.close();
              })
            }
          >
            {thread.archived ? "Confirm unarchive" : "Confirm archive"}
          </button>
        </div>
      </dialog>
    </>
  );
}
