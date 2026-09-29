import { randomUUID } from "node:crypto";
import type { Actor } from "../shared/contracts.js";
import type { Database } from "./db.js";
import type { Config } from "./config.js";
import { Auth, accountLock, hash, publicActor } from "./auth.js";
import { human, issueNumber, requireApp } from "./github/operation-common.js";
import { githubStatusSyncOperation } from "./github/status-sync-operation.js";
import {
  connectionOperationNames,
  githubConnectionOperation,
} from "./github/connection-operations.js";
import { access, event } from "./access.js";
import { checkRevision, fullThread, saveThread, threadRow } from "./feedback.js";
import { GithubApp, githubRepo, type GithubRepo } from "./github-app.js";
import {
  connectedGithubRepos,
  hasConnectedGithubRepo,
  requireConnectedGithubRepo,
} from "./github-repositories.js";
import { DomainError, fail } from "./errors.js";
import { quickIssueDraft } from "./issue-draft.js";
import type { AssetStore } from "./assets.js";

async function issueAuthor(db: Database, actor: Actor) {
  const current = await new Auth(db).current(actor);
  if (current.mustChangePassword)
    fail("PASSWORD_CHANGE_REQUIRED", "Change your password first", 403);
  if (current.kind === "agent" && !current.scopes?.includes("github.issueCreate"))
    fail("FORBIDDEN", "GitHub Issue creation is outside this agent key's scope", 403);
  return current;
}

async function linkedThread(
  db: Database,
  a: Actor,
  i: any,
  repo: GithubRepo,
  issue: { url: string; number: number; state: "open" | "closed" },
  kind: string,
) {
  const row = await threadRow(db, a, i.threadId, "maintain", true);
  const request = await db.one(
    "SELECT * FROM github_issue_requests WHERE thread_id=$1 FOR UPDATE",
    [row.id],
  );
  if (
    !request ||
    request.project_id !== row.project_id ||
    request.repository.toLowerCase() !== repo.fullName.toLowerCase()
  )
    fail("CONFLICT", "The Issue request is no longer current", 409);
  if (request.status === "linked") return fullThread(db, a, row);
  const links = row.data.externalIssues ?? [];
  const priorLink = links.find((link: any) => link.url === issue.url);
  if (priorLink) {
    priorLink.verification = "github_verified";
    priorLink.state = issue.state;
    priorLink.checkedAt = new Date().toISOString();
    priorLink.verifiedBy = publicActor(a);
    priorLink.verifiedAt = new Date().toISOString();
  } else
    links.push({
      url: issue.url,
      repository: repo.fullName,
      number: issue.number,
      verification: "github_verified",
      state: issue.state,
      checkedAt: new Date().toISOString(),
      linkedBy: publicActor(a),
      linkedAt: new Date().toISOString(),
    });
  row.data.externalIssues = links;
  const saved = await saveThread(db, a, row, kind);
  await db.query(
    "UPDATE github_issue_requests SET status='linked',issue_url=$1,updated_at=now() WHERE id=$2",
    [issue.url, request.id],
  );
  return fullThread(db, a, saved);
}

