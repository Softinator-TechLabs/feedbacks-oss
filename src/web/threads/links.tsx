import React from "react";
import type { Thread } from "../api.js";
import { ExternalLink, Field } from "../ui.js";
import { HumanTime } from "../human-time.js";

type LinkOperation = "threads.linkIssue" | "threads.figmaReference" | "threads.evidence";

export function ThreadLinks({
  thread,
  canWrite,
  canMaintain,
  busy,
  mutate,
}: {
  thread: Thread;
  canWrite: boolean;
  canMaintain: boolean;
  busy: boolean;
  mutate: (operation: LinkOperation, input: Record<string, unknown>) => Promise<void>;
}) {
  return (
    <>
      <details className="section compact-details" id="thread-issues">
        <summary>Linked issues</summary>
        {thread.externalIssues?.length ? (
          thread.externalIssues.map((issue) => (
            <p key={issue.url}>
              <strong>
                {issue.provider === "jira"
                  ? "Jira"
                  : issue.provider === "linear"
                    ? "Linear"
                    : "GitHub"}
              </strong>{" "}
              <ExternalLink href={issue.url}>{issue.url}</ExternalLink>
              <small>
                {issue.verification === "github_verified"
                  ? "Verified by GitHub"
                  : "Reported · not remotely verified"}
                {issue.state ? ` · ${issue.state}` : ""}
                {issue.linkedBy ? ` · ${issue.linkedBy.name}` : ""}
              </small>
            </p>
          ))
        ) : (
          <p className="muted">No Issue registered.</p>
        )}
        {canWrite && (
          <>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void mutate("threads.linkIssue", { url: f.get("url") });
              }}
            >
              <Field label="GitHub, Jira Cloud or Linear Issue URL">
                <input
                  name="url"
                  type="url"
                  required
                  placeholder="https://linear.app/team/issue/ENG-123"
                />
              </Field>
              <button disabled={busy}>Register Issue</button>
            </form>
          </>
        )}
      </details>
      <details className="section compact-details" id="thread-figma-reference">
        <summary>Figma design reference</summary>
        {thread.figmaReference ? (
          <p>
            <ExternalLink href={thread.figmaReference.url}>Open Figma file</ExternalLink>
            <small>
              Linked by {thread.figmaReference.linkedBy.name} ·{" "}
              <HumanTime at={thread.figmaReference.linkedAt} />
            </small>
          </p>
        ) : (
          <p className="muted">No Figma file linked.</p>
        )}
        {canMaintain && (
          <>
            <p className="muted">
              Register a Figma file after agreeing on design work. This saves the file
              link here; it does not copy feedback or screenshots to Figma. Check access
              in Figma before sharing the file.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void mutate("threads.figmaReference", { url: f.get("url") });
              }}
            >
              <Field label="Figma file URL">
                <input
                  key={thread.figmaReference?.url ?? "empty"}
                  name="url"
                  type="url"
                  defaultValue={thread.figmaReference?.url ?? ""}
                  required
                  placeholder="https://www.figma.com/design/..."
                />
              </Field>
              <div className="figma-reference-actions">
                <button disabled={busy}>
                  {thread.figmaReference ? "Replace reference" : "Link Figma file"}
                </button>
                {thread.figmaReference && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void mutate("threads.figmaReference", { url: null })}
                  >
                    Remove reference
                  </button>
                )}
              </div>
            </form>
          </>
        )}
      </details>
      <details className="section compact-details">
        <summary>Delivery evidence</summary>
        {thread.fixEvidence?.length ? (
          thread.fixEvidence.map((item, n) => (
            <div key={n}>
              <ExternalLink href={item.url}>
                {item.kind.replaceAll("_", " ")}
              </ExternalLink>
              <p className="message">{item.note}</p>
            </div>
          ))
        ) : (
          <p className="muted">No delivery evidence recorded.</p>
        )}
        {canWrite && (
          <>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void mutate("threads.evidence", {
                  url: f.get("url"),
                  note: f.get("note"),
                  kind: f.get("kind"),
                });
              }}
            >
              <Field label="Evidence type">
                <select name="kind">
                  {["commit", "pull_request", "variant", "incorporated_in"].map((k) => (
                    <option key={k} value={k}>
                      {k.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Evidence URL">
                <input name="url" type="url" required />
              </Field>
              <Field label="What does this demonstrate?">
                <textarea name="note" required maxLength={12000} />
              </Field>
              <button disabled={busy}>Add evidence</button>
            </form>
          </>
        )}
      </details>
    </>
  );
}
