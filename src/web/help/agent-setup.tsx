import React, { useState } from "react";
import {
  ownerTokenScopes,
  ownerEvidenceReadScopes,
  selfAgentTokenScopes,
  profileOnlyAgentScopes,
} from "../../shared/contracts.js";
import { agentSetupPrompt, type AgentIssuance } from "../agent-setup.js";
import { api, type Actor, type Project } from "../api.js";
import { ActionState, useAction } from "../ui.js";
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
  const action = useAction();
  const [issued, setIssued] = useState<AgentIssuance>();
  const [prompt, setPrompt] = useState("");
  const [showPrompt, setShowPrompt] = useState(false);
  const [evidenceAccess, setEvidenceAccess] = useState(false);

  if (!actor)
    return (
      <section className="help-agent">
        <h2>Connect your coding agent</h2>
        <p>Sign in to create your personal agent setup prompt.</p>
      </section>
    );

  const scopes = actor.owner
    ? [...ownerTokenScopes, ...(evidenceAccess ? ownerEvidenceReadScopes : [])]
    : projects.length
      ? selfAgentTokenScopes
      : profileOnlyAgentScopes;
  const canResolve = !!projects.length && projects.every((p) => p.permissions.canResolve);
  async function copyAgentSetup() {
    let nextPrompt = prompt;
    if (!issued) {
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
      const nextIssued: AgentIssuance = {
        ...result,
        origin: location.origin,
        projects: projects.map(({ id, name }) => ({ id, name })),
        scopes: [...scopes],
        ownerAdmin: !!actor!.owner,
        canResolve: actor!.owner || canResolve,
      };
      nextPrompt = agentSetupPrompt(nextIssued, instructions);
      setIssued(nextIssued);
      setPrompt(nextPrompt);
    }
    try {
      await navigator.clipboard.writeText(nextPrompt);
      setShowPrompt(false);
    } catch {
      setShowPrompt(true);
      throw new Error(
        "The agent key was created, but clipboard access was denied. Select and copy the private prompt below, or retry without creating another key.",
      );
    }
  }

  return (
    <section className="help-agent">
      <div>
        <h2>Connect your coding agent</h2>
        <p>Paste the prompt into Codex, Claude Code or Antigravity.</p>
        <p className="help-key-warning">
          Private 90-day key.{" "}
          {actor.owner
            ? `Owner administration for current and future projects${actor.primaryOwner ? ", including private member notes" : ""}.`
            : `Your existing access to ${projects.length ? "current projects and profile" : "your profile only"}.`}{" "}
          Only share with your own agent.
        </p>
      </div>
      {actor.owner && (
        <div>
          <label className="check">
            <input
              type="checkbox"
              checked={evidenceAccess}
              disabled={!!issued || action.busy}
              onChange={(event) => setEvidenceAccess(event.target.checked)}
              aria-describedby="agent-evidence-help"
            />
            Read shared recordings and diagnostics
          </label>
          <p className="muted" id="agent-evidence-help">
            Allows your agent to inspect captured page content, console and network
            evidence. Applies to this new key only. Existing keys keep their permissions;
            create a replacement and reconnect your agent if access is missing.
          </p>
        </div>
      )}
      <div className="help-agent-actions">
        <button
          className="primary"
          disabled={action.busy || !instructions}
          onClick={() =>
            void action.run(
              copyAgentSetup,
              issued
                ? "Agent setup prompt copied again."
                : "Private key created and setup prompt copied.",
            )
          }
        >
          {action.busy
            ? issued
              ? "Copying…"
              : "Creating key…"
            : issued
              ? "Copy prompt again"
              : "Create key & copy prompt"}
        </button>
        <a href="/account#agent-setup">Choose projects and permissions</a>
        <ActionState action={action} />
        {!instructions && (
          <p className="error" role="alert">
            Setup instructions are unavailable. Ask the owner to update this server before
            creating a key.
          </p>
        )}
      </div>
      <WatchStep step="agent" title="Show me where to paste" />
      {prompt && (
        <details
          className="help-prompt"
          open={showPrompt}
          onToggle={(event) => setShowPrompt(event.currentTarget.open)}
        >
          <summary>Preview or manually copy the private setup prompt</summary>
          <textarea
            aria-label="Private agent setup prompt"
            value={prompt}
            readOnly
            rows={12}
          />
        </details>
      )}
    </section>
  );
}
