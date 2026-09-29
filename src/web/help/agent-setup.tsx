import React, { useState } from "react";
import {
  ownerTokenScopes,
  ownerEvidenceReadScopes,
  selfAgentTokenScopes,
  profileOnlyAgentScopes,
} from "../../shared/contracts.js";
import { AgentSetupChoices, type AgentIssuance } from "../agent-setup.js";
import { api, type Actor, type Project } from "../api.js";
import { WatchStep } from "./watch-step.js";

export function HelpAgentSetup({
  actor,
  projects,
  instructions,
}: {
  actor?: Actor;
  projects: Project[];
  instructions: string;
}) {
  const [issued, setIssued] = useState<AgentIssuance>();

  if (!actor)
    return (
      <section className="help-agent">
        <h2>Connect your coding agent</h2>
        <p>Sign in to create your personal agent setup prompt.</p>
      </section>
    );

  const scopes = actor.owner
    ? [...ownerTokenScopes, ...ownerEvidenceReadScopes]
    : projects.length
      ? selfAgentTokenScopes
      : profileOnlyAgentScopes;
  const canResolve = !!projects.length && projects.every((p) => p.permissions.canResolve);
  async function createKey(): Promise<AgentIssuance> {
    const result = await api<{
      id: string;
      token: string;
      name: string;
      expiresAt: string;
    }>("tokens.create", {
      name: `${actor!.name} agent`,
      projectIds: projects.map((project) => project.id),
      scopes: [...scopes],
      ownerAdmin: !!actor!.owner,
      expiresInDays: 90,
      canResolve: actor!.owner || canResolve,
    });
    return {
      ...result,
      origin: location.origin,
      projects: projects.map(({ id, name }) => ({ id, name })),
      scopes: [...scopes],
      ownerAdmin: !!actor!.owner,
      canResolve: actor!.owner || canResolve,
    };
  }

  return (
    <section className="help-agent">
      <div>
        <h2>Connect your coding agent</h2>
        <p>Choose how to connect Codex, Claude Code or Antigravity.</p>
        <p className="help-key-warning">
          Private 90-day key.{" "}
          {actor.owner
            ? `Owner administration for current and future projects${actor.primaryOwner ? ", including private member notes" : ""}.`
            : `Your existing access to ${projects.length ? "current projects and profile" : "your profile only"}.`}{" "}
          Only share with your own agent.
        </p>
      </div>
      <AgentSetupChoices
        issued={issued}
        instructions={instructions}
        createKey={createKey}
        onIssued={setIssued}
        onClear={() => setIssued(undefined)}
      />
      <a href="/account#agent-setup">Choose projects and permissions</a>
      {!instructions && (
        <p className="error" role="alert">
          Setup instructions are unavailable. Ask the owner to update this server before
          creating a key.
        </p>
      )}
      <WatchStep step="agent" title="Show me where to paste" />
    </section>
  );
}
