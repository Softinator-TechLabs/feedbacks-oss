import React, { useState } from "react";
import { api } from "../api.js";
import { ActionState, ErrorNotice, Field, Loading, useAction, useLoad } from "../ui.js";
import { useUnsavedChanges } from "../navigation.js";
import {
  trackerStates,
  type TrackerProvider,
  type TrackerConfiguration,
} from "../../shared/contracts/domains/trackers.js";
import "./trackers.css";
import { useTrackerWrite } from "./retry-key.js";

const names: Record<TrackerProvider, string> = {
  jira: "Jira Cloud",
  linear: "Linear",
  asana: "Asana",
  clickup: "ClickUp",
  monday: "monday.com",
  trello: "Trello",
  productive: "Productive",
  teamwork: "Teamwork",
};
const targets: Record<TrackerProvider, string> = {
  jira: "Jira project ID or key",
  linear: "Linear team ID",
  asana: "Asana project ID",
  clickup: "ClickUp list ID",
  monday: "monday.com board ID",
  trello: "Trello intake list ID",
  productive: "Productive task list ID",
  teamwork: "Teamwork task list ID",
};
type Connection = {
  id: string;
  projectId: string;
  provider: TrackerProvider;
  label: string;
  configuration: TrackerConfiguration;
  enabled: boolean;
  revision: number;
  health: string;
  errorCode: string | null;
  checkedAt: string | null;
};
type Job = {
  historical: boolean;
  id: string;
  threadId: string;
  connectionId: string;
  kind: string;
  status: string;
  errorCode: string | null;
  remoteId: string | null;
};
type Link = {
  historical: boolean;
  id: string;
  connectionId: string;
  remoteId: string;
  title: string;
  url: string;
  remoteState: string;
  status: string;
};

