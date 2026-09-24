import { randomUUID } from "node:crypto";
import type { Actor } from "../shared/contracts.js";
import type { Database } from "./db.js";
import type { Config } from "./config.js";
import { Auth, accountLock, hash, publicActor } from "./auth.js";
import { access, event } from "./access.js";
import { checkRevision, fullThread, saveThread, threadRow } from "./feedback.js";
import { GithubApp, githubRepo, type GithubRepo } from "./github-app.js";
import { fail } from "./errors.js";

async function human(db: Database, actor: Actor) {
  const current = await new Auth(db).current(actor);
  if (current.kind !== "human")
    fail("FORBIDDEN", "A signed-in project maintainer is required", 403);
  if (current.mustChangePassword)
    fail("PASSWORD_CHANGE_REQUIRED", "Change your password first", 403);
  return current;
}

async function issueAuthor(db: Database, actor: Actor) {
  const current = await new Auth(db).current(actor);
  if (current.mustChangePassword)
    fail("PASSWORD_CHANGE_REQUIRED", "Change your password first", 403);
  if (current.kind === "agent" && !current.scopes?.includes("github.issueCreate"))
    fail("FORBIDDEN", "GitHub Issue creation is outside this agent key's scope", 403);
  return current;
}

function requireApp(config: Config) {
  if (!config.githubAppId || !config.githubAppSlug || !config.githubAppPrivateKey)
    fail("GITHUB_UNAVAILABLE", "This server has no GitHub App configured", 503);
}

function requireConnected(project: any): GithubRepo {
  if (!project.githubConnected)
    fail("GITHUB_NOT_CONNECTED", "Connect the GitHub App in project settings first", 409);
  return githubRepo(project.repositoryUrl);
}

function issueNumber(value: string, repo: GithubRepo) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    fail("GITHUB_ISSUE_INVALID", "Use an exact GitHub Issue URL");
  }
  const expected = `/` + repo.fullName + `/issues/`;
  if (
    url.origin !== "https://github.com" ||
    url.pathname.slice(0, expected.length).toLowerCase() !== expected.toLowerCase() ||
    url.search ||
    url.hash ||
    url.username ||
    url.password ||
    !/^[1-9]\d*$/.test(url.pathname.slice(expected.length))
  )
    fail("GITHUB_ISSUE_INVALID", "Use an Issue URL from the connected repository");
  const number = Number(url.pathname.slice(expected.length));
  if (!Number.isSafeInteger(number)) fail("GITHUB_ISSUE_INVALID", "Invalid Issue number");
  return number;
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
) {
  if (name === "github.connection")
    return db.transaction(async (tx) => {
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
        repositoryUrl: project.repositoryUrl ?? null,
        installUrl: config.githubAppSlug
          ? `https://github.com/apps/${config.githubAppSlug}/installations/new`
          : null,
      };
    });
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
      await tx.query(
        "UPDATE projects SET data=jsonb_set(data,'{githubConnected}','true'::jsonb),revision=revision+1 WHERE id=$1",
        [project.id],
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
        "UPDATE projects SET data=jsonb_set(data,'{githubConnected}','false'::jsonb),revision=revision+1 WHERE id=$1",
        [project.id],
      );
      await event(tx, a, project.id, project.id, name, {});
      return access(tx, a, project.id);
    });
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
      const repo = requireConnected(project);
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
