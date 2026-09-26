import React, { useEffect, useState } from "react";
import { ownerTokenScopes } from "../shared/contracts.js";
import { agentSetupPrompt, type AgentIssuance } from "./agent-setup.js";
import { api, type Actor, type Project } from "./api.js";
import { ActionState, useAction, useLoad, Loading, ErrorNotice } from "./ui.js";
import { chromeWebStoreUrl, officialWebsiteUrl } from "../shared/product-links.js";

type HelpContent = {
  moreHtml: string;
  instructions: string;
};

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

  if (!actor?.owner)
    return (
      <section className="help-agent">
        <h2>Connect your coding agent</h2>
        <p>Ask a workspace owner to create a private agent setup prompt.</p>
      </section>
    );

  async function copyAgentSetup() {
    let nextPrompt = prompt;
    if (!issued) {
      const result = await api<{
        id: string;
        token: string;
        name: string;
        expiresAt: string;
      }>("tokens.create", {
        name: "Internal agents",
        projectIds: projects.map((project) => project.id),
        scopes: [...ownerTokenScopes],
        ownerAdmin: true,
        expiresInDays: 90,
        canResolve: true,
      });
      const nextIssued: AgentIssuance = {
        ...result,
        origin: location.origin,
        projects: projects.map(({ id, name }) => ({ id, name })),
        scopes: [...ownerTokenScopes],
        ownerAdmin: true,
        canResolve: true,
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
          Give Codex, Claude or another MCP client a private connection to this workspace.
          The prompt includes the server address, a newly issued API key, permissions,
          expiry and setup instructions. Your agent reads current discussions through MCP
          after connecting.
        </p>
        <p className="help-key-warning">
          This creates a 90-day key with full owner administration across current and
          future projects.
          {actor.primaryOwner
            ? " It can access your private member notes."
            : " Primary-owner private notes stay restricted."}{" "}
          Share it only with an agent you trust.
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
        <a href="/account#agent-setup">Choose limited access instead</a>
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
  const [copiedCommand, setCopiedCommand] = useState(false);
  const mcpCommand = `codex mcp add feedbacks --url ${location.origin}/mcp --bearer-token-env-var FEEDBACKS_TOKEN`;
  const { data, error } = useLoad(async () => {
    const r = await fetch("/api/help", {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!r.ok) throw new Error("Sign in to read help.");
    const document = new DOMParser().parseFromString(await r.text(), "text/html");
    const template = document.querySelector<HTMLTemplateElement>(
      "template#agent-setup-instructions",
    );
    const instructions = template?.content.textContent?.trim() ?? "";
    template?.remove();
    const install = document.querySelector("section");
    document.querySelector("h1")?.remove();
    document.body.querySelector(":scope > p")?.remove();
    install?.remove();
    document.querySelector("#agent-setup-slot")?.remove();
    for (const disclosure of document.body.querySelectorAll(":scope > details")) {
      const section = document.createElement("section");
      const summary = disclosure.querySelector(":scope > summary");
      const heading = document.createElement("h2");
      heading.textContent = summary?.textContent ?? "More information";
      if (summary?.id) heading.id = summary.id;
      summary?.remove();
      section.append(heading, ...Array.from(disclosure.childNodes));
      disclosure.replaceWith(section);
    }
    return {
      moreHtml: document.body.innerHTML,
      instructions,
    } satisfies HelpContent;
  }, []);
  useEffect(() => {
    const revealUpdate = () => {
      if (location.hash !== "#update-extension") return;
      const more = document.getElementById("more-help");
      if (more instanceof HTMLDetailsElement) more.open = true;
      document.getElementById("update-extension")?.scrollIntoView();
    };
    revealUpdate();
    window.addEventListener("hashchange", revealUpdate);
    return () => window.removeEventListener("hashchange", revealUpdate);
  }, [data]);
  return (
    <>
      <ErrorNotice error={error} />
      {data ? (
        <article className="reading help-page">
          <div className="help-intro">
            <h1>Review the web together.</h1>
            <p>
              Capture a page, mark the exact spot and keep the discussion in one place.
            </p>
          </div>
          <div className="help-start">
            <section className="help-install" aria-labelledby="help-install-title">
              <h2 id="help-install-title">Start reviewing in Chrome</h2>
              <ol>
                <li>Install and pin the Feedbacks extension.</li>
                <li>
                  Enter <code>{location.origin}</code> as your server.
                </li>
                <li>Sign in and approve the pairing request.</li>
              </ol>
              <a
                className="button primary"
                href={chromeWebStoreUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Get the Chrome extension ↗
              </a>
            </section>
            <section className="help-docs" aria-labelledby="help-docs-title">
              <div className="help-docs-heading">
                <div>
                  <h2 id="help-docs-title">Find your guide</h2>
                  <p>Short answers here; full steps in searchable docs.</p>
                </div>
                <a href="https://feedbacks.softinator.ai/docs/">Search docs ↗</a>
              </div>
              <nav className="help-docs-list" aria-label="Feedbacks guides">
                <a href="https://feedbacks.softinator.ai/docs/guide/getting-started">
                  <strong>Getting started</strong>
                  <span>Join a workspace and review your first request</span>
                </a>
                <a href="https://feedbacks.softinator.ai/docs/guide/chrome-extension">
                  <strong>Chrome extension</strong>
                  <span>Pair, grant permissions and capture a page</span>
                </a>
                <a href="https://feedbacks.softinator.ai/docs/guide/mcp">
                  <strong>AI agents and MCP</strong>
                  <span>Understand MCP and connect a coding agent</span>
                </a>
                <a href="https://feedbacks.softinator.ai/docs/guide/github">
                  <strong>GitHub Issues</strong>
                  <span>Install the App and create an Issue</span>
                </a>
                <a href="https://feedbacks.softinator.ai/docs/guide/self-host">
                  <strong>Developer installation</strong>
                  <span>Run locally or self-host a team server</span>
                </a>
              </nav>
            </section>
          </div>
          <section className="help-connect" aria-labelledby="help-connect-title">
            <div>
              <h2 id="help-connect-title">Connect a coding agent</h2>
              <p>
                Create a scoped key in Account, then give the key to your MCP client
                privately. This command contains no secret.
              </p>
            </div>
            <div className="help-mcp-command">
              <code>{mcpCommand}</code>
              <button
                type="button"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(mcpCommand)
                    .then(() => setCopiedCommand(true))
                    .catch(() => setCopiedCommand(false))
                }
              >
                {copiedCommand ? "Copied" : "Copy command"}
              </button>
            </div>
            <p className="muted">
              Supply <code>FEEDBACKS_TOKEN</code> privately to Codex.{" "}
              <a href="https://feedbacks.softinator.ai/docs/guide/mcp">
                Read the MCP setup guide →
              </a>
            </p>
          </section>
          <HelpAgentSetup
            actor={actor}
            projects={projects}
            instructions={data.instructions}
          />
          <details id="more-help">
            <summary>More help</summary>
            <div dangerouslySetInnerHTML={{ __html: data.moreHtml }} />
          </details>
          <p className="help-website-link">
            Looking for the product overview?{" "}
            <a href={officialWebsiteUrl}>Visit the Feedbacks website</a>.
          </p>
        </article>
      ) : (
        !error && <Loading />
      )}
    </>
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