export function TrackerSettingsPage({
  projects,
  initialProjectId,
}: {
  projects: { id: string; name: string }[];
  initialProjectId?: string;
}) {
  const [projectId, setProjectId] = useState(initialProjectId ?? projects[0]?.id ?? ""),
    [version, setVersion] = useState(0),
    [editing, setEditing] = useState<Connection | null | undefined>();
  const { data, error } = useLoad(
    () =>
      projectId
        ? api<{ connections: Connection[]; jobs: Job[] }>("trackers.list", { projectId })
        : Promise.resolve({ connections: [], jobs: [] }),
    [projectId, version],
    true,
  );
  const action = useAction(),
    [result, setResult] = useState<{
      id: string;
      targetName: string;
      states: { id: string; name: string }[];
    }>();
  return (
    <article className="tracker-settings">
      <h1>Task trackers</h1>
      <Field label="Project">
        <select
          value={projectId}
          onChange={(e) => {
            setProjectId(e.target.value);
            setEditing(undefined);
            setResult(undefined);
          }}
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>
      <ErrorNotice error={error} />
      <ActionState action={action} />
      {!data ? (
        <Loading />
      ) : (
        <>
          {data.connections.length ? (
            <ul className="tracker-connections">
              {data.connections.map((c) => (
                <li key={c.id}>
                  <div className="tracker-heading">
                    <h2>{c.label}</h2>
                    <span>{c.enabled ? c.health : "Disabled"}</span>
                  </div>
                  <p>
                    {names[c.provider]} · {targets[c.provider]}:{" "}
                    {c.configuration.targetId}
                  </p>
                  {c.errorCode && (
                    <p className="error">
                      {c.errorCode}. Check access or reconnect, then test the connection.
                    </p>
                  )}
                  <div className="tracker-actions">
                    <button
                      type="button"
                      disabled={action.busy || !c.enabled}
                      onClick={() =>
                        action.run(async () => {
                          const r = await api<any>("trackers.test", {
                            connectionId: c.id,
                          });
                          setResult({
                            id: c.id,
                            targetName: r.targetName,
                            states: r.states,
                          });
                          setVersion((v) => v + 1);
                          if (!r.healthy)
                            throw new Error(
                              r.errorCode ?? "Connection verification failed",
                            );
                        }, "Provider access and status mappings verified.")
                      }
                    >
                      Test connection
                    </button>
                    <button type="button" onClick={() => setEditing(c)}>
                      Edit connection
                    </button>
                    <button
                      type="button"
                      disabled={action.busy}
                      onClick={() =>
                        action.run(
                          async () => {
                            await api("trackers.enable", {
                              connectionId: c.id,
                              revision: c.revision,
                              enabled: !c.enabled,
                            });
                            setVersion((v) => v + 1);
                          },
                          c.enabled
                            ? "Connection disabled. Historical links are retained."
                            : "Connection enabled. Test before using it.",
                        )
                      }
                    >
                      {c.enabled ? "Disconnect" : "Enable"}
                    </button>
                  </div>
                  {result?.id === c.id && (
                    <details open>
                      <summary>
                        {result.targetName || "Provider response"}: available status IDs
                      </summary>
                      <ul>
                        {result.states.map((s) => (
                          <li key={s.id}>
                            {s.name} — <code>{s.id}</code>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                  {editing?.id === c.id && (
                    <ConnectionForm
                      key={c.revision}
                      projectId={projectId}
                      existing={c}
                      onSaved={() => {
                        setEditing(undefined);
                        setVersion((v) => v + 1);
                      }}
                    />
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p>
              No tracker connected. Add a connection, verify its access, then link
              feedback from the thread.
            </p>
          )}
          {editing === null ? (
            <ConnectionForm
              projectId={projectId}
              onSaved={() => {
                setEditing(undefined);
                setVersion((v) => v + 1);
              }}
            />
          ) : (
            <button type="button" disabled={!projectId} onClick={() => setEditing(null)}>
              Add tracker connection
            </button>
          )}
          {!!data.jobs.length && (
            <details>
              <summary>Recent tracker actions ({data.jobs.length})</summary>
              <JobHistory jobs={data.jobs} onChange={() => setVersion((v) => v + 1)} />
            </details>
          )}
        </>
      )}
      <details>
        <summary>Local servers, sharing and recovery</summary>
        <p>
          Tracker requests and status polling use outbound HTTPS. Your local server needs
          no public webhook endpoint. Task descriptions and comments are sent only after
          you review and submit them.
        </p>
        <p>
          Jira Cloud uses the operator's optional OAuth broker with a distributable app.
          Its client secret stays on the broker. Other providers accept their documented
          service or personal API credentials. Credentials are encrypted using this
          installation's private storage.
        </p>
        <p>
          A provider timeout can leave delivery uncertain. Check the remote task before
          confirming delivery or sending a new action. Simultaneous local and remote
          status changes are shown as conflicts.
        </p>
      </details>
    </article>
  );
}

function ConnectionForm({
  projectId,
  existing,
  onSaved,
}: {
  projectId: string;
  existing?: Connection;
  onSaved: () => void;
}) {
  const [provider, setProvider] = useState<TrackerProvider>(
      existing?.provider ?? "asana",
    ),
    [dirty, setDirty] = useState(false),
    [oauth, setOAuth] = useState<{ flowId: string; authorizeUrl: string }>(),
    [resources, setResources] = useState<{ id: string; name: string }[]>();
  const action = useAction();
  useUnsavedChanges(dirty || action.busy);
  const c = existing?.configuration;
  async function complete(cloudId?: string) {
    if (!oauth) return;
    const result = await api<any>("trackers.oauthComplete", {
      flowId: oauth.flowId,
      ...(cloudId ? { cloudId } : {}),
    });
    if (result.status === "pending")
      throw new Error("Finish provider consent in the opened tab, then check again.");
    if (result.status === "choose_site") setResources(result.resources);
    else {
      setDirty(false);
      onSaved();
    }
  }
  return (
    <form
      className="tracker-form"
      onChange={() => setDirty(true)}
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        action.run(
          async () => {
            const fields = new FormData(form),
              value = (key: string) => String(fields.get(key) ?? "").trim();
            const configuration: TrackerConfiguration = {
              targetId: value("targetId"),
              statusColumn: value("statusColumn") || "status",
              poll: fields.get("poll") === "on",
              states: trackerStates.flatMap((local) =>
                value(`state-${local}`)
                  ? [
                      {
                        local,
                        remote: value(`state-${local}`),
                        ...(value(`transition-${local}`)
                          ? { transition: value(`transition-${local}`) }
                          : {}),
                      },
                    ]
                  : [],
              ),
              ...(value("workspaceId") ? { workspaceId: value("workspaceId") } : {}),
              ...(value("secondaryId") ? { secondaryId: value("secondaryId") } : {}),
              ...(value("site") ? { site: value("site") } : {}),
              ...(value("issueTypeId") ? { issueTypeId: value("issueTypeId") } : {}),
              ...(c?.cloudId ? { cloudId: c.cloudId } : {}),
              ...(c?.site && provider === "jira" ? { site: c.site } : {}),
            };
            if (provider === "jira" && !existing) {
              setOAuth(
                await api<any>("trackers.oauthStart", {
                  projectId,
                  provider,
                  label: value("label"),
                  configuration,
                }),
              );
              return;
            }
            await api("trackers.save", {
              projectId,
              provider,
              label: value("label"),
              configuration,
              ...(existing
                ? { connectionId: existing.id, revision: existing.revision }
                : {}),
              ...(value("token")
                ? {
                    credential: {
                      token: value("token"),
                      ...(value("key") ? { key: value("key") } : {}),
                      auth: provider === "jira" ? "oauth" : "token",
                    },
                  }
                : {}),
            });
            form.reset();
            setDirty(false);
            onSaved();
          },
          provider === "jira" && !existing
            ? "Open provider consent below, then finish the connection."
            : "Connection saved. Test provider access before using it.",
        );
      }}
    >
      <h2>{existing ? "Edit connection" : "Add a tracker"}</h2>
      <Field label="Provider">
        <select
          value={provider}
          disabled={!!existing || !!oauth}
          onChange={(e) => setProvider(e.target.value as TrackerProvider)}
        >
          {Object.entries(names).map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
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
      <Field label={targets[provider]}>
        <input
          name="targetId"
          required
          maxLength={200}
          defaultValue={c?.targetId ?? ""}
          autoComplete="off"
        />
      </Field>
      {provider === "jira" && (
        <Field label="Jira issue type ID">
          <input
            name="issueTypeId"
            required
            maxLength={200}
            defaultValue={c?.issueTypeId ?? ""}
          />
        </Field>
      )}
      {provider === "teamwork" && (
        <Field label="Teamwork site name" hint="Only the part before .teamwork.com">
          <input name="site" required maxLength={63} defaultValue={c?.site ?? ""} />
        </Field>
      )}
      {["productive", "trello"].includes(provider) && (
        <Field
          label={
            provider === "productive" ? "Productive organization ID" : "Trello board ID"
          }
        >
          <input
            name="workspaceId"
            required
            maxLength={200}
            defaultValue={c?.workspaceId ?? ""}
          />
        </Field>
      )}
      {provider === "monday" && (
        <>
          <Field label="Description text column ID">
            <input name="secondaryId" required defaultValue={c?.secondaryId ?? ""} />
          </Field>
          <Field label="Status column ID">
            <input
              name="statusColumn"
              required
              defaultValue={c?.statusColumn ?? "status"}
            />
          </Field>
        </>
      )}
      {provider !== "jira" && (
        <>
          <Field
            label={
              existing ? "Replace API token (leave empty to keep current)" : "API token"
            }
          >
            <input
              name="token"
              type="password"
              required={!existing}
              autoComplete="new-password"
              maxLength={16000}
            />
          </Field>
          {provider === "trello" && (
            <Field label="Trello API key">
              <input
                name="key"
                type="password"
                autoComplete="new-password"
                required={!existing}
              />
            </Field>
          )}
        </>
      )}
      <details>
        <summary>Status mappings and polling</summary>
        <p>
          Test the connection to read available remote status IDs. Map each local state to
          a distinct remote state. Polling imports remote changes every five minutes;
          local changes are sent explicitly from the feedback thread.
        </p>
        <div className="tracker-mappings">
          {trackerStates.map((local) => (
            <React.Fragment key={local}>
              <Field label={`${local.replaceAll("_", " ")} → remote status`}>
                <input
                  name={`state-${local}`}
                  defaultValue={c?.states.find((s) => s.local === local)?.remote ?? ""}
                  maxLength={200}
                />
              </Field>
              {provider === "jira" && (
                <Field label={`Transition ID for ${local.replaceAll("_", " ")}`}>
                  <input
                    name={`transition-${local}`}
                    defaultValue={
                      c?.states.find((s) => s.local === local)?.transition ?? ""
                    }
                    maxLength={200}
                  />
                </Field>
              )}
            </React.Fragment>
          ))}
        </div>
        <label>
          <input type="checkbox" name="poll" defaultChecked={c?.poll} /> Import remote
          status changes automatically
        </label>
      </details>
      <ActionState action={action} />
      {oauth ? (
        <div>
          <p>
            <a href={oauth.authorizeUrl} target="_blank" rel="noreferrer">
              Authorize Jira Cloud
            </a>
          </p>
          <button
            type="button"
            disabled={action.busy}
            onClick={() => action.run(() => complete())}
          >
            Check authorization
          </button>
          {resources && (
            <Field label="Authorized Jira site">
              <select
                defaultValue=""
                onChange={(e) =>
                  e.target.value && action.run(() => complete(e.target.value))
                }
              >
                <option value="" disabled>
                  Choose a site
                </option>
                {resources.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>
      ) : (
        <button type="submit" disabled={action.busy}>
          {provider === "jira" && !existing
            ? "Connect with Jira Cloud"
            : "Save connection"}
        </button>
      )}
    </form>
  );
}

function JobHistory({ jobs, onChange }: { jobs: Job[]; onChange: () => void }) {
  const action = useAction();
  return (
    <>
      <ActionState action={action} />
      <ul className="tracker-jobs">
        {jobs.map((job) => (
          <li key={job.id}>
            <strong>{job.kind}</strong> · {job.status}
            {job.historical && " · Historical source-project action"}
            {job.errorCode && ` · ${job.errorCode}`}
            {job.status === "uncertain" && !job.historical && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const values = new FormData(e.currentTarget);
                  action.run(async () => {
                    await api("trackers.reconcile", {
                      jobId: job.id,
                      outcome: String(values.get("outcome")) as any,
                      ...(values.get("remoteId")
                        ? { remoteId: String(values.get("remoteId")) }
                        : {}),
                    });
                    onChange();
                  }, "Reconciliation recorded.");
                }}
              >
                <p>Check the provider before reconciling this action.</p>
                {job.kind === "create" && (
                  <Field label="Created task ID">
                    <input name="remoteId" defaultValue={job.remoteId ?? ""} />
                  </Field>
                )}
                <Field label="Verified outcome">
                  <select name="outcome">
                    {job.kind === "create" ? (
                      <option value="linked">The task exists: link it</option>
                    ) : (
                      <option value="confirmed_delivered">
                        The action was delivered
                      </option>
                    )}
                    <option value="confirmed_not_delivered">
                      The action was not delivered
                    </option>
                  </select>
                </Field>
                <button type="submit" disabled={action.busy}>
                  Record verified outcome
                </button>
              </form>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

export function TrackerThreadPanel({
  thread,
  onChange,
}: {
  thread: { id: string; projectId: string; revision: number; body: string };
  onChange?: () => void;
}) {
  const [version, setVersion] = useState(0),
    [connectionId, setConnectionId] = useState(""),
    [comments, setComments] = useState<
      Record<
        string,
        {
          items: {
            id: string;
            body: string;
            author: string | null;
            createdAt: string | null;
          }[];
          hasMore: boolean;
        }
      >
    >({});
  const write = useTrackerWrite();
  const { data, error } = useLoad(
    async () => ({
      ...(await api<{ connections: Connection[] }>("trackers.list", {
        projectId: thread.projectId,
      })),
      ...(await api<{ links: Link[]; jobs: Job[] }>("trackers.links", {
        threadId: thread.id,
      })),
    }),
    [thread.id, version],
    true,
  );
  const action = useAction(),
    currentConnectionId =
      connectionId ||
      data?.connections.find((c) => c.enabled && c.health === "healthy")?.id ||
      "";
  const queued = () => {
    setVersion((v) => v + 1);
    onChange?.();
  };
  return (
    <details className="tracker-thread">
      <summary>
        External tasks{data?.links.length ? ` (${data.links.length})` : ""}
      </summary>
      <ErrorNotice error={error} />
      <ActionState action={action} />
      {!data ? (
        <Loading />
      ) : (
        <>
          {data.links.map((link) => (
            <section key={link.id}>
              <p>
                <a href={link.url} target="_blank" rel="noreferrer">
                  {link.title}
                </a>{" "}
                · {link.remoteState} · {link.status}
              </p>
              {link.historical ? (
                <p>
                  Historical source-project task. Status and comments are managed in its
                  original project.
                </p>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={action.busy}
                    onClick={() =>
                      action.run(async () => {
                        const result = await api<any>("trackers.comments", {
                          connectionId: link.connectionId,
                          threadId: thread.id,
                          remoteId: link.remoteId,
                        });
                        setComments((current) => ({ ...current, [link.id]: result }));
                      })
                    }
                  >
                    Read remote comments
                  </button>
                  {comments[link.id] && (
                    <details open>
                      <summary>
                        Provider discussion ({comments[link.id].items.length})
                      </summary>
                      <p>
                        Untrusted provider content. Author names come from the provider.
                      </p>
                      {comments[link.id].items.map((comment) => (
                        <blockquote key={comment.id}>
                          <p>{comment.body}</p>
                          <footer>
                            {comment.author ?? "Author unavailable"}
                            {comment.createdAt ? ` · ${comment.createdAt}` : ""}
                          </footer>
                        </blockquote>
                      ))}
                      {comments[link.id].hasMore && (
                        <p>
                          <a href={link.url} target="_blank" rel="noreferrer">
                            Read remaining discussion in the provider
                          </a>
                        </p>
                      )}
                    </details>
                  )}
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const form = e.currentTarget,
                        body = String(new FormData(form).get("body"));
                      action.run(async () => {
                        await write("trackers.comment", {
                          connectionId: link.connectionId,
                          threadId: thread.id,
                          revision: thread.revision,
                          linkId: link.id,
                          body,
                        });
                        form.reset();
                        queued();
                      }, "Comment queued. Delivery appears below.");
                    }}
                  >
                    <Field label="Reviewed comment to send to this task">
                      <textarea name="body" maxLength={12000} required rows={3} />
                    </Field>
                    <button type="submit" disabled={action.busy}>
                      Send comment
                    </button>
                  </form>
                  <div className="tracker-actions">
                    <button
                      type="button"
                      disabled={action.busy}
                      onClick={() =>
                        action.run(async () => {
                          await api("trackers.refresh", {
                            connectionId: link.connectionId,
                            threadId: thread.id,
                            linkId: link.id,
                          });
                          setVersion((v) => v + 1);
                        }, "Remote state refreshed. Choose which status to use.")
                      }
                    >
                      Refresh remote state
                    </button>
                    {(["provider", "feedbacks"] as const).map((source) => (
                      <button
                        key={source}
                        type="button"
                        disabled={action.busy}
                        onClick={() =>
                          action.run(async () => {
                            await write("trackers.sync", {
                              connectionId: link.connectionId,
                              threadId: thread.id,
                              revision: thread.revision,
                              linkId: link.id,
                              source,
                              expectedRemoteState: link.remoteState,
                            });
                            queued();
                          }, "Status sync queued. Delivery appears below.")
                        }
                      >
                        {source === "provider"
                          ? "Use remote status"
                          : "Send local status"}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </section>
          ))}
          <details>
            <summary>Create or link a task</summary>
            <Field label="Connected tracker">
              <select
                value={currentConnectionId}
                onChange={(e) => setConnectionId(e.target.value)}
              >
                <option value="">Choose a verified connection</option>
                {data.connections
                  .filter((c) => c.enabled && c.health === "healthy")
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
              </select>
            </Field>
            {currentConnectionId ? (
              <>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const fields = new FormData(e.currentTarget);
                    action.run(async () => {
                      await write("trackers.create", {
                        connectionId: currentConnectionId,
                        threadId: thread.id,
                        revision: thread.revision,
                        title: String(fields.get("title")),
                        body: String(fields.get("body")),
                      });
                      queued();
                    }, "Task creation queued. Delivery appears below.");
                  }}
                >
                  <Field label="Task title">
                    <input
                      name="title"
                      required
                      maxLength={250}
                      defaultValue={thread.body.split("\n")[0].slice(0, 250)}
                    />
                  </Field>
                  <Field label="Reviewed description to share">
                    <textarea
                      name="body"
                      maxLength={30000}
                      rows={5}
                      defaultValue={thread.body}
                    />
                  </Field>
                  <button type="submit" disabled={action.busy}>
                    Create external task
                  </button>
                </form>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const id = String(new FormData(e.currentTarget).get("remoteId"));
                    action.run(async () => {
                      await write("trackers.link", {
                        connectionId: currentConnectionId,
                        threadId: thread.id,
                        revision: thread.revision,
                        remoteId: id,
                      });
                      queued();
                    }, "Task verification queued.");
                  }}
                >
                  <Field label="Existing remote task ID">
                    <input name="remoteId" required maxLength={200} />
                  </Field>
                  <button type="submit" disabled={action.busy}>
                    Verify and link task
                  </button>
                </form>
              </>
            ) : (
              <p>
                <a href={`/trackers?projectId=${thread.projectId}`}>
                  Connect and verify a tracker
                </a>{" "}
                before creating or linking tasks.
              </p>
            )}
          </details>
          <JobHistory jobs={data.jobs} onChange={queued} />
        </>
      )}
    </details>
  );
}
