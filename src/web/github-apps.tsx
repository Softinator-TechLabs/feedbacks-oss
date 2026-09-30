import React from "react";
import { api, type Project } from "./api.js";
import { ErrorNotice, ExternalLink, Loading, useLoad } from "./ui.js";

type AppInventory = {
  defaultAppId: string | null;
  apps: { id: string; name: string; slug: string; owners: string[] }[];
};

export function GithubApps({ projects }: { projects: Project[] }) {
  const { data, error } = useLoad(() => api<AppInventory>("github.apps", {}), []);
  const appFor = (project: Project) =>
    project.githubAppId === undefined
      ? (data?.defaultAppId ?? null)
      : project.githubAppId;
  const projectList = (items: Project[]) => (
    <ul className="github-app-projects">
      {items.map((project) => (
        <li key={project.id}>
          <a href={`/projects/${project.id}/github`}>{project.name}</a>
          <span className="muted">
            {appFor(project) && !data?.apps.some((app) => app.id === appFor(project))
              ? `App ID ${appFor(project)} unavailable — restore configuration or choose an App`
              : !appFor(project)
                ? "No App selected"
                : project.githubConnected
                  ? "Repositories connected"
                  : "Connect repositories"}
          </span>
        </li>
      ))}
    </ul>
  );
  const otherProjects = projects.filter(
    (project) => !data?.apps.some((app) => app.id === appFor(project)),
  );
  return (
    <article className="github-apps-page">
      <a href="/help">← Setup</a>
      <div className="page-heading">
        <div>
          <h1>GitHub Apps</h1>
          <p>Connect each project with the right GitHub account.</p>
        </div>
      </div>
      <ErrorNotice error={error} />
      {!data && !error && <Loading />}
      {data && (
        <>
          <section aria-labelledby="configured-apps-heading">
            <h2 id="configured-apps-heading">Configured Apps ({data.apps.length})</h2>
            <p className="muted">
              Credentials are loaded on this server. Each repository still needs an
              approved GitHub installation.
            </p>
            {data.apps.length ? (
              <ul className="github-apps-list">
                {data.apps.map((app) => {
                  const assigned = projects.filter(
                    (project) => appFor(project) === app.id,
                  );
                  return (
                    <li key={app.id}>
                      <div className="github-app-heading">
                        <h3>{app.name}</h3>
                        <ExternalLink
                          href={`https://github.com/apps/${app.slug}/installations/new`}
                        >
                          Manage installations ↗
                        </ExternalLink>
                      </div>
                      <p>
                        {app.owners.length
                          ? `Approved GitHub accounts: ${app.owners.join(", ")}`
                          : "Repository access follows this App's GitHub installations."}
                      </p>
                      {assigned.length ? (
                        <>
                          <h4>Assigned projects ({assigned.length})</h4>
                          {projectList(assigned)}
                        </>
                      ) : (
                        <p className="muted">No projects assigned yet.</p>
                      )}
                      <details className="github-app-details">
                        <summary>App details</summary>
                        <p className="muted">
                          App ID {app.id} · {app.slug}
                        </p>
                        {app.id === data.defaultAppId && (
                          <p className="muted">
                            Default for projects without an explicit App selection.
                          </p>
                        )}
                      </details>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p>No GitHub Apps configured yet. Start with the setup steps below.</p>
            )}
          </section>
          {otherProjects.length > 0 && (
            <section aria-labelledby="other-app-projects-heading">
              <h2 id="other-app-projects-heading">Other projects</h2>
              {projectList(otherProjects)}
            </section>
          )}
          {!projects.length && (
            <p>
              <a href="/">Create a project</a> to assign an App.
            </p>
          )}
          <details
            className="github-apps-help"
            open={data.apps.length === 0 || undefined}
          >
            <summary>Connect another GitHub account</summary>
            <p>Each organization can keep its own private App on this server.</p>
            {React.createElement("feedbacks-demo", { step: "github" })}
            <details className="github-app-operator-help">
              <summary>Server operator instructions</summary>
              <p>
                Use Metadata read and Issues read/write permissions. Add the App ID, name,
                slug, key and approved GitHub accounts to <code>GITHUB_APPS_JSON</code>
                in deployment secrets, then restart the server. Keys stay there and are
                never shown here.
              </p>
              <p>
                Keep the existing default credentials for older Issue links. Before
                removing an App, reassign or disable its projects; historical Issue access
                still needs the original App. Rotate keys under the same App ID.
              </p>
            </details>
            <ExternalLink href="https://feedbacks.softinator.ai/docs/guide/github">
              GitHub App setup guide ↗
            </ExternalLink>
          </details>
        </>
      )}
    </article>
  );
}
