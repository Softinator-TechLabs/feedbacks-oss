import { githubIntegration } from "./github.js";
import type { IntegrationAdapter, IntegrationContext } from "./types.js";
import { trackerNames } from "./trackers/providers.js";
import type { TrackerProvider } from "../../shared/contracts/domains/trackers.js";
// Register only adapters whose server operations and owner UI are implemented.
const trackerAdapters: IntegrationAdapter[] = (
  Object.entries(trackerNames) as [TrackerProvider, string][]
).map(([id, name]) => ({
  descriptor: {
    id,
    name,
    description:
      id === "firmao"
        ? "Create reviewed CRM tasks in a selected Firmao project, verify task IDs and explicitly sync mapped statuses. Task comments are unavailable."
        : `Create, link and explicitly share comments or status changes. Verify account access in setup before use.`,
    managePath: "/trackers",
    capabilities: ["issue_create", "issue_link", "issue_status_sync"],
  },
  async summarize({ db }) {
    const counts = await db.one(
      "SELECT count(*)::int configured,count(*) FILTER (WHERE enabled=true AND health='healthy')::int active FROM tracker_connections WHERE provider=$1",
      [id],
    );
    return {
      configuredConnections: counts.configured,
      activeConnections: counts.active,
      storage: { feedbacks: counts.configured, environment: 0 },
    };
  },
}));
const adapters: readonly IntegrationAdapter[] = [githubIntegration, ...trackerAdapters];
export async function integrationCatalog(context: IntegrationContext) {
  return {
    providers: await Promise.all(
      adapters.map(async (adapter) => ({
        ...adapter.descriptor,
        ...(await adapter.summarize(context)),
      })),
    ),
  };
}
