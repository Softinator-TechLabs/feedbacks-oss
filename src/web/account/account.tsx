import React, { useEffect, useState } from "react";
import {
  agentTokenScopes,
  selfAgentTokenScopes,
  selfAgentOptionalScopes,
  profileOnlyAgentScopes,
} from "../../shared/contracts.js";
import { AgentSetupPrompt, type AgentIssuance } from "../agent-setup.js";
import { OwnerLinks } from "../owner-links.js";
import { api, type Actor, type Project } from "../api.js";
import { HumanTime } from "../human-time.js";
import {
  ActionState,
  ConfirmButton,
  ErrorNotice,
  Field,
  Loading,
  useAction,
  useLoad,
} from "../ui.js";

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
type AccountTab = "agent-setup" | "connections" | "owner-links" | "security";
function accountTabFromHash(owner?: boolean): AccountTab {
  const hash = window.location.hash.slice(1);
  if (hash === "connections" || hash === "security" || hash === "agent-setup")
    return hash;
  return owner && hash === "owner-links" ? "owner-links" : "agent-setup";
}
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
    [tab, setTab] = useState<AccountTab>(() => accountTabFromHash(actor.owner)),
    { data, error } = useLoad(
      () => api<{ items: Token[] }>("tokens.list", {}),
      [version],
      true,
    );
  useEffect(() => {
    const selectHash = () => setTab(accountTabFromHash(actor.owner));
    window.addEventListener("hashchange", selectHash);
    return () => window.removeEventListener("hashchange", selectHash);
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
  const tabs: Array<{ id: AccountTab; label: string }> = [
    { id: "agent-setup", label: "Agent setup" },
    { id: "connections", label: "Connections" },
    ...(actor.owner ? [{ id: "owner-links" as const, label: "Owner links" }] : []),
    { id: "security", label: "Security" },
  ];
  const selectTab = (next: AccountTab) => {
    setTab(next);
    history.replaceState(null, "", `#${next}`);
  };
  const activeTokens = (data?.items ?? []).filter(
    (token) => !token.revokedAt && new Date(token.expiresAt).getTime() > Date.now(),
  );
  const pastTokens = (data?.items ?? []).filter(
    (token) => token.revokedAt || new Date(token.expiresAt).getTime() <= Date.now(),
  );
  const tokenRow = (token: Token) => (
    <article className="token-row" key={token.id}>
      <div>
        <h3>{token.name}</h3>
        <p>
          {token.kind === "agent" ? "Agent key" : "Connected extension"}
          {token.secretSuffix
            ? ` · ends in ${token.secretSuffix}`
            : " · ending unavailable for older keys"}
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
                      projects.find((p) => p.id === id)?.name ?? "Unavailable project",
                  )
                  .join(", ")}
          </p>
          <p>{token.scopes.join(", ")}</p>
          <p>{token.canResolve ? "May resolve feedback" : "Cannot resolve feedback"}</p>
        </details>
      </div>
      {!token.revokedAt && (
        <ConfirmButton
          disabled={a.busy}
          onConfirm={() =>
            a.run(async () => {
              await api("tokens.revoke", { tokenId: token.id });
              setIssuance((current) => (current?.id === token.id ? undefined : current));
              setVersion((v) => v + 1);
            }, "Token revoked.")
          }
        >
          Revoke
        </ConfirmButton>
      )}
    </article>
  );
  return (
    <>
      <h1>Account</h1>
      <p>
        {actor.name} ·{" "}
        {actor.primaryOwner ? "Primary owner" : actor.owner ? "Owner" : "Project member"}
      </p>
      <div className="account-tabs" role="tablist" aria-label="Account sections">
        {tabs.map((item, index) => (
          <button
            key={item.id}
            type="button"
            id={`account-tab-${item.id}`}
            role="tab"
            aria-selected={tab === item.id}
            aria-controls={item.id}
            tabIndex={tab === item.id ? 0 : -1}
            onClick={() => selectTab(item.id)}
            onKeyDown={(event) => {
              let nextIndex: number;
              if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
              else if (event.key === "ArrowLeft")
                nextIndex = (index + tabs.length - 1) % tabs.length;
              else if (event.key === "Home") nextIndex = 0;
              else if (event.key === "End") nextIndex = tabs.length - 1;
              else return;
              event.preventDefault();
              const next = tabs[nextIndex]!.id;
              selectTab(next);
              document.getElementById(`account-tab-${next}`)?.focus();
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      {actor.owner && (
        <div
          className="account-panel"
          id="owner-links"
          role="tabpanel"
          aria-labelledby="account-tab-owner-links"
          hidden={tab !== "owner-links"}
        >
          <OwnerLinks />
        </div>
      )}
      <div
        className="account-panel"
        id="security"
        role="tabpanel"
        aria-labelledby="account-tab-security"
        hidden={tab !== "security"}
      >
        {actor.owner && (
          <section className="section">
            <h2>Service connection</h2>
            <ErrorNotice error={health.error} />
            {health.data ? (
              <p>
                Database: {health.data.database}. Configured image storage:{" "}
                {health.data.storage}. This readiness check does not verify an object
                upload or restore.
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
      </div>
      <section
        className="account-panel"
        id="connections"
        role="tabpanel"
        aria-labelledby="account-tab-connections"
        hidden={tab !== "connections"}
      >
        <h2>Connections</h2>
        <p>
          Revocation takes effect on the next request. Keep tokens private; access remains
          limited by current project permissions.
        </p>
        <ErrorNotice error={error} />
        {!data && !error ? (
          <Loading />
        ) : data?.items.length ? (
          <>
            <details className="account-group" open>
              <summary>
                Active agent keys (
                {activeTokens.filter((token) => token.kind === "agent").length})
              </summary>
              {activeTokens.filter((token) => token.kind === "agent").length ? (
                activeTokens.filter((token) => token.kind === "agent").map(tokenRow)
              ) : (
                <p className="muted">No active agent keys.</p>
              )}
            </details>
            <details className="account-group">
              <summary>
                Connected extensions (
                {activeTokens.filter((token) => token.kind !== "agent").length})
              </summary>
              {activeTokens.filter((token) => token.kind !== "agent").map(tokenRow)}
            </details>
            {!!pastTokens.length && (
              <details className="account-group">
                <summary>Expired and revoked ({pastTokens.length})</summary>
                {pastTokens.map(tokenRow)}
              </details>
            )}
          </>
        ) : (
          data && <p className="muted">No tokens or paired extensions.</p>
        )}
        <ActionState action={a} />
      </section>
      <section
        className="account-panel"
        id="agent-setup"
        role="tabpanel"
        aria-labelledby="account-tab-agent-setup"
        hidden={tab !== "agent-setup"}
      >
        <h2>Connect your coding agent</h2>
        <p>Personal key · {projects.length} current projects · 90 days</p>
        <p>
          Use your own Feedbacks key even when sharing a model-provider subscription.
          Claims identify this member and the named agent. New projects need a new key.
        </p>
        {!projects.length && (
          <p>You can connect an agent to update your profile before joining a project.</p>
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
              defaultValue={`${actor.name} agent`}
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
                  <input type="checkbox" name="projectIds" value={p.id} defaultChecked />
                  {p.name}
                </label>
              ))}
            </fieldset>
            <fieldset>
              <legend>Allowed operations</legend>
              <div className="scope-grid">
                {(actor.owner
                  ? agentTokenScopes
                  : [...selfAgentTokenScopes, ...selfAgentOptionalScopes]
                ).map((s) => (
                  <label className="check" key={s}>
                    <input
                      name="scopes"
                      type="checkbox"
                      value={s}
                      defaultChecked={
                        s !== "github.issueCreate" &&
                        (!!projects.length ||
                          (profileOnlyAgentScopes as readonly string[]).includes(s))
                      }
                    />
                    {s === "github.issueCreate"
                      ? "Create GitHub issues (explicit permission)"
                      : s}
                  </label>
                ))}
              </div>
              <p className="muted">
                Creating GitHub issues requires maintainer access in the chosen projects.
                This permission is off until you select it.
              </p>
            </fieldset>
            <label className="check">
              <input
                type="checkbox"
                name="canResolve"
                defaultChecked={
                  !!projects.length && projects.every((p) => p.permissions.canResolve)
                }
              />
              Allow resolving feedback (requires threads.status scope)
            </label>
            <p className="muted">
              {actor.owner
                ? "Includes delegated reviewer guidance and importance."
                : "Personal keys exclude owner-delegated policy weights and private notes."}{" "}
              Project permissions still apply; no account administration.
            </p>
          </details>
          <button className="primary" disabled={a.busy}>
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
      </section>
    </>
  );
}
