import { createPrivateKey } from "node:crypto";
import type { Config } from "./config.js";
import type { Database } from "./db.js";
import type { AssetStore } from "./assets.js";
import type { Actor } from "../shared/contracts.js";
import { accountLock, hash, secret } from "./auth.js";
import { ownerOnly, event } from "./access.js";
import { human } from "./github/operation-common.js";
import {
  configuredGithubApps,
  requireGithubApp,
  assertGithubOwner,
  type GithubAppConfig,
} from "./github-app-config.js";
import { GithubApp } from "./github-app.js";
import { sealGithubKey, openGithubKey, githubKeyPrefix } from "./github-app-vault.js";
import { DomainError, fail } from "./errors.js";

export const githubManagementOperations = new Set([
  "github.apps",
  "github.appSetupStart",
  "github.appSetupComplete",
  "github.appImport",
  "github.appAdopt",
  "github.appUpdate",
  "github.appEnable",
]);
const appIdentity = (config: Config, id: string) => config.organizationId + ":" + id;

export async function githubRegistrationRequest(
  db: Database,
  actor: Actor,
  state: string,
  config: Config,
) {
  return db.transaction(async (tx) => {
    await accountLock(tx);
    const a = await human(tx, actor);
    ownerOnly(a);
    const request = await tx.one(
      "SELECT * FROM github_app_setups WHERE state_hash=$1 AND session_hash=$2 AND user_id=$3 AND used_at IS NULL AND expires_at>now()",
      [hash(state), a.sessionHash ?? "", a.userId],
    );
    if (!request)
      fail(
        "GITHUB_SETUP_EXPIRED",
        "This setup expired. Start again from GitHub Apps.",
        409,
      );
    return manifestRequest(config, request.account, request.account_type, state);
  });
}

