import React, { useState } from "react";
import { api, type Thread } from "./api.js";
import { HumanTime } from "./human-time.js";
import { ErrorNotice, useAction } from "./ui.js";

export function ThreadReview({
  thread,
  canWrite,
  onSaved,
}: {
  thread: Thread;
  canWrite: boolean;
  onSaved: (thread: Thread) => void;
}) {
  const [note, setNote] = useState("");
  const action = useAction();
  const review = thread.review;
  const label =
    review.state === "approved"
      ? "Approved"
      : review.state === "changes_requested"
        ? "Changes requested"
        : "Awaiting decision";

  async function decide(decision: "approved" | "changes_requested" | "reopen") {
    await action.run(
      async () => {
        const latest = await api<Thread>("threads.review", {
          threadId: thread.id,
          revision: thread.revision,
          decision,
          note: note.trim(),
        });
        onSaved(latest);
        setNote("");
      },
      decision === "reopen" ? "New review round opened." : "Review decision saved.",
    );
  }

  return (
    <details className="thread-review" aria-label="Review decision">
      <summary aria-label={`Review ${review.round}: ${label}`}>
        Review <span className="thread-review-state">{label}</span>
      </summary>
      <div className="thread-review-panel">
        <p className="muted">Round {review.round} · Sign off on the work here.</p>
        {canWrite && (
          <>
            <label htmlFor="review-note">Decision note (optional)</label>
            <textarea
              id="review-note"
              value={note}
              maxLength={4000}
              rows={2}
              onChange={(event) => setNote(event.target.value)}
            />
            <div className="thread-review-actions">
              {review.state === "open" ? (
                <>
                  <button
                    type="button"
                    disabled={action.busy}
                    onClick={() => void decide("approved")}
                  >
                    Approve this round
                  </button>
                  <button
                    type="button"
                    disabled={action.busy}
                    onClick={() => void decide("changes_requested")}
                  >
                    Request changes
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  disabled={action.busy}
                  onClick={() => void decide("reopen")}
                >
                  Open another round
                </button>
              )}
            </div>
          </>
        )}
        <ErrorNotice error={action.error} />
        {!!review.history.length && (
          <details>
            <summary>Decision history ({review.history.length})</summary>
            <ol>
              {review.history.map((entry, index) => (
                <li key={`${entry.round}-${index}`}>
                  Round {entry.round}: {entry.decision.replaceAll("_", " ")} by{" "}
                  {entry.actor.name} · <HumanTime at={entry.at} />
                  {entry.note && <p className="message">{entry.note}</p>}
                </li>
              ))}
            </ol>
          </details>
        )}
      </div>
    </details>
  );
}
