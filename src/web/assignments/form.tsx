import { useRef, useState } from "react";
import { tagsSchema, type Delegation } from "../../shared/contracts.js";
import { api, uid, type Thread } from "../api.js";
import {
  ActionState,
  ErrorNotice,
  Field,
  Loading,
  Notice,
  useAction,
  useLoad,
} from "../ui.js";
import { useUnsavedChanges } from "../navigation.js";
import { splitTags } from "../review-filters.js";
import { builtInCategories, type ProjectTaxonomy } from "../../shared/taxonomy.js";
import {
  assignmentPoints,
  assignmentRetry,
  canAssignThread,
  writableAssignees,
  type Assignee,
} from "./model.js";
import { AssignmentSnapshot } from "./snapshot.js";
import { decisions, type HistoryPage, type AssignInput } from "./types.js";
export function AssignmentForm({
  thread,
  taxonomy,
  initial,
  canWrite,
  onRefresh,
  onSaved,
  onClose,
}: {
  thread: Thread;
  taxonomy?: ProjectTaxonomy;
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
      ((taxonomy?.categories ?? builtInCategories).some(
        (item) => item.id === thread.category && !item.archived,
      )
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
            <AssignmentSnapshot
              item={latestAssignment}
              thread={thread}
              taxonomy={taxonomy}
            />
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
                {(taxonomy?.categories ?? builtInCategories)
                  .filter((item) => !item.archived || item.id === category)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                      {item.archived ? " (archived)" : ""}
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
