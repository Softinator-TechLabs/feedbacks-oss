import React, { useState } from "react";
import { api } from "../api.js";
import { ActionState, ErrorNotice, Field, Loading, useAction, useLoad } from "../ui.js";
import { useUnsavedChanges } from "../navigation.js";
type Connection = {
  id: string;
  label: string;
  provider: "harvest" | "timedoctor";
  enabled: boolean;
  revision: number;
  health: string;
  errorCode: string | null;
  destination: { accountId: string; projectId: string; taskId: string; userId?: string };
};
type Entry = {
  historical: boolean;
  id: string;
  connectionId: string;
  minutes: number;
  spentDate: string;
  status: string;
  remoteId: string | null;
  errorCode: string | null;
};
export function TimeTrackingSettings({
  projectId,
  owner,
}: {
  projectId: string;
  owner: boolean;
}) {
  const [version, setVersion] = useState(0),
    [editing, setEditing] = useState<Connection | null | undefined>(),
    [dirty, setDirty] = useState(false),
    [provider, setProvider] = useState<"harvest" | "timedoctor">("harvest");
  const action = useAction();
  useUnsavedChanges(dirty || action.busy);
  const { data, error } = useLoad(
    () => api<{ connections: Connection[] }>("timeTracking.list", { projectId }),
    [projectId, version],
  );
  return (
    <section className="connection-settings">
      <h2>Harvest and Time Doctor</h2>
      <p className="muted">
        Log reviewed work from threads; tracking is never automatic.
      </p>
      <ErrorNotice error={error} />
      <ActionState action={action} />
      {!data && !error && <Loading />}
      <ul className="connection-list">
        {data?.connections.map((c) => (
          <li key={c.id}>
            <h3>{c.label}</h3>
            <p>
              {c.provider === "harvest" ? "Harvest" : "Time Doctor"} ·{" "}
              {c.enabled ? c.health : "Disabled"} · project {c.destination.projectId} ·
              task {c.destination.taskId} · user{" "}
              {c.destination.userId ?? "the credential's user"}
            </p>
            {c.errorCode && (
              <p className="error">
                {c.errorCode}. Check provider permissions and account configuration.
              </p>
            )}
            <div className="connection-actions">
              <button
                type="button"
                disabled={action.busy || !c.enabled}
                onClick={() =>
                  action.run(async () => {
                    const result = await api<any>("timeTracking.test", {
                      connectionId: c.id,
                    });
                    setVersion((v) => v + 1);
                    if (!result.healthy) throw new Error(result.errorCode);
                  }, "Time tracking destination verified.")
                }
              >
                Test destination
              </button>
              {owner && (
                <>
                  <button
                    type="button"
                    disabled={action.busy}
                    onClick={() => {
                      if (editing?.id === c.id) return;
                      if (
                        (dirty || action.busy) &&
                        !window.confirm(
                          "Discard this time connection draft? Your unsaved changes will be lost.",
                        )
                      )
                        return;
                      setDirty(false);
                      setEditing(c);
                      setProvider(c.provider);
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    disabled={action.busy || !c.enabled}
                    onClick={() =>
                      action.run(async () => {
                        await api("timeTracking.disable", {
                          connectionId: c.id,
                          revision: c.revision,
                        });
                        setVersion((v) => v + 1);
                      }, "Time tracking disabled. Existing entries remain.")
                    }
                  >
                    Disable
                  </button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
      {data?.connections.length === 0 && editing === undefined && (
        <p className="muted">No time connections.</p>
      )}
      {owner &&
        data &&
        (editing !== undefined ? (
          <form
            className="connection-form"
            key={editing?.id ?? "new"}
            data-unsaved={dirty || action.busy ? "true" : undefined}
            onChange={() => setDirty(true)}
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget,
                fields = new FormData(form),
                value = (name: string) => String(fields.get(name) ?? "").trim();
              action.run(async () => {
                await api("timeTracking.save", {
                  projectId,
                  provider,
                  label: value("label"),
                  destination: {
                    accountId: value("accountId"),
                    projectId: value("providerProjectId"),
                    taskId: value("taskId"),
                    ...(value("userId") ? { userId: value("userId") } : {}),
                  },
                  ...(editing
                    ? { connectionId: editing.id, revision: editing.revision }
                    : {}),
                  ...(value("token") ? { token: value("token") } : {}),
                });
                form.reset();
                setDirty(false);
                setEditing(undefined);
                setVersion((v) => v + 1);
              }, "Time connection saved. Test before logging time.");
            }}
          >
            <h3>{editing ? "Edit time connection" : "Add time connection"}</h3>
            <div className="connection-fields">
              <Field label="Provider">
                <select
                  value={provider}
                  disabled={!!editing}
                  onChange={(e) => setProvider(e.target.value as any)}
                >
                  <option value="harvest">Harvest</option>
                  <option value="timedoctor">Time Doctor</option>
                </select>
              </Field>
              <Field label="Connection name">
                <input
                  name="label"
                  required
                  maxLength={100}
                  defaultValue={editing?.label ?? ""}
                />
              </Field>
              <Field
                label={
                  provider === "harvest" ? "Harvest account ID" : "Time Doctor company ID"
                }
              >
                <input
                  name="accountId"
                  required
                  maxLength={120}
                  defaultValue={editing?.destination.accountId ?? ""}
                />
              </Field>
              <Field label="Provider project ID">
                <input
                  name="providerProjectId"
                  required
                  maxLength={120}
                  defaultValue={editing?.destination.projectId ?? ""}
                />
              </Field>
              <Field label="Provider task ID">
                <input
                  name="taskId"
                  required
                  maxLength={120}
                  defaultValue={editing?.destination.taskId ?? ""}
                />
              </Field>
              <Field
                label={
                  provider === "timedoctor"
                    ? "Time Doctor user ID"
                    : "Harvest user ID (optional)"
                }
                hint={
                  provider === "harvest" ? "Defaults to the token's user." : undefined
                }
              >
                <input
                  name="userId"
                  required={provider === "timedoctor"}
                  maxLength={120}
                  defaultValue={editing?.destination.userId ?? ""}
                />
              </Field>
            </div>
            <Field
              label={
                editing
                  ? "Replace token (leave empty to keep current)"
                  : provider === "timedoctor"
                    ? "Time Doctor JWT API token"
                    : "Harvest API token"
              }
            >
              <input
                name="token"
                type="password"
                required={!editing}
                maxLength={16000}
                autoComplete="new-password"
              />
            </Field>
            <div className="connection-actions">
              <button type="submit" className="primary" disabled={action.busy}>
                Save time connection
              </button>
              <button
                type="button"
                disabled={action.busy}
                onClick={() => {
                  if (
                    dirty &&
                    !window.confirm(
                      "Discard this time connection draft? Your unsaved changes will be lost.",
                    )
                  )
                    return;
                  setDirty(false);
                  setEditing(undefined);
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            className="primary"
            disabled={action.busy}
            onClick={() => {
              setEditing(null);
              setProvider("harvest");
            }}
          >
            Add time connection
          </button>
        ))}
      <details>
        <summary>Setup &amp; delivery</summary>
        <p>
          Harvest requires duration tracking and an active project task. Time Doctor
          requires API access and permission for manual time edits; its entries are
          submitted for approval.
        </p>
        <p>
          Tokens stay encrypted. If delivery is uncertain, check the provider's history
          and record its entry ID before logging that time again.
        </p>
      </details>
    </section>
  );
}
export function TimeEntryPanel({
  thread,
}: {
  thread: { id: string; projectId: string; revision: number };
}) {
  const [version, setVersion] = useState(0),
    [connectionId, setConnectionId] = useState(""),
    [retryKey, setRetryKey] = useState(() => crypto.randomUUID()),
    [dirty, setDirty] = useState(false);
  const action = useAction();
  useUnsavedChanges(dirty || action.busy);
  const { data, error } = useLoad(
    async () => ({
      ...(await api<{ connections: Connection[] }>("timeTracking.list", {
        projectId: thread.projectId,
      })),
      ...(await api<{ entries: Entry[] }>("timeTracking.history", {
        threadId: thread.id,
      })),
    }),
    [thread.id, version],
    true,
  );
  const selected = data?.connections.find((c) => c.id === connectionId);
  return (
    <details>
      <summary>Log reviewed work time</summary>
      <ErrorNotice error={error} />
      <ActionState action={action} />
      <Field label="Time tracking destination">
        <select
          value={connectionId}
          onChange={(e) => {
            setConnectionId(e.target.value);
            setRetryKey(crypto.randomUUID());
          }}
        >
          <option value="">Choose a verified destination</option>
          {data?.connections
            .filter((c) => c.enabled && c.health === "healthy")
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
        </select>
      </Field>
      {selected && (
        <form
          onChange={() => {
            setDirty(true);
            setRetryKey(crypto.randomUUID());
          }}
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget,
              fields = new FormData(form);
            action.run(async () => {
              await api("timeTracking.log", {
                connectionId,
                threadId: thread.id,
                revision: thread.revision,
                spentDate: String(fields.get("spentDate")),
                minutes: Number(fields.get("minutes")),
                note: String(fields.get("note")),
                ...(fields.get("startedAt")
                  ? { startedAt: new Date(String(fields.get("startedAt"))).toISOString() }
                  : {}),
                idempotencyKey: retryKey,
              });
              form.reset();
              setDirty(false);
              setRetryKey(crypto.randomUUID());
              setVersion((v) => v + 1);
            }, "Time entry queued. Check the delivery history below.");
          }}
        >
          <p>
            Destination: project {selected.destination.projectId}, task{" "}
            {selected.destination.taskId}, user{" "}
            {selected.destination.userId ?? "the credential's user"}.
          </p>
          <Field label="Work date">
            <input name="spentDate" type="date" required />
          </Field>
          {selected.provider === "timedoctor" && (
            <Field label="Start time in your local timezone">
              <input name="startedAt" type="datetime-local" required />
            </Field>
          )}
          <Field label="Minutes worked">
            <input name="minutes" type="number" min={1} max={1440} required />
          </Field>
          <Field label="Reviewed note to share with the provider">
            <textarea name="note" maxLength={4000} rows={3} required />
          </Field>
          <button type="submit" disabled={action.busy}>
            Submit reviewed time entry
          </button>
        </form>
      )}
      <ul>
        {data?.entries.map((entry) => (
          <li key={entry.id}>
            <p>
              {entry.spentDate} · {entry.minutes} minutes · {entry.status}
              {entry.historical && " · Historical source-project entry"}
              {entry.remoteId && ` · remote entry ${entry.remoteId}`}
              {entry.errorCode && ` · ${entry.errorCode}`}
            </p>
            {entry.status === "uncertain" && !entry.historical && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const fields = new FormData(e.currentTarget);
                  action.run(async () => {
                    await api("timeTracking.reconcile", {
                      entryId: entry.id,
                      delivered: fields.get("delivered") === "yes",
                      ...(fields.get("remoteId")
                        ? { remoteId: String(fields.get("remoteId")) }
                        : {}),
                    });
                    setVersion((v) => v + 1);
                  }, "Verified time entry outcome recorded.");
                }}
              >
                <Field label="Verified provider outcome">
                  <select name="delivered">
                    <option value="yes">Entry exists in the provider</option>
                    <option value="no">Entry was not created</option>
                  </select>
                </Field>
                <Field label="Remote entry ID if created">
                  <input name="remoteId" maxLength={120} />
                </Field>
                <button type="submit" disabled={action.busy}>
                  Record verified outcome
                </button>
              </form>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
