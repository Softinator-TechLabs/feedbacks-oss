import { createPrivateKey } from "node:crypto";
import { z } from "zod";
import type { Config } from "./config.js";
import { fail } from "./errors.js";

export type GithubAppConfig = {
  id: string;
  name: string;
  slug: string;
  privateKey: string;
  owners: string[];
  loadPrivateKey?: (owner?: string) => Promise<string>;
};

const appInput = z
  .object({
    id: z.string().regex(/^[1-9]\d{0,19}$/),
    name: z.string().trim().min(1).max(100),
    slug: z.string().regex(/^[a-z0-9-]{1,100}$/),
    privateKeyBase64: z.string().min(1).max(16000),
    owners: z
      .array(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/))
      .min(1)
      .max(20),
  })
  .strict();

export function parseGithubApps(value: string | undefined): GithubAppConfig[] {
  if (value === undefined || value === "") return [];
  try {
    if (value.length > 300000) throw new Error();
    const entries = z.array(appInput).max(20).parse(JSON.parse(value));
    const ids = new Set<string>(),
      slugs = new Set<string>();
    return entries.map((entry) => {
      if (ids.has(entry.id) || slugs.has(entry.slug)) throw new Error();
      ids.add(entry.id);
      slugs.add(entry.slug);
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(entry.privateKeyBase64)) throw new Error();
      const privateKey = Buffer.from(entry.privateKeyBase64, "base64").toString("utf8");
      if (createPrivateKey(privateKey).asymmetricKeyType !== "rsa") throw new Error();
      return {
        id: entry.id,
        name: entry.name,
        slug: entry.slug,
        privateKey,
        owners: [...new Set(entry.owners.map((owner) => owner.toLowerCase()))],
      };
    });
  } catch {
    // Do not include Zod/OpenSSL details or the supplied deployment secret.
    throw new Error(
      "GITHUB_APPS_JSON must contain up to 20 unique Apps with an ID, name, slug, base64 RSA private key and approved GitHub account names",
    );
  }
}

export function configuredGithubApps(config: Config): GithubAppConfig[] {
  const legacy =
    config.githubAppId && config.githubAppSlug && config.githubAppPrivateKey
      ? [
          {
            id: config.githubAppId,
            name: config.githubAppSlug,
            slug: config.githubAppSlug,
            privateKey: config.githubAppPrivateKey,
            owners: [],
          },
        ]
      : [];
  return [...legacy, ...(config.githubApps ?? [])];
}

export function projectGithubAppId(
  config: Config,
  project: { githubAppId?: string | null },
): string | null {
  return project.githubAppId === undefined
    ? (config.githubAppId ?? null)
    : project.githubAppId;
}

export function requireGithubApp(
  config: Config,
  appId: string | null | undefined,
): GithubAppConfig {
  const app = configuredGithubApps(config).find((app) => app.id === appId);
  if (!app)
    fail(
      "GITHUB_UNAVAILABLE",
      "This GitHub App is not configured. Ask the server owner to restore or select an App.",
      503,
    );
  return app;
}

export function assertGithubOwner(app: GithubAppConfig, owner: string) {
  if (app.owners.length && !app.owners.includes(owner.toLowerCase()))
    fail(
      "GITHUB_ACCOUNT_NOT_ALLOWED",
      "This repository's GitHub account is not approved for the selected App. Ask the server owner to review the App configuration.",
      403,
    );
}

export function historicalGithubAppId(
  config: Config,
  record: { githubAppId?: string | null },
): string | null {
  return record.githubAppId ?? config.githubAppId ?? null;
}

export function requireSyncAppId(
  config: Config,
  project: { githubAppId?: string | null },
  link: { githubAppId?: string | null },
): string {
  const appId = historicalGithubAppId(config, link);
  if (appId !== projectGithubAppId(config, project))
    fail(
      "GITHUB_APP_CHANGED",
      "This Issue belongs to a different GitHub App. Select its original App before syncing.",
      409,
    );
  return requireGithubApp(config, appId).id;
}