function manifestRequest(
  config: Config,
  account: string,
  accountType: string,
  state: string,
) {
  return {
    actionUrl:
      (accountType === "organization"
        ? "https://github.com/organizations/" +
          encodeURIComponent(account) +
          "/settings/apps/new"
        : "https://github.com/settings/apps/new") +
      "?state=" +
      encodeURIComponent(state),
    manifest: JSON.stringify({
      name: "Feedbacks " + account.slice(0, 15) + " " + state.slice(0, 5),
      url: config.appOrigin,
      redirect_url: config.appOrigin + "/api/github-app/setup-callback",
      setup_url: config.appOrigin + "/github-apps",
      public: false,
      hook_attributes: {
        url: config.appOrigin + "/api/github-app/events",
        active: false,
      },
      default_events: [],
      default_permissions: { metadata: "read", issues: "write" },
      request_oauth_on_install: false,
      setup_on_update: true,
    }),
  };
}
export async function managedGithubConfig(
  db: Database,
  config: Config,
  store?: AssetStore,
): Promise<Config> {
  const rows = await db.query(
    "SELECT * FROM github_managed_apps ORDER BY app_id LIMIT 22",
  );
  const overridden = new Set(rows.map((row) => row.app_id));
  const liveKey = (app: GithubAppConfig) => async (owner?: string) => {
    const current = await db.one("SELECT * FROM github_managed_apps WHERE app_id=$1", [
      app.id,
    ]);
    if (!current) return app.loadPrivateKey ? app.loadPrivateKey(owner) : app.privateKey;
    if (!current.enabled)
      fail(
        "GITHUB_UNAVAILABLE",
        "This App was disconnected. Reload its connection.",
        503,
      );
    if (owner) assertGithubOwner({ ...app, owners: current.approved_accounts }, owner);
    return openGithubKey(
      store,
      appIdentity(config, app.id),
      current.key_object,
      current.envelope,
      githubKeyPrefix(config),
    );
  };
  const entries: GithubAppConfig[] = [
    ...configuredGithubApps(config).filter((app) => !overridden.has(app.id)),
    ...rows
      .filter((row) => row.enabled)
      .map((row) => ({
        id: row.app_id,
        name: row.name,
        slug: row.slug,
        owners: row.approved_accounts,
        privateKey: "",
      })),
  ];
  const effective = {
    ...config,
    githubAppSlug: undefined,
    githubAppPrivateKey: undefined,
    githubApps: entries.map((app) => ({
      ...app,
      privateKey: "",
      loadPrivateKey: liveKey(app),
    })),
  };
  if (configuredGithubApps(effective).length > 21)
    fail("GITHUB_UNAVAILABLE", "Too many GitHub Apps are configured.", 503);
  return effective;
}
// Call under accountLock before reserving a write/lease or committing a connection.
export async function currentGithubApp(
  db: Database,
  config: Config,
  appId: string | null | undefined,
  owner?: string,
) {
  const app = requireGithubApp(config, appId);
  const row = await db.one(
    "SELECT enabled,approved_accounts FROM github_managed_apps WHERE app_id=$1",
    [app.id],
  );
  if (row && !row.enabled)
    fail("GITHUB_UNAVAILABLE", "This App was disconnected. Reload its connection.", 503);
  const current = row ? { ...app, owners: row.approved_accounts } : app;
  if (owner) assertGithubOwner(current, owner);
  return current;
}
function metadata(row: any) {
  return {
    id: row.app_id,
    name: row.name,
    slug: row.slug,
    owners: row.approved_accounts,
    account: row.account,
    source: "feedbacks",
    enabled: row.enabled,
    revision: row.revision,
    accountType: row.account_type,
  };
}
function registration(
  data: any,
  pem: string,
  expected?: { account: string; accountType: string },
) {
  try {
    if (
      typeof pem !== "string" ||
      pem.length > 16000 ||
      createPrivateKey(pem).asymmetricKeyType !== "rsa"
    )
      throw new Error();
    const id = String(data.id),
      account = String(data.owner?.login ?? "").toLowerCase();
    if (
      !Number.isSafeInteger(data.id) ||
      data.id <= 0 ||
      !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(account) ||
      typeof data.name !== "string" ||
      !data.name.trim() ||
      data.name.length > 100 ||
      !/^[a-z0-9-]{1,100}$/.test(data.slug)
    )
      throw new Error();
    const accountType =
      data.owner.type === "Organization"
        ? "organization"
        : data.owner.type === "User"
          ? "personal"
          : null;
    if (
      !accountType ||
      data.permissions?.issues !== "write" ||
      data.permissions?.metadata !== "read" ||
      Object.entries(data.permissions).some(
        ([permission, level]) =>
          !["issues", "metadata"].includes(permission) && level !== "none",
      ) ||
      (data.events?.length ?? 0) > 0 ||
      (expected && data.public === true) ||
      (expected &&
        (account !== expected.account.toLowerCase() ||
          accountType !== expected.accountType))
    )
      throw new Error();
    return { id, name: data.name.trim(), slug: data.slug, account, accountType, pem };
  } catch {
    fail(
      "GITHUB_APP_INVALID",
      "Use the intended account's App with Metadata read and Issues read/write permissions and a valid RSA key.",
    );
  }
}
async function pending(db: Database, config: Config, appId: string) {
  const row = await db.one(
    `SELECT 1 FROM github_issue_requests WHERE status='pending'
    AND (github_app_id=$1 OR (github_app_id IS NULL AND $1=$2))
    UNION ALL SELECT 1 FROM github_status_sync s JOIN threads t ON t.id=s.thread_id JOIN projects p ON p.id=t.project_id
    WHERE (s.status='uncertain' OR s.lease_until>clock_timestamp()) AND
      (CASE WHEN p.data ? 'githubAppId' THEN p.data->>'githubAppId' ELSE $2 END)=$1 LIMIT 1`,
    [appId, config.githubAppId ?? null],
  );
  if (row)
    fail(
      "GITHUB_PENDING",
      "Finish pending GitHub writes or wait for active status sync before changing this App.",
      409,
    );
}
export async function githubManagementOperation(
  db: Database,
  actor: Actor,
  name: string,
  i: any,
  config: Config,
  client: GithubApp,
  store?: AssetStore,
) {
  const ownerTx = <T>(work: (tx: Database, a: Actor) => Promise<T>) =>
    db.transaction(async (tx) => {
      await accountLock(tx);
      const a = await human(tx, actor);
      ownerOnly(a);
      return work(tx, a);
    });
  await ownerTx(async () => {});
  if (name === "github.apps")
    return ownerTx(async (tx) => {
      const rows = await tx.query(
        "SELECT * FROM github_managed_apps ORDER BY name,app_id",
      );
      const ids = new Set(rows.map((row) => row.app_id));
      return {
        defaultAppId: config.githubAppId ?? null,
        apps: [
          ...configuredGithubApps(config)
            .filter((app) => !ids.has(app.id))
            .map(({ id, name, slug, owners }) => ({
              id,
              name,
              slug,
              owners,
              source: "server",
              enabled: true,
            })),
          ...rows.map(metadata),
        ],
      };
    });
  if (name === "github.appSetupStart")
    return ownerTx(async (tx, a) => {
      if (!a.sessionHash)
        fail(
          "FORBIDDEN",
          "Use a signed-in browser session to connect a GitHub account.",
          403,
        );
      if (!store)
        fail(
          "GITHUB_STORAGE_UNAVAILABLE",
          "Private storage is unavailable. Use deployment environment setup or restore storage.",
          503,
        );
      const retained = await tx.query("SELECT app_id FROM github_managed_apps");
      if (
        new Set([
          ...configuredGithubApps(config).map((app) => app.id),
          ...retained.map((row) => row.app_id),
        ]).size >= 21
      )
        fail(
          "GITHUB_APP_INVALID",
          "This server has reached its 21-App limit. Manage an existing App instead.",
        );
      await tx.query("DELETE FROM github_app_setups WHERE expires_at<=now()");
      const count = await tx.one(
        "SELECT count(*)::int AS count FROM github_app_setups WHERE user_id=$1",
        [a.userId],
      );
      if (count.count >= 10)
        fail(
          "RATE_LIMITED",
          "Too many GitHub setup attempts. Wait 30 minutes before starting again.",
          429,
        );
      const state = secret();
      await tx.query(
        "INSERT INTO github_app_setups(state_hash,session_hash,user_id,account,account_type,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '30 minutes')",
        [hash(state), a.sessionHash, a.userId, i.account.toLowerCase(), i.accountType],
      );
      return manifestRequest(config, i.account.toLowerCase(), i.accountType, state);
    });
  if (name === "github.appUpdate" || name === "github.appEnable")
    return ownerTx(async (tx, a) => {
      const row = await tx.one(
        "SELECT * FROM github_managed_apps WHERE app_id=$1 FOR UPDATE",
        [i.appId],
      );
      if (!row)
        fail(
          "GITHUB_APP_INVALID",
          "Adopt this server-configured App before managing it here.",
        );
      if (row.revision !== i.revision)
        fail("CONFLICT", "This App changed. Reload first.", 409);
      if (name === "github.appEnable") await pending(tx, config, i.appId);
      const changed = await tx.one(
        name === "github.appUpdate"
          ? "UPDATE github_managed_apps SET name=$2,revision=revision+1,updated_by=$3,updated_at=now() WHERE app_id=$1 RETURNING *"
          : "UPDATE github_managed_apps SET enabled=$2,revision=revision+1,updated_by=$3,updated_at=now() WHERE app_id=$1 RETURNING *",
        [i.appId, name === "github.appUpdate" ? i.name : i.enabled, a.userId],
      );
      await event(tx, a, null, a.userId, name, {
        appId: i.appId,
        revision: changed.revision,
      });
      return metadata(changed);
    });
  let app: ReturnType<typeof registration>;
  let expectedRevision: number | null = null;
  let approvedAccounts: string[];
  if (name === "github.appSetupComplete") {
    const request = await ownerTx(async (tx, a) => {
      const row = await tx.one(
        "UPDATE github_app_setups SET used_at=now() WHERE state_hash=$1 AND session_hash=$2 AND user_id=$3 AND used_at IS NULL AND expires_at>now() RETURNING *",
        [hash(i.state), a.sessionHash ?? "", a.userId],
      );
      if (!row)
        fail(
          "GITHUB_SETUP_EXPIRED",
          "This setup expired or was already used. Start again, or connect the existing App.",
          409,
        );
      return row;
    });
    let response: any;
    try {
      response = await client.convertManifest(i.code);
    } catch {
      fail(
        "GITHUB_SETUP_FAILED",
        "GitHub setup could not be completed. If the App was created, connect the existing App with a new key.",
        503,
      );
    }
    app = registration(response, response.pem, {
      account: request.account,
      accountType: request.account_type,
    });
  } else {
    let pem: string,
      appId: string = i.appId;
    if (name === "github.appAdopt") {
      const env = configuredGithubApps(config).find(
        (candidate) => candidate.id === appId,
      );
      if (!env) fail("GITHUB_APP_INVALID", "This server-configured App is unavailable.");
      pem = env.privateKey;
    } else {
      pem = i.privateKey;
      expectedRevision = i.revision;
    }
    try {
      if (pem.length > 16000 || createPrivateKey(pem).asymmetricKeyType !== "rsa")
        throw new Error();
      const candidate: GithubAppConfig = {
        id: appId,
        name: "Connecting App",
        slug: "connecting",
        owners: [],
        privateKey: pem,
      };
      const temporary = {
        ...config,
        githubAppId: undefined,
        githubAppSlug: undefined,
        githubAppPrivateKey: undefined,
        githubApps: [candidate],
      };
      const response = await client
        .withConfig(temporary)
        .forApp(appId)
        .inspectRegistration();
      if (String(response.id) !== appId) throw new Error();
      app = registration(response, pem);
    } catch (error) {
      if (error instanceof DomainError && error.code === "GITHUB_APP_INVALID")
        throw error;
      fail(
        "GITHUB_APP_INVALID",
        "GitHub could not verify this App ID and RSA key. Check its account and permissions.",
      );
    }
  }
  if (!store) fail("GITHUB_STORAGE_UNAVAILABLE", "Private storage is unavailable.", 503);
  // Validate before creating a private key object, and repeat after external storage.
  const validate = async (tx: Database) => {
    const existing = await tx.one(
      "SELECT * FROM github_managed_apps WHERE app_id=$1 FOR UPDATE",
      [app.id],
    );
    if ((existing?.revision ?? null) !== expectedRevision)
      fail(
        "CONFLICT",
        "This App already exists or changed. Reload its details first.",
        409,
      );
    if (
      existing &&
      (existing.account !== app.account || existing.account_type !== app.accountType)
    )
      fail(
        "GITHUB_APP_INVALID",
        "The App's GitHub account changed. Connect a separate App for the new account.",
      );
    const rows = await tx.query("SELECT app_id,slug FROM github_managed_apps");
    const all = [
      ...configuredGithubApps(config).map((candidate) => ({
        app_id: candidate.id,
        slug: candidate.slug,
      })),
      ...rows,
    ];
    const ids = new Set(all.map((row) => row.app_id));
    ids.add(app.id);
    if (
      ids.size > 21 ||
      all.some((row) => row.slug === app.slug && row.app_id !== app.id)
    )
      fail(
        "GITHUB_APP_INVALID",
        "App IDs and slugs must be unique; this server supports up to 21 Apps.",
      );
    approvedAccounts = existing?.approved_accounts ??
      configuredGithubApps(config).find((candidate) => candidate.id === app.id)
        ?.owners ?? [app.account];
  };
  await ownerTx(async (tx) => validate(tx));
  const sealed = await sealGithubKey(
    store,
    appIdentity(config, app.id),
    app.pem,
    githubKeyPrefix(config),
  );
  try {
    return await ownerTx(async (tx, a) => {
      await validate(tx);
      const row = await tx.one(
        `INSERT INTO github_managed_apps(app_id,name,slug,account,account_type,approved_accounts,envelope,key_object,updated_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(app_id) DO UPDATE SET
        name=github_managed_apps.name,slug=EXCLUDED.slug,account=EXCLUDED.account,account_type=EXCLUDED.account_type,approved_accounts=EXCLUDED.approved_accounts,
        envelope=EXCLUDED.envelope,key_object=EXCLUDED.key_object,enabled=github_managed_apps.enabled,revision=github_managed_apps.revision+1,
        updated_by=EXCLUDED.updated_by,updated_at=now() RETURNING *`,
        [
          app.id,
          app.name,
          app.slug,
          app.account,
          app.accountType,
          JSON.stringify(approvedAccounts),
          JSON.stringify(sealed.envelope),
          sealed.objectKey,
          a.userId,
        ],
      );
      await event(tx, a, null, a.userId, name, {
        appId: app.id,
        account: app.account,
        revision: row.revision,
      });
      return metadata(row);
    });
  } catch (error) {
    // Keep the key when an unknown commit outcome may already reference it.
    if (error instanceof DomainError)
      await store.remove(sealed.objectKey).catch(() => {});
    throw error;
  }
}
