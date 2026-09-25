import React, { useEffect, useState } from "react";
import { agentTokenScopes } from "../shared/contracts.js";
import { AgentSetupPrompt, type AgentIssuance } from "./agent-setup.js";
import { CreateMember, MemberAdministration } from "./account-admin.js";
import { OwnerLinks } from "./owner-links.js";
import { api, labels, type Actor, type Project } from "./api.js";
import { HumanTime } from "./human-time.js";
import {
  ActionState,
  ConfirmButton,
  Empty,
  ErrorNotice,
  Field,
  Loading,
  Secret,
  useAction,
  useLoad,
} from "./ui.js";
type Policy = {
  general: number;
  visualDesign?: number;
  productWorkflow?: number;
  usabilityAccessibility?: number;
};
type Member = {
  id: string;
  name: string;
  email?: string;
  active: boolean;
  removedAt?: string | null;
  owner: boolean;
  primaryOwner?: boolean;
  role?: string;
  can_resolve?: boolean;
  classification?: string;
  expertise?: string[];
  policy?: Policy;
  policy_version?: number;
  project_policy?: Policy | null;
};
const categories = [
  "general",
  "visualDesign",
  "productWorkflow",
  "usabilityAccessibility",
] as const;
const expertiseCategories = categories.map((category) => labels[category]);
function PolicyFields({ policy, prefix = "" }: { policy?: Policy; prefix?: string }) {
  return (
    <div className="policy-fields">
      <Field label="Overall importance" hint="1 is normal, 2 counts twice, 0 ignores.">
        <input
          type="number"
          name={`${prefix}general`}
          min={0}
          max={10}
          step={0.1}
          defaultValue={policy?.general ?? 1}
          required
        />
      </Field>
      <details className="policy-topics">
        <summary>Set a different weight for a topic</summary>
        <div className="policy-grid">
          {categories.slice(1).map((c) => (
            <Field key={c} label={labels[c]} hint="Blank uses the overall importance.">
              <input
                type="number"
                name={`${prefix}${c}`}
                min={0}
                max={10}
                step={0.1}
                defaultValue={policy?.[c] ?? ""}
                placeholder="Use overall"
              />
            </Field>
          ))}
        </div>
      </details>
    </div>
  );
}
function readPolicy(f: FormData, prefix = "") {
  return Object.fromEntries(
    categories.flatMap((c) =>
      f.get(`${prefix}${c}`) === "" ? [] : [[c, Number(f.get(`${prefix}${c}`))]],
    ),
  ) as Policy;
}
export function Members({ actor, project }: { actor: Actor; project?: Project }) {
  const [version, setVersion] = useState(0),
    [selectedId, setSelectedId] = useState<string | null>(null),
    [showRemoved, setShowRemoved] = useState(false),
    { data, error } = useLoad(
      () =>
        api<{ items: Member[] }>(
          "members.list",
          project ? { projectId: project.id } : { includeRemoved: showRemoved },
        ),
      [project?.id, version, showRemoved],
    ),
    { data: all } = useLoad(
      () =>
        actor.owner && project
          ? api<{ items: Member[] }>("members.list", {})
          : Promise.resolve({ items: [] }),
      [project?.id, actor.owner, version],
    ),
    a = useAction(),
    [invite, setInvite] = useState("");
  const refresh = () => setVersion((v) => v + 1);
  useEffect(() => {
    if (selectedId) document.getElementById("person-back")?.focus();
  }, [selectedId]);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{project ? "Project members" : "People"}</h1>
          <p>
            {actor.owner
              ? "Manage your team."
              : "People who can participate in this project."}
          </p>
        </div>
      </div>
      <ErrorNotice error={error} />
      {!selectedId && actor.owner && <CreateMember project={project} onSaved={refresh} />}
      {!selectedId && actor.owner && project && (
        <details className="section">
          <summary>Invite a colleague</summary>
          <form
            className="form-grid"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void a.run(async () => {
                const r = await api("members.invite", {
                  email: String(f.get("email")),
                  role: String(f.get("role")) as "reviewer",
                  projectId: project.id,
                });
                setInvite(`${location.origin}${r.invitePath}`);
              });
            }}
          >
            <Field label="Email">
              <input name="email" type="email" required />
            </Field>
            <Field label="Project role">
              <RoleSelect />
            </Field>
            <button className="primary" disabled={a.busy}>
              Create invitation link
            </button>
          </form>
          <p className="muted">
            Send this link privately. No email is sent automatically. It expires in seven
            days.
          </p>
          {invite && (
            <Secret value={invite} label="Invitation link — copy and send privately." />
          )}
          <ActionState action={a} />
        </details>
      )}
      {!selectedId && actor.owner && project && (
        <details className="section">
          <summary>Add an existing member</summary>
          <form
            className="form-grid"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void a.run(async () => {
                await api("members.grant", {
                  projectId: project.id,
                  userId: String(f.get("userId")),
                  role: String(f.get("role")) as "reviewer",
                  canResolve: f.has("canResolve"),
                });
                refresh();
              }, "Project access saved.");
            }}
          >
            <Field label="Member">
              <select name="userId" required>
                <option value="">Select a member</option>
                {all?.items
                  .filter((m) => m.active && !m.owner)
                  .map((m) => (
                    <option value={m.id} key={m.id}>
                      {m.name} — {m.email}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Role">
              <RoleSelect />
            </Field>
            <label className="check">
              <input name="canResolve" type="checkbox" />
              May resolve feedback
            </label>
            <button disabled={a.busy}>Save access</button>
          </form>
          <ActionState action={a} />
        </details>
      )}
      {!project && actor.owner && !selectedId && (
        <label className="check">
          <input
            type="checkbox"
            checked={showRemoved}
            onChange={(e) => setShowRemoved(e.target.checked)}
          />
          Show removed accounts
        </label>
      )}
      {!data && !error ? (
        <Loading />
      ) : data?.items.length ? (
        selectedId ? (
          <>
            <button id="person-back" type="button" onClick={() => setSelectedId(null)}>
              ← All people
            </button>
            {data.items
              .filter((m) => m.id === selectedId)
              .map((m) => (
                <MemberEditor
                  key={m.id}
                  member={m}
                  project={project}
                  owner={!!actor.owner}
                  actor={actor}
                  onSaved={refresh}
                  onArchived={() => {
                    refresh();
                    setSelectedId(null);
                  }}
                />
              ))}
          </>
        ) : (
          <div className="member-list" aria-label="People">
            {data.items.map((m) => (
              <button
                type="button"
                className="member-list-item"
                key={m.id}
                onClick={() => setSelectedId(m.id)}
              >
                <span>
                  <strong>{m.name}</strong>
                  {actor.owner && <small>{m.email}</small>}
                </span>
                <span>
                  {m.removedAt
                    ? "Removed"
                    : m.primaryOwner
                      ? "Primary owner"
                      : m.owner
                        ? "Owner"
                        : (m.role ?? "Member")}
                  {!m.active && !m.removedAt ? " · Disabled" : ""}
                </span>
              </button>
            ))}
          </div>
        )
      ) : (
        data && (
          <Empty title="No members">Invite a colleague from a project to begin.</Empty>
        )
      )}
    </>
  );
}
function RoleSelect({ value = "maintainer" }: { value?: string }) {
  return (
    <select name="role" defaultValue={value}>
      <option value="viewer">Viewer — read only</option>
      <option value="reviewer">Reviewer — comment & update</option>
      <option value="maintainer">Maintainer — manage project & resolve</option>
    </select>
  );
}
function MemberEditor({
  member: m,
  project,
  owner,
  actor,
  onSaved,
  onArchived,
}: {
  member: Member;
  project?: Project;
  owner: boolean;
  actor: Actor;
  onSaved: () => void;
  onArchived: () => void;
}) {
  const a = useAction();
  return (
    <section className="member-editor">
      <div className="member-editor-heading">
        <div>
          <h2>{m.name}</h2>
          {owner && <small>{m.email}</small>}
        </div>
        <span>
          {m.primaryOwner ? "Primary owner" : m.owner ? "Owner" : (m.role ?? "Member")}
          {!m.active ? " · Disabled" : ""}
        </span>
      </div>
      {owner && (!m.primaryOwner || actor.primaryOwner) ? (
        <>
          {project && !m.owner && (
            <form
              className="form-grid section"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void a.run(async () => {
                  await api("members.grant", {
                    projectId: project.id,
                    userId: m.id,
                    role: String(f.get("role")) as "reviewer",
                    canResolve: f.has("canResolve"),
                  });
                  onSaved();
                }, "Project permission saved.");
              }}
            >
              <Field label="Project role">
                <RoleSelect value={m.role} />
              </Field>
              <label className="check">
                <input name="canResolve" type="checkbox" defaultChecked={m.can_resolve} />
                May resolve feedback
              </label>
              <button disabled={a.busy}>Save permission</button>
              <ConfirmButton
                disabled={a.busy}
                onConfirm={() =>
                  a.run(async () => {
                    await api("members.grant", {
                      projectId: project.id,
                      userId: m.id,
                      role: "viewer",
                      remove: true,
                    });
                    onSaved();
                  }, "Project access removed.")
                }
              >
                Remove access
              </ConfirmButton>
            </form>
          )}
          <form
            className="form-grid"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void a.run(async () => {
                await api("members.update", {
                  userId: m.id,
                  name: String(f.get("name")),
                  active: actor.userId === m.id || f.has("active"),
                  classification: String(f.get("classification")) as "employee",
                  expertise: [
                    ...f.getAll("expertiseCategory").map(String),
                    ...String(f.get("otherExpertise") ?? "")
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  ],
                  policy: readPolicy(f),
                });
                onSaved();
              }, "Member saved.");
            }}
          >
            <Field label="Name">
              <input name="name" defaultValue={m.name} required maxLength={120} />
            </Field>
            <Field label="Classification">
              <select name="classification" defaultValue={m.classification ?? "external"}>
                <option value="employee">Employee</option>
                <option value="external">External</option>
              </select>
            </Field>
            <fieldset className="wide expertise-choices">
              <legend>Expertise</legend>
              <p className="muted">
                Select the topics this person knows. Agents use these as context, not as
                permissions.
              </p>
              <div className="expertise-options">
                {expertiseCategories.map((category) => (
                  <label className="check" key={category}>
                    <input
                      type="checkbox"
                      name="expertiseCategory"
                      value={category}
                      defaultChecked={m.expertise?.includes(category)}
                    />
                    {category}
                  </label>
                ))}
              </div>
              <Field label="Other expertise" hint="Optional, separated by commas">
                <input
                  name="otherExpertise"
                  defaultValue={m.expertise
                    ?.filter((item) => !expertiseCategories.includes(item))
                    .join(", ")}
                  placeholder="Typesetting, research"
                />
              </Field>
            </fieldset>
            <label className="check">
              <input
                name="active"
                type="checkbox"
                defaultChecked={m.active}
                disabled={actor.userId === m.id}
              />
              Account active
            </label>
            <details className="wide importance-details">
              <summary>Feedback importance (advanced)</summary>
              <p className="muted">
                This affects preference summaries, not access or permissions.
              </p>
              <PolicyFields policy={m.policy} />
            </details>
            <button disabled={a.busy}>Save person</button>
          </form>
          <details className="section compact-details">
            <summary>Account access and reviewer notes</summary>
            <MemberAdministration actor={actor} member={m} onSaved={onSaved} />
          </details>
          {project && !m.owner && (
            <form
              className="section"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void a.run(async () => {
                  await api("members.policy", {
                    projectId: project.id,
                    userId: m.id,
                    policy: f.has("inherit") ? null : readPolicy(f, "project-"),
                  });
                  onSaved();
                }, "Project importance saved.");
              }}
            >
              <h3>Project feedback weighting (advanced)</h3>
              <p className="muted">
                Use only when this person's input should count differently in this
                project.
              </p>
              <label className="check">
                <input
                  name="inherit"
                  type="checkbox"
                  defaultChecked={!m.project_policy}
                />
                Use global importance
              </label>
              <PolicyFields policy={m.project_policy ?? m.policy} prefix="project-" />
              <button disabled={a.busy}>Save project importance</button>
            </form>
          )}
          <ActionState action={a} />
          {!project && !m.owner && (!m.active || !!m.removedAt) && (
            <ConfirmButton
              disabled={a.busy}
              onConfirm={() =>
                a.run(
                  async () => {
                    await api("members.archive", {
                      userId: m.id,
                      archived: !m.removedAt,
                    });
                    onArchived();
                  },
                  m.removedAt
                    ? "Person restored to People. Account remains disabled."
                    : "Disabled person removed from People. History is kept.",
                )
              }
            >
              {m.removedAt ? "Restore to People" : "Remove disabled person from People"}
            </ConfirmButton>
          )}
        </>
      ) : (
        <p>{m.active ? "Active project member." : "Account disabled."}</p>
      )}
    </section>
  );
}
export function Instructions({ project }: { project: Project }) {
  const [refreshVersion, setRefreshVersion] = useState(0),
    { data, setData, error } = useLoad(
      () =>
        api<{
          revision: number;
          items: Array<{
            id: string;
            version: number;
            body: string;
            actor: Actor;
            createdAt: string;
          }>;
        }>("instructions.get", { projectId: project.id }),
      [project.id, refreshVersion],
    ),
    a = useAction(),
    [body, setBody] = useState("");
  return (
    <>
      <div className="page-heading">
        <h1>Approved instructions</h1>
        <button type="button" onClick={() => setRefreshVersion((v) => v + 1)}>
          Refresh
        </button>
      </div>
      <p>
        Set the rules your team and connected agents should follow for this project.
        Publishing creates a new version; feedback comments do not change these rules.
      </p>
      <details className="instruction-example compact-details">
        <summary>See an example</summary>
        <p>
          <strong>Example only, not active instructions:</strong> Reproduce layout
          feedback at the recorded screen size. Ask for missing steps before closing a
          report. Link the fix or GitHub issue in the discussion. Do not treat a comment
          as a policy change.
        </p>
      </details>
      <ErrorNotice error={error} />
      {!data && !error ? (
        <Loading />
      ) : (
        <>
          {project.permissions.canMaintain && data && (
            <form
              className="section"
              onSubmit={(e) => {
                e.preventDefault();
                void a.run(async () => {
                  setData(
                    await api("instructions.publish", {
                      projectId: project.id,
                      revision: data.revision,
                      body,
                    }),
                  );
                  setBody((current) => (current === body ? "" : current));
                }, "Instruction version published.");
              }}
            >
              <Field label="Instructions for people and agents">
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  required
                  maxLength={12000}
                  rows={6}
                />
              </Field>
              <button className="primary" disabled={a.busy || !body.trim()}>
                Publish approved version
              </button>
              <ActionState action={a} />
            </form>
          )}
          {data?.items.length
            ? data.items.map((item, n) => (
                <article className="instruction section" key={item.id}>
                  <div className="meta">
                    <h2>
                      Version {item.version}
                      {n === 0 ? " · Current" : ""}
                    </h2>
                    <span>
                      {item.actor.name} · <HumanTime at={item.createdAt} />
                    </span>
                  </div>
                  <p className="message">{item.body}</p>
                </article>
              ))
            : data && (
                <Empty title="No approved instructions">
                  A human maintainer can publish the first version.
                </Empty>
              )}
        </>
      )}
    </>
  );
}
type Token = {
  id: string;
  name: string;
  kind: string;
  projects: string[];
  scopes: string[];
  canResolve: boolean;
  ownerAdmin?: boolean;
  secretSuffix?: string | null;
  expiresAt: string;
  revokedAt: string | null;
};
export function Account({
  actor,
  projects,
  onSignOut,
}: {
  actor: Actor;
  projects: Project[];
  onSignOut: () => void;
}) {
  const a = useAction(),
    [version, setVersion] = useState(0),
    [issuance, setIssuance] = useState<AgentIssuance>(),
    { data, error } = useLoad(
      () => api<{ items: Token[] }>("tokens.list", {}),
      [version],
      true,
    );
  useEffect(() => {
    const reveal = () => {
      if (location.hash !== "#agent-setup") return;
      const section = document.getElementById("agent-setup");
      if (section instanceof HTMLDetailsElement) section.open = true;
      section?.scrollIntoView({ block: "start" });
    };
    reveal();
    window.addEventListener("hashchange", reveal);
    return () => window.removeEventListener("hashchange", reveal);
  }, [actor.owner]);
  useEffect(() => {
    if (!issuance) return;
    if (data?.items.find((token) => token.id === issuance.id)?.revokedAt) {
      setIssuance(undefined);
      return;
    }
    const remaining = new Date(issuance.expiresAt).getTime() - Date.now();
    if (remaining <= 0) setIssuance(undefined);
    else {
      const timer = window.setTimeout(
        () => setIssuance(undefined),
        Math.min(remaining, 2147483647),
      );
      return () => window.clearTimeout(timer);
    }
  }, [issuance, data]);
  const health = useLoad(async () => {
    if (!actor.owner) return undefined;
    const r = await fetch("/readyz", { cache: "no-store" });
    if (!r.ok)
      throw new Error(
        "Service readiness check failed. Ask the operator to inspect the deployment.",
      );
    return r.json() as Promise<{ database: string; storage: string }>;
  }, [actor.owner]);
  return (
    <>
      <h1>Account</h1>
      <p>
        {actor.name} ·{" "}
        {actor.primaryOwner ? "Primary owner" : actor.owner ? "Owner" : "Project member"}
      </p>
      {actor.owner && <OwnerLinks />}
      {actor.owner && (
        <section className="section">
          <h2>Service connection</h2>
          <ErrorNotice error={health.error} />
          {health.data ? (
            <p>
              Database: {health.data.database}. Configured image storage:{" "}
              {health.data.storage}. This readiness check does not verify an object upload
              or restore.
            </p>
          ) : (
            !health.error && <Loading />
          )}
        </section>
      )}
      <details className="section">
        <summary>Change password</summary>
        <form
          className="narrow"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void a.run(async () => {
              await api("auth.changePassword", {
                currentPassword: String(f.get("currentPassword")),
                password: String(f.get("password")),
              });
              onSignOut();
            });
          }}
        >
          <Field label="Current password">
            <input
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              required
            />
          </Field>
          <Field
            label="New password"
            hint="At least 10 characters. Sessions, agent and extension tokens, approved pairings and account links will be revoked."
          >
            <input
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={10}
              maxLength={1024}
              required
            />
          </Field>
          <button disabled={a.busy}>Change password & sign out</button>
          <ActionState action={a} />
        </form>
      </details>
      <section className="section">
        <h2>Tokens & connected extensions</h2>
        <p>
          Revocation takes effect on the next request. Keep tokens private; access remains
          limited by current project permissions.
        </p>
        <ErrorNotice error={error} />
        {!data && !error ? (
          <Loading />
        ) : data?.items.length ? (
          data.items.map((token) => (
            <article className="token-row" key={token.id}>
              <div>
                <h3>{token.name}</h3>
                <p>
                  {token.kind === "agent" ? "Agent key" : "Connected extension"}
                  {token.secretSuffix
                    ? ` · ends in ${token.secretSuffix}`
                    : " · key ending unavailable for older keys"}
                  {" · "}
                  {token.revokedAt ? (
                    <>
                      Revoked <HumanTime at={token.revokedAt} />
                    </>
                  ) : (
                    <>
                      Expires <HumanTime at={token.expiresAt} />
                    </>
                  )}
                </p>
                <details>
                  <summary>Access details</summary>
                  <p>
                    {token.ownerAdmin
                      ? "Full owner administration · all current and future projects"
                      : token.projects
                          .map(
                            (id) =>
                              projects.find((p) => p.id === id)?.name ??
                              "Unavailable project",
                          )
                          .join(", ")}
                  </p>
                  <p>{token.scopes.join(", ")}</p>
                  <p>
                    {token.canResolve
                      ? "May resolve feedback"
                      : "Cannot resolve feedback"}
                  </p>
                </details>
              </div>
              {!token.revokedAt && (
                <ConfirmButton
                  disabled={a.busy}
                  onConfirm={() =>
                    a.run(async () => {
                      await api("tokens.revoke", { tokenId: token.id });
                      setIssuance((current) =>
                        current?.id === token.id ? undefined : current,
                      );
                      setVersion((v) => v + 1);
                    }, "Token revoked.")
                  }
                >
                  Revoke
                </ConfirmButton>
              )}
            </article>
          ))
        ) : (
          data && <p className="muted">No tokens or paired extensions.</p>
        )}
        <ActionState action={a} />
      </section>
      {actor.owner && (
        <details className="section" id="agent-setup">
          <summary>Connect internal agents</summary>
          <p>
            Default: all {projects.length} current projects · all agent actions · 90 days
          </p>
          <p>
            Use this revocable key in any of your internal agents. New projects need a new
            key.
          </p>
          {!projects.length && (
            <p>
              <a href="/">Create a project first</a> to connect an agent.
            </p>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void a.run(async () => {
                const input = {
                  name: String(f.get("name")),
                  projectIds: f.getAll("projectIds").map(String),
                  scopes: f.getAll("scopes").map(String),
                  expiresInDays: Number(f.get("expiresInDays")),
                  canResolve: f.has("canResolve"),
                };
                const selectedProjects = input.projectIds.map((id) => ({
                  id,
                  name:
                    projects.find((project) => project.id === id)?.name ??
                    "Unavailable project",
                }));
                const r = await api("tokens.create", input);
                setIssuance({
                  id: r.id,
                  token: r.token,
                  name: r.name,
                  origin: location.origin,
                  projects: selectedProjects,
                  scopes: [...input.scopes],
                  expiresAt: r.expiresAt,
                  canResolve: input.canResolve,
                });
                setVersion((v) => v + 1);
              });
            }}
          >
            <Field label="Key name">
              <input
                name="name"
                defaultValue="Internal agents"
                required
                maxLength={120}
              />
            </Field>
            <details>
              <summary>Advanced</summary>
              <Field label="Expires in days">
                <input
                  name="expiresInDays"
                  type="number"
                  min={1}
                  max={90}
                  defaultValue={90}
                  required
                />
              </Field>
              <fieldset>
                <legend>Allowed projects</legend>
                {projects.map((p) => (
                  <label className="check" key={p.id}>
                    <input
                      type="checkbox"
                      name="projectIds"
                      value={p.id}
                      defaultChecked
                    />
                    {p.name}
                  </label>
                ))}
              </fieldset>
              <fieldset>
                <legend>Allowed operations</legend>
                <div className="scope-grid">
                  {agentTokenScopes.map((s) => (
                    <label className="check" key={s}>
                      <input name="scopes" type="checkbox" value={s} defaultChecked />
                      {s}
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="check">
                <input type="checkbox" name="canResolve" defaultChecked />
                Allow resolving feedback (requires threads.status scope)
              </label>
              <p className="muted">
                Includes reviewer guidance and importance, never private notes or account
                administration.
              </p>
            </details>
            <button className="primary" disabled={a.busy || !projects.length}>
              Create agent key
            </button>
            <ActionState action={a} />
          </form>
          {issuance && (
            <AgentSetupPrompt
              key={issuance.id}
              issued={issuance}
              onClear={() => setIssuance(undefined)}
            />
          )}
        </details>
      )}
      {!actor.owner && (
        <section className="section" id="agent-setup">
          <h2>Agent setup</h2>
          <p>
            Ask an owner to create a scoped API key and copy its agent setup prompt for
            you.
          </p>
        </section>
      )}
    </>
  );
}
