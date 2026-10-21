import { randomUUID } from "node:crypto";
import type { Database } from "../db.js";
import type { Config } from "../config.js";
import type { AssetStore } from "../assets.js";
import type { Actor } from "../../shared/contracts.js";
import { access, ownerOnly, event } from "../access.js";
import { Auth, accountLock, hash } from "../auth.js";
import { checkRevision, threadRow } from "../feedback.js";
import { fail } from "../errors.js";
import { credentialScope, sealCredential, openCredential } from "./credential-vault.js";
import { TrackerError, type TrackerTransport } from "./trackers/providers.js";
export const timeTrackingMigrationSql = `CREATE TABLE time_connections(id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES projects(id),provider text NOT NULL,label text NOT NULL,destination jsonb NOT NULL,enabled boolean NOT NULL DEFAULT true,revision integer NOT NULL DEFAULT 1,health text NOT NULL DEFAULT 'unchecked',error_code text,credential_key text NOT NULL,credential jsonb NOT NULL,created_by uuid NOT NULL REFERENCES users(id));
CREATE INDEX time_connections_project ON time_connections(project_id);
CREATE TABLE external_time_entries(id uuid PRIMARY KEY,connection_id uuid NOT NULL REFERENCES time_connections(id),connection_revision integer NOT NULL,thread_id uuid NOT NULL REFERENCES threads(id),minutes integer NOT NULL CHECK(minutes>0 AND minutes<=1440),spent_date text NOT NULL,payload jsonb NOT NULL,actor jsonb NOT NULL,idempotency_key text NOT NULL,input_hash text NOT NULL,status text NOT NULL DEFAULT 'pending',remote_id text,error_code text,attempts integer NOT NULL DEFAULT 0,next_at timestamptz NOT NULL DEFAULT now(),lease_until timestamptz,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(connection_id,idempotency_key));CREATE INDEX external_time_entries_due ON external_time_entries(next_at) WHERE status='pending';`;
const connectionSummary = (r: any) => ({
  id: r.id,
  projectId: r.project_id,
  provider: r.provider,
  label: r.label,
  destination: r.destination,
  enabled: r.enabled,
  revision: r.revision,
  health: r.health,
  errorCode: r.error_code,
});
const entrySummary = (r: any) => ({
  historical: r.historical === true,
  id: r.id,
  connectionId: r.connection_id,
  threadId: r.thread_id,
  minutes: r.minutes,
  spentDate: r.spent_date,
  status: r.status,
  remoteId: r.remote_id,
  errorCode: r.error_code,
});
async function current(db: Database, actor: Actor) {
  const a = await new Auth(db).current(actor);
  if (actor.kind !== "human" || a.kind !== "human")
    fail("FORBIDDEN", "A signed-in project maintainer is required", 403);
  return a;
}
async function connection(db: Database, actor: Actor, id: string, enabled = true) {
  const c = await db.one("SELECT * FROM time_connections WHERE id=$1", [id]);
  if (!c) fail("NOT_FOUND", "Time tracking connection not found", 404);
  await access(db, actor, c.project_id, "maintain");
  if (enabled && !c.enabled)
    fail("TIME_CONNECTION_DISABLED", "Enable this connection before continuing", 409);
  return c;
}
export class TimeTrackingClient {
  constructor(
    private c: any,
    private token: string,
    private transport: TrackerTransport = (url, init) =>
      fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(15000) }),
  ) {
    if (
      c.provider === "harvest" &&
      [
        c.destination.accountId,
        c.destination.projectId,
        c.destination.taskId,
        c.destination.userId,
      ]
        .filter(Boolean)
        .some((v) => !/^\d+$/.test(v))
    )
      throw new TrackerError("TIME_DESTINATION_INVALID");
    if (c.provider === "timedoctor" && !c.destination.userId)
      throw new TrackerError("TIME_USER_REQUIRED");
  }
  private async request(path: string, body?: unknown) {
    const harvest = this.c.provider === "harvest";
    const headers: Record<string, string> = harvest
      ? {
          authorization: `Bearer ${this.token}`,
          "Harvest-Account-Id": this.c.destination.accountId,
          "User-Agent": "Feedbacks integration",
          "content-type": "application/json",
        }
      : { authorization: `JWT ${this.token}`, "content-type": "application/json" };
    let response: Response;
    try {
      response = await this.transport(
        (harvest
          ? "https://api.harvestapp.com/v2"
          : "https://api2.timedoctor.com/api/1.0") + path,
        {
          method: body ? "POST" : "GET",
          headers,
          ...(body ? { body: JSON.stringify(body) } : {}),
        },
      );
    } catch {
      throw new TrackerError("TIME_NETWORK", !!body);
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new TrackerError(
        response.status === 401 || response.status === 403
          ? "TIME_AUTH_REVOKED"
          : response.status === 429
            ? "TIME_RATE_LIMIT"
            : "TIME_REQUEST_REJECTED",
        !!body && response.status >= 500,
      );
    }
    const text = await response.text();
    if (text.length > 1_000_000) throw new TrackerError("TIME_RESPONSE_INVALID", !!body);
    try {
      return JSON.parse(text);
    } catch {
      throw new TrackerError("TIME_RESPONSE_INVALID", !!body);
    }
  }
  async test() {
    const d = this.c.destination;
    if (this.c.provider === "harvest") {
      const company = await this.request("/company");
      if (company.wants_timestamp_timers !== false)
        throw new TrackerError("HARVEST_DURATION_MODE_REQUIRED");
      const project = await this.request(`/projects/${encodeURIComponent(d.projectId)}`),
        tasks = await this.request(
          `/projects/${encodeURIComponent(d.projectId)}/task_assignments?is_active=true&per_page=100`,
        );
      if (
        !tasks.task_assignments?.some(
          (t: any) => String(t.task?.id) === d.taskId && t.is_active,
        )
      )
        throw new TrackerError("TIME_TASK_NOT_ASSIGNED");
      return String(project.name);
    }
    const task = (
      await this.request(
        `/tasks/${encodeURIComponent(d.taskId)}?company=${encodeURIComponent(d.accountId)}`,
      )
    ).data;
    if (String(task?.project?.id) !== d.projectId)
      throw new TrackerError("TIME_TASK_PROJECT_MISMATCH");
    return String(task.name);
  }
  async log(entry: any, permalink: string) {
    const d = this.c.destination;
    if (this.c.provider === "harvest") {
      const result = await this.request("/time_entries", {
        project_id: Number(d.projectId),
        task_id: Number(d.taskId),
        ...(d.userId ? { user_id: Number(d.userId) } : {}),
        spent_date: entry.spentDate,
        hours: entry.minutes / 60,
        notes: entry.note,
        external_reference: { id: entry.threadId, permalink },
      });
      if (
        !result.id ||
        result.is_running !== false ||
        String(result.project?.id) !== d.projectId ||
        String(result.task?.id) !== d.taskId
      )
        throw new TrackerError("TIME_READBACK_INVALID", true);
      return String(result.id);
    }
    const start = Date.parse(entry.startedAt),
      end = new Date(start + entry.minutes * 60000).toISOString();
    const result = (
      await this.request(
        `/activity/edit-time?company=${encodeURIComponent(d.accountId)}`,
        {
          userId: d.userId,
          projectId: d.projectId,
          taskId: d.taskId,
          start: new Date(start).toISOString(),
          end,
          operation: "add",
          reason: `${entry.note}\n${permalink}`,
          approved: false,
        },
      )
    ).data;
    if (!result?.id) throw new TrackerError("TIME_READBACK_INVALID", true);
    return String(result.id);
  }
}
async function client(
  store: AssetStore,
  config: Config,
  c: any,
  transport?: TrackerTransport,
) {
  return new TimeTrackingClient(
    c,
    await openCredential(
      store,
      credentialScope(config, "time-tracking", c.id),
      c.credential_key,
      c.credential,
    ),
    transport,
  );
}
export async function timeTrackingOperation(
  db: Database,
  store: AssetStore,
  config: Config,
  actor: Actor,
  name: string,
  input: any,
  transport?: TrackerTransport,
): Promise<any> {
  if (name === "timeTracking.test") {
    const c = await db.transaction(async (tx) => {
      await accountLock(tx);
      return connection(tx, await current(tx, actor), input.connectionId);
    });
    let targetName = "",
      errorCode: string | null = null;
    try {
      targetName = await (await client(store, config, c, transport)).test();
    } catch (error) {
      errorCode = (error as any)?.code ?? "TIME_UNAVAILABLE";
    }
    await db.transaction(async (tx) => {
      await accountLock(tx);
      await connection(tx, await current(tx, actor), c.id);
      const saved = await tx.one(
        "UPDATE time_connections SET health=$3,error_code=$4 WHERE id=$1 AND revision=$2 RETURNING id",
        [c.id, c.revision, errorCode ? "error" : "healthy", errorCode],
      );
      if (!saved) fail("CONFLICT", "Connection changed during verification", 409);
    });
    return { healthy: !errorCode, targetName, errorCode };
  }
  return db.transaction(async (tx) => {
    await accountLock(tx);
    const a = await current(tx, actor);
    if (name === "timeTracking.list") {
      await access(tx, a, input.projectId, "maintain");
      return {
        connections: (
          await tx.query(
            "SELECT * FROM time_connections WHERE project_id=$1 ORDER BY id LIMIT 30",
            [input.projectId],
          )
        ).map(connectionSummary),
      };
    }
    if (name === "timeTracking.history") {
      const thread = await threadRow(tx, a, input.threadId, "read");
      const entries = await tx.query(
        "SELECT e.*,c.project_id AS original_project_id FROM external_time_entries e JOIN time_connections c ON c.id=e.connection_id WHERE e.thread_id=$1 ORDER BY e.created_at DESC,e.id LIMIT 100",
        [thread.id],
      );
      const allowed = new Set<string>();
      for (const projectId of new Set<string>(
        entries.map((r) => r.original_project_id),
      )) {
        try {
          await access(tx, a, projectId, "maintain");
          allowed.add(projectId);
        } catch (error) {
          if (!["FORBIDDEN", "NOT_FOUND"].includes((error as any)?.code)) throw error;
        }
      }
      return {
        entries: entries
          .filter((r) => allowed.has(r.original_project_id))
          .map((r) =>
            entrySummary({
              ...r,
              historical: r.original_project_id !== thread.project_id,
            }),
          ),
      };
    }
    if (name === "timeTracking.save") {
      ownerOnly(a);
      await access(tx, a, input.projectId, "maintain");
      const previous = input.connectionId
        ? await connection(tx, a, input.connectionId, false)
        : null;
      if (
        previous &&
        (previous.provider !== input.provider || previous.project_id !== input.projectId)
      )
        fail("VALIDATION", "Time connections keep their original project and provider");
      if (previous && previous.revision !== input.revision)
        fail("CONFLICT", "Connection changed; reload before saving", 409);
      if (!previous && !input.token) fail("VALIDATION", "Provider API token is required");
      if (
        !previous &&
        (
          await tx.one(
            "SELECT count(*)::int n FROM time_connections WHERE project_id=$1",
            [input.projectId],
          )
        ).n >= 30
      )
        fail(
          "LIMIT_REACHED",
          "This project has reached its time tracking connection limit",
          429,
        );
      new TimeTrackingClient(input, input.token ?? "retained-token", transport);
      const id = previous?.id ?? randomUUID(),
        sealed = input.token
          ? await sealCredential(
              store,
              credentialScope(config, "time-tracking", id),
              input.token,
            )
          : { objectKey: previous.credential_key, envelope: previous.credential };
      const saved = await tx.one(
        "INSERT INTO time_connections(id,project_id,provider,label,destination,credential_key,credential,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET label=excluded.label,destination=excluded.destination,credential_key=excluded.credential_key,credential=excluded.credential,revision=time_connections.revision+1,enabled=true,health='unchecked',error_code=NULL RETURNING *",
        [
          id,
          input.projectId,
          input.provider,
          input.label,
          JSON.stringify(input.destination),
          sealed.objectKey,
          JSON.stringify(sealed.envelope),
          a.userId,
        ],
      );
      return connectionSummary(saved);
    }
    if (name === "timeTracking.reconcile") {
      const entry = await tx.one(
        "SELECT * FROM external_time_entries WHERE id=$1 FOR UPDATE",
        [input.entryId],
      );
      if (!entry) fail("NOT_FOUND", "Time entry not found", 404);
      await connection(tx, a, entry.connection_id, false);
      if (entry.status !== "uncertain")
        fail("CONFLICT", "This time entry does not need reconciliation", 409);
      if (input.delivered && !input.remoteId)
        fail(
          "VALIDATION",
          "Record the remote entry ID after verifying it in the provider",
        );
      return entrySummary(
        await tx.one(
          "UPDATE external_time_entries SET status=$2,remote_id=$3,error_code=NULL WHERE id=$1 RETURNING *",
          [entry.id, input.delivered ? "delivered" : "abandoned", input.remoteId ?? null],
        ),
      );
    }
    const c = await connection(tx, a, input.connectionId);
    if (name === "timeTracking.disable") {
      ownerOnly(a);
      if (c.revision !== input.revision)
        fail("CONFLICT", "Connection changed; reload before disabling", 409);
      await tx.query(
        "UPDATE external_time_entries SET status='cancelled',error_code='TIME_CONNECTION_DISABLED' WHERE connection_id=$1 AND status='pending'",
        [c.id],
      );
      return connectionSummary(
        await tx.one(
          "UPDATE time_connections SET enabled=false,revision=revision+1 WHERE id=$1 RETURNING *",
          [c.id],
        ),
      );
    }
    if (name !== "timeTracking.log")
      fail("NOT_FOUND", "Unknown time tracking operation", 404);
    if (c.health !== "healthy")
      fail("TIME_UNVERIFIED", "Test the connection before logging time", 409);
    const thread = await threadRow(tx, a, input.threadId, "maintain");
    if (thread.project_id !== c.project_id)
      fail("FORBIDDEN", "Feedback must belong to this connection's project", 403);
    const previous = await tx.one(
        "SELECT * FROM external_time_entries WHERE connection_id=$1 AND idempotency_key=$2",
        [c.id, input.idempotencyKey],
      ),
      inputHash = hash(JSON.stringify(input));
    if (previous) {
      if (previous.input_hash !== inputHash)
        fail(
          "IDEMPOTENCY_CONFLICT",
          "This retry key was used for another time entry",
          409,
        );
      return entrySummary(previous);
    }
    checkRevision(thread, input.revision);
    if (
      c.provider === "timedoctor" &&
      (!input.startedAt ||
        Date.parse(input.startedAt) + input.minutes * 60000 > Date.now() + 60000)
    )
      fail(
        "VALIDATION",
        "Time Doctor requires a reviewed start time whose interval ends in the past",
      );
    const entry = await tx.one(
      "INSERT INTO external_time_entries(id,connection_id,connection_revision,thread_id,minutes,spent_date,payload,actor,idempotency_key,input_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",
      [
        randomUUID(),
        c.id,
        c.revision,
        thread.id,
        input.minutes,
        input.spentDate,
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
    return entrySummary(entry);
  });
}
export async function processTimeEntries(
  db: Database,
  store: AssetStore,
  config: Config,
  transport?: TrackerTransport,
) {
  await db.query(
    "UPDATE external_time_entries SET status='uncertain',error_code='TIME_INTERRUPTED',lease_until=NULL WHERE status='processing' AND lease_until<now()",
  );
  for (let count = 0; count < 10; count++) {
    const entry = await db.transaction(async (tx) => {
      const row = await tx.one(
        "SELECT * FROM external_time_entries WHERE status='pending' AND next_at<=now() ORDER BY next_at,id LIMIT 1 FOR UPDATE SKIP LOCKED",
      );
      if (!row) return null;
      return tx.one(
        "UPDATE external_time_entries SET status='processing',attempts=attempts+1,lease_until=now()+interval '2 minutes' WHERE id=$1 RETURNING *",
        [row.id],
      );
    });
    if (!entry) return;
    let writing = false;
    try {
      const c = await db.transaction(async (tx) => {
        await accountLock(tx);
        const a = await current(tx, entry.actor),
          c = await connection(tx, a, entry.connection_id);
        if (c.revision !== entry.connection_revision || c.health !== "healthy")
          fail("TIME_CONNECTION_CHANGED", "Time connection changed", 409);
        const thread = await threadRow(tx, a, entry.thread_id, "maintain");
        if (thread.project_id !== c.project_id)
          fail("TIME_PROJECT_CHANGED", "Feedback moved to another project", 409);
        return c;
      });
      const provider = await client(store, config, c, transport);
      const preWrite = () =>
        db.transaction(async (tx) => {
          await accountLock(tx);
          const a = await current(tx, entry.actor),
            now = await connection(tx, a, entry.connection_id);
          if (now.revision !== entry.connection_revision || now.health !== "healthy")
            fail("TIME_CONNECTION_CHANGED", "Time connection changed", 409);
          const thread = await threadRow(tx, a, entry.thread_id, "maintain");
          if (thread.project_id !== now.project_id)
            fail("TIME_PROJECT_CHANGED", "Feedback moved", 409);
          if (
            !(await tx.one(
              "SELECT id FROM external_time_entries WHERE id=$1 AND status='processing' AND attempts=$2 AND lease_until>now()",
              [entry.id, entry.attempts],
            ))
          )
            fail("TIME_LEASE_EXPIRED", "Time entry attempt expired", 409);
        });
      await preWrite();
      await provider.test();
      await preWrite();
      writing = true;
      const remoteId = await provider.log(
        entry.payload,
        `${config.appOrigin}/threads/${entry.thread_id}`,
      );
      await db.query(
        "UPDATE external_time_entries SET status='delivered',remote_id=$2,error_code=NULL,lease_until=NULL WHERE id=$1 AND status='processing' AND attempts=$3",
        [entry.id, remoteId, entry.attempts],
      );
    } catch (error) {
      const code = (error as any)?.code ?? "TIME_UNAVAILABLE",
        known = [
          "TIME_AUTH_REVOKED",
          "TIME_RATE_LIMIT",
          "TIME_REQUEST_REJECTED",
        ].includes(code),
        uncertain =
          (error instanceof TrackerError && error.uncertain) || (writing && !known);
      const retry =
        !uncertain &&
        ["TIME_NETWORK", "TIME_RATE_LIMIT"].includes(code) &&
        entry.attempts < 5;
      await db.query(
        "UPDATE external_time_entries SET status=$2,error_code=$3,lease_until=NULL,next_at=now()+($4::integer*interval '1 second') WHERE id=$1 AND status='processing' AND attempts=$5",
        [
          entry.id,
          uncertain ? "uncertain" : retry ? "pending" : "failed",
          code,
          Math.min(3600, 30 * 2 ** entry.attempts),
          entry.attempts,
        ],
      );
      if (code === "TIME_AUTH_REVOKED")
        await db.query(
          "UPDATE time_connections SET health='error',error_code=$2 WHERE id=$1 AND revision=$3",
          [entry.connection_id, code, entry.connection_revision],
        );
    }
  }
}
