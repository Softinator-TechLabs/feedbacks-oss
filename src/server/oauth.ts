import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Database } from "./db.js";
import type { Config } from "./config.js";
import { Auth, accountLock, hash, secret } from "./auth.js";
import { access, event } from "./access.js";
import {
  operationRegistry,
  selfAgentTokenScopes,
  type Actor,
} from "../shared/contracts.js";

export const oauthScopes = ["feedbacks:read", "feedbacks:reply", "offline_access"];
const readScopes = selfAgentTokenScopes.filter(
  (name) => operationRegistry[name]?.readOnly,
);
const accessSeconds = 3600;
const grantDays = 90;
const refreshDays = 30;
export class OAuthError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
function reject(code: string, message: string, status = 400): never {
  throw new OAuthError(code, message, status);
}
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) reject("invalid_request", "Invalid OAuth request fields");
  return parsed.data;
}
function redirectUri(value: string) {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.hash ||
    !(
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname))
    )
  )
    reject(
      "invalid_redirect_uri",
      "Use HTTPS or a loopback HTTP callback without credentials or fragments",
    );
  return value;
}
const authorization = z.object({
  client_id: z.string().min(1).max(100),
  redirect_uri: z.url().max(2048),
  response_type: z.literal("code"),
  code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  code_challenge_method: z.literal("S256"),
  resource: z.url().max(2048),
  state: z.string().max(2048).optional(),
  scope: z.string().max(256).default("feedbacks:read"),
});
type Parameters = z.infer<typeof authorization>;
function callback(
  parameters: Parameters,
  values: Record<string, string>,
  issuer: string,
) {
  const url = new URL(parameters.redirect_uri);
  url.searchParams.set("iss", issuer);
  for (const [key, value] of Object.entries(values)) url.searchParams.set(key, value);
  if (parameters.state !== undefined) url.searchParams.set("state", parameters.state);
  return url.href;
}
function scopes(value: string) {
  const result = [...new Set(value.split(" ").filter(Boolean))];
  if (
    !result.includes("feedbacks:read") ||
    result.some((scope) => !oauthScopes.includes(scope))
  )
    reject(
      "invalid_scope",
      "Request feedbacks:read and optional feedbacks:reply or offline_access",
    );
  return result;
}
const expiry = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString();

