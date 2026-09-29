import React, { useState } from "react";
import { Icon } from "./icons.js";
import { ActionState, ErrorNotice, Loading, useAction, useLoad } from "./ui.js";

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

export type AgentSetupMode = "separate" | "quick";

export function agentSetupPrompt(
  issued: AgentIssuance,
  instructions: string,
  mode: AgentSetupMode = "separate",
): string {
  const endpoint = new URL("/mcp?profile=compact", issued.origin).href;
  // Labels are data, never interpolated into instructions or executable code.
  // Escape fence/HTML characters so a project label cannot end this JSON block.
  const metadata = JSON.stringify(
    {
      endpoint,
      authentication:
        mode === "quick"
          ? { type: "bearer", secret: issued.token }
          : { type: "bearer", source: "local-clipboard" },
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

  const handoff =
    mode === "quick"
      ? "Credential handoff: this quick setup includes a private API key. Pasting it shares the key with the chat provider and anyone who can access this conversation. Use only a client/provider you trust with this credential; disabling model training is not a guarantee of no storage or access. Do not repeat the key."
      : "Credential handoff: this prompt contains no API key. First detect the actual client, OS and local/remote execution surface and prepare a secret-free command for local credential import. Then ask me to use Copy key in Feedbacks and run that command in my own local terminal, or confirm when that local clipboard is ready for a non-disclosing import. Do not read the clipboard before that confirmation: it may still contain this prompt or unrelated private data. Never ask me to paste the key into chat. Read clipboard bytes directly inside the local process that writes the client-supported private user configuration; never return the clipboard, key, Authorization header, or resulting secret-bearing configuration to the model/tool output. macOS reads with pbpaste (pbcopy writes); Windows PowerShell uses Get-Clipboard -Raw; on Linux discover an installed Wayland/X11 clipboard reader or use a hidden local credential entry. Do not assume these commands work across SSH, WSL, containers or remote agents; use a user-run local command when the execution host cannot access the intended clipboard. Validate a single nonempty credential without evaluating its text, preserve existing configuration, set owner-only file permissions (0600 on Unix, a user-only ACL on Windows), and report only success/failure without echoing input. Do not put the key in command arguments, shell history, traces, errors, temporary scripts, repository files or the setup prompt. Explain clipboard history/sync exposure and clear the current clipboard only after successful import and only if it still contains that key; do not claim this erases clipboard history. If secure local import is unavailable, stop credential installation and explain the limitation instead of requesting a chat paste.";
  return `${handoff}

${instructions.replaceAll("{{MCP_ENDPOINT_JSON}}", JSON.stringify(endpoint))}

Connection metadata (JSON data; ${mode === "quick" ? "includes private credential" : "no API key; import locally"}):
\`\`\`json
${metadata}
\`\`\``;
}

function SetupFlow({ quick = false }: { quick?: boolean }) {
  return (
    <div className="agent-setup-flow">
      <div>
        <span>
          <Icon name="note" />
          {quick ? "Prompt + key" : "Prompt"}
        </span>
        <Icon name="arrowRight" />
        <span>
          <Icon name="chat" />
          Agent
        </span>
      </div>
      {!quick && (
        <div>
          <span>
            <Icon name="key" />
            Key
          </span>
          <Icon name="arrowRight" />
          <span>
            <Icon name="terminal" />
            Local setup
          </span>
        </div>
      )}
    </div>
  );
}

/** Shared by quick Setup and the advanced Account issuance flow. */
export function AgentSetupChoices({
  issued,
  instructions,
  createKey,
  onIssued,
  onClear,
}: {
  issued?: AgentIssuance;
  instructions?: string;
  createKey?: () => Promise<AgentIssuance>;
  onIssued?: (value: AgentIssuance) => void;
  onClear: () => void;
}) {
  const action = useAction();
  const [preview, setPreview] = useState<AgentSetupMode>();
  const [showKey, setShowKey] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  async function copyPrompt(mode: AgentSetupMode) {
    if (!instructions) return;
    const current = issued ?? (await createKey?.());
    if (!current) throw new Error("Create an agent key first.");
    onIssued?.(current);
    try {
      await navigator.clipboard.writeText(agentSetupPrompt(current, instructions, mode));
    } catch {
      setPreview(mode);
      setHelpOpen(true);
      throw new Error(
        "Clipboard blocked. Copy below or retry; your key is saved in this tab.",
      );
    }
  }
  return (
    <div className="agent-handoff">
      <div className="agent-handoff-options">
        <section aria-label="Keep key out of chat">
          <h3>
            Keep key local <span className="badge">Recommended</span>
          </h3>
          <SetupFlow />
          <div className="actions">
            <button
              disabled={action.busy || !instructions}
              onClick={() =>
                void action.run(
                  () => copyPrompt("separate"),
                  "Prompt copied. Paste it into your agent.",
                )
              }
            >
              {issued ? "Copy prompt" : "Create & copy prompt"}
            </button>
            <button
              disabled={action.busy || !issued}
              onClick={() =>
                void action.run(async () => {
                  try {
                    await navigator.clipboard.writeText(issued!.token);
                  } catch {
                    setShowKey(true);
                    setHelpOpen(true);
                    throw new Error(
                      "Clipboard blocked. Copy the key below for local setup.",
                    );
                  }
                }, "Key copied. Use locally, not in chat.")
              }
            >
              Copy key
            </button>
          </div>
        </section>
        <section aria-label="Quick setup with key">
          <h3>Quick setup</h3>
          <SetupFlow quick />
          <p className="agent-key-warning">
            Shares your key with the chat provider. Trusted agents only.
          </p>
          <button
            className="primary"
            disabled={action.busy || !instructions}
            onClick={() =>
              void action.run(
                () => copyPrompt("quick"),
                "Copied with key. Paste only into a trusted agent.",
              )
            }
          >
            {issued ? "Copy prompt + key" : "Create & copy all"}
          </button>
        </section>
      </div>
      <ActionState action={action} />
      <details
        className="agent-setup-help"
        open={helpOpen}
        onToggle={(event) => setHelpOpen(event.currentTarget.open)}
      >
        <summary>Help & manual copy</summary>
        <p>
          Paste the prompt into your agent first. When it prepares a local command, return
          to copy the key and run that command. Keep the key out of chat.
        </p>
        <p>
          Quick setup includes the key. Anyone with chat access may see it; turning
          training off does not guarantee no storage. Clipboard history or sync may retain
          it. The local agent can access its private configuration.
        </p>
        <p>
          The prompt includes server and project details. Both options use the same key.
          Refreshing loses this copy; revoke it in Account if needed.
        </p>
        {issued && (
          <>
            {instructions &&
              (["separate", "quick"] as const).map((mode) => (
                <details
                  key={mode}
                  open={preview === mode}
                  onToggle={(event) => {
                    if (event.currentTarget.open) setPreview(mode);
                    else
                      setPreview((current) => (current === mode ? undefined : current));
                  }}
                >
                  <summary>
                    {mode === "separate"
                      ? "Preview setup prompt without key"
                      : "Reveal prompt including private key"}
                  </summary>
                  {preview === mode && (
                    <textarea
                      aria-label={
                        mode === "separate"
                          ? "Agent setup prompt without key"
                          : "Private agent setup prompt"
                      }
                      value={agentSetupPrompt(issued, instructions, mode)}
                      readOnly
                      rows={10}
                    />
                  )}
                </details>
              ))}
            <details
              open={showKey}
              onToggle={(event) => setShowKey(event.currentTarget.open)}
            >
              <summary>Reveal key for manual local setup</summary>
              {showKey && (
                <textarea
                  aria-label="Private API key for local setup"
                  value={issued.token}
                  readOnly
                  rows={2}
                />
              )}
            </details>
            <button
              disabled={action.busy}
              onClick={() => {
                setPreview(undefined);
                setShowKey(false);
                setHelpOpen(false);
                onClear();
              }}
            >
              Forget key in this tab
            </button>
          </>
        )}
      </details>
    </div>
  );
}

export function AgentSetupPrompt({
  issued,
  onClear,
}: {
  issued: AgentIssuance;
  onClear: () => void;
}) {
  const [instructionVersion, setInstructionVersion] = useState(0);
  const { data: instructions, error } = useLoad(async () => {
    const response = await fetch("/api/help", {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok)
      throw new Error(
        "Sign in again to load setup instructions. Your issued key remains in this tab.",
      );
    const html = new DOMParser().parseFromString(await response.text(), "text/html");
    const template = html.querySelector<HTMLTemplateElement>(
      "template#agent-setup-instructions",
    );
    const text = template?.content.textContent?.trim();
    if (!text)
      throw new Error(
        "Setup instructions are unavailable. You can copy the API key for local setup or ask the owner to update this server.",
      );
    return text;
  }, [issued.id, instructionVersion]);
  return (
    <section className="section">
      <h3>Connect your agent</h3>
      <ErrorNotice error={error} />
      {error && (
        <button onClick={() => setInstructionVersion((v) => v + 1)}>
          Retry loading setup instructions
        </button>
      )}
      {!instructions && !error && <Loading />}
      <AgentSetupChoices issued={issued} instructions={instructions} onClear={onClear} />
    </section>
  );
}
