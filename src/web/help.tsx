import React, { useState } from "react";
import {
  ownerTokenScopes,
  selfAgentTokenScopes,
  profileOnlyAgentScopes,
} from "../shared/contracts.js";
import { agentSetupPrompt, type AgentIssuance } from "./agent-setup.js";
import { api, type Actor, type Project } from "./api.js";
import { ActionState, useAction, useLoad, Loading, ErrorNotice } from "./ui.js";
import { chromeWebStoreUrl } from "../shared/product-links.js";

function HelpAgentSetup({
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

  if (!actor)
    return (
      <section className="help-agent">
        <h2>Connect your coding agent</h2>
        <p>Sign in to create your personal agent setup prompt.</p>
      </section>
    );

  const scopes = actor.owner
    ? ownerTokenScopes
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
        <p>
          Copy the setup prompt, then paste it into Codex, Claude or your coding agent. It
          contains the connection details and a private API key.
        </p>
        <p className="help-key-warning">
          {actor.owner ? (
            <>
              This creates a 90-day key with full owner administration across current and
              future projects.
              {actor.primaryOwner
                ? " It can access your private member notes."
                : " Primary-owner private notes stay restricted."}
            </>
          ) : (
            <>
              This creates a 90-day personal key for your{" "}
              {projects.length ? "current projects and profile" : "profile only"}. It acts
              as you and keeps your existing project permissions.
            </>
          )}{" "}
          Share it only with your own agent. Even with a shared Codex subscription, each
          member needs their own Feedbacks key.
        </p>
      </div>
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
              ? "Copy setup again"
              : "Create key and copy setup"}
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

export function Help({ actor, projects }: { actor?: Actor; projects: Project[] }) {
  const { data, error } = useLoad(async () => {
    const response = await fetch("/api/help", {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Sign in to read help.");
    const document = new DOMParser().parseFromString(await response.text(), "text/html");
    return {
      instructions:
        document
          .querySelector<HTMLTemplateElement>("template#agent-setup-instructions")
          ?.content.textContent?.trim() ?? "",
    };
  }, []);
  const serverCopy = useAction();
  return (
    <article className="reading help-page help-simple">
      <div className="help-simple-heading">
        <h1>Help &amp; setup</h1>
        <a href="https://feedbacks.softinator.ai/docs/" target="_blank" rel="noreferrer">
          All guides
        </a>
      </div>
      <p>
        Feedbacks turns client requests and UI test findings into context your developer
        and AI coding agent can use: screenshots, the exact page, selected elements and
        project guidance.
      </p>
      <nav className="help-paths" aria-label="Choose a setup guide">
        <a href="https://feedbacks.softinator.ai/docs/guide/clients">Clients</a>
        <a href="#review-with-extension">Reviewers &amp; testers</a>
        <a href="https://feedbacks.softinator.ai/docs/guide/self-host">
          DevOps installation
        </a>
        <a href="#connect-agent">Developers using MCP</a>
      </nav>
      <section className="help-onboarding-section">
        <h2>Set up in this order</h2>
        <ol>
          <li>
            <strong>DevOps installs the team server.</strong> One installation on company
            infrastructure. This Help page belongs to your current server.
          </li>
          <li>
            <strong>Install, pin and connect the extension.</strong> Copy the server URL
            below. Project capture is available once the owner grants access.
          </li>
          <li>
            <strong>The owner prepares projects and people.</strong> Add website origins,
            publish project context, optionally connect the GitHub App, add members and
            set their profiles and responsibilities.{" "}
            <a href="https://feedbacks.softinator.ai/docs/guide/team-setup">
              Owner setup guide
            </a>
            .
          </li>
          <li>
            <strong>Each developer connects their own agent.</strong> Use a personal setup
            prompt for Codex, Claude Code or Antigravity. Reviewers do not need MCP to
            send feedback.
          </li>
        </ol>
      </section>
      <section id="review-with-extension" className="help-onboarding-section">
        <h2>Install and connect the Chrome extension</h2>
        <ol>
          <li>
            <a href={chromeWebStoreUrl} target="_blank" rel="noopener noreferrer">
              Open Feedbacks in the Chrome Web Store
            </a>
            . Choose <strong>Add to Chrome</strong>, then <strong>Add extension</strong>.
          </li>
          <li>
            Open Chrome’s <strong>Extensions</strong> menu (the puzzle-piece button), find
            Feedbacks and click its <strong>pin</strong>.
          </li>
          <li>
            Copy this server URL, click the pinned Feedbacks icon and paste it into{" "}
            <strong>Your Feedbacks server</strong>.
          </li>
          <li>
            Choose <strong>Connect to server</strong>, allow Chrome’s server access, sign
            in and approve the connection.
          </li>
        </ol>
        <label htmlFor="help-server-url">Your team’s Feedbacks server URL</label>
        <div className="help-server-copy">
          <input
            id="help-server-url"
            type="text"
            value={location.origin}
            readOnly
            onFocus={(event) => event.currentTarget.select()}
          />
          <button
            disabled={serverCopy.busy}
            onClick={() =>
              void serverCopy.run(async () => {
                try {
                  await navigator.clipboard.writeText(location.origin);
                } catch {
                  throw new Error(
                    "Clipboard access was denied. Select the server URL above and copy it manually.",
                  );
                }
              }, "Server URL copied. Paste it into Your Feedbacks server in the extension.")
            }
          >
            {serverCopy.busy ? "Copying…" : "Copy server URL"}
          </button>
        </div>
        <ActionState action={serverCopy} />
        <p className="muted">
          Use this address, not the website you want to review or the public docs address.
          No project appears? Ask the owner to grant access and add the website’s origin.
        </p>
      </section>
      <section className="help-onboarding-section">
        <h2>Send your first feedback</h2>
        <ol>
          <li>
            Open the website and <strong>click the pinned Feedbacks icon</strong> to start
            review. Choose a project if prompted.
          </li>
          <li>
            Hover the element, <strong>right-click</strong>, write what should change and
            choose <strong>Save point</strong>. Add more points as needed.
          </li>
          <li>
            Choose <strong>Review &amp; send</strong> to finalize your points. Check the
            saved screenshots and notes; redact private details.
          </li>
          <li>
            Choose <strong>Send feedback</strong>. Wait for completion, then open the
            resulting thread on this server.
          </li>
        </ol>
        <p>
          <strong>Save point is a local draft.</strong> It is not shared until Send
          feedback. If an upload stops, use <strong>Retry Send</strong> in the same draft.
        </p>
        <p>
          <a href="https://feedbacks.softinator.ai/docs/guide/chrome-extension">
            Full extension guide: install, pin, capture and send
          </a>
        </p>
      </section>
      <section id="connect-agent" className="help-onboarding-section">
        <h2>Resolve feedback with your own coding agent</h2>
        <p>
          After the owner sets up your project and member access, sign in as yourself and
          create your setup prompt below. Paste it into Codex, Claude Code or Antigravity.
          Ask the agent to verify project access, read the feedback and approved context,
          then work on the agreed changes. Record checks and fix evidence before
          resolving.
        </p>
        <p>
          <a href="https://feedbacks.softinator.ai/docs/guide/mcp">
            MCP setup and first-fix guide
          </a>
        </p>
      </section>
      <ErrorNotice error={error} />
      {data ? (
        <HelpAgentSetup
          actor={actor}
          projects={projects}
          instructions={data.instructions}
        />
      ) : (
        !error && <Loading />
      )}
      <details
        id="update-extension"
        className="compact-details"
        open={location.hash === "#update-extension"}
      >
        <summary>Update an unpacked extension</summary>
        <p>
          <a href="/downloads/feedbacks-extension.zip">Download the current extension</a>,
          extract it over your existing extension folder, then click Reload on its card in
          Chrome’s Extensions page. Finish any unsent review first and refresh the website
          afterwards. Keep the same folder to retain your connection.
        </p>
      </details>
      <p className="muted">
        Installation, permissions, MCP and GitHub setup are in the{" "}
        <a href="https://feedbacks.softinator.ai/docs/" target="_blank" rel="noreferrer">
          Feedbacks docs
        </a>
        .
      </p>
    </article>
  );
}
export function Privacy() {
  return (
    <article className="reading">
      <h1>Privacy & data use</h1>
      <p>
        Feedbacks is a private team review service. Access to projects, discussion and
        screenshots is restricted to authorized members and scoped tokens.
      </p>
      <section>
        <h2>Information stored</h2>
        <p>
          The service stores account identity, project memberships, comments and replies,
          reviewer policy, timestamps, target URLs, viewport and element context, and
          screenshots that users explicitly approve for upload. Sensitive query keys and
          URL fragments are removed server-side. Avoid confidential data in comments, URL
          paths and element identifiers.
        </p>
        <p>
          Passwords are hashed. Web sessions use HttpOnly cookies. The extension stores
          its paired device credential in trusted extension storage and sends it only to
          the selected Feedbacks service.
        </p>
        <p>
          A guest feedback link lets someone submit a name, page URL and comment to one
          project after a Turnstile check. The link does not reveal existing feedback or
          private member information. The project team can see submitted guest feedback.
        </p>
      </section>
      <section>
        <h2>Capture is explicit</h2>
        <p>
          The extension captures only when you initiate review. It does not continuously
          record your screen. Screenshots include the visible page, including forms and
          embedded frames, without automatic masking. Nothing is uploaded until you send
          it.
        </p>
        <p>
          Optional instant right-click installs a local listener on HTTP(S) websites after
          you approve Chrome’s all-website permission. It does not upload browsing history
          or capture pages in the background. General projects accept any website;
          ordinary projects keep their approved origins and all projects still require
          membership.
        </p>
        <p>
          Approved images are validated, stripped of image metadata and stored privately.
          Project authorization is checked when an image is read. No public bucket links
          are provided.
        </p>
      </section>
      <section>
        <h2>Optional diagnostics</h2>
        <p>
          Console and resource timing collection starts only when you choose it in the
          extension. It ends on capture, navigation, stop or after five minutes, with at
          most 25 console and 50 resource entries. Review the entries and explicitly
          enable sharing in the editor before sending them with a thread.
        </p>
        <p>
          URL credentials, queries and fragments are stripped. Headers, request bodies,
          cookies and storage values are not collected. Redaction is best effort; review
          messages and URL paths for private information. Shared entries follow the same
          project access and retention rules as discussion. Page-generated diagnostics are
          untrusted and may be incomplete.
        </p>
      </section>
      <section>
        <h2>Access, retention and removal</h2>
        <p>
          Owners manage access. You can revoke agent tokens and paired extensions in
          Account. Archiving keeps discussion and evidence; it is not erasure. Contact
          your deployment owner for exact retention, backup handling, account requests and
          operator-managed deletion.
        </p>
        <p>
          This application does not sell feedback, include advertising trackers, or send
          it to a model provider automatically. An authorized developer may share project
          context with a separately configured agent; that client’s own privacy settings
          also apply.
        </p>
      </section>
      <a href="/help">Back to help</a>
    </article>
  );
}
