import { managedGithubConfig } from "../github-managed-apps.js";
import { configuredGithubApps } from "../github-app-config.js";
import type { IntegrationAdapter } from "./types.js";
export const githubIntegration: IntegrationAdapter = {
  descriptor: {
    id: "github",
    name: "GitHub",
    description: "Create and track GitHub Issues from feedback.",
    managePath: "/github-apps",
    capabilities: ["issue_create", "issue_link", "issue_status_sync"],
  },
  async summarize({ db, config, store }) {
    const apps = configuredGithubApps(await managedGithubConfig(db, config, store));
    const rows = await db.query("SELECT app_id,enabled FROM github_managed_apps");
    const retained = new Set([
      ...apps.map((app) => app.id),
      ...rows.map((row) => row.app_id),
    ]);
    return {
      configuredConnections: retained.size,
      activeConnections: apps.length,
      storage: {
        feedbacks: rows.length,
        environment: apps.filter((app) => !rows.some((row) => row.app_id === app.id))
          .length,
      },
    };
  },
};