export async function githubOperation(
  db: Database,
  actor: Actor,
  name: string,
  i: any,
  config: Config,
  client: GithubApp,
  store?: AssetStore,
) {
  if (connectionOperationNames.has(name))
    return githubConnectionOperation(db, actor, name, i, config, client);
  if (name === "github.issueState")
    return db.transaction(async (tx) => {
      await accountLock(tx);
      const a = await human(tx, actor);
      const row = await threadRow(tx, a, i.threadId, "maintain");
      const request = await tx.one(
        "SELECT status,issue_url,created_at FROM github_issue_requests WHERE thread_id=$1",
        [row.id],
      );
      return {
        status: request?.status ?? "none",
        issueUrl: request?.issue_url ?? null,
        canAbandon:
          request?.status === "pending" &&
          Date.now() - new Date(request.created_at).getTime() >= 10 * 60 * 1000,
      };
    });
  if (name === "github.statusSyncState")
    return db.transaction(async (tx) => {
      await accountLock(tx);
      const a = await human(tx, actor);
      const row = await threadRow(tx, a, i.threadId, "maintain");
      const project = await access(tx, a, row.project_id, "maintain");
      const sync = await tx.one("SELECT * FROM github_status_sync WHERE thread_id=$1", [
        row.id,
      ]);
      return {
        status:
          sync?.status === "uncertain"
            ? "uncertain"
            : !project.githubConnected || !project.githubStatusSync
              ? "disabled"
              : !config.githubAppId ||
                  !config.githubAppPrivateKey ||
                  !config.githubAppSlug
                ? "error"
                : (sync?.status ?? "pending"),
        issueUrl: sync?.issue_url ?? null,
        feedbacksState: sync?.feedbacks_state ?? null,
        githubState: sync?.github_state ?? null,
        pendingTarget: sync?.pending_target ?? null,
        errorCode:
          !config.githubAppId || !config.githubAppPrivateKey || !config.githubAppSlug
            ? "GITHUB_UNAVAILABLE"
            : (sync?.error_code ?? null),
      };
    });
  if (name === "github.statusSync")
    return githubStatusSyncOperation(db, actor, i, config, client);
  if (name === "github.issueCreate") {
    requireApp(config);
    const reservation = await db.transaction(async (tx) => {
      await accountLock(tx);
      const a = await issueAuthor(tx, actor);
      const row = await threadRow(tx, a, i.threadId, "maintain", true);
      const project = await access(tx, a, row.project_id, "maintain");
      const existing = await tx.one(
        "SELECT * FROM github_issue_requests WHERE thread_id=$1 FOR UPDATE",
        [row.id],
      );
      const inputHash = hash(JSON.stringify({ title: i.title, body: i.body }));
      if (existing) {
        if (
          i.repositoryUrl &&
          githubRepo(i.repositoryUrl).fullName.toLowerCase() !==
            existing.repository.toLowerCase()
        )
          fail(
            "IDEMPOTENCY_CONFLICT",
            "An Issue request already exists for another repository",
            409,
          );
        if (
          existing.request_key !== i.idempotencyKey ||
          existing.input_hash !== inputHash
        )
          fail(
            "IDEMPOTENCY_CONFLICT",
            "An Issue request already exists for this thread",
            409,
          );
        if (existing.status === "linked") return { prior: await fullThread(tx, a, row) };
        fail(
          "GITHUB_UNCERTAIN",
          "The earlier Issue request may have succeeded. Inspect GitHub and reconcile it before retrying",
          409,
        );
      }
      const repo = requireConnectedGithubRepo(project, i.repositoryUrl);
      if (
        row.data.externalIssues?.some(
          (link: any) => link.repository?.toLowerCase() === repo.fullName.toLowerCase(),
        )
      )
        fail(
          "GITHUB_ALREADY_LINKED",
          "This thread already links an Issue in the connected repository",
          409,
        );
      checkRevision(row, i.revision);
      const requestId = randomUUID();
      await tx.query(
        "INSERT INTO github_issue_requests(id,thread_id,project_id,request_key,input_hash,repository,status) VALUES($1,$2,$3,$4,$5,$6,'pending')",
        [requestId, row.id, row.project_id, i.idempotencyKey, inputHash, repo.fullName],
      );
      await event(tx, a, row.project_id, row.id, "github.issueReserved", {
        repository: repo.fullName,
      });
      return { repo, requestId };
    });
    if ("prior" in reservation) return reservation.prior;
    const body = `${i.body}\n\n<!-- feedbacks-request:${reservation.requestId} -->`;
    const issue = await client.createIssue(reservation.repo, i.title, body);
    if (!issue.body.includes(`feedbacks-request:${reservation.requestId}`))
      fail(
        "GITHUB_UNCERTAIN",
        "GitHub Issue readback did not include the request marker. Inspect GitHub before retrying",
        503,
      );
    return db.transaction(async (tx) => {
      await accountLock(tx);
      const a = await issueAuthor(tx, actor);
      return linkedThread(tx, a, i, reservation.repo, issue, "github.issueCreate");
    });
  }
  if (name === "github.issueCreateQuick") {
    requireApp(config);
    const prepared = await db.transaction(async (tx) => {
      await accountLock(tx);
      const a = await human(tx, actor);
      const row = await threadRow(tx, a, i.threadId, "maintain", true);
      const project = await access(tx, a, row.project_id, "maintain");
      const repo = requireConnectedGithubRepo(project, i.repositoryUrl);
      const existing = await tx.one(
        "SELECT status,request_key,repository FROM github_issue_requests WHERE thread_id=$1 FOR UPDATE",
        [row.id],
      );
      if (existing) {
        if (
          i.repositoryUrl &&
          githubRepo(i.repositoryUrl).fullName.toLowerCase() !==
            existing.repository.toLowerCase()
        )
          fail(
            "IDEMPOTENCY_CONFLICT",
            "An Issue request already exists for another repository",
            409,
          );
        if (existing.request_key !== i.idempotencyKey)
          fail(
            "IDEMPOTENCY_CONFLICT",
            "An Issue request already exists for this thread",
            409,
          );
        if (existing.status === "linked") return { prior: await fullThread(tx, a, row) };
        fail(
          "GITHUB_UNCERTAIN",
          "The earlier Issue request may have succeeded. Inspect GitHub before retrying",
          409,
        );
      }
      checkRevision(row, i.revision);
      const thread = await fullThread(tx, a, row);
      const assets = await tx.query(
        "SELECT id,object_key,data FROM assets WHERE thread_id=$1 AND status='validated' AND NOT (data ? 'supersededBy') ORDER BY data->>'createdAt',data->>'filename',id",
        [row.id],
      );
      return { thread, repo, assets };
    });
    if ("prior" in prepared) return prepared.prior;
    const attachments = prepared.assets.map((asset) => ({
      id: asset.id,
      contentType: asset.data.contentType,
      filename: asset.data.filename,
    }));
    const draft = quickIssueDraft(prepared.thread, config.appOrigin, attachments);
    return githubOperation(
      db,
      actor,
      "github.issueCreate",
      { ...i, ...draft, reviewed: true },
      config,
      client,
      store,
    );
  }
  if (name === "github.issueReconcile") {
    requireApp(config);
    const repo = await db.transaction(async (tx) => {
      await accountLock(tx);
      const a = await human(tx, actor);
      const row = await threadRow(tx, a, i.threadId, "maintain");
      checkRevision(row, i.revision);
      const request = await tx.one(
        "SELECT * FROM github_issue_requests WHERE thread_id=$1",
        [row.id],
      );
      if (!request || request.status !== "pending")
        fail("NOT_FOUND", "No pending GitHub Issue request", 404);
      return githubRepo(`https://github.com/${request.repository}`);
    });
    const issue = await client.readIssue(repo, issueNumber(i.issueUrl, repo));
    return db.transaction(async (tx) => {
      await accountLock(tx);
      const a = await human(tx, actor);
      const request = await tx.one(
        "SELECT * FROM github_issue_requests WHERE thread_id=$1",
        [i.threadId],
      );
      if (!request || !issue.body.includes(`feedbacks-request:${request.id}`))
        fail(
          "GITHUB_ISSUE_INVALID",
          "That Issue does not match the pending request",
          409,
        );
      return linkedThread(tx, a, i, repo, issue, "github.issueReconcile");
    });
  }
  if (name === "github.issueAbandon")
    return db.transaction(async (tx) => {
      await accountLock(tx);
      const a = await human(tx, actor);
      const row = await threadRow(tx, a, i.threadId, "maintain", true);
      checkRevision(row, i.revision);
      const request = await tx.one(
        "SELECT * FROM github_issue_requests WHERE thread_id=$1 FOR UPDATE",
        [row.id],
      );
      if (!request || request.status !== "pending")
        fail("NOT_FOUND", "No pending GitHub Issue request", 404);
      if (Date.now() - new Date(request.created_at).getTime() < 10 * 60 * 1000)
        fail(
          "GITHUB_PENDING",
          "Wait 10 minutes for the GitHub request to settle before clearing it",
          409,
        );
      await tx.query("DELETE FROM github_issue_requests WHERE id=$1", [request.id]);
      await event(tx, a, row.project_id, row.id, name, {
        repository: request.repository,
        confirmedAbsent: true,
      });
      return { abandoned: true };
    });
  if (name === "github.issueRefresh") {
    requireApp(config);
    const repo = await db.transaction(async (tx) => {
      await accountLock(tx);
      const a = await human(tx, actor);
      const row = await threadRow(tx, a, i.threadId, "maintain");
      checkRevision(row, i.revision);
      const link = row.data.externalIssues?.find(
        (entry: any) =>
          entry.url === i.issueUrl && entry.verification === "github_verified",
      );
      if (!link) fail("NOT_FOUND", "No verified Issue link to refresh", 404);
      return githubRepo(`https://github.com/${link.repository}`);
    });
    const issue = await client.readIssue(repo, issueNumber(i.issueUrl, repo));
    return db.transaction(async (tx) => {
      await accountLock(tx);
      const a = await human(tx, actor);
      const row = await threadRow(tx, a, i.threadId, "maintain", true);
      const link = row.data.externalIssues?.find(
        (entry: any) =>
          entry.url === issue.url && entry.verification === "github_verified",
      );
      if (!link) fail("NOT_FOUND", "Verified Issue link changed", 404);
      link.state = issue.state;
      link.checkedAt = new Date().toISOString();
      return fullThread(tx, a, await saveThread(tx, a, row, name));
    });
  }
  fail("NOT_FOUND", "Unknown GitHub operation", 404);
}
