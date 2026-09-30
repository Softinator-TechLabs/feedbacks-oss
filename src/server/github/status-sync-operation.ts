import type { Actor } from "../../shared/contracts.js";
import type { Database } from "../db.js";
import type { Config } from "../config.js";
import { accountLock, publicActor } from "../auth.js";
import { access, event } from "../access.js";
import { checkRevision, fullThread, saveThread, threadRow } from "../feedback.js";
import { GithubApp } from "../github-app.js";
import {
  hasConnectedGithubRepo,
  requireConnectedGithubRepo,
} from "../github-repositories.js";
import { fail } from "../errors.js";
import {
  configuredGithubApps,
  projectGithubAppId,
  requireSyncAppId,
} from "../github-app-config.js";
import { human, issueNumber } from "./operation-common.js";

export async function githubStatusSyncState(
  db: Database,
  actor: Actor,
  i: any,
  config: Config,
) {
  return db.transaction(async (tx) => {
    await accountLock(tx);
    const a = await human(tx, actor);
    const row = await threadRow(tx, a, i.threadId, "maintain");
    const project = await access(tx, a, row.project_id, "maintain");
    const sync = await tx.one("SELECT * FROM github_status_sync WHERE thread_id=$1", [
      row.id,
    ]);
    const configured = configuredGithubApps(config).some(
      (app) => app.id === projectGithubAppId(config, project),
    );
    return {
      status:
        sync?.status === "uncertain"
          ? "uncertain"
          : !project.githubConnected || !project.githubStatusSync
            ? "disabled"
            : !configured
              ? "error"
              : (sync?.status ?? "pending"),
      issueUrl: sync?.issue_url ?? null,
      feedbacksState: sync?.feedbacks_state ?? null,
      githubState: sync?.github_state ?? null,
      pendingTarget: sync?.pending_target ?? null,
      errorCode: !configured ? "GITHUB_UNAVAILABLE" : (sync?.error_code ?? null),
    };
  });
}

