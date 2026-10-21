import { randomUUID } from "node:crypto";
import type { Database } from "../../db.js";
import type { Config } from "../../config.js";
import type { AssetStore } from "../../assets.js";
import { accountLock } from "../../auth.js";
import { access } from "../../access.js";
import { checkRevision, saveThread, threadRow } from "../../feedback.js";
import { TrackerError, type TrackerTransport, type RemoteIssue } from "./providers.js";
import { trackerClient, trackerConnection, trackerHuman } from "./operations.js";

async function attach(db: Database, connection: any, thread: any, issue: RemoteIssue) {
  const mapped = connection.configuration.states.find(
    (s: any) => s.local === thread.data.work.state,
  )?.remote;
  await db.query(
    `INSERT INTO tracker_links(id,connection_id,thread_id,remote_id,url,title,remote_state,local_state,local_revision,status,checked_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now()) ON CONFLICT(connection_id,thread_id,remote_id) DO UPDATE SET url=excluded.url,title=excluded.title,remote_state=excluded.remote_state,observed_remote_state=NULL,local_state=excluded.local_state,local_revision=excluded.local_revision,status=excluded.status,checked_at=now()`,
    [
      randomUUID(),
      connection.id,
      thread.id,
      issue.id,
      issue.url,
      issue.title,
      issue.state,
      thread.data.work.state,
      thread.revision,
      mapped === issue.state ? "synced" : "linked",
    ],
  );
}
async function applyRemoteState(
  db: Database,
  actor: any,
  thread: any,
  link: any,
  connection: any,
  issue: RemoteIssue,
  expected?: string,
  automatic = false,
) {
  const state = connection.configuration.states.find(
    (s: any) => s.remote === issue.state,
  )?.local;
  if (!state) throw new TrackerError("TRACKER_STATE_UNMAPPED");
  if (expected !== undefined && issue.state !== expected)
    throw new TrackerError("TRACKER_REMOTE_CONFLICT");
  if (
    automatic &&
    thread.data.work.state !== link.local_state &&
    thread.data.work.state !== state
  )
    throw new TrackerError("TRACKER_BOTH_CHANGED");
  if (thread.data.work.state !== state) {
    await access(
      db,
      actor,
      thread.project_id,
      ["resolved", "declined", "closed"].includes(state) ? "resolve" : "write",
    );
    thread.data.work.state = state;
    thread.data.work.note = `Status received from ${connection.label}`;
    thread.data.work.duplicateOf = null;
    thread.data.work.history.push({
      state,
      note: thread.data.work.note,
      actor: { id: actor.id, kind: "human", name: actor.name },
      at: new Date().toISOString(),
      duplicateOf: null,
    });
    thread = await saveThread(db, actor, thread, "threads.status", {
      source: "tracker",
      connectionId: connection.id,
    });
  }
  await db.query(
    "UPDATE tracker_links SET remote_state=$2,observed_remote_state=NULL,local_state=$3,local_revision=$4,status='synced',checked_at=now(),next_poll_at=now()+interval '5 minutes' WHERE id=$1",
    [link.id, issue.state, thread.data.work.state, thread.revision],
  );
}

