import { randomUUID } from "node:crypto";
import type { Database } from "../../db.js";
import type { Config } from "../../config.js";
import type { AssetStore } from "../../assets.js";
import type { Actor } from "../../../shared/contracts.js";
import {
  trackerConfiguration,
  trackerCredential,
  trackerDiscoverySelection,
  type TrackerCredential,
} from "../../../shared/contracts/domains/trackers.js";
import { Auth, accountLock, hash } from "../../auth.js";
import { access, event, ownerOnly } from "../../access.js";
import { checkRevision, threadRow, retry, remember } from "../../feedback.js";
import { fail } from "../../errors.js";
import { credentialScope, sealCredential, openCredential } from "../credential-vault.js";
import { TrackerClient, TrackerError, type TrackerTransport } from "./providers.js";
import { discoverTracker } from "./discovery.js";

export const connectionSummary = (r: any) => ({
  id: r.id,
  projectId: r.project_id,
  provider: r.provider,
  label: r.label,
  configuration: r.configuration,
  revision: r.revision,
  enabled: r.enabled,
  health: r.health,
  errorCode: r.error_code,
  checkedAt: r.checked_at?.toISOString() ?? null,
  createdAt: r.created_at.toISOString(),
});
export const jobSummary = (r: any) => ({
  historical: r.historical === true,
  id: r.id,
  connectionId: r.connection_id,
  threadId: r.thread_id,
  kind: r.kind,
  status: r.status,
  attempts: r.attempts,
  errorCode: r.error_code,
  createdAt: r.created_at.toISOString(),
  remoteId: r.remote_id,
});
export const linkSummary = (r: any) => ({
  historical: r.historical === true,
  id: r.id,
  connectionId: r.connection_id,
  threadId: r.thread_id,
  remoteId: r.remote_id,
  url: r.url,
  title: r.title,
  remoteState: r.observed_remote_state ?? r.remote_state,
  localState: r.local_state,
  status: r.status,
  checkedAt: r.checked_at?.toISOString() ?? null,
});
export async function trackerHuman(db: Database, actor: Actor) {
  const current = await new Auth(db).current(actor);
  if (actor.kind !== "human" || current.kind !== "human")
    fail("FORBIDDEN", "A signed-in project maintainer is required", 403);
  return current;
}
export async function trackerConnection(
  db: Database,
  actor: Actor,
  id: string,
  enabled = true,
) {
  const row = await db.one("SELECT * FROM tracker_connections WHERE id=$1", [id]);
  if (!row) fail("NOT_FOUND", "Tracker connection not found", 404);
  await access(db, actor, row.project_id, "maintain");
  if (enabled && !row.enabled)
    fail("TRACKER_DISABLED", "Enable this connection before continuing", 409);
  return row;
}
export async function trackerClient(
  db: Database,
  store: AssetStore,
  config: Config,
  connection: any,
  transport?: TrackerTransport,
) {
  const credential = await trackerCredentialValue(db, store, config, connection);
  return new TrackerClient(
    connection.provider,
    trackerConfiguration.parse(connection.configuration),
    credential,
    transport,
    config.openProjectAllowedOrigins,
  );
}
async function trackerCredentialValue(
  db: Database,
  store: AssetStore,
  config: Config,
  connection: any,
) {
  const plaintext = await openCredential(
    store,
    credentialScope(config, connection.provider, connection.id),
    connection.credential_key,
    connection.credential,
  );
  let credential = trackerCredential.parse(JSON.parse(plaintext));
  if (credential.expiresAt && Date.parse(credential.expiresAt) < Date.now() + 60000)
    credential = await (
      await import("./oauth.js")
    ).refreshTrackerOAuth(db, store, config, connection);
  return credential;
}
function assertAccountContext(source: any, configuration: any) {
  if (!source) return;
  const field = (
    {
      openproject: "instanceOrigin",
      teamwork: "site",
      productive: "workspaceId",
      firmao: "workspaceId",
    } as Record<string, string>
  )[source.provider];
  if (field && source.configuration[field] !== configuration?.[field])
    fail(
      "TRACKER_ACCOUNT_CONTEXT_CHANGED",
      "This saved account belongs to another provider site or organization. Enter new credentials for that account.",
      400,
    );
}
export async function trackerOperation(
  db: Database,
  store: AssetStore,
  config: Config,
  actor: Actor,
  name: string,
  input: any,
  transport?: TrackerTransport,
): Promise<any> {
  if (name.startsWith("trackers.oauth"))
    return (await import("./oauth.js")).trackerOAuthOperation(
      db,
      store,
      config,
      actor,
      name,
      input,
    );
  const ownerSnapshot = (sourceId?: string, sourceRevision?: number) =>
    db.transaction(async (tx) => {
      await accountLock(tx);
      const a = await trackerHuman(tx, actor);
      ownerOnly(a);
      await access(tx, a, input.projectId, "maintain");
      const source = sourceId ? await trackerConnection(tx, a, sourceId) : undefined;
      if (
        source &&
        (source.provider !== input.provider || source.revision !== sourceRevision)
      )
        fail("CONFLICT", "Saved account changed; choose it again", 409);
      assertAccountContext(
        source,
        name === "trackers.discover" ? input.selection : input.configuration,
      );
      return { a, source };
    });
  const savedRetry = async (tx: Database, a: Actor) => {
    if (!input.idempotencyKey || input.connectionId) return null;
    const prior = await retry(tx, a, "trackers.save", input);
    if (!prior) return null;
    const row = await trackerConnection(tx, a, prior);
    if (row.project_id !== input.projectId || row.provider !== input.provider)
      fail("CONFLICT", "Saved connection belongs to another destination", 409);
    return connectionSummary(row);
  };
  if (name === "trackers.save" && input.idempotencyKey && !input.connectionId) {
    const prior = await db.transaction(async (tx) => {
      await accountLock(tx);
      const a = await trackerHuman(tx, actor);
      ownerOnly(a);
      await access(tx, a, input.projectId, "maintain");
      return savedRetry(tx, a);
    });
    if (prior) return prior;
  }
  if (name === "trackers.accounts") {
    return db.transaction(async (tx) => {
      await accountLock(tx);
      const a = await trackerHuman(tx, actor);
      ownerOnly(a);
      await access(tx, a, input.projectId, "maintain");
      // A rotating Jira refresh token must have one canonical owner; copying it would invalidate siblings.
      if (input.provider === "jira") return { accounts: [] };
      const accounts = await tx.query(
        "SELECT c.id,c.revision,c.label,c.configuration,p.data->>'name' AS project_name FROM tracker_connections c JOIN projects p ON p.id=c.project_id WHERE c.enabled=true AND c.provider=$1 ORDER BY c.created_at DESC,c.id LIMIT 100",
        [input.provider],
      );
      return {
        accounts: accounts.map((row) => ({
          connectionId: row.id,
          revision: row.revision,
          label: row.label,
          projectName: row.project_name ?? "Project",
          selection: trackerDiscoverySelection.parse({
            site: row.configuration.site,
            cloudId: row.configuration.cloudId,
            instanceOrigin: row.configuration.instanceOrigin,
            ...(["productive", "firmao"].includes(input.provider)
              ? { workspaceId: row.configuration.workspaceId }
              : {}),
          }),
        })),
      };
    });
  }
  if (name === "trackers.discover") {
    if (
      !!input.credential === !!input.sourceConnectionId ||
      !!input.sourceConnectionId !== !!input.sourceRevision
    )
      fail("VALIDATION", "Choose one account credential source");
    const snapshot = await ownerSnapshot(input.sourceConnectionId, input.sourceRevision);
    const credential =
      input.credential ??
      (await trackerCredentialValue(db, store, config, snapshot.source));
    await ownerSnapshot(input.sourceConnectionId, input.sourceRevision);
    let result;
    try {
      result = await discoverTracker(
        input.provider,
        input.selection,
        credential,
        input.cursor,
        transport,
        config.openProjectAllowedOrigins,
      );
    } catch (error) {
      // Provider failures contain only stable codes, never response bodies or credentials.
      if (error instanceof TrackerError)
        fail(
          error.code,
          "Could not read this provider account. Check access and try again.",
          400,
        );
      throw error;
    }
    await ownerSnapshot(input.sourceConnectionId, input.sourceRevision);
    return result;
  }
  let verifiedSource: any;
  let destinationVerified = false;
  if (name === "trackers.save" && input.reuseConnectionId && input.provider === "jira") {
    await ownerSnapshot(input.reuseConnectionId, input.reuseRevision);
    fail("JIRA_OAUTH_REQUIRED", "Authorize Jira separately for this project.", 400);
  }
  if (name === "trackers.save" && (input.verifyDestination || input.reuseConnectionId)) {
    const snapshot = await ownerSnapshot(input.reuseConnectionId, input.reuseRevision);
    verifiedSource = snapshot.source;
    let credential = input.credential;
    if (!credential) {
      const existing =
        verifiedSource ??
        (await db.transaction(async (tx) => {
          await accountLock(tx);
          const a = await trackerHuman(tx, actor);
          ownerOnly(a);
          const row = await trackerConnection(tx, a, input.connectionId, false);
          if (
            row.project_id !== input.projectId ||
            row.provider !== input.provider ||
            row.revision !== input.revision
          )
            fail("CONFLICT", "Connection changed; reload before saving", 409);
          assertAccountContext(row, input.configuration);
          return row;
        }));
      credential = await trackerCredentialValue(db, store, config, existing);
    }
    await ownerSnapshot(input.reuseConnectionId, input.reuseRevision);
    try {
      const target = await new TrackerClient(
        input.provider,
        input.configuration,
        credential,
        transport,
        config.openProjectAllowedOrigins,
      ).target();
      if (
        !target.name ||
        input.configuration.states.some(
          (mapping: any) => !target.states.some((state) => state.id === mapping.remote),
        )
      )
        throw new TrackerError("TRACKER_MAPPING_INVALID");
    } catch (error) {
      if (error instanceof TrackerError)
        fail(error.code, "Check the account and destination, then try again.", 400);
      throw error;
    }
    await ownerSnapshot(input.reuseConnectionId, input.reuseRevision);
    destinationVerified = true;
  }
  if (name === "trackers.comments") {
    const check = () =>
      db.transaction(async (tx) => {
        await accountLock(tx);
        const a = await trackerHuman(tx, actor),
          c = await trackerConnection(tx, a, input.connectionId),
          t = await threadRow(tx, a, input.threadId, "maintain");
        if (
          t.project_id !== c.project_id ||
          !(await tx.one(
            "SELECT id FROM tracker_links WHERE connection_id=$1 AND thread_id=$2 AND remote_id=$3",
            [c.id, t.id, input.remoteId],
          ))
        )
          fail("NOT_FOUND", "Verified tracker link not found", 404);
        if (c.provider === "firmao")
          fail(
            "FEATURE_UNAVAILABLE",
            "Firmao task comments are not available through the documented API",
            409,
          );
        return c;
      });
    const c = await check(),
      client = await trackerClient(db, store, config, c, transport);
    if ((await check()).revision !== c.revision)
      fail("CONFLICT", "Tracker connection changed", 409);
    await client.read(input.remoteId);
    const comments = await client.comments(input.remoteId);
    if ((await check()).revision !== c.revision)
      fail("CONFLICT", "Tracker connection changed", 409);
    return comments;
  }
  if (name === "trackers.refresh") {
    const check = () =>
      db.transaction(async (tx) => {
        await accountLock(tx);
        const a = await trackerHuman(tx, actor),
          c = await trackerConnection(tx, a, input.connectionId),
          t = await threadRow(tx, a, input.threadId, "maintain"),
          link = await tx.one(
            "SELECT * FROM tracker_links WHERE id=$1 AND connection_id=$2 AND thread_id=$3",
            [input.linkId, c.id, t.id],
          );
        if (t.project_id !== c.project_id || !link)
          fail("NOT_FOUND", "Verified tracker link not found", 404);
        return { a, c, t, link };
      });
    const snapshot = await check(),
      client = await trackerClient(db, store, config, snapshot.c, transport);
    if ((await check()).c.revision !== snapshot.c.revision)
      fail("CONFLICT", "Tracker connection changed", 409);
    const remote = await client.read(snapshot.link.remote_id);
    return db.transaction(async (tx) => {
      await accountLock(tx);
      const a = await trackerHuman(tx, actor),
        c = await trackerConnection(tx, a, input.connectionId),
        t = await threadRow(tx, a, input.threadId, "maintain");
      if (c.revision !== snapshot.c.revision || t.project_id !== c.project_id)
        fail("CONFLICT", "Tracker connection or project changed", 409);
      const mapping = c.configuration.states.find(
        (s: any) => s.local === t.data.work.state,
      );
      const link = await tx.one(
        "UPDATE tracker_links SET observed_remote_state=$2,title=$3,url=$4,status=$5,checked_at=now() WHERE id=$1 AND connection_id=$6 AND thread_id=$7 RETURNING *",
        [
          input.linkId,
          remote.state,
          remote.title,
          remote.url,
          mapping?.remote === remote.state ? "synced" : "local_changed",
          c.id,
          t.id,
        ],
      );
      if (!link) fail("NOT_FOUND", "Tracker link no longer exists", 404);
      return linkSummary(link);
    });
  }
  if (name === "trackers.test") {
    const connection = await db.transaction(async (tx) => {
      await accountLock(tx);
      return trackerConnection(tx, await trackerHuman(tx, actor), input.connectionId);
    });
    let result: { name: string; states: { id: string; name: string }[] } = {
        name: "",
        states: [],
      },
      errorCode: string | null = null;
    try {
      const client = await trackerClient(db, store, config, connection, transport);
      await db.transaction(async (tx) => {
        await accountLock(tx);
        const current = await trackerConnection(
          tx,
          await trackerHuman(tx, actor),
          connection.id,
        );
        if (current.revision !== connection.revision)
          fail("CONFLICT", "Tracker connection changed", 409);
      });
      result = await client.target();
      if (
        connection.configuration.states.some(
          (s: any) => !result.states.some((v) => v.id === s.remote),
        )
      )
        throw new TrackerError("TRACKER_MAPPING_INVALID");
    } catch (error) {
      errorCode = error instanceof TrackerError ? error.code : "TRACKER_UNAVAILABLE";
    }
    await db.transaction(async (tx) => {
      await accountLock(tx);
      await trackerConnection(tx, await trackerHuman(tx, actor), connection.id);
      const updated = await tx.one(
        "UPDATE tracker_connections SET health=$3,error_code=$4,checked_at=now() WHERE id=$1 AND revision=$2 RETURNING id",
        [connection.id, connection.revision, errorCode ? "error" : "healthy", errorCode],
      );
      if (!updated) fail("CONFLICT", "Connection changed during verification", 409);
    });
    return {
      healthy: !errorCode,
      targetName: result.name,
      states: result.states,
      errorCode,
    };
  }
  return db.transaction(async (tx) => {
    await accountLock(tx);
    const a = await trackerHuman(tx, actor);
    if (name === "trackers.list") {
      await access(tx, a, input.projectId, "maintain");
      const connections = await tx.query(
        "SELECT * FROM tracker_connections WHERE project_id=$1 ORDER BY created_at DESC,id LIMIT 100",
        [input.projectId],
      );
      const jobs = await tx.query(
        "SELECT j.* FROM tracker_jobs j JOIN tracker_connections c ON c.id=j.connection_id WHERE c.project_id=$1 ORDER BY j.created_at DESC,j.id DESC LIMIT 100",
        [input.projectId],
      );
      return {
        connections: connections.map(connectionSummary),
        jobs: jobs.map(jobSummary),
      };
    }
    if (name === "trackers.links") {
      const thread = await threadRow(tx, a, input.threadId, "read");
      const links = await tx.query(
        "SELECT l.*,c.project_id AS original_project_id FROM tracker_links l JOIN tracker_connections c ON c.id=l.connection_id WHERE l.thread_id=$1 ORDER BY l.id LIMIT 100",
        [thread.id],
      );
      const jobs = await tx.query(
        "SELECT j.*,c.project_id AS original_project_id FROM tracker_jobs j JOIN tracker_connections c ON c.id=j.connection_id WHERE j.thread_id=$1 ORDER BY j.created_at DESC,j.id DESC LIMIT 50",
        [thread.id],
      );
      const allowed = new Set<string>();
      for (const projectId of new Set<string>(
        [...links, ...jobs].map((r) => r.original_project_id),
      )) {
        try {
          await access(tx, a, projectId, "maintain");
          allowed.add(projectId);
        } catch (error) {
          if (!["FORBIDDEN", "NOT_FOUND"].includes((error as any)?.code)) throw error;
        }
      }
      return {
        links: links
          .filter((r) => allowed.has(r.original_project_id))
          .map((r) =>
            linkSummary({
              ...r,
              historical: r.original_project_id !== thread.project_id,
            }),
          ),
        jobs: jobs
          .filter((r) => allowed.has(r.original_project_id))
          .map((r) =>
            jobSummary({ ...r, historical: r.original_project_id !== thread.project_id }),
          ),
      };
    }
    if (name === "trackers.save") {
      ownerOnly(a);
      await access(tx, a, input.projectId, "maintain");
      const prior = await savedRetry(tx, a);
      if (prior) return prior;
      const existing = input.connectionId
        ? await trackerConnection(tx, a, input.connectionId, false)
        : null;
      if (existing && !input.credential && !input.reuseConnectionId)
        assertAccountContext(existing, input.configuration);
      if (
        existing &&
        (existing.project_id !== input.projectId || existing.provider !== input.provider)
      )
        fail("VALIDATION", "A connection keeps its original project and provider");
      if (existing && existing.revision !== input.revision)
        fail("CONFLICT", "Connection changed; reload before saving", 409);
      const reuse = input.reuseConnectionId
        ? await trackerConnection(tx, a, input.reuseConnectionId)
        : null;
      assertAccountContext(reuse, input.configuration);
      if (
        reuse &&
        (reuse.provider !== input.provider ||
          reuse.revision !== input.reuseRevision ||
          reuse.revision !== verifiedSource?.revision)
      )
        fail("CONFLICT", "Saved account changed; choose it again", 409);
      if (!existing && !input.credential && !reuse)
        fail("VALIDATION", "A provider credential is required");
      if (
        !existing &&
        (
          await tx.one(
            "SELECT count(*)::int n FROM tracker_connections WHERE project_id=$1",
            [input.projectId],
          )
        ).n >= 30
      )
        fail(
          "LIMIT_REACHED",
          "This project has reached its tracker connection limit",
          429,
        );
      const id = existing?.id ?? randomUUID();
      const credential: TrackerCredential =
        input.credential ??
        trackerCredential.parse(
          JSON.parse(
            await openCredential(
              store,
              credentialScope(config, input.provider, reuse?.id ?? id),
              (reuse ?? existing).credential_key,
              (reuse ?? existing).credential,
            ),
          ),
        );
      // Constructor validates provider-specific authentication and metadata without contacting a remote service.
      try {
        new TrackerClient(
          input.provider,
          input.configuration,
          credential,
          transport,
          config.openProjectAllowedOrigins,
        );
      } catch (error) {
        if (
          error instanceof TrackerError &&
          [
            "TRACKER_AUTH_INVALID",
            "OPENPROJECT_API_TOKEN_REQUIRED",
            "OPENPROJECT_ORIGIN_NOT_ALLOWED",
            "OPENPROJECT_NUMERIC_ID_REQUIRED",
            "FIRMAO_API_LOGIN_REQUIRED",
            "FIRMAO_ORGANIZATION_REQUIRED",
            "FIRMAO_NUMERIC_ID_REQUIRED",
            "JIRA_OAUTH_REQUIRED",
            "TRACKER_SITE_REQUIRED",
            "TRACKER_WORKSPACE_REQUIRED",
            "TRACKER_API_KEY_AND_BOARD_REQUIRED",
            "TRACKER_DESCRIPTION_COLUMN_REQUIRED",
            "TRACKER_SITE_INVALID",
          ].includes(error.code)
        )
          fail(
            error.code,
            error.code === "OPENPROJECT_ORIGIN_NOT_ALLOWED"
              ? "Ask the server operator to add this HTTPS instance origin to OPENPROJECT_ALLOWED_ORIGINS and recreate the application container, then save again."
              : "Check the provider credentials and destination settings, then save again.",
            400,
          );
        throw error;
      }
      const sealed =
        input.credential || reuse
          ? await sealCredential(
              store,
              credentialScope(config, input.provider, id),
              JSON.stringify(credential),
            )
          : { objectKey: existing.credential_key, envelope: existing.credential };
      const row = await tx.one(
        `INSERT INTO tracker_connections(id,project_id,provider,label,configuration,credential_key,credential,created_by,health,checked_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,CASE WHEN $9='healthy' THEN now() ELSE NULL END)
       ON CONFLICT(id) DO UPDATE SET label=excluded.label,configuration=excluded.configuration,credential_key=excluded.credential_key,credential=excluded.credential,revision=tracker_connections.revision+1,health=excluded.health,error_code=NULL,checked_at=excluded.checked_at RETURNING *`,
        [
          id,
          input.projectId,
          input.provider,
          input.label,
          JSON.stringify(input.configuration),
          sealed.objectKey,
          JSON.stringify(sealed.envelope),
          a.userId,
          destinationVerified ? "healthy" : "unchecked",
        ],
      );
      await event(tx, a, input.projectId, id, "tracker.configured", {
        provider: input.provider,
      });
      if (!existing) await remember(tx, a, "trackers.save", input, id);
      return connectionSummary(row);
    }
    if (name === "trackers.enable") {
      ownerOnly(a);
      const connection = await trackerConnection(tx, a, input.connectionId, false);
      if (connection.revision !== input.revision)
        fail("CONFLICT", "Connection changed; reload before continuing", 409);
      const row = await tx.one(
        "UPDATE tracker_connections SET enabled=$2,revision=revision+1,health='unchecked',checked_at=NULL WHERE id=$1 RETURNING *",
        [connection.id, input.enabled],
      );
      if (!input.enabled)
        await tx.query(
          "UPDATE tracker_jobs SET status='cancelled',error_code='TRACKER_DISABLED' WHERE connection_id=$1 AND status='pending'",
          [connection.id],
        );
      await event(
        tx,
        a,
        connection.project_id,
        connection.id,
        input.enabled ? "tracker.enabled" : "tracker.disabled",
        {},
      );
      return connectionSummary(row);
    }
    if (name === "trackers.reconcile") {
      const job = await tx.one("SELECT * FROM tracker_jobs WHERE id=$1 FOR UPDATE", [
        input.jobId,
      ]);
      if (!job) fail("NOT_FOUND", "Tracker action not found", 404);
      await trackerConnection(tx, a, job.connection_id, false);
      if (job.status !== "uncertain")
        fail("CONFLICT", "Only uncertain actions need reconciliation", 409);
      if (input.outcome === "linked") {
        if (job.kind !== "create" || !input.remoteId)
          fail("VALIDATION", "A remote ID is required to reconcile task creation");
        const payload = { ...job.payload, remoteId: input.remoteId };
        await tx.query(
          "UPDATE tracker_jobs SET kind='link',payload=$2,status='pending',next_at=now(),lease_until=NULL,error_code=NULL WHERE id=$1",
          [job.id, JSON.stringify(payload)],
        );
      } else {
        if (job.kind === "create" && input.outcome === "confirmed_delivered")
          fail("VALIDATION", "Link the created remote task to record delivery");
        await tx.query(
          "UPDATE tracker_jobs SET status=$2,error_code=NULL,lease_until=NULL WHERE id=$1",
          [job.id, input.outcome === "confirmed_delivered" ? "delivered" : "abandoned"],
        );
      }
      await event(
        tx,
        a,
        (await trackerConnection(tx, a, job.connection_id, false)).project_id,
        job.thread_id,
        "tracker.reconciled",
        { jobId: job.id, outcome: input.outcome },
      );
      return jobSummary(await tx.one("SELECT * FROM tracker_jobs WHERE id=$1", [job.id]));
    }
    const connection = await trackerConnection(tx, a, input.connectionId);
    if (connection.health !== "healthy")
      fail(
        "TRACKER_UNVERIFIED",
        "Test this connection and its status mappings before using it",
        409,
      );
    const thread = await threadRow(tx, a, input.threadId, "maintain");
    if (thread.project_id !== connection.project_id)
      fail("FORBIDDEN", "The feedback and tracker must belong to the same project", 403);
    if (connection.provider === "firmao" && name === "trackers.comment")
      fail(
        "FEATURE_UNAVAILABLE",
        "Firmao task comments are not available through the documented API",
        409,
      );
    const kind = name.slice("trackers.".length);
    const inputHash = hash(JSON.stringify({ name, input }));
    const previous = await tx.one(
      "SELECT * FROM tracker_jobs WHERE connection_id=$1 AND idempotency_key=$2",
      [connection.id, input.idempotencyKey],
    );
    if (previous) {
      if (previous.input_hash !== inputHash)
        fail(
          "IDEMPOTENCY_CONFLICT",
          "This retry key was used for another tracker action",
          409,
        );
      return jobSummary(previous);
    }
    checkRevision(thread, input.revision);
    if (!["create", "link", "comment", "sync"].includes(kind))
      fail("NOT_FOUND", "Unknown tracker action", 404);
    if (
      kind === "create" &&
      (await tx.one(
        "SELECT id FROM tracker_jobs WHERE connection_id=$1 AND thread_id=$2 AND kind='create' AND status NOT IN ('failed','cancelled','abandoned') LIMIT 1",
        [connection.id, thread.id],
      ))
    )
      fail(
        "TRACKER_CREATION_EXISTS",
        "A task was already created or creation needs reconciliation. Link the existing task instead.",
        409,
      );
    if (kind === "comment" || kind === "sync") {
      const link = await tx.one(
        "SELECT * FROM tracker_links WHERE id=$1 AND connection_id=$2 AND thread_id=$3",
        [input.linkId, connection.id, thread.id],
      );
      if (!link) fail("NOT_FOUND", "Tracker link not found", 404);
      if (kind === "sync" && input.source === "provider")
        await access(tx, a, thread.project_id, "resolve");
    }
    const queued = await tx.one(
      "INSERT INTO tracker_jobs(id,connection_id,connection_revision,thread_id,kind,payload,actor,idempotency_key,input_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
      [
        randomUUID(),
        connection.id,
        connection.revision,
        thread.id,
        kind,
        JSON.stringify(input),
        JSON.stringify({
          id: a.userId,
          userId: a.userId,
          kind: "human",
          owner: false,
          name: a.name,
        }),
        input.idempotencyKey,
        inputHash,
      ],
    );
    return jobSummary(queued);
  });
}
