import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { type Delegation } from "../../shared/contracts.js";
import { api, uid, type Project, type Thread } from "../api.js";
import { ErrorNotice, Loading, useAction, useLoad } from "../ui.js";
import { HumanTime } from "../human-time.js";
import {
  builtInCategories,
  categoryName,
  type ProjectTaxonomy,
} from "../../shared/taxonomy.js";
import {
  assignmentActor,
  assignmentRetry,
  assignmentScope,
  canAssignThread,
  writableAssignees,
  type Assignee,
} from "./model.js";
import { AssignmentForm } from "./form.js";
import { AssignmentRecord } from "./record.js";
import {
  decisions,
  type DelegationPage,
  type ClaimPage,
  type AssignInput,
} from "./types.js";
export function ThreadAssignments({
  thread,
  project,
  taxonomy,
  toolbar,
  onRefresh,
  onGithub,
}: {
  thread: Thread;
  project: Project;
  taxonomy?: ProjectTaxonomy;
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
            ((taxonomy?.categories ?? builtInCategories).some(
              (item) => item.id === thread.category && !item.archived,
            )
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
                  <span>
                    {categoryName(
                      taxonomy?.categories ?? builtInCategories,
                      item.category,
                    )}
                  </span>
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
              taxonomy={taxonomy}
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
              taxonomy={taxonomy}
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