/** OAuth delegates existing operation scopes; it never replaces operation authorization. */
export class McpOAuth {
  constructor(
    private db: Database,
    private config: Config,
  ) {}
  get resource() {
    return `${this.config.appOrigin}/mcp`;
  }
  enabled() {
    if (!this.config.mcpOAuthEnabled)
      reject("temporarily_unavailable", "OAuth is disabled on this installation", 503);
  }
  metadata() {
    const base = this.config.appOrigin;
    return {
      issuer: base,
      authorization_endpoint: `${base}/oauth/authorize`,
      token_endpoint: `${base}/oauth/token`,
      registration_endpoint: `${base}/oauth/register`,
      revocation_endpoint: `${base}/oauth/revoke`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      token_endpoint_auth_methods_supported: ["none"],
      code_challenge_methods_supported: ["S256"],
      authorization_response_iss_parameter_supported: true,
      scopes_supported: oauthScopes,
    };
  }
  protectedMetadata() {
    return {
      resource: this.resource,
      authorization_servers: [this.config.appOrigin],
      scopes_supported: oauthScopes,
      bearer_methods_supported: ["header"],
      resource_name: "Feedbacks MCP",
    };
  }
  async register(input: unknown) {
    this.enabled();
    const i = parse(
      z.object({
        client_name: z
          .string()
          .trim()
          .min(1)
          .max(100)
          .regex(/^[^\u0000-\u001f\u007f]+$/)
          .default("Coding assistant"),
        redirect_uris: z.array(z.url().max(2048)).min(1).max(10),
        token_endpoint_auth_method: z.literal("none").default("none"),
        grant_types: z
          .array(z.enum(["authorization_code", "refresh_token"]))
          .min(1)
          .max(2)
          .default(["authorization_code", "refresh_token"]),
        response_types: z.array(z.literal("code")).length(1).default(["code"]),
      }),
      input,
    );
    const uris = [...new Set(i.redirect_uris.map(redirectUri))];
    if (!i.grant_types.includes("authorization_code"))
      reject("invalid_client_metadata", "Authorization code grant is required");
    const id = randomUUID();
    await this.db.transaction(async (tx) => {
      await accountLock(tx);
      await this.prune(tx);
      const count = await tx.one(
        "SELECT count(*)::integer AS count, count(*) FILTER (WHERE approved=false)::integer AS pending FROM oauth_clients",
      );
      if (count.pending >= 1000 || count.count >= 10000)
        reject("temporarily_unavailable", "Client registration capacity reached", 503);
      await tx.query(
        "INSERT INTO oauth_clients(id,name,redirect_uris) VALUES($1,$2,$3)",
        [id, i.client_name, JSON.stringify(uris)],
      );
    });
    return {
      client_id: id,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: i.client_name,
      redirect_uris: uris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    };
  }
  async authorize(input: unknown) {
    this.enabled();
    const i = parse(authorization, input);
    scopes(i.scope);
    if (i.resource !== this.resource)
      reject("invalid_target", "Use this installation's canonical MCP resource");
    const request = secret();
    await this.db.transaction(async (tx) => {
      await accountLock(tx);
      await this.prune(tx);
      const client = await tx.one("SELECT * FROM oauth_clients WHERE id=$1", [
        i.client_id,
      ]);
      if (!client) reject("invalid_client", "Register this client first");
      if (!client.redirect_uris.includes(i.redirect_uri))
        reject(
          "invalid_request",
          "Callback must exactly match a registered redirect URI",
        );
      const count = await tx.one(
        "SELECT count(*)::integer AS count FROM oauth_requests WHERE consumed_at IS NULL AND expires_at>now()",
      );
      if (count.count >= 1000)
        reject("temporarily_unavailable", "Authorization capacity reached", 503);
      await tx.query(
        "INSERT INTO oauth_requests(hash,client_id,parameters,expires_at) VALUES($1,$2,$3,$4)",
        [hash(request), i.client_id, JSON.stringify(i), expiry(600)],
      );
    });
    return `${this.config.appOrigin}/connect-agent?request=${request}`;
  }
  private async pending(tx: Database, request: string) {
    const row = await tx.one(
      `SELECT r.*,c.name AS client_name FROM oauth_requests r
      JOIN oauth_clients c ON c.id=r.client_id WHERE r.hash=$1 AND r.expires_at>now() AND r.code_hash IS NULL`,
      [hash(request)],
    );
    if (!row)
      reject("invalid_request", "Connection request expired or was already answered");
    return row;
  }
  private async human(tx: Database, actor: Actor) {
    const current = await new Auth(tx).current(actor);
    if (current.kind !== "human" || !current.sessionHash || current.mustChangePassword)
      reject(
        "access_denied",
        "Use your signed-in account after replacing any temporary password",
        403,
      );
    return current;
  }
  async inspect(actor: Actor, request: string) {
    this.enabled();
    await this.human(this.db, actor);
    const row = await this.pending(this.db, request);
    return {
      clientName: row.client_name,
      redirectUri: row.parameters.redirect_uri,
      resource: this.resource,
      requestedScopes: scopes(row.parameters.scope),
      expiresAt: row.expires_at,
    };
  }
  async consent(actor: Actor, input: unknown) {
    this.enabled();
    const i = parse(
      z
        .object({
          request: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
          approve: z.boolean(),
          projectIds: z.array(z.uuid()).max(100).default([]),
          reply: z.boolean().default(false),
        })
        .strict(),
      input,
    );
    return this.db.transaction(async (tx) => {
      await accountLock(tx);
      const human = await this.human(tx, actor),
        row = await this.pending(tx, i.request);
      if (!i.approve) {
        await tx.query("DELETE FROM oauth_requests WHERE hash=$1", [row.hash]);
        return {
          redirect: callback(
            row.parameters,
            {
              error: "access_denied",
              error_description: "The user declined this connection",
            },
            this.config.appOrigin,
          ),
        };
      }
      const requested = scopes(row.parameters.scope);
      if (!i.projectIds.length || new Set(i.projectIds).size !== i.projectIds.length)
        reject("invalid_request", "Choose at least one project without duplicates");
      if (i.reply && !requested.includes("feedbacks:reply"))
        reject("invalid_scope", "This client did not request reply access");
      for (const projectId of i.projectIds)
        await access(tx, human, projectId, i.reply ? "write" : "read");
      const code = secret();
      const approvedScopes = requested.filter(
        (scope) => scope !== "feedbacks:reply" || i.reply,
      );
      await tx.query(
        `UPDATE oauth_requests SET user_id=$2,project_ids=$3,scopes=$4,code_hash=$5,code_expires_at=$6 WHERE hash=$1`,
        [
          row.hash,
          human.userId,
          JSON.stringify(i.projectIds),
          JSON.stringify(approvedScopes),
          hash(code),
          expiry(300),
        ],
      );
      await tx.query("UPDATE oauth_clients SET approved=true WHERE id=$1", [
        row.client_id,
      ]);
      return { redirect: callback(row.parameters, { code }, this.config.appOrigin) };
    });
  }
  async token(input: unknown) {
    this.enabled();
    const i = parse(
      z.object({
        grant_type: z.enum(["authorization_code", "refresh_token"]),
        client_id: z.string().min(1).max(100),
        resource: z.string().max(2048),
        code: z.string().max(128).optional(),
        redirect_uri: z.string().max(2048).optional(),
        code_verifier: z
          .string()
          .regex(/^[A-Za-z0-9._~-]{43,128}$/)
          .optional(),
        refresh_token: z.string().max(128).optional(),
        scope: z.string().max(256).optional(),
      }),
      input,
    );
    if (i.resource !== this.resource)
      reject("invalid_target", "Use this installation's canonical MCP resource");
    const result = await this.db.transaction(async (tx) => {
      await accountLock(tx);
      if (i.grant_type === "authorization_code") {
        if (!i.code || !i.redirect_uri || !i.code_verifier)
          reject("invalid_request", "Code, redirect URI and PKCE verifier are required");
        const row = await tx.one("SELECT * FROM oauth_requests WHERE code_hash=$1", [
          hash(i.code),
        ]);
        const challenge = Buffer.from(hash(i.code_verifier), "hex").toString("base64url");
        if (
          !row ||
          row.client_id !== i.client_id ||
          row.parameters.redirect_uri !== i.redirect_uri ||
          row.parameters.resource !== i.resource ||
          row.parameters.code_challenge !== challenge
        )
          reject("invalid_grant", "Invalid authorization code or PKCE proof");
        if (row.consumed_at) {
          if (row.token_id) await this.revokeGrant(tx, row.token_id);
          return undefined;
        }
        if (new Date(row.code_expires_at).getTime() <= Date.now())
          reject("invalid_grant", "Authorization code expired");
        const user = await tx.one(
          "SELECT * FROM users WHERE id=$1 AND active=true AND must_change_password=false",
          [row.user_id],
        );
        if (!user) reject("invalid_grant", "Account is unavailable");
        const actor: Actor = {
          id: user.id,
          userId: user.id,
          name: user.name,
          kind: "human",
          owner: user.owner,
        };
        if (i.scope !== undefined && i.scope !== row.scopes.join(" "))
          reject("invalid_scope", "Use the permissions approved by the user");
        for (const projectId of row.project_ids)
          await access(
            tx,
            actor,
            projectId,
            row.scopes.includes("feedbacks:reply") ? "write" : "read",
          );
        const issued = await new Auth(tx).issueToken(tx, actor, {
          name: `OAuth: ${(await tx.one("SELECT name FROM oauth_clients WHERE id=$1", [row.client_id])).name}`,
          projectIds: row.project_ids,
          scopes: [
            ...readScopes,
            ...(row.scopes.includes("feedbacks:reply") ? ["threads.reply"] : []),
          ],
          expiresInDays: accessSeconds / 86400,
          ownerAdmin: false,
          canResolve: false,
        });
        await tx.query("UPDATE tokens SET oauth_resource=$2 WHERE id=$1", [
          issued.id,
          this.resource,
        ]);
        await tx.query(
          "INSERT INTO oauth_grants(token_id,client_id,resource,scopes,expires_at) VALUES($1,$2,$3,$4,$5)",
          [
            issued.id,
            row.client_id,
            this.resource,
            JSON.stringify(row.scopes),
            expiry(grantDays * 86400),
          ],
        );
        await tx.query(
          "UPDATE oauth_requests SET consumed_at=now(),token_id=$2 WHERE hash=$1",
          [row.hash, issued.id],
        );
        await event(tx, actor, null, issued.id, "token.created", {
          kind: "oauth",
          projectIds: row.project_ids,
          scopes: row.scopes,
        });
        const refresh = row.scopes.includes("offline_access")
          ? await this.refreshSecret(tx, issued.id, expiry(grantDays * 86400))
          : undefined;
        return this.response(issued.token, row.scopes, refresh);
      }
      if (!i.refresh_token) reject("invalid_request", "Refresh token is required");
      const grant = await tx.one(
        `SELECT g.*,r.used_at,r.expires_at AS refresh_expires_at,
        t.revoked_at AS token_revoked,t.user_id,u.active,u.must_change_password FROM oauth_refresh_tokens r
        JOIN oauth_grants g ON g.token_id=r.token_id JOIN tokens t ON t.id=g.token_id JOIN users u ON u.id=t.user_id WHERE r.hash=$1`,
        [hash(i.refresh_token)],
      );
      if (!grant || grant.client_id !== i.client_id || grant.resource !== i.resource)
        reject("invalid_grant", "Invalid refresh token");
      if (grant.used_at) {
        await this.revokeGrant(tx, grant.token_id);
        return undefined;
      }
      if (
        grant.revoked_at ||
        grant.token_revoked ||
        !grant.active ||
        grant.must_change_password ||
        new Date(grant.expires_at).getTime() <= Date.now() ||
        new Date(grant.refresh_expires_at).getTime() <= Date.now()
      )
        reject("invalid_grant", "Connection expired or was revoked");
      if (i.scope !== undefined && i.scope !== grant.scopes.join(" "))
        reject("invalid_scope", "Reconnect to change permissions");
      const token = secret(),
        refresh = await this.refreshSecret(tx, grant.token_id, grant.expires_at);
      await tx.query("UPDATE oauth_refresh_tokens SET used_at=now() WHERE hash=$1", [
        hash(i.refresh_token),
      ]);
      await tx.query(
        "UPDATE tokens SET hash=$2,secret_suffix=$3,expires_at=$4 WHERE id=$1",
        [grant.token_id, hash(token), token.slice(-4), expiry(accessSeconds)],
      );
      return this.response(token, grant.scopes, refresh);
    });
    // Commit replay revocation before returning the protocol error.
    if (!result)
      reject("invalid_grant", "Credential already used; reconnect to authorize again");
    return result;
  }
  private response(token: string, approved: string[], refresh?: string) {
    return {
      access_token: token,
      token_type: "Bearer",
      expires_in: accessSeconds,
      scope: approved.join(" "),
      ...(refresh ? { refresh_token: refresh } : {}),
    };
  }
  private async refreshSecret(tx: Database, tokenId: string, grantExpiry: string | Date) {
    const refresh = secret();
    await tx.query(
      "INSERT INTO oauth_refresh_tokens(hash,token_id,expires_at) VALUES($1,$2,$3)",
      [
        hash(refresh),
        tokenId,
        new Date(
          Math.min(new Date(grantExpiry).getTime(), Date.now() + refreshDays * 86400000),
        ).toISOString(),
      ],
    );
    return refresh;
  }
  private async revokeGrant(tx: Database, tokenId: string) {
    await tx.query(
      "UPDATE oauth_grants SET revoked_at=COALESCE(revoked_at,now()) WHERE token_id=$1",
      [tokenId],
    );
    await tx.query(
      "UPDATE tokens SET revoked_at=COALESCE(revoked_at,now()) WHERE id=$1",
      [tokenId],
    );
  }
  async revoke(input: unknown) {
    this.enabled();
    const i = parse(
      z.object({ client_id: z.string().max(100), token: z.string().max(128) }),
      input,
    );
    await this.db.transaction(async (tx) => {
      await accountLock(tx);
      const grant = await tx.one(
        `SELECT g.token_id FROM oauth_grants g JOIN tokens t ON t.id=g.token_id
        WHERE g.client_id=$1 AND (t.hash=$2 OR EXISTS(SELECT 1 FROM oauth_refresh_tokens r WHERE r.token_id=g.token_id AND r.hash=$2))`,
        [i.client_id, hash(i.token)],
      );
      if (grant) await this.revokeGrant(tx, grant.token_id);
    });
  }
  private async prune(tx: Database) {
    // Retain consumed codes for one day and used refresh hashes until the whole
    // grant expires so replay can revoke descendants. Never delete active grants.
    await tx.query(
      "DELETE FROM oauth_requests WHERE (code_hash IS NULL AND expires_at<now()) OR expires_at<now()-interval '1 day'",
    );
    await tx.query(
      "DELETE FROM oauth_refresh_tokens r USING oauth_grants g WHERE r.token_id=g.token_id AND g.expires_at<now()",
    );
    await tx.query(`DELETE FROM oauth_clients c WHERE approved=false AND created_at<now()-interval '1 day'
      AND NOT EXISTS(SELECT 1 FROM oauth_requests r WHERE r.client_id=c.id)`);
  }
}
