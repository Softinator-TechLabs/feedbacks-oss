import React, { useEffect, useState } from "react";
import { api, type Project, type Thread } from "./api.js";
import { ActionState, Field, useAction } from "./ui.js";
import { useUnsavedChanges } from "./navigation.js";

type Draft = {
  title: string;
  body: string;
  repositoryUrl: string | null;
  revision: number;
};
type RequestState = {
  status: "none" | "pending" | "linked";
  issueUrl: string | null;
  canAbandon: boolean;
};

export function GithubIssue({
  thread,
  project,
  onSaved,
}: {
  thread: Thread;
  project: Project;
  onSaved: (thread: Thread) => void;
}) {
  const action = useAction();
  const [request, setRequest] = useState<RequestState | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [requestKey, setRequestKey] = useState("");
  const [issueUrl, setIssueUrl] = useState("");
  const [confirmedAbsent, setConfirmedAbsent] = useState(false);
  useUnsavedChanges(!!draft);
  const refresh = () =>
    api<RequestState>("github.issueState", { threadId: thread.id }).then((value) => {
      setRequest(value);
      setLoadError(false);
    });
  useEffect(() => {
    let active = true;
    void api<RequestState>("github.issueState", { threadId: thread.id })
      .then((value) => {
        if (active) setRequest(value);
      })
      .catch(() => {
        if (active) {
          setRequest(null);
          setLoadError(true);
        }
      });
    return () => {
      active = false;
    };
  }, [thread.id]);
  if (!project.permissions.canMaintain) return null;
  return (
    <div className="github-issue-control">
      {loadError && (
        <p role="alert">
          Could not load the GitHub request state.{" "}
          <button
            type="button"
            onClick={() => void refresh().catch(() => setLoadError(true))}
          >
            Retry
          </button>
        </p>
      )}
      {request?.status === "pending" ? (
        <>
          <p>
            The last Issue request may have succeeded. Check GitHub before entering its
            URL. Feedbacks will not create it again automatically.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void action.run(async () => {
                const saved = await api<Thread>("github.issueReconcile", {
                  threadId: thread.id,
                  revision: thread.revision,
                  issueUrl,
                });
                onSaved(saved);
                await refresh();
              }, "GitHub Issue verified and linked.");
            }}
          >
            <Field label="Created Issue URL">
              <input
                type="url"
                value={issueUrl}
                onChange={(event) => setIssueUrl(event.target.value)}
                placeholder="https://github.com/org/repo/issues/123"
                required
              />
            </Field>
            <button disabled={action.busy}>Verify and link Issue</button>
          </form>
          {!request.canAbandon && (
            <p className="muted">
              Wait 10 minutes for the request to settle before clearing it.
            </p>
          )}
          <label className="check">
            <input
              type="checkbox"
              checked={confirmedAbsent}
              disabled={!request.canAbandon}
              onChange={(event) => setConfirmedAbsent(event.target.checked)}
            />{" "}
            I checked the connected repository and confirmed no Issue was created.
          </label>
          <button
            type="button"
            disabled={action.busy || !request.canAbandon || !confirmedAbsent}
            onClick={() =>
              void action.run(async () => {
                await api("github.issueAbandon", {
                  threadId: thread.id,
                  revision: thread.revision,
                  confirmedAbsent: true,
                });
                setConfirmedAbsent(false);
                setDraft(null);
                await refresh();
              }, "Pending request cleared. You can prepare a new Issue.")
            }
          >
            Clear pending request
          </button>
        </>
      ) : request?.status === "linked" && request.issueUrl ? (
        <button
          type="button"
          disabled={action.busy}
          onClick={() =>
            void action.run(async () => {
              const saved = await api<Thread>("github.issueRefresh", {
                threadId: thread.id,
                revision: thread.revision,
                issueUrl: request.issueUrl!,
              });
              onSaved(saved);
            }, "GitHub Issue state refreshed.")
          }
        >
          Refresh Issue state
        </button>
      ) : !project.githubConnected ? (
        <p className="muted">
          Connect the GitHub App in project settings to create or refresh Issues.
        </p>
      ) : request?.status !== "linked" && !draft ? (
        <button
          type="button"
          disabled={action.busy || request === null}
          onClick={() =>
            void action.run(async () => {
              const value = await api<Draft>("threads.issueDraft", {
                threadId: thread.id,
              });
              setDraft(value);
              setTitle(value.title);
              setBody(value.body);
              setReviewed(false);
              setRequestKey(crypto.randomUUID());
            })
          }
        >
          Prepare GitHub Issue
        </button>
      ) : request?.status !== "linked" && draft ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!reviewed) return;
            void action.run(async () => {
              try {
                const saved = await api<Thread>("github.issueCreate", {
                  threadId: thread.id,
                  revision: draft.revision,
                  reviewed: true,
                  title,
                  body,
                  idempotencyKey: requestKey,
                });
                onSaved(saved);
                setDraft(null);
              } finally {
                await refresh();
              }
            }, "GitHub Issue created and linked.");
          }}
        >
          <p>
            Review this draft for accuracy and private information. Screenshots and
            private reviewer notes are not included.
          </p>
          <Field label="Issue title">
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={120}
              required
            />
          </Field>
          <Field label="Issue description">
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              maxLength={8000}
              rows={7}
              required
            />
          </Field>
          <label className="check">
            <input
              type="checkbox"
              checked={reviewed}
              onChange={(event) => setReviewed(event.target.checked)}
            />{" "}
            I reviewed this Issue for accuracy and private information.
          </label>
          <div className="form-end">
            <button type="button" onClick={() => setDraft(null)}>
              Cancel
            </button>
            <button className="primary" disabled={action.busy || !reviewed}>
              Create GitHub Issue
            </button>
          </div>
        </form>
      ) : null}
      <ActionState action={action} />
    </div>
  );
}
