import type { Config } from "./config.js";
import type { AssetStore } from "./assets.js";
import { fail } from "./errors.js";
import {
  credentialScope,
  sealCredential,
  openCredential,
  type EncryptedCredential,
} from "./integrations/credential-vault.js";
export const githubKeyPrefix = (config: Config) =>
  credentialScope(config, "github", "prefix").objectPrefix;
export type GithubKeyEnvelope = EncryptedCredential;
export async function sealGithubKey(
  store: AssetStore,
  identity: string,
  pem: string,
  prefix: string,
) {
  try {
    return await sealCredential(
      store,
      { provider: "github", identity, objectPrefix: prefix },
      pem,
    );
  } catch {
    fail(
      "GITHUB_STORAGE_UNAVAILABLE",
      "Private storage is unavailable. Try connecting the App again later.",
      503,
    );
  }
}
export async function openGithubKey(
  store: AssetStore | undefined,
  identity: string,
  objectKey: string,
  envelope: GithubKeyEnvelope,
  prefix: string,
) {
  try {
    return await openCredential(
      store,
      { provider: "github", identity, objectPrefix: prefix },
      objectKey,
      envelope,
    );
  } catch {
    fail(
      "GITHUB_STORAGE_UNAVAILABLE",
      "This App's private credentials could not be opened. Restore private storage or update its key.",
      503,
    );
  }
}
