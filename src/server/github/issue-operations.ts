import { currentGithubApp } from "../github-managed-apps.js";
import { randomUUID } from "node:crypto";
import type { Actor } from "../../shared/contracts.js";
import type { Database } from "../db.js";
import type { Config } from "../config.js";
import { Auth, accountLock, hash, publicActor } from "../auth.js";
import { access, event } from "../access.js";
import { checkRevision, fullThread, saveThread, threadRow } from "../feedback.js";
import { GithubApp, githubRepo, type GithubRepo } from "../github-app.js";
import { requireConnectedGithubRepo } from "../github-repositories.js";
import { fail } from "../errors.js";
import { quickIssueDraft } from "../issue-draft.js";
import type { AssetStore } from "../assets.js";
import {
  projectGithubAppId,
  historicalGithubAppId,
  assertGithubOwner,
} from "../github-app-config.js";
import { human, issueNumber } from "./operation-common.js";

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
    priorLink.githubAppId = request.github_app_id ?? null;
    priorLink.verification = "github_verified";
    priorLink.state = issue.state;
    priorLink.checkedAt = new Date().toISOString();
    priorLink.verifiedBy = publicActor(a);
    priorLink.verifiedAt = new Date().toISOString();
  } else
    links.push({
      url: issue.url,
      repository: repo.fullName,
      githubAppId: request.github_app_id ?? null,
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

export const issueOperationNames = new Set([
  "github.issueState",
  "github.issueCreate",
  "github.issueCreateQuick",
  "github.issueReconcile",
  "github.issueAbandon",
  "github.issueRefresh",
]);

export async function githubIssueOperation(
  db: Database,
  actor: Actor,
  name: string,
  i: any,
  config: Config,
  client: GithubApp,
  store?: AssetStore,
) {
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
  if (name === "github.issueCreate") {
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
      const appId = projectGithubAppId(config, project);
      const app = await currentGithubApp(tx, config, appId, repo.owner);
      assertGithubOwner(app, repo.owner);
      const requestId = randomUUID();
      await tx.query(
        "INSERT INTO github_issue_requests(id,thread_id,project_id,request_key,input_hash,repository,github_app_id,status) VALUES($1,$2,$3,$4,$5,$6,$7,'pending')",
        [
          requestId,
          row.id,
          row.project_id,
          i.idempotencyKey,
          inputHash,
          repo.fullName,
          appId,
        ],
      );
      await event(tx, a, row.project_id, row.id, "github.issueReserved", {
        repository: repo.fullName,
      });
      return { repo, requestId, appId };
    });
    if ("prior" in reservation) return reservation.prior;
    const body = `${i.body}\n\n<!-- feedbacks-request:${reservation.requestId} -->`;
    const issue = await client
      .forApp(reservation.appId)
      .createIssue(reservation.repo, i.title, body);
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
    return githubIssueOperation(
      db,
      actor,
      "github.issueCreate",
      {
        ...i,
        ...draft,
        repositoryUrl: `https://github.com/${prepared.repo.fullName}`,
        reviewed: true,
      },
      config,
      client,
      store,
    );
  }
  if (name === "github.issueReconcile") {
    const target = await db.transaction(async (tx) => {
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
      return {
        repo: githubRepo(`https://github.com/${request.repository}`),
        appId: request.github_app_id ?? config.githubAppId ?? null,
      };
    });
    const { repo, appId } = target;
    const issue = await client
      .forApp(appId)
      .readIssue(repo, issueNumber(i.issueUrl, repo));
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
    const target = await db.transaction(async (tx) => {
      await accountLock(tx);
      const a = await human(tx, actor);
      const row = await threadRow(tx, a, i.threadId, "maintain");
      checkRevision(row, i.revision);
      const link = row.data.externalIssues?.find(
        (entry: any) =>
          entry.url === i.issueUrl && entry.verification === "github_verified",
      );
      if (!link) fail("NOT_FOUND", "No verified Issue link to refresh", 404);
      return {
        repo: githubRepo(`https://github.com/${link.repository}`),
        appId: historicalGithubAppId(config, link),
      };
    });
    const { repo, appId } = target;
    const issue = await client
      .forApp(appId)
      .readIssue(repo, issueNumber(i.issueUrl, repo));
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
  fail("NOT_FOUND", "Unknown GitHub Issue operation", 404);
}
