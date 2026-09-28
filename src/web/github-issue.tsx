import React, { useEffect, useRef, useState } from "react";
import { api, type Project, type Thread } from "./api.js";
import { ActionState, ErrorNotice, Field, useAction, useLoad } from "./ui.js";
import { Icon } from "./icons.js";
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
  onViewIssues,
}: {
  thread: Thread;
  project: Project;
  onSaved: (thread: Thread) => void;
  onViewIssues: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
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
  const [destination, setDestination] = useState("");
  const connection = useLoad<{
    configured: boolean;
    installation:
      | "not_configured"
      | "no_repository"
      | "installed"
      | "not_installed"
      | "unavailable";
    repositories: {
      repositoryUrl: string;
      connected: boolean;
      installation: "installed" | "not_installed" | "unavailable";
    }[];
  }>(
    () => api("github.connection", { projectId: project.id }),
    [project.id, project.revision],
  );
  useUnsavedChanges(!!draft);
  const repositories =
    connection.data?.repositories.filter((repo) => repo.connected) ?? [];
  const selectedRepository =
    repositories.find((repo) => repo.repositoryUrl === destination) ??
    (repositories.length === 1 ? repositories[0] : undefined);
  const issueReady = selectedRepository?.installation === "installed";
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
  useEffect(() => {
    if (request?.status === "pending" || action.error) dialog.current?.showModal();
  }, [request?.status, action.error]);
  const createIssue = () =>
    void action.run(async () => {
      const key = requestKey || crypto.randomUUID();
      setRequestKey(key);
      try {
        const saved = await api<Thread>("github.issueCreateQuick", {
          threadId: thread.id,
          revision: thread.revision,
          idempotencyKey: key,
          repositoryUrl: selectedRepository?.repositoryUrl,
        });
        onSaved(saved);
      } finally {
        await refresh();
      }
    }, "GitHub Issue created and linked.");
  const manual =
    connection.data && (!connection.data.configured || !project.githubConnected);
  const label = action.busy
    ? "Creating GitHub issue…"
    : manual
      ? "View or link issues"
      : request?.status === "linked"
        ? "View GitHub issue"
        : request?.status === "pending"
          ? "Check GitHub issue request"
          : connection.error || loadError
            ? "Check GitHub connection"
            : "Create GitHub issue";
  if (!project.permissions.canMaintain) return null;
  return (
    <>
      <button
        type="button"
        className="thread-icon-button"
        aria-label={label}
        data-tooltip={label}
        disabled={
          action.busy ||
          (!connection.data && !connection.error) ||
          (!manual && request === null && !loadError)
        }
        aria-busy={action.busy}
        onClick={() => {
          if (manual) return onViewIssues();
          if (issueReady && request?.status === "none" && !draft && !connection.error)
            createIssue();
          else dialog.current?.showModal();
        }}
      >
        <Icon
          name={
            manual || request?.status === "linked"
              ? "link"
              : request?.status === "pending" || loadError || connection.error
                ? "issue"
                : "issueCreate"
          }
        />
      </button>
      <span className="sr-only" role="status">
        {action.notice}
      </span>
      <dialog
        ref={dialog}
        className="github-issue-dialog"
        id="thread-github"
        aria-label="GitHub issue"
        onCancel={(event) => {
          if (action.busy) event.preventDefault();
        }}
      >
        <div className="github-dialog-heading">
          <h2>GitHub issue</h2>
          <button
            type="button"
            disabled={action.busy}
            onClick={() => dialog.current?.close()}
          >
            Close
          </button>
        </div>
        <section className="github-issue-control" aria-label="GitHub Issue">
          <div className="github-issue-summary">
            <div>
              <strong>GitHub</strong>{" "}
              <span className="muted">
                {connection.error
                  ? "Could not check connection"
                  : !connection.data
                    ? "Checking connection…"
                    : !connection.data.configured
                      ? "App not configured"
                      : !project.githubConnected
                        ? "Project not connected"
                        : selectedRepository?.installation === "not_installed"
                          ? "App not installed on this repository"
                          : selectedRepository?.installation === "unavailable"
                            ? "Connection needs checking"
                            : repositories.length > 1 && !selectedRepository
                              ? "Choose an Issue repository"
                              : request?.status === "linked"
                                ? "Issue linked"
                                : "Ready to create an Issue"}
              </span>
            </div>
            <a href={`/projects/${project.id}/github`}>GitHub settings</a>
          </div>
          <ErrorNotice error={connection.error} />
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
                The last Issue request may have succeeded. Check GitHub before entering
                its URL. Feedbacks will not create it again automatically.
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
            <div className="github-issue-actions">
              <a href={request.issueUrl} target="_blank" rel="noopener noreferrer">
                Open GitHub Issue ↗
              </a>
              <button
                type="button"
                className="text-button"
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
                Refresh state
              </button>
            </div>
          ) : !project.githubConnected ? (
            <p className="muted">
              <a href={`/projects/${project.id}/github`}>Connect GitHub</a> to create
              Issues from this feedback.
            </p>
          ) : request?.status !== "linked" && !draft ? (
            <>
              {repositories.length > 1 && (
                <Field label="Create Issue in">
                  <select
                    value={selectedRepository?.repositoryUrl ?? ""}
                    onChange={(event) => setDestination(event.target.value)}
                  >
                    <option value="">Choose a repository</option>
                    {repositories.map((repo) => (
                      <option key={repo.repositoryUrl} value={repo.repositoryUrl}>
                        {repo.repositoryUrl.replace("https://github.com/", "")}
                        {repo.installation !== "installed"
                          ? " · App access unavailable"
                          : ""}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <div className="github-issue-actions">
                <button
                  className="primary"
                  type="button"
                  disabled={
                    action.busy || request === null || !!connection.error || !issueReady
                  }
                  onClick={createIssue}
                >
                  Create Issue
                </button>
                <button
                  type="button"
                  className="text-button"
                  disabled={action.busy || !issueReady}
                  onClick={() =>
                    void action.run(async () => {
                      const value = await api<Draft>("threads.issueDraft", {
                        threadId: thread.id,
                        repositoryUrl: selectedRepository?.repositoryUrl,
                      });
                      setDraft(value);
                      setTitle(value.title);
                      setBody(value.body);
                      setReviewed(false);
                      setRequestKey(crypto.randomUUID());
                    })
                  }
                >
                  Review/edit first
                </button>
                <span className="muted">Images and videos are linked automatically.</span>
              </div>
            </>
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
                      repositoryUrl: selectedRepository?.repositoryUrl,
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
                <button
                  className="primary"
                  disabled={action.busy || !reviewed || !issueReady}
                >
                  Create GitHub Issue
                </button>
              </div>
            </form>
          ) : null}
          <GithubStatusSync thread={thread} project={project} onSaved={onSaved} />
          <ActionState action={action} />
          <button
            type="button"
            className="text-button"
            onClick={() => {
              dialog.current?.close();
              onViewIssues();
            }}
          >
            View or link other issues
          </button>
        </section>
      </dialog>
    </>
  );
}

type SyncState = {
  status: "disabled" | "pending" | "ready" | "conflict" | "uncertain" | "error";
  issueUrl: string | null;
  feedbacksState: string | null;
  githubState: "open" | "closed" | null;
  pendingTarget: "open" | "closed" | null;
  errorCode: string | null;
};

function GithubStatusSync({
  thread,
  project,
  onSaved,
}: {
  thread: Thread;
  project: Project;
  onSaved: (thread: Thread) => void;
}) {
  const action = useAction();
  const [sync, setSync] = useState<SyncState | null>(null);
  const [loadError, setLoadError] = useState(false);
  const repositories = project.githubRepositories?.length
    ? project.githubRepositories
    : project.repositoryUrl
      ? [project.repositoryUrl]
      : [];
  const link = thread.externalIssues?.find(
    (issue) =>
      issue.verification === "github_verified" &&
      repositories.some((repository) =>
        issue.url
          .toLowerCase()
          .startsWith(`${repository.replace(/\/$/, "").toLowerCase()}/issues/`),
      ),
  );
  useEffect(() => {
    if (!link || !project.githubStatusSync) return;
    let active = true;
    const refresh = () =>
      void api<SyncState>("github.statusSyncState", { threadId: thread.id })
        .then((value) => {
          if (active) {
            setSync(value);
            setLoadError(false);
          }
        })
        .catch(() => {
          if (active) setLoadError(true);
        });
    refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 15000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [thread.id, thread.revision, link?.url, project.githubStatusSync]);
  if (!link || !project.githubStatusSync) return null;
  const synchronize = (source: "github" | "feedbacks") =>
    void action.run(
      async () => {
        const saved = await api<Thread>("github.statusSync", {
          threadId: thread.id,
          revision: thread.revision,
          issueUrl: link.url,
          source,
        });
        onSaved(saved);
        setSync(await api<SyncState>("github.statusSyncState", { threadId: thread.id }));
      },
      source === "github"
        ? "Thread status updated from GitHub."
        : "Issue state updated from Feedbacks.",
    );
  return (
    <details
      className="github-status-sync"
      aria-label="GitHub status sync"
      open={
        sync?.status === "conflict" ||
        sync?.status === "uncertain" ||
        sync?.status === "error"
          ? true
          : undefined
      }
    >
      <summary>
        Issue status sync
        {sync?.status === "ready"
          ? " · Up to date"
          : sync?.status === "conflict" ||
              sync?.status === "uncertain" ||
              sync?.status === "error"
            ? " · Needs attention"
            : ""}
      </summary>
      <p className="muted">
        GitHub open/closed ↔ Feedbacks open/resolved. In progress and ready for review
        stay open on GitHub.
      </p>
      {loadError && (
        <p role="alert">Could not load status sync state. Reload this thread to retry.</p>
      )}
      {sync?.status === "conflict" && (
        <p role="alert">
          Both sides changed, or their starting statuses differed. Review the Issue and
          thread, then choose which status to keep.
        </p>
      )}
      {sync?.status === "uncertain" && (
        <p role="alert">
          A GitHub update may have succeeded. Inspect the Issue before choosing a status
          below. Automatic writes are paused for this thread.
        </p>
      )}
      {sync?.status === "error" && (
        <p role="alert">
          GitHub status check failed ({sync.errorCode}).{" "}
          {sync.errorCode === "GITHUB_UNAVAILABLE"
            ? "Check the GitHub App configuration and connection."
            : "The server will retry the read."}{" "}
          No status was changed.
        </p>
      )}
      {sync?.status === "ready" && (
        <p className="muted">
          Last agreed: GitHub {sync.githubState}, Feedbacks{" "}
          {sync.feedbacksState?.replaceAll("_", " ")}.
        </p>
      )}
      {sync?.status === "disabled" && (
        <p className="muted">Status sync is off for this project.</p>
      )}
      {project.githubStatusSync && project.githubConnected && (
        <div className="form-end">
          <button
            type="button"
            disabled={action.busy || !sync || loadError}
            onClick={() => synchronize("github")}
          >
            Use GitHub status
          </button>
          <button
            type="button"
            disabled={
              action.busy || !sync || loadError || thread.work.state === "declined"
            }
            onClick={() => synchronize("feedbacks")}
          >
            Send Feedbacks status to GitHub
          </button>
        </div>
      )}
      <ActionState action={action} />
    </details>
  );
}