/** No blind retry after an external write may have succeeded. Operators reconcile uncertain actions. */
export async function processTrackerJobs(
  db: Database,
  store: AssetStore,
  config: Config,
  transport?: TrackerTransport,
) {
  await db.query(
    "UPDATE tracker_jobs SET status='uncertain',error_code='TRACKER_INTERRUPTED',lease_until=NULL WHERE status='processing' AND lease_until<now()",
  );
  for (let count = 0; count < 10; count++) {
    const job = await db.transaction(async (tx) => {
      const next = await tx.one(
        "SELECT * FROM tracker_jobs WHERE status='pending' AND next_at<=now() ORDER BY next_at,id LIMIT 1 FOR UPDATE SKIP LOCKED",
      );
      if (!next) return null;
      return tx.one(
        "UPDATE tracker_jobs SET status='processing',attempts=attempts+1,lease_until=now()+interval '3 minutes' WHERE id=$1 RETURNING *",
        [next.id],
      );
    });
    if (!job) break;
    let performedWrite = false,
      writeAccepted = false,
      remoteId: string | undefined;
    try {
      const snapshot = await db.transaction(async (tx) => {
        await accountLock(tx);
        const actor = await trackerHuman(tx, job.actor),
          connection = await trackerConnection(tx, actor, job.connection_id);
        if (
          connection.revision !== job.connection_revision ||
          connection.health !== "healthy"
        )
          throw new TrackerError("TRACKER_CONNECTION_CHANGED");
        const thread = await threadRow(tx, actor, job.thread_id, "maintain");
        if (thread.project_id !== connection.project_id)
          throw new TrackerError("TRACKER_PROJECT_CHANGED");
        checkRevision(thread, job.payload.revision);
        const link = job.payload.linkId
          ? await tx.one(
              "SELECT * FROM tracker_links WHERE id=$1 AND connection_id=$2 AND thread_id=$3",
              [job.payload.linkId, connection.id, thread.id],
            )
          : null;
        if (["comment", "sync"].includes(job.kind) && !link)
          throw new TrackerError("TRACKER_LINK_CHANGED");
        return { actor, connection, thread, link };
      });
      const client = await trackerClient(
        db,
        store,
        config,
        snapshot.connection,
        transport,
      );
      const preWrite = () =>
        db.transaction(async (tx) => {
          await accountLock(tx);
          const a = await trackerHuman(tx, job.actor),
            c = await trackerConnection(tx, a, job.connection_id);
          if (c.revision !== job.connection_revision || c.health !== "healthy")
            throw new TrackerError("TRACKER_CONNECTION_CHANGED");
          const thread = await threadRow(tx, a, job.thread_id, "maintain");
          if (thread.project_id !== c.project_id)
            throw new TrackerError("TRACKER_PROJECT_CHANGED");
          checkRevision(thread, job.payload.revision);
          if (
            !(await tx.one(
              "SELECT id FROM tracker_jobs WHERE id=$1 AND status='processing' AND attempts=$2 AND lease_until>now()",
              [job.id, job.attempts],
            ))
          )
            throw new TrackerError("TRACKER_LEASE_EXPIRED");
        });
      await preWrite();
      let issue: RemoteIssue | undefined;
      if (job.kind === "create") {
        performedWrite = true;
        issue = await client.create(job.payload.title, job.payload.body);
        writeAccepted = true;
        remoteId = issue.id;
      } else if (job.kind === "link") {
        issue = await client.read(job.payload.remoteId);
        remoteId = issue.id;
      } else {
        issue = await client.read(snapshot.link.remote_id);
        remoteId = issue.id;
        if (job.kind === "comment") {
          await preWrite();
          performedWrite = true;
          await client.comment(issue.id, job.payload.body);
          writeAccepted = true;
        } else if (job.payload.source === "feedbacks") {
          if (issue.state !== job.payload.expectedRemoteState)
            throw new TrackerError("TRACKER_REMOTE_CONFLICT");
          const mapping = snapshot.connection.configuration.states.find(
            (s: any) => s.local === snapshot.thread.data.work.state,
          );
          if (!mapping) throw new TrackerError("TRACKER_STATE_UNMAPPED");
          if (issue.state !== mapping.remote) {
            await preWrite();
            performedWrite = true;
            await client.setState(issue.id, mapping.remote, mapping.transition);
            writeAccepted = true;
            issue = await client.read(issue.id);
            if (issue.state !== mapping.remote)
              throw new TrackerError("TRACKER_STATE_READBACK_FAILED", true);
          }
        }
      }
      await db.transaction(async (tx) => {
        await accountLock(tx);
        if (
          !(await tx.one(
            "SELECT id FROM tracker_jobs WHERE id=$1 AND status='processing' AND attempts=$2 AND lease_until>now() FOR UPDATE",
            [job.id, job.attempts],
          ))
        )
          throw new TrackerError("TRACKER_LEASE_EXPIRED");
        const actor = await trackerHuman(tx, job.actor),
          connection = await trackerConnection(tx, actor, job.connection_id);
        if (connection.revision !== job.connection_revision)
          throw new TrackerError("TRACKER_CONNECTION_CHANGED");
        const thread = await threadRow(tx, actor, job.thread_id, "maintain");
        if (thread.project_id !== connection.project_id)
          throw new TrackerError("TRACKER_PROJECT_CHANGED");
        checkRevision(thread, job.payload.revision);
        if (job.kind === "create" || job.kind === "link")
          await attach(tx, connection, thread, issue!);
        if (job.kind === "sync") {
          const link = await tx.one(
            "SELECT * FROM tracker_links WHERE id=$1 FOR UPDATE",
            [snapshot.link.id],
          );
          if (job.payload.source === "provider")
            await applyRemoteState(
              tx,
              actor,
              thread,
              link,
              connection,
              issue!,
              job.payload.expectedRemoteState,
            );
          else
            await tx.query(
              "UPDATE tracker_links SET remote_state=$2,observed_remote_state=NULL,local_state=$3,local_revision=$4,status='synced',checked_at=now() WHERE id=$1",
              [link.id, issue!.state, thread.data.work.state, thread.revision],
            );
        }
        await tx.query(
          "UPDATE tracker_jobs SET status='delivered',remote_id=$2,error_code=NULL,lease_until=NULL WHERE id=$1 AND status='processing' AND attempts=$3",
          [job.id, remoteId ?? null, job.attempts],
        );
      });
    } catch (error) {
      if (error instanceof TrackerError && error.remoteId) remoteId = error.remoteId;
      const code =
        typeof (error as any)?.code === "string"
          ? (error as any).code
          : "TRACKER_UNAVAILABLE";
      const knownRejection = [
        "TRACKER_AUTH_REVOKED",
        "TRACKER_RATE_LIMIT",
        "TRACKER_REQUEST_REJECTED",
        "TRACKER_NOT_FOUND",
        "TRACKER_STATE_INVALID",
        "JIRA_TRANSITION_REQUIRED",
      ].includes(code);
      const uncertain =
        writeAccepted ||
        (error instanceof TrackerError && error.uncertain) ||
        (performedWrite && !knownRejection);
      const retryable =
        !uncertain &&
        ["TRACKER_NETWORK", "TRACKER_RATE_LIMIT", "TRACKER_UNAVAILABLE"].includes(code) &&
        job.attempts < 5;
      const conflict = [
        "CONFLICT",
        "TRACKER_REMOTE_CONFLICT",
        "TRACKER_BOTH_CHANGED",
      ].includes(code);
      const delay = Math.max(
        error instanceof TrackerError ? error.retryAfter : 0,
        Math.min(3600, 30 * 2 ** job.attempts),
      );
      await db.query(
        "UPDATE tracker_jobs SET status=$2,error_code=$3,remote_id=coalesce($4,remote_id),lease_until=NULL,next_at=now()+($5::integer*interval '1 second') WHERE id=$1 AND status='processing' AND attempts=$6",
        [
          job.id,
          uncertain
            ? "uncertain"
            : conflict
              ? "conflict"
              : retryable
                ? "pending"
                : "failed",
          code,
          remoteId ?? null,
          delay,
          job.attempts,
        ],
      );
      if (["TRACKER_AUTH_REVOKED", "TRACKER_OAUTH_EXPIRED"].includes(code))
        await db.query(
          "UPDATE tracker_connections SET health='error',error_code=$2 WHERE id=$1 AND revision=$3",
          [job.connection_id, code, job.connection_revision],
        );
    }
  }
}

