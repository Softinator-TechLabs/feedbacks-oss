import type { Database } from "../db.js";
import type { Config } from "../config.js";
import type { AssetStore } from "../assets.js";
import type { IntegrationProvider } from "../../shared/contracts/domains/integrations.js";
export type IntegrationContext = { db: Database; config: Config; store: AssetStore };
export interface IntegrationAdapter {
  readonly descriptor: Pick<
    IntegrationProvider,
    "id" | "name" | "description" | "managePath" | "capabilities"
  >;
  summarize(
    context: IntegrationContext,
  ): Promise<
    Pick<IntegrationProvider, "configuredConnections" | "activeConnections" | "storage">
  >;
}
