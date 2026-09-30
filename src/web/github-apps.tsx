import React, { useState } from "react";
import {
  CredentialStorageChoice,
  type CredentialStorage,
} from "./integrations/credential-storage.js";
import { api, type Project } from "./api.js";
import {
  ActionState,
  ErrorNotice,
  ExternalLink,
  Field,
  Loading,
  Notice,
  useAction,
  useLoad,
} from "./ui.js";

type AppInfo = {
  id: string;
  name: string;
  slug: string;
  owners: string[];
  account?: string;
  source?: "server" | "feedbacks";
  enabled?: boolean;
  revision?: number;
  accountType?: "organization" | "personal";
};
type AppInventory = { defaultAppId: string | null; apps: AppInfo[] };
const installationUrl = (app: AppInfo) =>
  `https://github.com/apps/${app.slug}/installations/new`;

function ExistingApp({ app, onSaved }: { app?: AppInfo; onSaved: () => void }) {
  const [appId, setAppId] = useState(app?.id ?? "");
  const [keyFile, setKeyFile] = useState<File | null>(null);
  const [fileReset, setFileReset] = useState(0);
  const action = useAction();
  return (
    <form
      className="github-app-form"
      onSubmit={(event) => {
        event.preventDefault();
        void action.run(async () => {
          if (!keyFile || keyFile.size > 16000)
            throw new Error("Choose a private key file smaller than 16 KB.");
          await api("github.appImport", {
            appId,
            revision: app?.revision ?? null,
            privateKey: await keyFile.text(),
          });
          setKeyFile(null);
          setFileReset((value) => value + 1);
          onSaved();
        }, "App verified and saved.");
      }}
    >
      <p className="muted">
        Generate a private key in this App’s GitHub settings, then choose its PEM file.
        Feedbacks verifies and encrypts the key; it is never displayed.
      </p>
      {!app && (
        <Field label="GitHub App ID">
          <input
            required
            inputMode="numeric"
            pattern="[0-9]+"
            value={appId}
            onChange={(event) => setAppId(event.target.value)}
          />
        </Field>
      )}
      <Field label="Private key file">
        <input
          key={fileReset}
          type="file"
          accept=".pem,.key"
          required
          onChange={(event) => setKeyFile(event.target.files?.[0] ?? null)}
        />
      </Field>
      <button disabled={action.busy || !keyFile}>
        {app ? "Verify & update key" : "Connect existing App"}
      </button>
      <ActionState action={action} />
    </form>
  );
}

function AppManagement({ app, onSaved }: { app: AppInfo; onSaved: () => void }) {
  const action = useAction();
  const [name, setName] = useState(app.name);
  const account = app.account ?? app.owners[0];
  const settings =
    app.accountType === "organization"
      ? `https://github.com/organizations/${encodeURIComponent(account ?? "")}/settings/apps/${app.slug}`
      : `https://github.com/settings/apps/${app.slug}`;
  const installations =
    app.accountType === "organization"
      ? `https://github.com/organizations/${encodeURIComponent(account ?? "")}/settings/installations`
      : "https://github.com/settings/installations";
  if (app.source !== "feedbacks")
    return (
      <div className="github-app-management">
        <p className="muted">
          Credentials stay in the deployment environment. You can keep this setup, or
          choose Manage here to move the App into encrypted Feedbacks storage. Its
          existing key will be verified and saved automatically.
        </p>
        <button
          disabled={action.busy}
          onClick={() =>
            void action.run(async () => {
              await api("github.appAdopt", { appId: app.id });
              onSaved();
            }, "App can now be managed here.")
          }
        >
          Manage here
        </button>
        <ActionState action={action} />
      </div>
    );
  return (
    <div className="github-app-management">
      <p className="muted">
        Managed in Feedbacks · App ID {app.id}. Sign in to GitHub with the account that
        can manage {account}.
      </p>
      <div className="actions">
        <ExternalLink href={installations}>Manage repository access ↗</ExternalLink>
        <ExternalLink href={settings}>App settings on GitHub ↗</ExternalLink>
      </div>
      <form
        className="inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          void action.run(async () => {
            await api("github.appUpdate", {
              appId: app.id,
              revision: app.revision!,
              name,
            });
            onSaved();
          }, "App name saved.");
        }}
      >
        <Field label="App name">
          <input
            required
            maxLength={100}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <button disabled={action.busy}>Save name</button>
      </form>
      <details>
        <summary>Update private key</summary>
        <ExistingApp app={app} onSaved={onSaved} />
      </details>
      <p className="muted">
        Disconnecting pauses this App’s projects. Its credentials and existing Issue links
        are kept so you can reconnect.
      </p>
      <button
        disabled={action.busy}
        onClick={() => {
          if (
            app.enabled !== false &&
            !window.confirm(
              "Disconnect this App? Its projects will pause until you reconnect it. Existing Issue links and credentials will be kept.",
            )
          )
            return;
          void action.run(async () => {
            await api("github.appEnable", {
              appId: app.id,
              revision: app.revision!,
              enabled: app.enabled === false,
            });
            onSaved();
          });
        }}
      >
        {app.enabled === false ? "Reconnect App" : "Disconnect App"}
      </button>
      <ActionState action={action} />
    </div>
  );
}

