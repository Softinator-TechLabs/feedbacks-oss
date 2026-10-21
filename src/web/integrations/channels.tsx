import React, { useRef, useState } from "react";
import { api } from "../api.js";
import { ActionState, ErrorNotice, Field, Loading, useAction, useLoad } from "../ui.js";
import { useUnsavedChanges } from "../navigation.js";
import { channelEvents } from "../../shared/contracts/domains/channels.js";

type Channel = {
  id: string;
  projectId: string;
  label: string;
  provider: "slack" | "teams";
  enabled: boolean;
  revision: number;
  events: string[];
  errorCode: string | null;
};
export function ChannelSettings({ projectId }: { projectId: string }) {
  const surface = useRef<HTMLElement>(null);
  const [version, setVersion] = useState(0),
    [editing, setEditing] = useState<Channel | null | undefined>();
  const { data, error } = useLoad(
    () => api<{ channels: Channel[] }>("channels.list", { projectId }),
    [projectId, version],
  );
  const { data: deliveries, error: deliveryError } = useLoad(
    () =>
      api<{
        items: {
          id: string;
          channelId: string;
          event: string;
          status: string;
          attempts: number;
          errorCode: string | null;
          createdAt: string;
        }[];
      }>("channels.deliveries", { projectId }),
    [projectId, version],
    true,
  );
  const action = useAction();
  const refresh = () => setVersion((v) => v + 1);
  const mayReplaceDraft = () =>
    !surface.current?.querySelector('form[data-unsaved="true"]') ||
    window.confirm(
      "Discard this notification channel draft? Your unsaved changes will be lost.",
    );
  return (
    <section ref={surface} className="connection-settings">
      <h2>Slack and Teams notifications</h2>
      <p className="muted">Send selected activity and thread links to your channels.</p>
      <ErrorNotice error={error} />
      <ActionState action={action} />
      {!data ? (
        !error && <Loading />
      ) : (
        <>
          <ul className="connection-list">
            {data.channels.map((c) => (
              <li key={c.id}>
                <h3>{c.label}</h3>
                <p>
                  {c.provider === "slack" ? "Slack" : "Microsoft Teams"} ·{" "}
                  {c.enabled ? "Enabled" : "Disabled"} · {c.events.length}{" "}
                  {c.events.length === 1 ? "activity" : "activities"}
                </p>
                {c.errorCode && (
                  <p className="error">
                    {c.errorCode}. Check the provider connection and send a test.
                  </p>
                )}
                <div className="connection-actions">
                  <button
                    type="button"
                    disabled={action.busy || !c.enabled}
                    onClick={() =>
                      action.run(async () => {
                        await api("channels.test", {
                          channelId: c.id,
                          idempotencyKey: crypto.randomUUID(),
                        });
                        refresh();
                      }, "Test queued. Check delivery history and the destination channel.")
                    }
                  >
                    Send test message
                  </button>
                  <button
                    type="button"
                    disabled={action.busy}
                    onClick={() => {
                      if (editing?.id !== c.id && !mayReplaceDraft()) return;
                      setEditing(c);
                    }}
                  >
                    Edit connection
                  </button>
                  <button
                    type="button"
                    disabled={action.busy || !c.enabled}
                    onClick={() =>
                      action.run(async () => {
                        await api("channels.disable", {
                          channelId: c.id,
                          revision: c.revision,
                        });
                        refresh();
                      }, "Channel notifications disabled.")
                    }
                  >
                    Disable
                  </button>
                </div>
                {editing?.id === c.id && (
                  <ChannelForm
                    key={c.revision}
                    projectId={projectId}
                    existing={c}
                    onCancel={() => setEditing(undefined)}
                    onSaved={() => {
                      setEditing(undefined);
                      refresh();
                    }}
                  />
                )}
              </li>
            ))}
          </ul>
          {data.channels.length === 0 && editing === undefined && (
            <p className="muted">No channels connected.</p>
          )}
          {editing === null ? (
            <ChannelForm
              projectId={projectId}
              onCancel={() => setEditing(undefined)}
              onSaved={() => {
                setEditing(undefined);
                refresh();
              }}
            />
          ) : editing === undefined ? (
            <button
              type="button"
              className="primary"
              disabled={action.busy}
              onClick={() => {
                if (mayReplaceDraft()) setEditing(null);
              }}
            >
              Add notification channel
            </button>
          ) : null}
        </>
      )}
      <details>
        <summary>Delivery history</summary>
        <ErrorNotice error={deliveryError} />
        {deliveries?.items.length ? (
          <ul>
            {deliveries.items.map((d) => (
              <li key={d.id}>
                <p>
                  {data?.channels.find((c) => c.id === d.channelId)?.label ?? "Channel"}:{" "}
                  {d.event} · {d.status} · {d.attempts} attempt
                  {d.attempts === 1 ? "" : "s"}
                  {d.errorCode && ` · ${d.errorCode}`}
                </p>
                {d.status === "uncertain" && (
                  <div className="connection-actions">
                    <span>Check the destination channel, then record the outcome:</span>
                    {[true, false].map((delivered) => (
                      <button
                        key={String(delivered)}
                        type="button"
                        disabled={action.busy}
                        onClick={() =>
                          action.run(async () => {
                            await api("channels.reconcile", {
                              deliveryId: d.id,
                              delivered,
                            });
                            refresh();
                          }, "Delivery outcome recorded.")
                        }
                      >
                        {delivered ? "Message arrived" : "Message did not arrive"}
                      </button>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p>No messages queued yet.</p>
        )}
      </details>
      <details>
        <summary>Setup &amp; privacy</summary>
        <p>
          Slack: create an incoming webhook for your channel. Teams: create a Workflows
          webhook that accepts Adaptive Cards and add a co-owner. Paste its secret URL,
          save, then send a test.
        </p>
        <p>
          Channel members see activity labels and links, without feedback or discussion
          text. Opening a thread requires project access and access to your server or VPN.
        </p>
      </details>
    </section>
  );
}
function ChannelForm({
  projectId,
  existing,
  onSaved,
  onCancel,
}: {
  projectId: string;
  existing?: Channel;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [provider, setProvider] = useState<"slack" | "teams">(
      existing?.provider ?? "slack",
    ),
    [dirty, setDirty] = useState(false);
  const action = useAction();
  useUnsavedChanges(dirty || action.busy);
  return (
    <form
      className="connection-form"
      data-unsaved={dirty || action.busy ? "true" : undefined}
      onChange={() => setDirty(true)}
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget,
          fields = new FormData(form);
        action.run(async () => {
          const url = String(fields.get("webhookUrl") ?? "").trim();
          await api("channels.save", {
            projectId,
            provider,
            label: String(fields.get("label")),
            events: fields.getAll("events") as any,
            ...(existing ? { channelId: existing.id, revision: existing.revision } : {}),
            ...(url ? { webhookUrl: url } : {}),
          });
          form.reset();
          setDirty(false);
          onSaved();
        }, "Channel saved. Send a test to verify delivery.");
      }}
    >
      <h3>{existing ? "Edit notification channel" : "Add notification channel"}</h3>
      <Field label="Provider">
        <select
          value={provider}
          disabled={!!existing}
          onChange={(e) => setProvider(e.target.value as "slack" | "teams")}
        >
          <option value="slack">Slack</option>
          <option value="teams">Microsoft Teams</option>
        </select>
      </Field>
      <Field label="Connection name">
        <input
          name="label"
          required
          maxLength={100}
          defaultValue={existing?.label ?? ""}
        />
      </Field>
      <Field
        label={
          existing
            ? "Replace incoming webhook URL (leave empty to keep current)"
            : "Incoming webhook URL"
        }
      >
        <input
          name="webhookUrl"
          type="password"
          required={!existing}
          maxLength={4000}
          autoComplete="new-password"
        />
      </Field>
      <fieldset className="connection-options">
        <legend>Send these activities</legend>
        <div>
          {channelEvents.map((kind) => (
            <label key={kind}>
              <input
                type="checkbox"
                name="events"
                value={kind}
                defaultChecked={
                  existing ? existing.events.includes(kind) : kind === "created"
                }
              />{" "}
              {kind === "created"
                ? "New feedback"
                : kind === "discussion"
                  ? "Discussion and replies"
                  : kind === "status"
                    ? "Work status changes"
                    : "Assignments"}
            </label>
          ))}
        </div>
      </fieldset>
      <ActionState action={action} />
      <div className="connection-actions">
        <button type="submit" className="primary" disabled={action.busy}>
          Save channel
        </button>
        <button
          type="button"
          disabled={action.busy}
          onClick={() => {
            if (
              dirty &&
              !window.confirm(
                "Discard this notification channel draft? Your unsaved changes will be lost.",
              )
            )
              return;
            setDirty(false);
            onCancel();
          }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
