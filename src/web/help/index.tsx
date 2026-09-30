import { setServerInExtension } from "../extension-setup.js";
import React, { useState } from "react";
import { Icon } from "../icons.js";
import type { Actor, Project } from "../api.js";
import { ActionState, useAction, useLoad, Loading, ErrorNotice } from "../ui.js";
import { chromeWebStoreUrl } from "../../shared/product-links.js";
import { WatchStep } from "./watch-step.js";
import { HelpAgentSetup } from "./agent-setup.js";
import { ProjectReadiness } from "./project-readiness.js";

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
    <details
      className="help-watch"
      id="update-extension"
      open={location.hash === "#update-extension" || undefined}
    >
      <summary>Manual install · v{version}</summary>
      <a
        className="button"
        href={`/downloads/feedbacks-extension.zip?v=${encodeURIComponent(version)}`}
        download
      >
        Download latest · v{version}
      </a>

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
  const extensionSetup = useAction();
  return (
    <article className="reading help-page help-quickstart">
      <div className="help-simple-heading">
        <h1>Let’s get you connected</h1>
        <a href="https://feedbacks.softinator.ai/docs/">Docs</a>
      </div>
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
          <div className="help-pin">
            <div>
              <h3>Pin Feedbacks</h3>
              <p>
                Chrome → Extensions → <strong>Pin</strong>.
              </p>
            </div>
            {React.createElement("feedbacks-demo", { step: "pin" })}
          </div>
          <div className="help-server-copy">
            <input
              id="help-server-url"
              aria-label="Your Feedbacks server URL"
              value={location.origin}
              readOnly
              onFocus={(event) => event.currentTarget.select()}
            />
            <button
              className="primary"
              disabled={extensionSetup.busy}
              onClick={() =>
                void extensionSetup.run(
                  setServerInExtension,
                  "Server set. Continue in extension Settings to connect.",
                )
              }
            >
              {extensionSetup.busy ? "Setting…" : "Set in extension"}
            </button>
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
          <ActionState action={extensionSetup} />
          <ActionState action={serverCopy} />
          <details className="help-watch">
            <summary>Connection help</summary>
            <p>
              Open Feedbacks on this page and choose <strong>Connect to server</strong>,
              or use <strong>Set in extension</strong> above.
            </p>
            <p>
              Review shortcut: Mac <kbd>⌘ Shift Y</kbd> · Windows <kbd>Ctrl Shift Y</kbd>.
            </p>
            <WatchStep step="connect" title="Show how to connect" />
          </details>
          <LatestExtension />
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
      {actor?.owner && (
        <section className="help-github-apps">
          <h2>GitHub integration · optional</h2>
          <p>Manage the Apps configured on this server and their project assignments.</p>
          <a href="/github-apps">Manage GitHub Apps</a>
        </section>
      )}
      <p className="muted help-footer">
        <a href="https://feedbacks.softinator.ai/docs/guide/chrome-extension">
          How to capture &amp; send feedback
        </a>
      </p>
    </article>
  );
}
