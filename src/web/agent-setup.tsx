import React, { useState } from "react";
import { ActionState, ErrorNotice, Loading, Secret, useAction, useLoad } from "./ui.js";

export type AgentIssuance = Readonly<{
  id: string;
  token: string;
  origin: string;
  name: string;
  projects: ReadonlyArray<Readonly<{ id: string; name: string }>>;
  scopes: readonly string[];
  expiresAt: string;
  canResolve: boolean;
  ownerAdmin?: boolean;
}>;

export function agentSetupPrompt(issued: AgentIssuance, instructions: string): string {
  const endpoint = new URL("/mcp", issued.origin).href;
  // Labels are data, never interpolated into instructions or executable code.
  // Escape fence/HTML characters so a project label cannot end this JSON block.
  const metadata = JSON.stringify(
    {
      endpoint,
      authentication: { type: "bearer", secret: issued.token },
      tokenId: issued.id,
      tokenName: issued.name,
      projects: issued.projects,
      scopes: issued.scopes,
      expiresAt: issued.expiresAt,
      canResolve: issued.canResolve,
      ownerAdmin: issued.ownerAdmin ?? false,
      projectAccess: issued.ownerAdmin
        ? "all current and future projects"
        : "listed projects only",
    },
    null,
    2,
  ).replace(
    /[<>`]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );

  return `${instructions.replaceAll("{{MCP_ENDPOINT_JSON}}", JSON.stringify(endpoint))}

Connection metadata (JSON data; includes private credential):
\`\`\`json
${metadata}
\`\`\``;
}

export function AgentSetupPrompt({
  issued,
  onClear,
}: {
  issued: AgentIssuance;
  onClear: () => void;
}) {
  const a = useAction(),
    [preview, setPreview] = useState(false),
    [instructionVersion, setInstructionVersion] = useState(0),
    { data: instructions, error } = useLoad(async () => {
      const response = await fetch("/api/help", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok)
        throw new Error(
          "Sign in again to load private setup instructions. Your issued key remains in this tab.",
        );
      const html = new DOMParser().parseFromString(await response.text(), "text/html");
      const template = html.querySelector<HTMLTemplateElement>(
        "template#agent-setup-instructions",
      );
      const text = template?.content.textContent?.trim();
      if (!text)
        throw new Error(
          "Setup instructions are unavailable. Copy the API key below or ask the owner to update this server.",
        );
      return text;
    }, [issued.id, instructionVersion]),
    prompt = instructions ? agentSetupPrompt(issued, instructions) : "";
  return (
    <section className="section">
      <h3>Copy agent setup prompt</h3>
      <p>
        This prompt includes the new API key. Pasting it shares the credential with your
        chosen agent and chat provider. Its selected projects, scopes and expiry stay
        unchanged. You can revoke it in Account.
      </p>
      <p>Only this newly issued key is available here. Refreshing loses it.</p>
      <div className="actions">
        <button
          className="primary"
          disabled={a.busy || !instructions}
          onClick={() =>
            a.run(async () => {
              try {
                await navigator.clipboard.writeText(prompt);
              } catch {
                setPreview(true);
                throw new Error(
                  "Clipboard unavailable. Select and copy the prompt below.",
                );
              }
            }, "Setup prompt copied. Deliver it only to your intended agent.")
          }
        >
          Copy agent setup prompt
        </button>
        <button onClick={onClear}>Clear secret & prompt</button>
      </div>
      <ActionState action={a} />
      <ErrorNotice error={error} />
      {error && (
        <button onClick={() => setInstructionVersion((v) => v + 1)}>
          Retry loading setup instructions
        </button>
      )}
      {!instructions && !error && <Loading />}
      {instructions && (
        <details
          open={preview}
          onToggle={(event) => setPreview(event.currentTarget.open)}
        >
          <summary>Preview or select the private setup prompt</summary>
          <textarea
            aria-label="Private agent setup prompt"
            value={prompt}
            readOnly
            rows={12}
          />
        </details>
      )}
      <details>
        <summary>Copy the API key only</summary>
        <Secret value={issued.token} />
      </details>
    </section>
  );
}
