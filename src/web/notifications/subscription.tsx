import { useUnsavedChanges } from "../navigation.js";
import React, { useState } from "react";
import { api } from "../api.js";
import { ActionState, ErrorNotice, Loading, useLoad, useAction } from "../ui.js";
import {
  notificationEvents,
  type NotificationEvent,
} from "../../shared/notifications.js";
const names: Record<NotificationEvent, string> = {
  created: "New feedback",
  reply: "Discussion replies",
  mention: "Mentions",
  status: "Status changes",
  assignment: "Assignment changes",
};
function EmailSubscriptionEditor({ projectId }: { projectId: string }) {
  const { data, error, setData } = useLoad(
    () =>
      api<{
        events: NotificationEvent[];
        includeSelf: boolean;
        includeContent: boolean;
        revision: number;
      }>("notifications.subscription", { projectId }),
    [projectId],
  );
  const [draft, setDraft] = useState<typeof data>();
  const action = useAction();
  const current = draft ?? data;
  useUnsavedChanges(!!draft || action.busy);
  return (
    <>
      <ErrorNotice error={error} />
      {!current && !error && <Loading />}
      {current && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void action.run(
              async () => {
                setData(await api("notifications.subscribe", { projectId, ...current }));
                setDraft(undefined);
              },
              current.events.length
                ? "Email preferences saved."
                : "Project email notifications stopped.",
            );
          }}
        >
          <p>
            Choose emails for your own account. Clients and team members with project
            access can subscribe here. Delivery also requires a configured project or
            server provider.
          </p>
          <fieldset disabled={action.busy}>
            <legend>Notify me about</legend>
            {notificationEvents.map((kind) => (
              <label className="checkbox" key={kind}>
                <input
                  type="checkbox"
                  checked={current.events.includes(kind)}
                  onChange={(e) =>
                    setDraft({
                      ...current,
                      events: e.target.checked
                        ? [...current.events, kind]
                        : current.events.filter((k) => k !== kind),
                    })
                  }
                />
                {names[kind]}
              </label>
            ))}
            <label className="checkbox">
              <input
                type="checkbox"
                checked={current.includeSelf}
                onChange={(e) => setDraft({ ...current, includeSelf: e.target.checked })}
              />
              Include my own activity
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={current.includeContent}
                onChange={(e) =>
                  setDraft({ ...current, includeContent: e.target.checked })
                }
              />
              Include feedback and discussion excerpts in email
            </label>
            <p className="muted">
              Screenshots, recordings, diagnostics and private notes stay in Feedbacks.
              Unsubscribe at any time here or from an email.
            </p>
            <button type="submit">Save email preferences</button>
          </fieldset>
          <ActionState action={action} />
          {action.errorCode === "CONFLICT" && (
            <button
              type="button"
              disabled={action.busy}
              onClick={() =>
                void action.run(async () => {
                  setData(await api("notifications.subscription", { projectId }));
                  setDraft(undefined);
                }, "Saved email preferences reloaded. Review them before editing again.")
              }
            >
              Reload saved preferences
            </button>
          )}
        </form>
      )}
    </>
  );
}

export function EmailSubscription({ projectId }: { projectId: string }) {
  const [opened, setOpened] = useState(false);
  return (
    <details
      className="email-subscription"
      onToggle={(event) => {
        if (event.currentTarget.open) setOpened(true);
      }}
    >
      <summary>Email notifications</summary>
      {opened && <EmailSubscriptionEditor projectId={projectId} />}
    </details>
  );
}
