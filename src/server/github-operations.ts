import type { Actor } from "../shared/contracts.js";
import type { Database } from "./db.js";
import type { Config } from "./config.js";
import { GithubApp } from "./github-app.js";
import type { AssetStore } from "./assets.js";
import { fail } from "./errors.js";
import {
  githubManagementOperations,
  githubManagementOperation,
  managedGithubConfig,
} from "./github-managed-apps.js";
import {
  connectionOperationNames,
  githubConnectionOperation,
} from "./github/connection-operations.js";
import { issueOperationNames, githubIssueOperation } from "./github/issue-operations.js";
import {
  githubStatusSyncOperation,
  githubStatusSyncState,
} from "./github/status-sync-operation.js";

export async function githubOperation(
  db: Database,
  actor: Actor,
  name: string,
  i: any,
  config: Config,
  client: GithubApp,
  store?: AssetStore,
) {
  if (githubManagementOperations.has(name))
    return githubManagementOperation(db, actor, name, i, config, client, store);
  config = await managedGithubConfig(db, config, store);
  client = client.withConfig(config);
  if (connectionOperationNames.has(name))
    return githubConnectionOperation(db, actor, name, i, config, client);
  if (issueOperationNames.has(name))
    return githubIssueOperation(db, actor, name, i, config, client, store);
  if (name === "github.statusSyncState")
    return githubStatusSyncState(db, actor, i, config);
  if (name === "github.statusSync")
    return githubStatusSyncOperation(db, actor, i, config, client);
  fail("NOT_FOUND", "Unknown GitHub operation", 404);
}
