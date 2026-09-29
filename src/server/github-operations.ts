import { randomUUID } from "node:crypto";
import type { Actor } from "../shared/contracts.js";
import type { Database } from "./db.js";
import type { Config } from "./config.js";
import { Auth, accountLock, hash, publicActor } from "./auth.js";
import { human, issueNumber, requireApp } from "./github/operation-common.js";
import { githubStatusSyncOperation } from "./github/status-sync-operation.js";
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
  if (name === "github.connection") {
    const connection = await db.transaction(async (tx) => {
      await accountLock(tx);
      const a = await human(tx, actor);
      const project = await access(tx, a, i.projectId);
      return {
        configured: !!(
          config.githubAppId &&
          config.githubAppSlug &&
          config.githubAppPrivateKey
        ),
        connected: project.githubConnected === true,
        statusSyncEnabled: project.githubStatusSync === true,
        repositoryUrl: project.repositoryUrl ?? null,
        connectedRepositories: connectedGithubRepos(project).map(
          (repo) => `https://github.com/${repo.fullName}`,
        ),
        installUrl: config.githubAppSlug
          ? `https://github.com/apps/${config.githubAppSlug}/installations/new`
          : null,
      };
    });
    let installation:
      | "not_configured"
      | "no_repository"
      | "installed"
      | "not_installed"
      | "unavailable" = !connection.configured
      ? "not_configured"
      : !connection.repositoryUrl
        ? "no_repository"
        : "unavailable";
    const repositoryUrls = [
      ...new Set(
        [...connection.connectedRepositories, connection.repositoryUrl].filter(
          (value): value is string => !!value,
        ),
      ),
    ].slice(0, 21);
    const repositories = await Promise.all(
      repositoryUrls.map(async (repositoryUrl) => {
        let state: "installed" | "not_installed" | "unavailable" = "unavailable";
        if (connection.configured) {
          try {
            await client.check(githubRepo(repositoryUrl));
            state = "installed";
          } catch (error) {
            if (error instanceof DomainError && error.code === "GITHUB_NOT_INSTALLED")
              state = "not_installed";
          }
        }
        return {
          repositoryUrl,
          connected: connection.connectedRepositories.some(
            (url) => url.toLowerCase() === repositoryUrl.toLowerCase(),
          ),
          installation: state,
        };
      }),
    );
    if (connection.configured && connection.repositoryUrl)
      installation =
        repositories.find(
          (repo) =>
            repo.repositoryUrl.toLowerCase() === connection.repositoryUrl?.toLowerCase(),
        )?.installation ?? "unavailable";
    const { connectedRepositories: _connectedRepositories, ...summary } = connection;
    return { ...summary, installation, repositories };
  }
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
  if (name === "github.connect") {
    requireApp(config);
    const repo = await db.transaction(async (tx) => {
      await accountLock(tx);
      const a = await human(tx, actor);
      const project = await access(tx, a, i.projectId, "maintain");
      if (project.revision !== i.revision)
        fail("CONFLICT", "Project changed; reload first", 409);
      return githubRepo(project.repositoryUrl);
    });
    await client.check(repo);
    return db.transaction(async (tx) => {
      await accountLock(tx);
      const a = await human(tx, actor);
      const project = await access(tx, a, i.projectId, "maintain");
      if (
        project.revision !== i.revision ||
        githubRepo(project.repositoryUrl).fullName.toLowerCase() !==
          repo.fullName.toLowerCase()
      )
        fail("CONFLICT", "Project changed while checking GitHub", 409);
      if (
        !hasConnectedGithubRepo(project, repo) &&
        connectedGithubRepos(project).length >= 20
      )
        fail("LIMIT", "A project can connect up to 20 GitHub repositories", 400);
      await tx.query(
        "UPDATE projects SET data=data || jsonb_build_object('githubConnected',true,'githubRepositories',$2::jsonb),revision=revision+1 WHERE id=$1",
        [
          project.id,
          JSON.stringify([
            ...new Set([
              ...connectedGithubRepos(project).map(
                (connected) => `https://github.com/${connected.fullName}`,
              ),
              `https://github.com/${repo.fullName}`,
            ]),
          ]),
        ],
      );
      await event(tx, a, project.id, project.id, name, { repository: repo.fullName });
      return access(tx, a, project.id);
    });
  }
  if (name === "github.disconnect")
    return db.transaction(async (tx) => {
      await accountLock(tx);
      const a = await human(tx, actor);
      const project = await access(tx, a, i.projectId, "maintain");
      if (project.revision !== i.revision)
        fail("CONFLICT", "Project changed; reload first", 409);
      await tx.query(
        "UPDATE projects SET data=data || jsonb_build_object('githubConnected',false,'githubStatusSync',false,'githubRepositories','[]'::jsonb),revision=revision+1 WHERE id=$1",
        [project.id],
      );
      await event(tx, a, project.id, project.id, name, {});
      return access(tx, a, project.id);
    });
  if (name === "github.repositoryConnect") {
    requireApp(config);
    const repo = githubRepo(i.repositoryUrl);
    await db.transaction(async (tx) => {
      await accountLock(tx);
      const a = await human(tx, actor);
      const project = await access(tx, a, i.projectId, "maintain");
      if (project.revision !== i.revision)
        fail("CONFLICT", "Project changed; reload first", 409);
      if (
        !hasConnectedGithubRepo(project, repo) &&
        connectedGithubRepos(project).length >= 20
      )
        fail("LIMIT", "A project can connect up to 20 GitHub repositories", 400);
    });
    await client.check(repo);
    return db.transaction(async (tx) => {
      await accountLock(tx);
      const a = await human(tx, actor);
      const project = await access(tx, a, i.projectId, "maintain");
      if (project.revision !== i.revision)
        fail("CONFLICT", "Project changed while checking GitHub", 409);
      const urls = connectedGithubRepos(project).map(
        (connected) => `https://github.com/${connected.fullName}`,
      );
      if (!hasConnectedGithubRepo(project, repo))
        urls.push(`https://github.com/${repo.fullName}`);
      if (urls.length > 20) fail("LIMIT", "Too many repositories", 400);
      await tx.query(
        "UPDATE projects SET data=data || jsonb_build_object('githubConnected',true,'githubRepositories',$2::jsonb),revision=revision+1 WHERE id=$1",
        [project.id, JSON.stringify(urls)],
      );
      await event(tx, a, project.id, project.id, name, { repository: repo.fullName });
      return access(tx, a, project.id);
    });
  }
  if (name === "github.repositoryDisconnect")
    return db.transaction(async (tx) => {
      await accountLock(tx);
      const a = await human(tx, actor);
      const project = await access(tx, a, i.projectId, "maintain");
      if (project.revision !== i.revision)
        fail("CONFLICT", "Project changed; reload first", 409);
      const repo = githubRepo(i.repositoryUrl);
      if (!hasConnectedGithubRepo(project, repo))
        fail("GITHUB_NOT_CONNECTED", "This repository is not connected", 409);
      const urls = connectedGithubRepos(project)
        .filter(
          (connected) => connected.fullName.toLowerCase() !== repo.fullName.toLowerCase(),
        )
        .map((connected) => `https://github.com/${connected.fullName}`);
      await tx.query(
        "UPDATE projects SET data=data || jsonb_build_object('githubConnected',$2::boolean,'githubStatusSync',false,'githubRepositories',$3::jsonb),revision=revision+1 WHERE id=$1",
        [project.id, urls.length > 0, JSON.stringify(urls)],
      );
      await event(tx, a, project.id, project.id, name, { repository: repo.fullName });
      return access(tx, a, project.id);
    });
  if (name === "github.statusSyncConfigure")
    return db.transaction(async (tx) => {
      await accountLock(tx);
      const a = await human(tx, actor);
      const project = await access(tx, a, i.projectId, "maintain");
      if (project.revision !== i.revision)
        fail("CONFLICT", "Project changed; reload first", 409);
      if (i.enabled && !project.githubConnected)
        fail("GITHUB_NOT_CONNECTED", "Connect the GitHub App first", 409);
      if (i.enabled) requireApp(config);
      if (project.githubStatusSync === i.enabled) return project;
      if (i.enabled)
        await tx.query(
          `UPDATE github_status_sync SET feedbacks_state=NULL,github_state=NULL,
          status='ready',pending_target=NULL,error_code=NULL,next_at=now(),lease_until=NULL,updated_at=now()
          WHERE thread_id IN (SELECT id FROM threads WHERE project_id=$1) AND status<>'uncertain'`,
          [project.id],
        );
      await tx.query(
        "UPDATE projects SET data=jsonb_set(data,'{githubStatusSync}',to_jsonb($1::boolean)),revision=revision+1 WHERE id=$2",
        [i.enabled, project.id],
      );
      await event(tx, a, project.id, project.id, name, { enabled: i.enabled });
      return access(tx, a, project.id);
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
