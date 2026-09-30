import React from "react";
import { api } from "../api.js";
import { ErrorNotice, Loading, useLoad } from "../ui.js";
import type { IntegrationProvider } from "../../shared/contracts/domains/integrations.js";

export function Integrations() {
  const { data, error } = useLoad(
    () => api<{ providers: IntegrationProvider[] }>("integrations.catalog", {}),
    [],
  );
  return (
    <article className="github-apps-page integrations-page">
      <a href="/help">← Setup</a>
      <div className="page-heading">
        <div>
          <h1>Integrations</h1>
          <p>Connect your team's tools and choose where credentials are stored.</p>
        </div>
      </div>
      <ErrorNotice error={error} />
      {!data && !error && <Loading />}
      {data && (
        <ul className="github-apps-list">
          {data.providers.map((provider) => (
            <li key={provider.id}>
              <div className="github-app-heading">
                <h2>{provider.name}</h2>
                <a href={provider.managePath}>Manage {provider.name}</a>
              </div>
              <p>{provider.description}</p>
              <p>
                {provider.configuredConnections
                  ? `${provider.configuredConnections} configured connection${provider.configuredConnections === 1 ? "" : "s"} · ${provider.activeConnections} active`
                  : "Ready to connect"}
              </p>
              {!!provider.configuredConnections && (
                <p className="muted">
                  Encrypted in Feedbacks: {provider.storage.feedbacks} · Deployment
                  environment: {provider.storage.environment}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      <details>
        <summary>Storage and access</summary>
        <p>
          Choose encrypted storage in Feedbacks for management here, or your deployment
          environment for operator-managed secrets.
        </p>
        <p>
          Only server owners manage connections. Each tool asks for its own approval and
          controls which repositories or workspaces it can access.
        </p>
      </details>
    </article>
  );
}
