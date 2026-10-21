import { randomUUID } from "node:crypto";
import type { Database } from "../../db.js";
import type { Config } from "../../config.js";
import type { AssetStore } from "../../assets.js";
import type { Actor } from "../../../shared/contracts.js";
import { trackerCredential } from "../../../shared/contracts/domains/trackers.js";
import { accountLock } from "../../auth.js";
import { access, ownerOnly, event } from "../../access.js";
import { fail } from "../../errors.js";
import { credentialScope, openCredential, sealCredential } from "../credential-vault.js";
import { trackerHuman, connectionSummary } from "./operations.js";

type BrokerConfig = Config & {
  trackerOAuth?: { brokerUrl: string; installationKey: string };
};
async function broker(config: BrokerConfig, path: string, body: unknown) {
  const settings = config.trackerOAuth;
  if (!settings)
    fail(
      "TRACKER_OAUTH_UNAVAILABLE",
      "The operator must configure the optional OAuth broker before connecting Jira Cloud",
      503,
    );
  const url = new URL(settings!.brokerUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.hash || url.search)
    fail("TRACKER_OAUTH_UNAVAILABLE", "The OAuth broker must use HTTPS", 503);
  let response: Response;
  try {
    response = await fetch(new URL(path, url), {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(20000),
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${settings!.installationKey}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    fail(
      "TRACKER_OAUTH_UNAVAILABLE",
      "The OAuth broker could not be reached. Retry the same connection flow.",
      503,
    );
  }
  if (!response!.ok) {
    await response!.body?.cancel();
    fail(
      "TRACKER_OAUTH_REJECTED",
      "The OAuth broker rejected this connection. Check its operator configuration or restart consent.",
      409,
    );
  }
  const text = await response!.text();
  if (text.length > 128000)
    fail("TRACKER_OAUTH_REJECTED", "The OAuth broker returned an invalid response", 502);
  try {
    return JSON.parse(text);
  } catch {
    fail("TRACKER_OAUTH_REJECTED", "The OAuth broker returned an invalid response", 502);
  }
}
export async function trackerOAuthOperation(
  db: Database,
  store: AssetStore,
  config: BrokerConfig,
  actor: Actor,
  name: string,
  input: any,
) {
  if (name === "trackers.oauthStart") {
    await db.transaction(async (tx) => {
      await accountLock(tx);
      const a = await trackerHuman(tx, actor);
      ownerOnly(a);
      await access(tx, a, input.projectId, "maintain");
      if (!a.sessionHash)
        fail("FORBIDDEN", "Use the signed-in web application for OAuth consent", 403);
      const count = await tx.one(
        "SELECT count(*)::int n FROM tracker_oauth_flows WHERE user_id=$1 AND expires_at>now() AND consumed_at IS NULL",
        [a.userId],
      );
      if (count.n >= 5)
        fail(
          "LIMIT_REACHED",
          "Finish an existing connection flow or wait for it to expire",
          429,
        );
    });
    const remote = await broker(config, "/v1/start", { provider: "jira" });
    const authorize = new URL(remote.authorizeUrl);
    if (
      authorize.origin !== "https://auth.atlassian.com" ||
      authorize.pathname !== "/authorize" ||
      typeof remote.flowId !== "string" ||
      typeof remote.pollToken !== "string"
    )
      fail(
        "TRACKER_OAUTH_REJECTED",
        "The OAuth broker returned an invalid consent flow",
        502,
      );
    const id = randomUUID(),
      expiresAt = new Date(Date.now() + 10 * 60000).toISOString();
    const sealed = await sealCredential(
      store,
      credentialScope(config, "tracker-oauth", id),
      JSON.stringify({ flowId: remote.flowId, pollToken: remote.pollToken }),
    );
    await db.transaction(async (tx) => {
      await accountLock(tx);
      const a = await trackerHuman(tx, actor);
      ownerOnly(a);
      await access(tx, a, input.projectId, "maintain");
      await tx.query(
        "INSERT INTO tracker_oauth_flows(id,user_id,session_hash,project_id,provider,payload,credential_key,credential,expires_at) VALUES($1,$2,$3,$4,'jira',$5,$6,$7,$8)",
        [
          id,
          a.userId,
          a.sessionHash,
          input.projectId,
          JSON.stringify(input),
          sealed.objectKey,
          JSON.stringify(sealed.envelope),
          expiresAt,
        ],
      );
    });
    return { flowId: id, authorizeUrl: authorize.toString(), expiresAt };
  }
  const flow = await db.transaction(async (tx) => {
    await accountLock(tx);
    const a = await trackerHuman(tx, actor);
    ownerOnly(a);
    const row = await tx.one(
      "SELECT * FROM tracker_oauth_flows WHERE id=$1 AND user_id=$2 AND session_hash=$3 AND expires_at>now() AND consumed_at IS NULL",
      [input.flowId, a.userId, a.sessionHash],
    );
    if (!row)
      fail(
        "TRACKER_OAUTH_EXPIRED",
        "This consent flow expired, was already used, or belongs to another sign-in. Start a new connection.",
        409,
      );
    await access(tx, a, row.project_id, "maintain");
    return row;
  });
  const secret = JSON.parse(
    await openCredential(
      store,
      credentialScope(config, "tracker-oauth", flow.id),
      flow.credential_key,
      flow.credential,
    ),
  );
  const remote = await broker(config, "/v1/poll", secret);
  if (remote.status === "pending") return { status: "pending" };
  const resources = Array.isArray(remote.resources)
    ? remote.resources
        .filter(
          (r: any) =>
            typeof r.id === "string" &&
            typeof r.name === "string" &&
            /^https:\/\/[a-z0-9-]+\.atlassian\.net\/?$/.test(r.url),
        )
        .map((r: any) => ({ id: r.id, name: r.name.slice(0, 200), url: r.url }))
    : [];
  if (!input.cloudId) return { status: "choose_site", resources };
  const resource = resources.find((r: any) => r.id === input.cloudId);
  if (!resource) fail("VALIDATION", "Choose a Jira site from the consented account");
  const credentials = trackerCredential.parse({
    token: remote.token.access_token,
    refreshToken: remote.token.refresh_token,
    auth: "oauth",
    expiresAt: new Date(Date.now() + remote.token.expires_in * 1000).toISOString(),
  });
  const id = randomUUID(),
    configuration = {
      ...flow.payload.configuration,
      cloudId: resource.id,
      site: new URL(resource.url).hostname.slice(0, -".atlassian.net".length),
    };
  const sealed = await sealCredential(
    store,
    credentialScope(config, "jira", id),
    JSON.stringify(credentials),
  );
  const connection = await db.transaction(async (tx) => {
    await accountLock(tx);
    const a = await trackerHuman(tx, actor);
    ownerOnly(a);
    await access(tx, a, flow.project_id, "maintain");
    const consumed = await tx.one(
      "UPDATE tracker_oauth_flows SET consumed_at=now() WHERE id=$1 AND consumed_at IS NULL AND expires_at>now() AND session_hash=$2 RETURNING id",
      [flow.id, a.sessionHash],
    );
    if (!consumed)
      fail(
        "TRACKER_OAUTH_EXPIRED",
        "This consent flow was already completed or expired",
        409,
      );
    if (
      (
        await tx.one(
          "SELECT count(*)::int n FROM tracker_connections WHERE project_id=$1",
          [flow.project_id],
        )
      ).n >= 30
    )
      fail("LIMIT_REACHED", "This project has reached its tracker connection limit", 429);
    const row = await tx.one(
      "INSERT INTO tracker_connections(id,project_id,provider,label,configuration,credential_key,credential,created_by) VALUES($1,$2,'jira',$3,$4,$5,$6,$7) RETURNING *",
      [
        id,
        flow.project_id,
        flow.payload.label,
        JSON.stringify(configuration),
        sealed.objectKey,
        JSON.stringify(sealed.envelope),
        a.userId,
      ],
    );
    await event(tx, a, flow.project_id, id, "tracker.configured", {
      provider: "jira",
      auth: "oauth",
    });
    return connectionSummary(row);
  });
  // Token delivery is recoverable until the local database commit; an acknowledgement only removes temporary broker data.
  await broker(config, "/v1/ack", secret).catch(() => {});
  return { status: "connected", connection };
}
export async function refreshTrackerOAuth(
  db: Database,
  store: AssetStore,
  config: BrokerConfig,
  connection: any,
) {
  return db.transaction(async (tx) => {
    await tx.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('feedbacks.tracker.refresh:' || $1::text,0))",
      [connection.id],
    );
    const current = await tx.one(
      "SELECT * FROM tracker_connections WHERE id=$1 AND enabled=true",
      [connection.id],
    );
    if (!current || current.revision !== connection.revision)
      fail("TRACKER_CONNECTION_CHANGED", "The tracker connection changed", 409);
    const credential = trackerCredential.parse(
      JSON.parse(
        await openCredential(
          store,
          credentialScope(config, current.provider, current.id),
          current.credential_key,
          current.credential,
        ),
      ),
    );
    if (!credential.expiresAt || Date.parse(credential.expiresAt) > Date.now() + 60000)
      return credential;
    if (current.provider !== "jira" || !credential.refreshToken)
      fail("TRACKER_OAUTH_EXPIRED", "Reconnect this tracker account", 409);
    const remote = await broker(config, "/v1/refresh", {
      provider: "jira",
      refreshToken: credential.refreshToken,
    });
    const fresh = trackerCredential.parse({
      token: remote.access_token,
      refreshToken: remote.refresh_token ?? credential.refreshToken,
      auth: "oauth",
      expiresAt: new Date(Date.now() + remote.expires_in * 1000).toISOString(),
    });
    const sealed = await sealCredential(
      store,
      credentialScope(config, current.provider, current.id),
      JSON.stringify(fresh),
    );
    await accountLock(tx);
    const saved = await tx.one(
      "UPDATE tracker_connections SET credential_key=$2,credential=$3 WHERE id=$1 AND enabled=true AND revision=$4 AND credential_key=$5 RETURNING id",
      [
        current.id,
        sealed.objectKey,
        JSON.stringify(sealed.envelope),
        current.revision,
        current.credential_key,
      ],
    );
    if (!saved)
      fail(
        "TRACKER_CONNECTION_CHANGED",
        "The tracker connection changed while refreshing. Use its current connection settings.",
        409,
      );
    return fresh;
  });
}
