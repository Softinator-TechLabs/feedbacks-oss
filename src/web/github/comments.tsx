import React, { useEffect, useRef, useState } from "react";
import { api, type Project, type Thread } from "../api.js";
import { ActionState, Field, useAction } from "../ui.js";
import { useUnsavedChanges } from "../navigation.js";

type Comment = {
  id: number;
  url: string;
  body: string;
  author: string | null;
  createdAt: string;
};
type Job = {
  id: string;
  issueUrl: string;
  status: string;
  errorCode: string | null;
  commentId: number | null;
  commentUrl: string | null;
  historical: boolean;
};
type Page = { items: Comment[]; page: number; hasMore: boolean };

export function GithubComments({
  thread,
  project,
}: {
  thread: Thread;
  project: Project;
}) {
  const action = useAction();
  const [open, setOpen] = useState(false);
  const [issueUrl, setIssueUrl] = useState("");
  const [body, setBody] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [page, setPage] = useState<Page | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [historyError, setHistoryError] = useState(false);
  const keys = useRef(new Map<string, string>());
  useUnsavedChanges(!!body.trim());
  const repositories = project.githubRepositories?.length
    ? project.githubRepositories
    : project.repositoryUrl
      ? [project.repositoryUrl]
      : [];
  const issues = (thread.externalIssues ?? []).filter(
    (issue) =>
      issue.verification === "github_verified" &&
      project.githubConnected &&
      repositories.some((repo) =>
        issue.url
          .toLowerCase()
          .startsWith(`${repo.replace(/\/$/, "").toLowerCase()}/issues/`),
      ),
  );
  const destination =
    issues.find((issue) => issue.url === issueUrl)?.url ??
    (issues.length === 1 ? issues[0].url : "");
  useEffect(() => {
    setPage(null);
  }, [destination]);
  const refresh = async () => {
    const result = await api<{ items: Job[] }>("github.commentHistory", {
      threadId: thread.id,
    });
    setJobs(result.items);
    setHistoryError(false);
  };
  useEffect(() => {
    if (!open) return;
    let active = true;
    const load = () =>
      void api<{ items: Job[] }>("github.commentHistory", { threadId: thread.id })
        .then((value) => {
          if (active) {
            setJobs(value.items);
            setHistoryError(false);
          }
        })
        .catch(() => {
          if (active) setHistoryError(true);
        });
    load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [open, thread.id, thread.revision]);
  return (
    <details
      className="github-status-sync"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Issue discussion</summary>
      <p className="muted">
        Read linked Issue comments or send reviewed text through the connected GitHub App.
        Feedbacks discussions are shared only when you write and send a comment here.
      </p>
      {issues.length > 1 && (
        <Field label="Comment destination">
          <select
            value={destination}
            disabled={action.busy}
            onChange={(event) => {
              setIssueUrl(event.target.value);
              setReviewed(false);
            }}
          >
            <option value="">Choose a linked Issue</option>
            {issues.map((issue) => (
              <option key={issue.url} value={issue.url}>
                {issue.url}
              </option>
            ))}
          </select>
        </Field>
      )}
      {destination ? (
        <>
          <p>
            <a href={destination} target="_blank" rel="noreferrer">
              Open destination Issue
            </a>
          </p>
          <button
            type="button"
            disabled={action.busy}
            onClick={() =>
              void action.run(async () =>
                setPage(
                  await api<Page>("github.comments", {
                    threadId: thread.id,
                    issueUrl: destination,
                    page: 1,
                  }),
                ),
              )
            }
          >
            Load GitHub comments
          </button>
          {page && (
            <section aria-label="GitHub comments">
              <p className="muted">
                Page {page.page}, up to 20 comments. Each comment shows up to 12,000
                characters.
              </p>
              {page.items.length ? (
                page.items.map((comment) => (
                  <article key={comment.id}>
                    <a href={comment.url} target="_blank" rel="noreferrer">
                      {comment.author ?? "GitHub user"} ·{" "}
                      {new Date(comment.createdAt).toLocaleString()}
                    </a>
                    <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                      {comment.body}
                    </p>
                  </article>
                ))
              ) : (
                <p>No comments on this page.</p>
              )}
              <div className="form-end">
                <button
                  type="button"
                  disabled={action.busy || page.page <= 1}
                  onClick={() =>
                    void action.run(async () =>
                      setPage(
                        await api<Page>("github.comments", {
                          threadId: thread.id,
                          issueUrl: destination,
                          page: page.page - 1,
                        }),
                      ),
                    )
                  }
                >
                  Previous comments
                </button>
                <button
                  type="button"
                  disabled={action.busy || !page.hasMore || page.page >= 1000}
                  onClick={() =>
                    void action.run(async () =>
                      setPage(
                        await api<Page>("github.comments", {
                          threadId: thread.id,
                          issueUrl: destination,
                          page: page.page + 1,
                        }),
                      ),
                    )
                  }
                >
                  Next comments
                </button>
              </div>
            </section>
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void action.run(async () => {
                const input = {
                  threadId: thread.id,
                  revision: thread.revision,
                  issueUrl: destination,
                  reviewed: true as const,
                  body: body.trim(),
                };
                const fingerprint = JSON.stringify(input),
                  key = keys.current.get(fingerprint) ?? crypto.randomUUID();
                keys.current.set(fingerprint, key);
                await api("github.commentQueue", { ...input, idempotencyKey: key });
                keys.current.delete(fingerprint);
                setBody("");
                setReviewed(false);
                await refresh();
              }, "Reviewed GitHub comment queued. Check delivery below.");
            }}
          >
            <Field label="Comment text">
              <textarea
                disabled={action.busy}
                rows={4}
                maxLength={12000}
                value={body}
                onChange={(event) => {
                  setBody(event.target.value);
                  setReviewed(false);
                }}
                required
              />
            </Field>
            {body.trim() && (
              <details>
                <summary>Preview exact comment text</summary>
                <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                  {body.trim()}
                </p>
              </details>
            )}
            <label className="check">
              <input
                type="checkbox"
                disabled={action.busy}
                checked={reviewed}
                onChange={(event) => setReviewed(event.target.checked)}
              />{" "}
              I reviewed this text and destination for sharing on GitHub.
            </label>
            <button disabled={action.busy || !reviewed || !body.trim()}>
              Queue GitHub comment
            </button>
          </form>
        </>
      ) : (
        <p className="muted">
          Connect the original GitHub App and a verified linked Issue to send or read
          comments.
        </p>
      )}
      {historyError && (
        <p role="alert">
          Could not load comment delivery history.{" "}
          <button type="button" onClick={() => void action.run(refresh)}>
            Retry history
          </button>
        </p>
      )}
      {jobs.length > 0 && (
        <section aria-label="GitHub comment deliveries">
          <h3>Comment deliveries</h3>
          {jobs.map((job) => (
            <article key={job.id}>
              <p>
                {job.historical ? "Historical · " : ""}
                {job.status}
                {job.errorCode ? ` · ${job.errorCode}` : ""}
                {job.commentUrl && (
                  <>
                    {" "}
                    ·{" "}
                    <a href={job.commentUrl} target="_blank" rel="noreferrer">
                      View comment
                    </a>
                  </>
                )}
              </p>
              {job.status === "uncertain" && !job.historical && (
                <Reconcile
                  job={job}
                  busy={action.busy}
                  run={(operation) =>
                    action.run(async () => {
                      await operation();
                      await refresh();
                    }, "Comment delivery reconciled.")
                  }
                />
              )}
            </article>
          ))}
        </section>
      )}
      <ActionState action={action} />
    </details>
  );
}

function Reconcile({
  job,
  busy,
  run,
}: {
  job: Job;
  busy: boolean;
  run: (operation: () => Promise<unknown>) => Promise<unknown>;
}) {
  const [commentId, setCommentId] = useState(String(job.commentId ?? "")),
    [confirmed, setConfirmed] = useState(false);
  return (
    <details>
      <summary>Check uncertain delivery</summary>
      <p>
        The last write may have succeeded.{" "}
        <a href={job.issueUrl} target="_blank" rel="noreferrer">
          Inspect the Issue
        </a>{" "}
        before resolving it. A new comment requires a separate reviewed send.
      </p>
      <Field label="Actual GitHub comment ID">
        <input
          type="number"
          min="1"
          max={Number.MAX_SAFE_INTEGER}
          step="1"
          value={commentId}
          onChange={(event) => setCommentId(event.target.value)}
        />
      </Field>
      <label className="check">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
        />{" "}
        I checked the destination Issue.
      </label>
      <div className="form-end">
        <button
          type="button"
          disabled={
            busy ||
            !confirmed ||
            !Number.isSafeInteger(Number(commentId)) ||
            Number(commentId) < 1
          }
          onClick={() =>
            void run(() =>
              api("github.commentReconcile", {
                jobId: job.id,
                outcome: "delivered",
                commentId: Number(commentId),
                confirmed: true,
              }),
            )
          }
        >
          Verify delivered comment
        </button>
        <button
          type="button"
          disabled={busy || !confirmed}
          onClick={() =>
            void run(() =>
              api("github.commentReconcile", {
                jobId: job.id,
                outcome: "not_delivered",
                confirmed: true,
              }),
            )
          }
        >
          Confirm absent and retire action
        </button>
      </div>
    </details>
  );
}