export function GithubApps({ projects }: { projects: Project[] }) {
  const [refresh, setRefresh] = useState(0);
  const [adding, setAdding] = useState(false);
  const [credentialStorage, setCredentialStorage] =
    useState<CredentialStorage>("feedbacks");
  const [account, setAccount] = useState("");
  const [accountType, setAccountType] = useState<"organization" | "personal">(
    "organization",
  );
  const action = useAction();
  const { data, error } = useLoad(() => api<AppInventory>("github.apps", {}), [refresh]);
  const reload = () => setRefresh((value) => value + 1);
  const appFor = (project: Project) =>
    project.githubAppId === undefined
      ? (data?.defaultAppId ?? null)
      : project.githubAppId;
  const active = data?.apps.filter((app) => app.enabled !== false) ?? [];
  const disabled = data?.apps.filter((app) => app.enabled === false) ?? [];
  const query = new URLSearchParams(window.location.search);
  const connectedApp =
    query.get("setup") === "connected"
      ? active.find((app) => app.id === query.get("appId"))
      : undefined;
  const projectList = (items: Project[]) => (
    <ul className="github-app-projects">
      {items.map((project) => (
        <li key={project.id}>
          <a href={`/projects/${project.id}/github`}>{project.name}</a>
          <span className="muted">
            {appFor(project) && !data?.apps.some((app) => app.id === appFor(project))
              ? "App unavailable — choose another App"
              : !appFor(project)
                ? "No App selected"
                : disabled.some((app) => app.id === appFor(project))
                  ? "App disconnected"
                  : project.githubConnected
                    ? "Repositories connected"
                    : "Connect repositories"}
          </span>
        </li>
      ))}
    </ul>
  );
  const appList = (apps: AppInfo[]) => (
    <ul className="github-apps-list">
      {apps.map((app) => {
        const assigned = projects.filter((project) => appFor(project) === app.id);
        return (
          <li key={app.id}>
            <div className="github-app-heading">
              <h3>{app.name}</h3>
              {app.enabled !== false && (
                <ExternalLink href={installationUrl(app)}>
                  Install on repositories ↗
                </ExternalLink>
              )}
            </div>
            <p>
              {app.account || app.owners.length
                ? `GitHub account: ${app.account ?? app.owners.join(", ")}`
                : "Choose Manage here to verify this App’s GitHub account."}
            </p>
            <p className="muted">
              Credential storage:{" "}
              {app.source === "feedbacks"
                ? "Encrypted in Feedbacks"
                : "Deployment environment"}
              .
            </p>
            {(app.account || app.owners.length > 0) && (
              <p className="muted">
                Use the GitHub login that can manage this account. A private App can only
                be installed on its owning account.
              </p>
            )}
            {assigned.length ? (
              <>
                <h4>Assigned projects ({assigned.length})</h4>
                {projectList(assigned)}
              </>
            ) : (
              <p className="muted">No projects assigned yet.</p>
            )}
            <details className="github-app-details">
              <summary>Manage App</summary>
              <AppManagement
                key={`${app.id}:${app.revision}`}
                app={app}
                onSaved={reload}
              />
            </details>
          </li>
        );
      })}
    </ul>
  );
  const otherProjects = projects.filter(
    (project) => !data?.apps.some((app) => app.id === appFor(project)),
  );
  return (
    <article className="github-apps-page">
      <a href="/integrations">← Integrations</a>
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
          {connectedApp && (
            <Notice>
              App connected. Install it on selected repositories, then choose it in your
              project’s GitHub tab.{" "}
              <ExternalLink href={installationUrl(connectedApp)}>
                Install on repositories ↗
              </ExternalLink>
            </Notice>
          )}
          {query.get("setup") === "failed" && (
            <div role="alert" className="notice error">
              GitHub setup could not be completed. Start again using the same Feedbacks
              session and the intended GitHub login. If the App was already created, use
              Connect existing App below.
            </div>
          )}
          <section
            className="github-add-account"
            aria-labelledby="add-github-account-heading"
          >
            <h2 id="add-github-account-heading">Add GitHub account</h2>
            <p>
              Create a private App for your GitHub organization or personal account.
              GitHub asks for approval; Feedbacks saves the connection automatically.
            </p>
            {active.length > 0 && !adding && (
              <button onClick={() => setAdding(true)}>Add GitHub account</button>
            )}
            {(adding || !active.length) && (
              <form
                className="github-app-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (credentialStorage !== "feedbacks") return;
                  void action.run(async () => {
                    const setup = await api<{ actionUrl: string; manifest: string }>(
                      "github.appSetupStart",
                      { account, accountType },
                    );
                    const state = new URL(setup.actionUrl).searchParams.get("state");
                    window.location.assign(
                      `/api/github-app/register?state=${encodeURIComponent(state ?? "")}`,
                    );
                  });
                }}
              >
                <CredentialStorageChoice
                  value={credentialStorage}
                  onChange={setCredentialStorage}
                />
                {credentialStorage === "feedbacks" ? (
                  <>
                    <Field label="Account type">
                      <select
                        value={accountType}
                        onChange={(event) =>
                          setAccountType(
                            event.target.value as "organization" | "personal",
                          )
                        }
                      >
                        <option value="organization">GitHub organization</option>
                        <option value="personal">Personal GitHub account</option>
                      </select>
                    </Field>
                    <Field
                      label={
                        accountType === "organization"
                          ? "GitHub organization name"
                          : "GitHub username"
                      }
                    >
                      <input
                        required
                        maxLength={39}
                        pattern="[A-Za-z0-9][A-Za-z0-9-]{0,38}"
                        placeholder={
                          accountType === "organization"
                            ? "your-github-org"
                            : "your-github-username"
                        }
                        value={account}
                        onChange={(event) => setAccount(event.target.value)}
                      />
                    </Field>
                    <p className="muted">
                      On GitHub, sign in with the login that can create Apps for this
                      account. Approve access to Issues, then select only the repositories
                      you need.
                    </p>
                    <button disabled={action.busy}>Continue to GitHub</button>
                  </>
                ) : (
                  <div>
                    <p>
                      Create the App in GitHub settings, then ask your server operator to
                      configure its credentials in the deployment environment and restart
                      the server.
                    </p>
                    <p className="muted">
                      The key stays in deployment secrets. Feedbacks can list and use this
                      App without moving it into encrypted storage.
                    </p>
                    <ExternalLink href="https://feedbacks.softinator.ai/docs/reference/manual/self-hosting#deployment-environment">
                      Environment setup steps ↗
                    </ExternalLink>
                  </div>
                )}
                <ActionState action={action} />
              </form>
            )}
            <details>
              <summary>Connect existing App</summary>
              <ExistingApp onSaved={reload} />
            </details>
          </section>
          <section aria-labelledby="configured-apps-heading">
            <h2 id="configured-apps-heading">Configured Apps ({active.length})</h2>
            <p className="muted">
              Each repository needs an approved GitHub installation. Choose the right App
              in each project’s GitHub tab.
            </p>
            {active.length ? appList(active) : <p>No GitHub Apps connected yet.</p>}
          </section>
          {disabled.length > 0 && (
            <section>
              <h2>Disconnected Apps ({disabled.length})</h2>
              {appList(disabled)}
            </section>
          )}
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
          <details className="github-apps-help">
            <summary>How it works · three steps</summary>
            {React.createElement("feedbacks-demo", { step: "github" })}
            <ExternalLink href="https://feedbacks.softinator.ai/docs/guide/github">
              GitHub App setup guide ↗
            </ExternalLink>
          </details>
        </>
      )}
    </article>
  );
}
