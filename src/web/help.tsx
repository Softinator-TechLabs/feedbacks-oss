import React, { useState } from "react";
import { Icon } from "./icons.js";
import {
  ownerTokenScopes,
  selfAgentTokenScopes,
  profileOnlyAgentScopes,
} from "../shared/contracts.js";
import { agentSetupPrompt, type AgentIssuance } from "./agent-setup.js";
import { api, type Actor, type Project } from "./api.js";
import { ActionState, useAction, useLoad, Loading, ErrorNotice } from "./ui.js";
import { chromeWebStoreUrl } from "../shared/product-links.js";

function WatchStep({ step, title }: { step: string; title: string }) {
  return (
    <details className="help-watch">
      <summary>{title}</summary>
      {step
        .split(",")
        .map((part) => React.createElement("feedbacks-demo", { step: part, key: part }))}
    </details>
  );
}

function LatestExtension() {
  const { data: version } = useLoad(async () => {
    const response = await fetch("/downloads/extension-release.json", {
      cache: "no-store",
    });
    if (!response.ok) return null;
    const release = await response.json();
    return typeof release.version === "string" &&
      /^\d+(?:\.\d+){0,3}$/.test(release.version) &&
      release.downloadPath === "/downloads/feedbacks-extension.zip"
      ? release.version
      : null;
  }, []);
  if (!version) return null;
  return (
    <div className="help-latest-extension">
      <p>
        <strong>Need the latest version?</strong> Chrome Web Store may be a version behind
        while an update is under review.
      </p>
      <a
        className="button"
        href={`/downloads/feedbacks-extension.zip?v=${encodeURIComponent(version)}`}
        download
      >
        Download latest · v{version}
      </a>
      <details
        className="help-watch"
        id="update-extension"
        open={location.hash === "#update-extension" || undefined}
      >
        <summary>Install manually in Chrome</summary>
        <ol>
          <li>
            Download the ZIP above and <strong>extract it</strong>.
          </li>
          <li>
            Open <code>chrome://extensions</code> and turn on{" "}
            <strong>Developer mode</strong>.
          </li>
          <li>
            Choose <strong>Load unpacked</strong> and select the extracted folder.
          </li>
        </ol>
        <p className="muted">
          If both copies appear, turn off the Store copy and pin the manual one.
        </p>
        <p className="muted">
          Already installed manually? Replace the files in that folder, then click{" "}
          <strong>Reload</strong> in Chrome. Finish unsent reviews first.
        </p>
      </details>
    </div>
  );
}

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
        <p>Paste the prompt into Codex, Claude Code or Antigravity.</p>
        <p className="help-key-warning">
          Private 90-day key.{" "}
          {actor.owner
            ? `Full owner access to current and future projects${actor.primaryOwner ? ", including private member notes" : ""}.`
            : `Your existing access to ${projects.length ? "current projects and profile" : "your profile only"}.`}{" "}
          Only share with your own agent.
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

function ProjectReadiness({ actor, project }: { actor: Actor; project: Project }) {
  const { data, error } = useLoad(async () => {
    const [members, context] = await Promise.all([
      api<{ items: { id: string; active: boolean; removedAt?: string | null }[] }>(
        "members.list",
        { projectId: project.id },
      ),
      api<{ items: { body: string }[] }>("instructions.get", { projectId: project.id }),
    ]);
    return {
      colleagues: members.items.some(
        (member) => member.id !== actor.userId && member.active && !member.removedAt,
      ),
      context: !!context.items[0]?.body.trim(),
    };
  }, [project.id, actor.userId]);
  return (
    <>
      {data && (
        <p className="help-readiness-title">
          {data.colleagues && data.context ? "Project ready" : "Finish project setup"}
        </p>
      )}
      {!data && !error && (
        <p className="muted">Checking teammates and project context…</p>
      )}
      {error && (
        <p className="muted">
          Couldn’t check setup. <a href={`/projects/${project.id}`}>Open project</a> to
          check.
        </p>
      )}
      {data && (
        <div className="help-project-status" role="status">
          <span>
            {data.colleagues ? (
              <>
                <Icon name="check" /> Teammates already have access.
              </>
            ) : actor.owner ? (
              <a href={`/projects/${project.id}/members`}>Add teammates</a>
            ) : (
              "Ask your owner to add teammates."
            )}
          </span>
          <span>
            {data.context ? (
              <>
                <Icon name="check" /> Project context is set.
              </>
            ) : project.permissions.canMaintain ? (
              <a href={`/projects/${project.id}/instructions`}>Add project context</a>
            ) : (
              "Ask a maintainer to add project context."
            )}
          </span>
        </div>
      )}
      {data && actor.owner && (!data.colleagues || !data.context) && (
        <WatchStep step="project" title="Show project setup" />
      )}
    </>
  );
}

export function Help({ actor, projects }: { actor?: Actor; projects: Project[] }) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const project = projects.find((item) => item.id === projectId) ?? projects[0];
  const { data, error } = useLoad(async () => {
    const response = await fetch("/api/help", {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Sign in to connect your coding agent.");
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
    <article className="reading help-page help-quickstart">
      <div className="help-simple-heading">
        <h1>Let’s get you connected</h1>
        <div className="help-heading-actions">
          {React.createElement("feedbacks-motion-control")}
          <a href="https://feedbacks.softinator.ai/docs/">Docs</a>
        </div>
      </div>
      <p className="muted">Your team’s server is already set up.</p>
      <ol className="help-steps">
        <li>
          {project && actor ? (
            <>
              <div className="help-project-switcher">
                {projects.length > 1 ? (
                  <label className="help-project-picker">
                    <span>Choose a project</span>
                    <select
                      aria-label="Project"
                      value={project.id}
                      onChange={(event) => setProjectId(event.target.value)}
                    >
                      {projects.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <div className="help-project-picker">
                    <span>Your project</span>
                    <strong>{project.name}</strong>
                  </div>
                )}
                <a className="help-open-project" href={`/projects/${project.id}`}>
                  Open project <Icon name="external" />
                </a>
              </div>
              <ProjectReadiness key={project.id} actor={actor} project={project} />
            </>
          ) : (
            <>
              <h2>{actor?.owner ? "Create your first project" : "Get project access"}</h2>
              <p>
                {actor?.owner ? (
                  <a href="/">Create a project</a>
                ) : actor ? (
                  "Ask your owner to add you to a project."
                ) : (
                  <a href="/sign-in?returnTo=/help">Sign in to your team’s server</a>
                )}
              </p>
            </>
          )}
        </li>
        <li id="review-with-extension">
          <div className="help-step-heading">
            <h2>Connect the extension</h2>
            <a
              className="button"
              href={chromeWebStoreUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Install extension <Icon name="external" />
            </a>
          </div>
          <p>
            Pin it in Chrome. Paste this URL into the extension, then choose{" "}
            <strong>Connect to server</strong>.
          </p>
          <div className="help-server-copy">
            <input
              id="help-server-url"
              aria-label="Your Feedbacks server URL"
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
                    throw new Error("Select the server URL and copy it manually.");
                  }
                }, "Copied. Paste it into the extension.")
              }
            >
              {serverCopy.busy ? "Copying…" : "Copy server URL"}
            </button>
          </div>
          <ActionState action={serverCopy} />
          <LatestExtension />
          <WatchStep step="install,connect" title="Show install & connect" />
        </li>
        <li id="connect-agent">
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
        </li>
      </ol>
      <p className="muted help-footer">
        <a href="https://feedbacks.softinator.ai/docs/guide/chrome-extension">
          How to capture &amp; send feedback
        </a>
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
