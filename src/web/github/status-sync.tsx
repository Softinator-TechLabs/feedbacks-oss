import React, { useEffect, useState } from "react";
import { api, type Project, type Thread } from "../api.js";
import { ActionState, useAction } from "../ui.js";

type SyncState = {
  status: "disabled" | "pending" | "ready" | "conflict" | "uncertain" | "error";
  issueUrl: string | null;
  feedbacksState: string | null;
  githubState: "open" | "closed" | null;
  pendingTarget: "open" | "closed" | null;
  errorCode: string | null;
};

export function GithubStatusSync({
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
