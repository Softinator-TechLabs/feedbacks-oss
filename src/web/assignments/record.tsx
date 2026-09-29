import { useRef, useState } from "react";
import { type Delegation } from "../../shared/contracts.js";
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
import { HumanTime } from "../human-time.js";
import { useUnsavedChanges } from "../navigation.js";
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
} from "./model.js";
import { AssignmentSnapshot } from "./snapshot.js";
import { decisions, type HistoryPage } from "./types.js";
export function AssignmentRecord({
  item,
  thread,
  taxonomy,
  canWrite,
  editing,
  onEdit,
  onChanged,
  onGithub,
}: {
  item: Delegation;
  thread: Thread;
  taxonomy?: ProjectTaxonomy;
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
        {categoryName(taxonomy?.categories ?? builtInCategories, item.category)}
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
                <AssignmentSnapshot
                  item={cancelLatest}
                  thread={thread}
                  taxonomy={taxonomy}
                />
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
                  {categoryName(
                    taxonomy?.categories ?? builtInCategories,
                    entry.assignment.category,
                  )}
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
