import React from "react";
import { api, type Project } from "../api.js";
import {
  ActionState,
  ErrorNotice,
  Field,
  useAction,
  useLoad,
  ExternalLink,
} from "../ui.js";

export function ProjectGithub({
  project,
  onSaved,
}: {
  project: Project;
  onSaved: (p: Project) => void;
}) {
  const action = useAction();
  const connection = useLoad<{
    appId: string | null;
    appName: string | null;
    approvedAccounts: string[];
    canSelectApp: boolean;
    apps: { id: string; name: string; slug: string; owners: string[] }[];
    configured: boolean;
    connected: boolean;
    statusSyncEnabled: boolean;
    installUrl: string | null;
    installation:
      | "not_configured"
      | "no_repository"
      | "installed"
      | "not_installed"
      | "unavailable";
    repositories: {
      repositoryUrl: string;
      connected: boolean;
      installation: "installed" | "not_installed" | "unavailable";
    }[];
  }>(
    () => api("github.connection", { projectId: project.id }),
    [project.id, project.revision],
  );
  return (
    <div className="github-project-page">
      <div className="page-heading">
        <div>
          <h1>GitHub</h1>
          <p>Turn feedback into a trackable Issue in your repository.</p>
        </div>
      </div>
      {connection.error && <ErrorNotice error={connection.error} />}
      <section className="github-connection-card" aria-labelledby="github-heading">
        <div className="github-connection-heading">
          <div>
            <h2 id="github-heading">Repository connection</h2>
            <p className="muted">
              Connect selected repositories, then choose the destination when creating an
              Issue.
            </p>
          </div>
        </div>
        {connection.data && (
          <div className="github-app-selection">
            {connection.data.canSelectApp ? (
              <form
                className="github-repository-form"
                key={connection.data.appId ?? "none"}
                onSubmit={(event) => {
                  event.preventDefault();
                  const appId =
                    String(new FormData(event.currentTarget).get("appId") ?? "") || null;
                  void action.run(async () => {
                    onSaved(
                      await api<Project>("github.appSelect", {
                        projectId: project.id,
                        revision: project.revision,
                        appId,
                      }),
                    );
                  }, "GitHub App saved.");
                }}
              >
                <Field label="GitHub App">
                  <select
                    name="appId"
                    aria-describedby="github-app-hint"
                    defaultValue={connection.data.appId ?? ""}
                    disabled={action.busy}
                  >
                    <option value="">No App selected</option>
                    {connection.data.appId &&
                      !connection.data.apps.some(
                        (app) => app.id === connection.data!.appId,
                      ) && (
                        <option value={connection.data.appId}>
                          Unavailable App (ID {connection.data.appId})
                        </option>
                      )}
                    {connection.data.apps.map((app) => (
                      <option value={app.id} key={app.id}>
                        {app.name}
                        {app.owners.length ? ` — ${app.owners.join(", ")}` : ""}
                      </option>
                    ))}
                  </select>
                </Field>
                <button type="submit" disabled={action.busy}>
                  Save App
                </button>
                <small id="github-app-hint" className="github-repository-hint">
                  Choose the App configured for this project's GitHub account.
                </small>
              </form>
            ) : (
              <p>
                <strong>GitHub App:</strong>{" "}
                {connection.data.appName ??
                  (connection.data.appId
                    ? "Configured App unavailable"
                    : "No App selected")}
                . Ask the server owner to change the App.
              </p>
            )}
            {connection.data.approvedAccounts.length > 0 && (
              <p className="muted">
                Approved GitHub accounts: {connection.data.approvedAccounts.join(", ")}.
              </p>
            )}
            {connection.data.canSelectApp && (
              <p>
                <a href="/github-apps">Manage configured Apps</a>
              </p>
            )}
            {connection.data.canSelectApp && project.githubConnected && (
              <p className="muted">
                Changing App disconnects this project's repositories and turns off status
                sync. Existing Issue links stay available through their original App.
              </p>
            )}
            <details>
              <summary>Use a private App from another GitHub account</summary>
              <p>
                Your organization can keep its own private App. The server owner can add
                it from Manage configured Apps, then choose it for this project.
              </p>
              {React.createElement("feedbacks-demo", { step: "github" })}
              <a href="https://feedbacks.softinator.ai/docs/guide/github">
                GitHub App setup guide
              </a>
            </details>
          </div>
        )}
        <ol
          className="github-steps"
          aria-label="GitHub connection status"
          aria-live="polite"
        >
          <li className={connection.data?.configured ? "done" : ""}>
            {connection.data?.configured ? "App configured" : "App not configured"}
          </li>
          <li className={connection.data?.installation === "installed" ? "done" : ""}>
            {connection.data?.installation === "installed"
              ? "App installed on repository"
              : connection.data?.installation === "not_installed"
                ? "App not installed on repository"
                : connection.data?.installation === "unavailable"
                  ? "Installation check unavailable"
                  : project.repositoryUrl
                    ? "Checking repository…"
                    : "Choose a repository"}
          </li>
          <li className={project.githubConnected ? "done" : ""}>
            Project {project.githubConnected ? "connected" : "not connected"}
          </li>
        </ol>
        {project.permissions.canMaintain && (
          <form
            className="github-repository-form"
            onSubmit={(event) => {
              event.preventDefault();
              const value = String(
                new FormData(event.currentTarget).get("repositoryUrl") ?? "",
              ).trim();
              void action.run(async () => {
                onSaved(
                  await api<Project>("projects.update", {
                    projectId: project.id,
                    revision: project.revision,
                    name: project.name,
                    origins: project.origins,
                    captureMode: project.captureMode,
                    reviewEnabled: project.reviewEnabled,
                    documentsEnabled: project.documentsEnabled,
                    surveysEnabled: project.surveysEnabled,
                    repositoryUrl: value,
                  }),
                );
              }, "Repository saved. Connect it after installation.");
            }}
          >
            <Field label="GitHub repository URL">
              <input
                name="repositoryUrl"
                type="url"
                defaultValue={project.repositoryUrl ?? ""}
                placeholder="https://github.com/owner/repository"
                required
              />
            </Field>
            <button type="submit" disabled={action.busy}>
              Save repository
            </button>
          </form>
        )}
        {connection.data?.repositories.some((repo) => repo.connected) && (
          <div
            className="github-repository-list"
            aria-label="Connected GitHub repositories"
          >
            <h3>Connected repositories</h3>
            {connection.data.repositories
              .filter((repo) => repo.connected)
              .map((repo) => (
                <div className="github-repository-item" key={repo.repositoryUrl}>
                  <div>
                    <strong>
                      {repo.repositoryUrl.replace("https://github.com/", "")}
                    </strong>
                    <span className="muted">
                      {repo.installation === "installed"
                        ? "App access verified"
                        : repo.installation === "not_installed"
                          ? "App installation missing"
                          : "Access check unavailable"}
                    </span>
                  </div>
                  {project.permissions.canMaintain && (
                    <button
                      type="button"
                      className="text-button"
                      disabled={action.busy}
                      onClick={() =>
                        void action.run(async () => {
                          onSaved(
                            await api<Project>("github.repositoryDisconnect", {
                              projectId: project.id,
                              revision: project.revision,
                              repositoryUrl: repo.repositoryUrl,
                            }),
                          );
                        }, "Repository disconnected; status sync paused.")
                      }
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
          </div>
        )}
        {project.permissions.canMaintain && connection.data?.configured && (
          <form
            className="github-repository-form"
            onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget;
              const repositoryUrl = String(
                new FormData(form).get("additionalRepositoryUrl") ?? "",
              ).trim();
              void action.run(async () => {
                onSaved(
                  await api<Project>("github.repositoryConnect", {
                    projectId: project.id,
                    revision: project.revision,
                    repositoryUrl,
                  }),
                );
                form.reset();
              }, "Repository connected.");
            }}
          >
            <Field label="Add another repository">
              <input
                name="additionalRepositoryUrl"
                aria-describedby="github-add-repository-hint"
                type="url"
                placeholder="https://github.com/owner/repository"
                required
              />
            </Field>
            <button type="submit" disabled={action.busy}>
              Add repository
            </button>
            <small id="github-add-repository-hint" className="github-repository-hint">
              The App must be installed on this exact repository.
            </small>
          </form>
        )}
        <div className="github-connection-actions">
          {connection.data?.configured && connection.data.installUrl && (
            <ExternalLink href={connection.data.installUrl}>
              {project.githubConnected
                ? "Manage App installations ↗"
                : "Install App on repository ↗"}
            </ExternalLink>
          )}
          {project.permissions.canMaintain &&
            !project.githubConnected &&
            connection.data?.installation === "installed" && (
              <button
                className="primary"
                type="button"
                disabled={action.busy}
                onClick={() =>
                  void action.run(async () => {
                    onSaved(
                      await api<Project>("github.connect", {
                        projectId: project.id,
                        revision: project.revision,
                      }),
                    );
                  }, "GitHub connected.")
                }
              >
                Connect project
              </button>
            )}
          {project.permissions.canMaintain && project.githubConnected && (
            <button
              className="text-button"
              type="button"
              disabled={action.busy}
              onClick={() =>
                void action.run(async () => {
                  onSaved(
                    await api<Project>("github.disconnect", {
                      projectId: project.id,
                      revision: project.revision,
                    }),
                  );
                }, "GitHub disconnected; status sync stopped.")
              }
            >
              Disconnect all
            </button>
          )}
        </div>
        {!connection.data?.configured && connection.data && (
          <p className="muted">
            Ask the server owner to configure a GitHub App.{" "}
            <a href="https://feedbacks.softinator.ai/docs/guide/github">Setup guide</a>
          </p>
        )}
      </section>
      <section className="github-connection-card" aria-labelledby="github-sync-heading">
        <h2 id="github-sync-heading">Status sync</h2>
        <p className="muted">
          Optional. A verified Issue’s open/closed state can update work status; conflicts
          pause for a maintainer.
        </p>
        {project.permissions.canMaintain && (
          <label className="check">
            <input
              type="checkbox"
              checked={project.githubStatusSync === true}
              disabled={
                action.busy ||
                (!project.githubStatusSync &&
                  (!project.githubConnected ||
                    !connection.data?.repositories.some(
                      (repo) => repo.connected && repo.installation === "installed",
                    )))
              }
              onChange={(event) =>
                void action.run(
                  async () => {
                    onSaved(
                      await api<Project>("github.statusSyncConfigure", {
                        projectId: project.id,
                        revision: project.revision,
                        enabled: event.target.checked,
                      }),
                    );
                  },
                  event.target.checked
                    ? "GitHub status sync enabled."
                    : "GitHub status sync disabled.",
                )
              }
            />{" "}
            Sync verified Issue open/closed state with thread work status
          </label>
        )}
        {!project.permissions.canMaintain && (
          <p>{project.githubStatusSync ? "On" : "Off"}</p>
        )}
      </section>
      <ActionState action={action} />
    </div>
  );
}
