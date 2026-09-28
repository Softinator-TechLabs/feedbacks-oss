import React, { useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { z } from "zod";
import { tagsSchema, type Delegation, type inputSchemas } from "../shared/contracts.js";
import { api, labels, uid, type Project, type Thread } from "./api.js";
import {
  ActionState,
  ErrorNotice,
  Field,
  Loading,
  Notice,
  useAction,
  useLoad,
} from "./ui.js";
import { HumanTime } from "./human-time.js";
import { useUnsavedChanges } from "./navigation.js";
import { categories, splitTags } from "./review-filters.js";
import {
  assignmentActor,
  assignmentPoints,
  assignmentRetry,
  assignmentScope,
  writableAssignees,
  type Assignee,
} from "./assignment-model.js";

type DelegationPage = { items: Delegation[]; total: number; nextOffset: number | null };
type HistoryPage = {
  items: Array<{
    id: string;
    delegationId: string;
    action: "assigned" | "reassigned" | "cancelled";
    revision: number;
    actor: Delegation["updatedBy"];
    reason: string;
    assignment: Delegation;
    createdAt: string;
  }>;
  total: number;
  nextOffset: number | null;
};
type ClaimPage = {
  items: Array<{
    id: string;
    memberName: string;
    agentName: string;
    annotationIds: string[];
    expiresAt: string;
  }>;
  total: number;
  nextOffset: number | null;
};
type AssignInput = Omit<
  z.input<(typeof inputSchemas)["assignments.assign"]>,
  "idempotencyKey"
>;
const decisions = {
  undecided: "Undecided",
  create_issue: "Create GitHub issue",
  not_needed: "GitHub issue not needed",
  already_linked: "GitHub issue already linked",
} as const;

export function canAssignThread(thread: Thread) {
  return (
    !thread.archived &&
    !["resolved", "declined"].includes(thread.work.state) &&
    (!thread.context.annotations?.length || assignmentPoints(thread).length > 0)
  );
}

export function ThreadAssignments({
  thread,
  project,
  toolbar,
  onRefresh,
  onGithub,
}: {
  thread: Thread;
  project: Project;
  toolbar: HTMLElement | null;
  onRefresh: () => Promise<Thread>;
  onGithub: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState<Delegation | "new" | null>(null);
  const [version, setVersion] = useState(0);
  const [offset, setOffset] = useState(0);
  const section = useRef<HTMLElement>(null);
  const quick = useAction();
  const pending = useRef(false);
  const retry = useRef<ReturnType<typeof assignmentRetry<AssignInput>> | undefined>(
    undefined,
  );
  const members = useLoad(
    () => api<{ items: Assignee[] }>("members.list", { projectId: project.id }),
    [project.id, version],
  );
  const active = useLoad(
    () =>
      api<DelegationPage>("assignments.delegations", {
        projectId: project.id,
        threadId: thread.id,
        state: "active",
        offset: 0,
        limit: 50,
      }),
    [thread.id, thread.revision, version],
    true,
  );
  const all = useLoad(
    () =>
      expanded
        ? api<DelegationPage>("assignments.delegations", {
            projectId: project.id,
            threadId: thread.id,
            state: "all",
            offset,
            limit: 10,
          })
        : Promise.resolve(undefined),
    [thread.id, thread.revision, expanded, offset, version],
  );
  const claims = useLoad(
    () =>
      api<ClaimPage>("assignments.list", {
        projectId: project.id,
        threadId: thread.id,
        state: "active",
        offset: 0,
        limit: 50,
      }),
    [thread.id, thread.revision, version],
    true,
  );
  const liveClaims =
    claims.data?.items.filter(
      (claim) => new Date(claim.expiresAt).getTime() > Date.now(),
    ) ?? [];
  const changed = () => {
    setVersion((value) => value + 1);
    setOffset(0);
  };
  const people = writableAssignees(members.data?.items ?? []);
  const whole = active.data?.items.find((item) => !item.annotationIds.length);
  const hasPoints = !!active.data?.total && !whole;
  const value = whole?.userId ?? (hasPoints ? "__points" : "");
  const openDetails = () => {
    setExpanded(true);
    requestAnimationFrame(() => {
      section.current?.scrollIntoView({ block: "start", behavior: "instant" });
      section.current
        ?.querySelector<HTMLElement>("button")
        ?.focus({ preventScroll: true });
    });
  };
  async function assign(userId: string) {
    if (userId === "__details" || hasPoints) {
      openDetails();
      return;
    }
    if (pending.current || userId === value) return;
    pending.current = true;
    await quick.run(async () => {
      if (!userId && whole) {
        await api("assignments.cancel", {
          delegationId: whole.id,
          revision: whole.revision,
          reason: "Unassigned from the thread member dropdown.",
          idempotencyKey: `unassign:${whole.id}:${whole.revision}`,
        });
      } else {
        const input: AssignInput = {
          threadId: thread.id,
          threadRevision: thread.revision,
          ...(whole ? { delegationId: whole.id, revision: whole.revision } : {}),
          annotationIds: [],
          userId,
          summary: whole?.summary ?? "Work on this thread",
          category:
            whole?.category ??
            (categories.includes(thread.category as any)
              ? (thread.category as AssignInput["category"])
              : "general"),
          tags: whole?.tags ?? thread.tags ?? [],
          githubDecision: whole?.githubDecision ?? "undecided",
          githubRationale: whole?.githubRationale ?? "Not assessed during assignment.",
        };
        retry.current = assignmentRetry(retry.current, input, uid);
        await api("assignments.assign", retry.current.input);
      }
      changed();
    });
    pending.current = false;
  }
  return (
    <>
      {toolbar &&
        createPortal(
          <div className="thread-assignee field">
            <select
              aria-label="Assigned member"
              title={whole ? `Assigned to ${whole.memberName}` : "Assign this thread"}
              value={value}
              disabled={
                quick.busy ||
                !active.data ||
                !members.data ||
                !!active.error ||
                !!members.error
              }
              onChange={(event) => void assign(event.target.value)}
            >
              <option
                value=""
                disabled={
                  hasPoints || !project.permissions.canWrite || !canAssignThread(thread)
                }
              >
                {quick.busy
                  ? "Saving…"
                  : !active.data || !members.data
                    ? "Loading members…"
                    : "Unassigned"}
              </option>
              {hasPoints && (
                <option value="__points" disabled>
                  Assigned by point
                </option>
              )}
              {whole && !people.some((person) => person.id === whole.userId) && (
                <option value={whole.userId} disabled>
                  {whole.memberName}
                </option>
              )}
              {!hasPoints &&
                people.map((person) => (
                  <option
                    key={person.id}
                    value={person.id}
                    disabled={!project.permissions.canWrite || !canAssignThread(thread)}
                  >
                    {person.name}
                  </option>
                ))}
              <option value="__details">Points &amp; assignment history…</option>
            </select>
            {(quick.error || active.error || members.error) && (
              <div className="thread-assignee-error" role="alert">
                {quick.error || active.error || members.error}
                <button
                  type="button"
                  disabled={quick.busy}
                  onClick={() =>
                    void quick.run(async () => {
                      await onRefresh();
                      retry.current = undefined;
                      changed();
                    })
                  }
                >
                  Reload assignments
                </button>
              </div>
            )}
          </div>,
          toolbar,
        )}
      <section
        hidden={!expanded}
        ref={section}
        id="thread-assignments"
        className="thread-assignments"
        aria-labelledby="thread-assignments-heading"
      >
        <div className="assignment-heading">
          <h2 id="thread-assignments-heading">Assigned work</h2>
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls="assignment-management"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? "Hide assignments" : "Manage & history"}
          </button>
        </div>
        <ErrorNotice error={active.error} />
        {active.error && (
          <button type="button" onClick={changed}>
            Retry assignments
          </button>
        )}
        {!active.data && !active.error && <Loading />}
        {active.data &&
          (active.data.total ? (
            <ul className="assignment-summary">
              {active.data.items.slice(0, 3).map((item) => (
                <li key={item.id}>
                  <strong>{item.memberName}</strong>
                  <span>{assignmentScope(item.annotationIds, thread)}</span>
                  <span>{labels[item.category] ?? item.category}</span>
                  <span>{decisions[item.githubDecision]}</span>
                  <span className="assignment-attribution">
                    Updated by {assignmentActor(item.updatedBy)} ·{" "}
                    <HumanTime at={item.updatedAt} />
                  </span>
                </li>
              ))}
              {active.data.total > 3 && (
                <li>
                  <button type="button" onClick={() => setExpanded(true)}>
                    View all {active.data.total} assignments
                  </button>
                </li>
              )}
            </ul>
          ) : (
            <p className="assignment-empty">
              No assigned work. Assign the thread or selected open points to a project
              member.
            </p>
          ))}
        <ErrorNotice
          error={claims.error ? `Current workers could not load: ${claims.error}` : ""}
        />
        {claims.error && (
          <button type="button" onClick={changed}>
            Retry current workers
          </button>
        )}
        {!!liveClaims.length && (
          <div className="assignment-workers" aria-label="Current worker claims">
            <strong>Working now · temporary claims</strong>
            {liveClaims.map((claim) => (
              <p key={claim.id}>
                {claim.memberName} via {claim.agentName} ·{" "}
                {assignmentScope(claim.annotationIds, thread)} · lease expires{" "}
                <HumanTime at={claim.expiresAt} />
              </p>
            ))}
            {(claims.data?.total ?? 0) > liveClaims.length && (
              <p>
                Showing {liveClaims.length} of {claims.data?.total} current claims.
              </p>
            )}
          </div>
        )}
        <div id="assignment-management" hidden={!expanded}>
          {project.permissions.canWrite && canAssignThread(thread) && !editing && (
            <button type="button" onClick={() => setEditing("new")}>
              Assign more work
            </button>
          )}
          {!canAssignThread(thread) && (
            <p>
              Completed or archived work cannot receive a new assignment. Assignment
              history stays available.
            </p>
          )}
          {editing && (
            <AssignmentForm
              key={editing === "new" ? "new" : editing.id}
              thread={thread}
              initial={editing === "new" ? undefined : editing}
              canWrite={project.permissions.canWrite}
              onRefresh={onRefresh}
              onSaved={() => {
                setEditing(null);
                changed();
              }}
              onClose={() => setEditing(null)}
            />
          )}
          <ErrorNotice error={all.error} />
          {all.error && (
            <button type="button" onClick={changed}>
              Retry assignment history
            </button>
          )}
          {!all.data && !all.error && <Loading />}
          {all.data?.items.map((item) => (
            <AssignmentRecord
              key={item.id}
              item={item}
              thread={thread}
              canWrite={project.permissions.canWrite}
              editing={!!editing}
              onEdit={() => setEditing(item)}
              onChanged={changed}
              onGithub={onGithub}
            />
          ))}
          {all.data && (all.data.total > 10 || offset > 0) && (
            <div className="actions assignment-pagination">
              <button
                type="button"
                disabled={!offset}
                onClick={() => setOffset(Math.max(0, offset - 10))}
              >
                Previous assignments
              </button>
              <span>
                {all.data.total
                  ? `${offset + 1}–${Math.min(offset + 10, all.data.total)} of ${all.data.total}`
                  : "No assignments"}
              </span>
              <button
                type="button"
                disabled={all.data.nextOffset === null}
                onClick={() => setOffset(all.data!.nextOffset!)}
              >
                Next assignments
              </button>
            </div>
          )}
        </div>
      </section>
    </>
  );
}

function AssignmentForm({
  thread,
  initial,
  canWrite,
  onRefresh,
  onSaved,
  onClose,
}: {
  thread: Thread;
  initial?: Delegation;
  canWrite: boolean;
  onRefresh: () => Promise<Thread>;
  onSaved: () => void;
  onClose: () => void;
}) {
  const a = useAction();
  const pending = useRef(false);
  const [memberVersion, setMemberVersion] = useState(0);
  const members = useLoad(
    () => api<{ items: Assignee[] }>("members.list", { projectId: thread.projectId }),
    [thread.projectId, memberVersion],
  );
  const people = writableAssignees(members.data?.items ?? []);
  const points = assignmentPoints(thread);
  const [userId, setUserId] = useState(initial?.userId ?? "");
  const [summary, setSummary] = useState(initial?.summary ?? "Work on this thread");
  const [scope, setScope] = useState(initial?.annotationIds.length ? "points" : "thread");
  const [selected, setSelected] = useState<string[]>(initial?.annotationIds ?? []);
  const [category, setCategory] = useState<AssignInput["category"]>(
    initial?.category ??
      (categories.includes(thread.category as any)
        ? (thread.category as AssignInput["category"])
        : "general"),
  );
  const [tags, setTags] = useState((initial?.tags ?? thread.tags ?? []).join(", "));
  const [decision, setDecision] = useState<keyof typeof decisions>(
    initial?.githubDecision ?? "undecided",
  );
  const [rationale, setRationale] = useState(
    initial?.githubRationale ?? "Not assessed during assignment.",
  );
  const [revisions, setRevisions] = useState({
    thread: thread.revision,
    delegation: initial?.revision,
  });
  const [cancelled, setCancelled] = useState(false);
  const [latestAssignment, setLatestAssignment] = useState<Delegation | null>(null);
  const [reviewedLatest, setReviewedLatest] = useState(false);
  const [dirty, setDirty] = useState(false);
  useUnsavedChanges(dirty || a.busy);
  const retry = useRef<ReturnType<typeof assignmentRetry<AssignInput>> | undefined>(
    undefined,
  );
  const stalePoints =
    scope === "points" && selected.some((id) => !points.some((point) => point.id === id));
  const invalid =
    !canWrite ||
    !canAssignThread(thread) ||
    cancelled ||
    (!!latestAssignment && !reviewedLatest) ||
    !people.some((person) => person.id === userId) ||
    (scope === "points" && (!selected.length || stalePoints));
  async function reloadLatest() {
    await a.run(async () => {
      const latest = await onRefresh();
      let delegationRevision = revisions.delegation;
      if (initial) {
        const history = await api<HistoryPage>("assignments.history", {
          delegationId: initial.id,
          offset: 0,
          limit: 1,
        });
        const current = history.items[0]?.assignment;
        if (!current)
          throw new Error(
            "The current assignment could not be loaded. Your draft is intact.",
          );
        delegationRevision = current.revision;
        setCancelled(current.state === "cancelled");
        setLatestAssignment(current);
        setReviewedLatest(false);
      }
      setRevisions({ thread: latest.revision, delegation: delegationRevision });
      retry.current = undefined;
      setMemberVersion((value) => value + 1);
    }, "Latest revisions loaded. Review your saved draft before retrying.");
  }
  return (
    <form
      className="assignment-form"
      data-unsaved={dirty || a.busy ? "true" : undefined}
      onChange={() => setDirty(true)}
      onSubmit={(event) => {
        event.preventDefault();
        if (pending.current || invalid) return;
        const parsedTags = tagsSchema.safeParse(splitTags(tags));
        if (!parsedTags.success) {
          a.setError(parsedTags.error.issues.map((issue) => issue.message).join(" "));
          return;
        }
        const input: AssignInput = {
          threadId: thread.id,
          threadRevision: revisions.thread,
          ...(initial
            ? { delegationId: initial.id, revision: revisions.delegation }
            : {}),
          annotationIds: scope === "thread" ? [] : selected,
          userId,
          summary: summary.trim(),
          category,
          tags: parsedTags.data,
          githubDecision: decision,
          githubRationale: rationale.trim(),
        };
        retry.current = assignmentRetry(retry.current, input, uid);
        pending.current = true;
        void a
          .run(async () => {
            await api("assignments.assign", retry.current!.input);
            onSaved();
          }, "Assignment saved.")
          .finally(() => {
            pending.current = false;
          });
      }}
    >
      <h3>{initial ? "Edit assignment" : "Assign work"}</h3>
      <ActionState action={a} />
      {a.error && (
        <Notice>
          Your draft is intact. Retry the same request, or{" "}
          <button type="button" disabled={a.busy} onClick={() => void reloadLatest()}>
            Reload latest before retrying
          </button>
          .
        </Notice>
      )}
      {cancelled && (
        <ErrorNotice error="This assignment has been cancelled. Keep this draft for reference or start a new assignment." />
      )}
      <fieldset disabled={a.busy} className="assignment-fields">
        {latestAssignment && (
          <div className="assignment-conflict">
            <AssignmentSnapshot item={latestAssignment} thread={thread} />
            <p>
              Your draft below is unchanged. Saving it will replace the current assignment
              above.
            </p>
            <label className="check">
              <input
                type="checkbox"
                checked={reviewedLatest}
                onChange={(event) => setReviewedLatest(event.target.checked)}
              />
              I reviewed the current assignment and want to apply this draft.
            </label>
          </div>
        )}
        <div className="assignment-form-grid">
          <Field label="Assign to">
            <select
              required
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
            >
              <option value="">Select a project member</option>
              {userId && !people.some((person) => person.id === userId) && (
                <option value={userId} disabled>
                  Previous assignee unavailable
                </option>
              )}
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Work scope">
            <select value={scope} onChange={(event) => setScope(event.target.value)}>
              <option value="thread">Whole thread</option>
              <option value="points" disabled={!points.length}>
                Selected open points
              </option>
            </select>
          </Field>
        </div>
        <ErrorNotice error={members.error} />
        {members.error && (
          <button type="button" onClick={() => setMemberVersion((value) => value + 1)}>
            Retry project members
          </button>
        )}
        {!members.data && !members.error && <Loading />}
        {members.data && !people.length && (
          <p>No active project members with write access are available.</p>
        )}
        {scope === "points" && (
          <fieldset className="assignment-points">
            <legend>Select open points</legend>
            {points.map((point) => (
              <label className="check" key={point.id}>
                <input
                  type="checkbox"
                  checked={selected.includes(point.id)}
                  onChange={(event) =>
                    setSelected((current) =>
                      event.target.checked
                        ? [...current, point.id]
                        : current.filter((id) => id !== point.id),
                    )
                  }
                />
                <span>
                  <strong>Point {point.number}</strong> · {point.body}
                </span>
              </label>
            ))}
            {stalePoints && (
              <Notice>
                A selected point is now completed or removed.{" "}
                <button
                  type="button"
                  onClick={() => {
                    setSelected((current) =>
                      current.filter((id) => points.some((point) => point.id === id)),
                    );
                    setDirty(true);
                  }}
                >
                  Remove unavailable points from this draft
                </button>
              </Notice>
            )}
          </fieldset>
        )}
        {scope === "thread" && (
          <p className="assignment-hint">
            Assigns ownership of this thread. Completed points remain completed.
          </p>
        )}
        <details className="assignment-extra">
          <summary>Additional details (optional)</summary>
          <Field label="Work summary">
            <input
              required
              maxLength={500}
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
            />
          </Field>
          <div className="assignment-form-grid">
            <Field label="Category">
              <select
                value={category}
                onChange={(event) =>
                  setCategory(event.target.value as AssignInput["category"])
                }
              >
                {categories.map((value) => (
                  <option key={value} value={value}>
                    {labels[value]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Tags" hint="Separate tags with commas. Up to 12 tags.">
              <input value={tags} onChange={(event) => setTags(event.target.value)} />
            </Field>
          </div>
          <Field label="GitHub decision">
            <select
              value={decision}
              onChange={(event) =>
                setDecision(event.target.value as keyof typeof decisions)
              }
            >
              {Object.entries(decisions).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Reason for GitHub decision"
            hint="Explain the decision, including what is still uncertain."
          >
            <textarea
              required
              maxLength={1000}
              rows={2}
              value={rationale}
              onChange={(event) => setRationale(event.target.value)}
            />
          </Field>
          <p className="assignment-hint">
            Saving an assignment does not create a GitHub issue. Use GitHub issue options
            separately.
          </p>
        </details>
        <div className="actions">
          <button
            className="primary"
            disabled={invalid || !summary.trim() || !rationale.trim()}
          >
            {a.busy ? "Saving…" : initial ? "Save assignment" : "Assign work"}
          </button>
          <button
            type="button"
            onClick={() => {
              if (!dirty || confirm("Discard this assignment draft?")) onClose();
            }}
          >
            Discard draft
          </button>
        </div>
      </fieldset>
    </form>
  );
}

function AssignmentRecord({
  item,
  thread,
  canWrite,
  editing,
  onEdit,
  onChanged,
  onGithub,
}: {
  item: Delegation;
  thread: Thread;
  canWrite: boolean;
  editing: boolean;
  onEdit: () => void;
  onChanged: () => void;
  onGithub: () => void;
}) {
  const [showHistory, setShowHistory] = useState(false);
  const [showCancel, setShowCancel] = useState(false);
  const [reason, setReason] = useState("");
  const [cancelRevision, setCancelRevision] = useState(item.revision);
  const [cancelLatest, setCancelLatest] = useState<Delegation | null>(null);
  const [reviewedCancel, setReviewedCancel] = useState(false);
  const [historyOffset, setHistoryOffset] = useState(0);
  const [historyVersion, setHistoryVersion] = useState(0);
  const a = useAction();
  useUnsavedChanges(showCancel && (!!reason || a.busy));
  const pending = useRef(false);
  const retry = useRef<
    | ReturnType<
        typeof assignmentRetry<{ delegationId: string; revision: number; reason: string }>
      >
    | undefined
  >(undefined);
  const history = useLoad(
    () =>
      showHistory
        ? api<HistoryPage>("assignments.history", {
            delegationId: item.id,
            offset: historyOffset,
            limit: 10,
          })
        : Promise.resolve(undefined),
    [item.id, item.revision, showHistory, historyOffset, historyVersion],
  );
  return (
    <article className="assignment-record">
      <div className="assignment-record-heading">
        <h3>{item.memberName}</h3>
        <span>
          {item.state === "cancelled" ? "Cancelled" : "Assigned"} ·{" "}
          {assignmentScope(item.annotationIds, thread)}
        </span>
      </div>
      <p className="assignment-description">{item.summary}</p>
      <p>
        {labels[item.category] ?? item.category}
        {item.tags.length ? ` · ${item.tags.join(", ")}` : ""}
      </p>
      <p>
        <strong>{decisions[item.githubDecision]}</strong> · {item.githubRationale}
      </p>
      <p className="assignment-attribution">
        Last updated by {assignmentActor(item.updatedBy)} ·{" "}
        <HumanTime at={item.updatedAt} />
      </p>
      <div className="actions">
        {canWrite && item.state === "active" && (
          <>
            <button
              type="button"
              disabled={editing || a.busy || !canAssignThread(thread)}
              onClick={onEdit}
            >
              Edit assignment
            </button>
            <button
              type="button"
              disabled={a.busy}
              aria-expanded={showCancel}
              onClick={() => {
                if (!showCancel) setCancelRevision(item.revision);
                setShowCancel(!showCancel);
              }}
            >
              Cancel assignment
            </button>
          </>
        )}
        <button
          type="button"
          aria-expanded={showHistory}
          onClick={() => setShowHistory(!showHistory)}
        >
          Assignment history
        </button>
        {(item.githubDecision === "create_issue" ||
          item.githubDecision === "already_linked") && (
          <button type="button" onClick={onGithub}>
            GitHub issue options
          </button>
        )}
      </div>
      <ActionState action={a} />
      {showCancel && (
        <form
          className="assignment-cancel"
          data-unsaved={reason || a.busy ? "true" : undefined}
          onSubmit={(event) => {
            event.preventDefault();
            if (pending.current || !reason.trim() || (cancelLatest && !reviewedCancel))
              return;
            retry.current = assignmentRetry(
              retry.current,
              { delegationId: item.id, revision: cancelRevision, reason: reason.trim() },
              uid,
            );
            pending.current = true;
            void a
              .run(async () => {
                await api("assignments.cancel", retry.current!.input);
                setShowCancel(false);
                setReason("");
                onChanged();
              }, "Assignment cancelled; history retained.")
              .finally(() => {
                pending.current = false;
              });
          }}
        >
          <fieldset disabled={a.busy} className="assignment-fields">
            {cancelLatest && (
              <div className="assignment-conflict">
                <AssignmentSnapshot item={cancelLatest} thread={thread} />
                <label className="check">
                  <input
                    type="checkbox"
                    checked={reviewedCancel}
                    onChange={(event) => setReviewedCancel(event.target.checked)}
                  />
                  I reviewed the current assignment and want to cancel it.
                </label>
              </div>
            )}
            <Field label="Reason for cancelling">
              <input
                required
                maxLength={500}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </Field>
            {a.error && (
              <Notice>
                Your reason is intact.{" "}
                <button
                  type="button"
                  onClick={() =>
                    void a.run(async () => {
                      const latest = await api<HistoryPage>("assignments.history", {
                        delegationId: item.id,
                        offset: 0,
                        limit: 1,
                      });
                      const current = latest.items[0]?.assignment;
                      if (!current)
                        throw new Error("Could not load the latest assignment.");
                      if (current.state === "cancelled") {
                        setShowCancel(false);
                        setReason("");
                        onChanged();
                        return;
                      }
                      setCancelRevision(current.revision);
                      retry.current = undefined;
                      setCancelLatest(current);
                      setReviewedCancel(false);
                    }, "Latest assignment loaded. Review the reason before retrying.")
                  }
                >
                  Reload latest before retrying
                </button>
              </Notice>
            )}
            <div className="actions">
              <button
                className="danger"
                disabled={!reason.trim() || (!!cancelLatest && !reviewedCancel)}
              >
                {a.busy ? "Cancelling…" : "Confirm cancellation"}
              </button>
              <button type="button" onClick={() => setShowCancel(false)}>
                Keep assignment
              </button>
            </div>
          </fieldset>
        </form>
      )}
      {showHistory && (
        <div className="assignment-history">
          <ErrorNotice error={history.error} />
          {history.error && (
            <button type="button" onClick={() => setHistoryVersion((value) => value + 1)}>
              Retry history
            </button>
          )}
          {!history.data && !history.error && <Loading />}
          <ol>
            {history.data?.items.map((entry) => (
              <li key={entry.id}>
                {entry.actor.memberName}{" "}
                {entry.action === "cancelled"
                  ? "cancelled work assigned to"
                  : entry.action === "reassigned"
                    ? "reassigned work to"
                    : "assigned work to"}{" "}
                {entry.assignment.memberName}
                {entry.actor.agentName ? ` via ${entry.actor.agentName}` : ""} ·{" "}
                <HumanTime at={entry.createdAt} />
                <p>
                  {assignmentScope(entry.assignment.annotationIds, thread)} ·{" "}
                  {entry.assignment.summary}
                </p>
                <p>
                  {labels[entry.assignment.category] ?? entry.assignment.category}
                  {entry.assignment.tags.length
                    ? ` · ${entry.assignment.tags.join(", ")}`
                    : ""}{" "}
                  · {decisions[entry.assignment.githubDecision]} ·{" "}
                  {entry.assignment.githubRationale}
                </p>
                {entry.reason && <p>{entry.reason}</p>}
              </li>
            ))}
          </ol>
          {history.data && (history.data.total > 10 || historyOffset > 0) && (
            <div className="actions">
              <button
                type="button"
                disabled={!historyOffset}
                onClick={() => setHistoryOffset(Math.max(0, historyOffset - 10))}
              >
                Newer changes
              </button>
              <span>
                {historyOffset + 1}–{Math.min(historyOffset + 10, history.data.total)} of{" "}
                {history.data.total}
              </span>
              <button
                type="button"
                disabled={history.data.nextOffset === null}
                onClick={() => setHistoryOffset(history.data!.nextOffset!)}
              >
                Older changes
              </button>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

export function ProjectAssignments({ project }: { project: Project }) {
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState("");
  const [offset, setOffset] = useState(0);
  const [version, setVersion] = useState(0);
  const people = useLoad(
    () =>
      open
        ? api<{ items: Assignee[] }>("members.list", { projectId: project.id })
        : Promise.resolve(undefined),
    [project.id, open, version],
  );
  const page = useLoad(
    async () => {
      if (!open) return undefined;
      const result = await api<DelegationPage>("assignments.delegations", {
        projectId: project.id,
        ...(userId ? { userId } : {}),
        state: "active",
        offset,
        limit: 10,
      });
      const threads = new Map<string, Thread>();
      const threadIds = [
        ...new Set(
          result.items
            .filter((item) => item.annotationIds.length)
            .map((item) => item.threadId),
        ),
      ];
      await Promise.all(
        threadIds.map(async (threadId) => {
          const thread = await api<Thread>("threads.get", { threadId });
          threads.set(threadId, thread);
        }),
      );
      return { result, threads, userId, offset };
    },
    [project.id, open, userId, offset, version],
    true,
  );
  const data =
    page.data?.userId === userId && page.data?.offset === offset ? page.data : undefined;
  return (
    <details
      className="project-assignments section compact-details"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Assigned work</summary>
      <p>
        Browse project assignments by member. Current worker claims appear inside each
        thread.
      </p>
      <Field label="Assigned to">
        <select
          value={userId}
          onChange={(event) => {
            setUserId(event.target.value);
            setOffset(0);
          }}
        >
          <option value="">All project members</option>
          {people.data?.items.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
              {!person.active ? " (inactive)" : ""}
            </option>
          ))}
        </select>
      </Field>
      <ErrorNotice error={people.error || page.error} />
      {(people.error || page.error) && (
        <button type="button" onClick={() => setVersion((value) => value + 1)}>
          Retry assigned work
        </button>
      )}
      {!data && !page.error && open && <Loading />}
      {data && !data.result.total && <p>No active assignments for this selection.</p>}
      <ul className="project-assignment-list">
        {data?.result.items.map((item) => (
          <li key={item.id}>
            <div>
              <strong>{item.memberName}</strong>
              <span>
                {item.annotationIds.length
                  ? assignmentScope(item.annotationIds, data.threads.get(item.threadId)!)
                  : "Whole thread"}
              </span>
            </div>
            <a href={`/threads/${item.threadId}#thread-assignments`}>{item.summary}</a>
            <p>
              {labels[item.category] ?? item.category} · {decisions[item.githubDecision]}
            </p>
          </li>
        ))}
      </ul>
      {data && (data.result.total > 10 || offset > 0) && (
        <div className="actions assignment-pagination">
          <button
            type="button"
            disabled={!offset}
            onClick={() => setOffset(Math.max(0, offset - 10))}
          >
            Previous assignments
          </button>
          <span>
            {offset + 1}–{Math.min(offset + 10, data.result.total)} of {data.result.total}
          </span>
          <button
            type="button"
            disabled={data.result.nextOffset === null}
            onClick={() => setOffset(data.result.nextOffset!)}
          >
            Next assignments
          </button>
        </div>
      )}
    </details>
  );
}

function AssignmentSnapshot({ item, thread }: { item: Delegation; thread: Thread }) {
  return (
    <div>
      <h4>Current assignment · revision {item.revision}</h4>
      <p>
        <strong>{item.memberName}</strong> · {assignmentScope(item.annotationIds, thread)}{" "}
        · {item.state === "cancelled" ? "Cancelled" : "Assigned"}
      </p>
      <p>{item.summary}</p>
      <p>
        {labels[item.category] ?? item.category}
        {item.tags.length ? ` · ${item.tags.join(", ")}` : ""}
      </p>
      <p>
        {decisions[item.githubDecision]} · {item.githubRationale}
      </p>
      <p>
        Last updated by {assignmentActor(item.updatedBy)} ·{" "}
        <HumanTime at={item.updatedAt} />
      </p>
    </div>
  );
}