/** Remote status polling needs outbound HTTPS only and stops when the connection owner loses access. */
export async function pollTrackerLinks(
  db: Database,
  store: AssetStore,
  config: Config,
  transport?: TrackerTransport,
) {
  for (let count = 0; count < 20; count++) {
    const target = await db.transaction(async (tx) => {
      const link = await tx.one(
        "SELECT l.* FROM tracker_links l JOIN tracker_connections c ON c.id=l.connection_id JOIN threads t ON t.id=l.thread_id AND t.project_id=c.project_id WHERE c.enabled=true AND c.health='healthy' AND (c.configuration->>'poll')='true' AND l.status<>'moved' AND l.next_poll_at<=now() ORDER BY l.next_poll_at,l.id LIMIT 1 FOR UPDATE OF l SKIP LOCKED",
      );
      if (!link) return null;
      await tx.query(
        "UPDATE tracker_links SET next_poll_at=now()+interval '5 minutes' WHERE id=$1",
        [link.id],
      );
      const connection = await tx.one("SELECT * FROM tracker_connections WHERE id=$1", [
        link.connection_id,
      ]);
      return { link, connection };
    });
    if (!target) break;
    try {
      const actor = {
        id: target.connection.created_by,
        userId: target.connection.created_by,
        kind: "human" as const,
        owner: false,
        name: "Tracker integration",
      };
      await db.transaction(async (tx) => {
        await accountLock(tx);
        await trackerConnection(tx, await trackerHuman(tx, actor), target.connection.id);
      });
      const remote = await (
        await trackerClient(db, store, config, target.connection, transport)
      ).read(target.link.remote_id);
      await db.transaction(async (tx) => {
        await accountLock(tx);
        const current = await trackerHuman(tx, actor),
          connection = await trackerConnection(tx, current, target.connection.id);
        if (
          connection.revision !== target.connection.revision ||
          !connection.configuration.poll
        )
          return;
        const thread = await threadRow(tx, current, target.link.thread_id, "maintain");
        if (thread.project_id !== connection.project_id)
          throw new TrackerError("TRACKER_PROJECT_CHANGED");
        const link = await tx.one("SELECT * FROM tracker_links WHERE id=$1 FOR UPDATE", [
          target.link.id,
        ]);
        if (remote.state === link.remote_state) {
          const desired = connection.configuration.states.find(
            (s: any) => s.remote === remote.state,
          )?.local;
          if (desired === thread.data.work.state)
            await tx.query(
              "UPDATE tracker_links SET observed_remote_state=NULL,checked_at=now(),status='synced',local_state=$2,local_revision=$3 WHERE id=$1",
              [link.id, thread.data.work.state, thread.revision],
            );
          else if (
            link.status === "linked" &&
            thread.data.work.state === link.local_state
          )
            await applyRemoteState(
              tx,
              current,
              thread,
              link,
              connection,
              remote,
              undefined,
              true,
            );
          else
            await tx.query(
              "UPDATE tracker_links SET observed_remote_state=NULL,checked_at=now(),status=$2 WHERE id=$1",
              [link.id, desired ? "local_changed" : "TRACKER_STATE_UNMAPPED"],
            );
        } else
          await applyRemoteState(
            tx,
            current,
            thread,
            link,
            connection,
            remote,
            undefined,
            true,
          );
      });
    } catch (error) {
      const code =
        typeof (error as any)?.code === "string"
          ? (error as any).code
          : "TRACKER_UNAVAILABLE";
      await db.query(
        "UPDATE tracker_links SET status=$2,checked_at=now(),next_poll_at=now()+interval '15 minutes' WHERE id=$1 AND status<>'moved' AND EXISTS(SELECT 1 FROM tracker_connections c JOIN threads t ON t.id=tracker_links.thread_id AND t.project_id=c.project_id WHERE c.id=tracker_links.connection_id AND c.revision=$3 AND c.enabled=true)",
        [
          target.link.id,
          ["TRACKER_BOTH_CHANGED", "TRACKER_REMOTE_CONFLICT"].includes(code)
            ? "conflict"
            : code,
          target.connection.revision,
        ],
      );
      if (
        [
          "TRACKER_AUTH_REVOKED",
          "TRACKER_OAUTH_EXPIRED",
          "UNAUTHENTICATED",
          "FORBIDDEN",
        ].includes(code)
      )
        await db.query(
          "UPDATE tracker_connections SET health='error',error_code=$2 WHERE id=$1 AND revision=$3 AND enabled=true",
          [target.connection.id, code, target.connection.revision],
        );
    }
  }
}
