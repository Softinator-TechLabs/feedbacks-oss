import { githubIntegration } from "./github.js";
import type { IntegrationAdapter, IntegrationContext } from "./types.js";
// Register only adapters whose server operations and owner UI are implemented.
const adapters: readonly IntegrationAdapter[] = [githubIntegration];
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