export async function githubStatusSyncOperation(
  db: Database,
  actor: Actor,
  i: any,
  config: Config,
  client: GithubApp,
) {
  const name = "github.statusSync";
  const target = await db.transaction(async (tx) => {
    await accountLock(tx);
    const a = await human(tx, actor);
    const row = await threadRow(tx, a, i.threadId, "maintain");
    checkRevision(row, i.revision);
    const project = await access(tx, a, row.project_id, "maintain");
    if (!project.githubConnected || !project.githubStatusSync)
      fail("GITHUB_SYNC_DISABLED", "Enable status sync in project settings first", 409);
    const link = row.data.externalIssues?.find(
      (entry: any) =>
        entry.url === i.issueUrl && entry.verification === "github_verified",
    );
    if (!link)
      fail(
        "GITHUB_ISSUE_INVALID",
        "Use a verified Issue in the connected repository",
        409,
      );
    const repo = requireConnectedGithubRepo(
      project,
      `https://github.com/${link.repository}`,
    );
    return {
      repo,
      number: issueNumber(i.issueUrl, repo),
      appId: requireSyncAppId(config, project, link),
    };
  });
  client = client.forApp(target.appId);
  const issue = await client.readIssue(target.repo, target.number);
  let reservationToken: string | null = null;
  if (i.source === "feedbacks") {
    const state = await db.transaction(async (tx) => {
      await accountLock(tx);
      const a = await human(tx, actor);
      const row = await threadRow(tx, a, i.threadId, "maintain");
      checkRevision(row, i.revision);
      const project = await access(tx, a, row.project_id, "maintain");
      if (
        !project.githubConnected ||
        !project.githubStatusSync ||
        projectGithubAppId(config, project) !== target.appId
      )
        fail("GITHUB_SYNC_DISABLED", "Status sync was disabled", 409);
      if (row.data.work.state === "declined")
        fail(
          "GITHUB_SYNC_CONFLICT",
          "Declined feedback has no GitHub Issue equivalent",
          409,
        );
      return row.data.work.state === "resolved" ? "closed" : "open";
    });
    if (issue.state !== state) {
      reservationToken = await db.transaction(async (tx) => {
        await accountLock(tx);
        const a = await human(tx, actor);
        const row = await threadRow(tx, a, i.threadId, "maintain", true);
        checkRevision(row, i.revision);
        const project = await access(tx, a, row.project_id, "maintain");
        if (
          !project.githubConnected ||
          !project.githubStatusSync ||
          !hasConnectedGithubRepo(project, target.repo) ||
          projectGithubAppId(config, project) !== target.appId
        )
          fail(
            "GITHUB_SYNC_DISABLED",
            "Status sync was disabled or repository changed",
            409,
          );
        const link = row.data.externalIssues?.find(
          (entry: any) =>
            entry.url === issue.url && entry.verification === "github_verified",
        );
        if (!link) fail("GITHUB_ISSUE_INVALID", "Verified Issue link changed", 409);
        await tx.query(
          `INSERT INTO github_status_sync(thread_id,issue_url) VALUES($1,$2)
           ON CONFLICT(thread_id) DO NOTHING`,
          [row.id, issue.url],
        );
        const prior = await tx.one(
          "SELECT * FROM github_status_sync WHERE thread_id=$1 FOR UPDATE",
          [row.id],
        );
        if (prior.status === "uncertain")
          fail(
            "GITHUB_UNCERTAIN",
            "Inspect GitHub and reconcile the uncertain Issue state first",
            409,
          );
        if (prior.lease_until && new Date(prior.lease_until).getTime() > Date.now())
          fail("GITHUB_PENDING", "A status sync is already in progress", 409);
        const reserved = await tx.one(
          `UPDATE github_status_sync SET issue_url=$2,status='uncertain',pending_target=$3,
            error_code=NULL,next_at=now()+interval '5 minutes',
            lease_until=clock_timestamp()+interval '2 minutes',updated_at=now()
           WHERE thread_id=$1 AND status<>'uncertain'
           RETURNING lease_until::text AS claim_token`,
          [row.id, issue.url, state],
        );
        if (!reserved)
          fail("GITHUB_UNCERTAIN", "Inspect GitHub before trying again", 409);
        await event(tx, a, row.project_id, row.id, "github.statusSync.uncertain", {
          issueUrl: issue.url,
          pendingTarget: state,
        });
        return reserved.claim_token as string;
      });
      try {
        await client.setIssueState(target.repo, target.number, state);
      } catch (error) {
        await db.query(
          `UPDATE github_status_sync SET lease_until=NULL,updated_at=now()
           WHERE thread_id=$1 AND status='uncertain' AND lease_until=$2::timestamptz`,
          [i.threadId, reservationToken],
        );
        throw error;
      }
    }
    issue.state = state;
  }
  return db.transaction(async (tx) => {
    await accountLock(tx);
    const a = await human(tx, actor);
    const row = await threadRow(tx, a, i.threadId, "maintain", true);
    checkRevision(row, i.revision);
    const project = await access(tx, a, row.project_id, "maintain");
    if (
      !project.githubConnected ||
      !project.githubStatusSync ||
      !hasConnectedGithubRepo(project, target.repo) ||
      projectGithubAppId(config, project) !== target.appId
    )
      fail("GITHUB_SYNC_DISABLED", "Status sync was disabled or repository changed", 409);
    const link = row.data.externalIssues?.find(
      (entry: any) => entry.url === issue.url && entry.verification === "github_verified",
    );
    if (!link) fail("GITHUB_ISSUE_INVALID", "Verified Issue link changed", 409);
    const sync = await tx.one(
      `SELECT *,lease_until=$2::timestamptz AS owns_reservation
       FROM github_status_sync WHERE thread_id=$1 FOR UPDATE`,
      [row.id, reservationToken],
    );
    if (reservationToken) {
      if (sync?.status !== "uncertain" || !sync.owns_reservation)
        fail(
          "GITHUB_UNCERTAIN",
          "Status sync ownership changed after the GitHub write",
          409,
        );
    } else if (sync?.lease_until && new Date(sync.lease_until).getTime() > Date.now()) {
      fail("GITHUB_PENDING", "A status sync is already in progress", 409);
    } else if (
      i.source === "feedbacks" &&
      sync?.status === "uncertain" &&
      sync.pending_target !== issue.state
    ) {
      fail(
        "GITHUB_UNCERTAIN",
        "Inspect GitHub and reconcile the uncertain Issue state first",
        409,
      );
    }
    if (i.source === "github" && row.data.work.state === "declined")
      fail(
        "GITHUB_SYNC_CONFLICT",
        "Declined feedback requires a manual status decision",
        409,
      );
    const next =
      i.source === "github"
        ? issue.state === "closed"
          ? "resolved"
          : row.data.work.state === "resolved"
            ? "open"
            : row.data.work.state
        : row.data.work.state;
    if (row.data.work.state === next && link.state === issue.state) {
      const prior = await tx.one(
        "SELECT status,issue_url FROM github_status_sync WHERE thread_id=$1",
        [row.id],
      );
      await tx.query(
        `INSERT INTO github_status_sync(thread_id,issue_url,feedbacks_state,github_state,status,next_at)
        VALUES($1,$2,$3,$4,'ready',now()+interval '5 minutes')
        ON CONFLICT(thread_id) DO UPDATE SET issue_url=$2,feedbacks_state=$3,github_state=$4,
          status='ready',pending_target=NULL,error_code=NULL,next_at=now()+interval '5 minutes',lease_until=NULL,updated_at=now()`,
        [row.id, issue.url, next, issue.state],
      );
      if (prior?.status !== "ready" || prior?.issue_url !== issue.url)
        await event(tx, a, row.project_id, row.id, "github.statusSynchronized", {
          issueUrl: issue.url,
          source: i.source,
          githubState: issue.state,
          workState: next,
        });
      return fullThread(tx, a, row);
    }
    if (row.data.work.state !== next) {
      row.data.work.state = next;
      row.data.work.history.push({
        state: next,
        note: `Synced from GitHub Issue ${issue.url}`,
        actor: publicActor(a),
        at: new Date().toISOString(),
        duplicateOf: row.data.work.duplicateOf ?? null,
      });
    }
    link.state = issue.state;
    link.checkedAt = new Date().toISOString();
    link.statusSyncedAt = link.checkedAt;
    link.statusSyncSource = i.source;
    const saved = await saveThread(tx, a, row, name);
    await event(tx, a, row.project_id, row.id, "github.statusSynchronized", {
      issueUrl: issue.url,
      source: i.source,
      githubState: issue.state,
      workState: next,
    });
    await tx.query(
      `INSERT INTO github_status_sync(thread_id,issue_url,feedbacks_state,github_state,status,next_at)
      VALUES($1,$2,$3,$4,'ready',now()+interval '5 minutes')
      ON CONFLICT(thread_id) DO UPDATE SET issue_url=$2,feedbacks_state=$3,github_state=$4,
        status='ready',pending_target=NULL,error_code=NULL,next_at=now()+interval '5 minutes',lease_until=NULL,updated_at=now()`,
      [row.id, issue.url, next, issue.state],
    );
    return fullThread(tx, a, saved);
  });
}
