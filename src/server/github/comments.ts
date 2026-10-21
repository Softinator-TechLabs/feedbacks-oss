import { randomUUID } from "node:crypto";
import type { Database } from "../db.js";
import type { Config } from "../config.js";
import type { AssetStore } from "../assets.js";
import type { Actor } from "../../shared/contracts.js";
import { accountLock, hash } from "../auth.js";
import { access, event } from "../access.js";
import { checkRevision, threadRow } from "../feedback.js";
import { GithubApp, GithubCommentError, githubRepo } from "../github-app.js";
import { managedGithubConfig, currentGithubApp } from "../github-managed-apps.js";
import { requireSyncAppId } from "../github-app-config.js";
import { requireConnectedGithubRepo } from "../github-repositories.js";
import { human, issueNumber } from "./operation-common.js";
import { fail } from "../errors.js";

export const githubCommentsMigrationSql = `CREATE TABLE github_comment_jobs(
 id uuid PRIMARY KEY,thread_id uuid NOT NULL REFERENCES threads(id),project_id uuid NOT NULL REFERENCES projects(id),github_app_id text NOT NULL,app_revision integer NOT NULL,repository text NOT NULL,issue_url text NOT NULL,issue_number integer NOT NULL,
 body text NOT NULL,actor jsonb NOT NULL,created_by uuid NOT NULL REFERENCES users(id),idempotency_key text NOT NULL,input_hash text NOT NULL,status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','delivered','failed','uncertain','abandoned','cancelled')),
 attempts integer NOT NULL DEFAULT 0,next_at timestamptz NOT NULL DEFAULT now(),lease_until timestamptz,error_code text,comment_id bigint,comment_url text,created_at timestamptz NOT NULL DEFAULT now(),delivered_at timestamptz,UNIQUE(created_by,idempotency_key));
CREATE INDEX github_comment_jobs_due ON github_comment_jobs(next_at) WHERE status='pending';
CREATE INDEX github_comment_jobs_thread ON github_comment_jobs(thread_id,created_at DESC);`;
export const githubCommentOperationNames = new Set([
  "github.comments",
  "github.commentQueue",
  "github.commentHistory",
  "github.commentReconcile",
]);
const summary = (r: any, historical = false) => ({
  id: r.id,
  threadId: r.thread_id,
  issueUrl: r.issue_url,
  status: r.status,
  attempts: r.attempts,
  errorCode: r.error_code,
  commentId: r.comment_id == null ? null : Number(r.comment_id),
  commentUrl: r.comment_url,
  createdAt: r.created_at.toISOString(),
  historical,
});
async function appRevision(db: Database, config: Config, appId: string, owner: string) {
  await currentGithubApp(db, config, appId, owner);
  return (
    (await db.one("SELECT revision FROM github_managed_apps WHERE app_id=$1", [appId]))
      ?.revision ?? 0
  );
}
async function target(db: Database, actor: Actor, input: any, config: Config) {
  const a = await human(db, actor);
  if (actor.kind !== "human")
    fail("FORBIDDEN", "A signed-in human maintainer is required", 403);
  const row = await threadRow(db, a, input.threadId, "maintain"),
    project = await access(db, a, row.project_id, "maintain");
  const link = row.data.externalIssues?.find(
    (entry: any) =>
      entry.url === input.issueUrl && entry.verification === "github_verified",
  );
  if (!link)
    fail(
      "GITHUB_ISSUE_INVALID",
      "Use a verified GitHub Issue linked to this feedback",
      409,
    );
  const repo = requireConnectedGithubRepo(
      project,
      `https://github.com/${link.repository}`,
    ),
    appId = requireSyncAppId(config, project, link),
    revision = await appRevision(db, config, appId, repo.owner);
  return {
    actor: a,
    row,
    repo,
    appId,
    appRevision: revision,
    number: issueNumber(input.issueUrl, repo),
    issueUrl: input.issueUrl,
  };
}
export async function githubCommentOperation(
  db: Database,
  actor: Actor,
  name: string,
  input: any,
  config: Config,
  client: GithubApp,
  store?: AssetStore,
): Promise<any> {
  config = await managedGithubConfig(db, config, store);
  client = client.withConfig(config);
  if (name === "github.comments") {
    const check = () =>
      db.transaction(async (tx) => {
        await accountLock(tx);
        return target(tx, actor, input, config);
      });
    const initial = await check();
    const recheck = async () => {
      const now = await check();
      if (
        now.row.project_id !== initial.row.project_id ||
        now.appId !== initial.appId ||
        now.appRevision !== initial.appRevision
      )
        fail(
          "GITHUB_APP_CHANGED",
          "The GitHub connection changed; reload before reading comments",
          409,
        );
    };
    const comments = await client
      .forApp(initial.appId)
      .readIssueComments(initial.repo, initial.number, input.page, recheck);
    await recheck();
    return comments;
  }
  if (name === "github.commentReconcile" && input.outcome === "delivered") {
    if (!input.commentId)
      fail("VALIDATION", "Enter the actual GitHub comment ID after checking the Issue");
    const check = () =>
      db.transaction(async (tx) => {
        await accountLock(tx);
        const a = await human(tx, actor);
        if (actor.kind !== "human")
          fail("FORBIDDEN", "A signed-in human maintainer is required", 403);
        const job = await tx.one("SELECT * FROM github_comment_jobs WHERE id=$1", [
          input.jobId,
        ]);
        if (!job) fail("NOT_FOUND", "GitHub comment action not found", 404);
        const thread = await threadRow(tx, a, job.thread_id, "maintain");
        await access(tx, a, job.project_id, "maintain");
        if (thread.project_id !== job.project_id || job.status !== "uncertain")
          fail("CONFLICT", "This action is historical or no longer uncertain", 409);
        const repo = githubRepo(`https://github.com/${job.repository}`);
        const revision = await appRevision(tx, config, job.github_app_id, repo.owner);
        return { a, job, repo, revision };
      });
    const original = await check(),
      comment = await client
        .forApp(original.job.github_app_id)
        .readIssueComment(
          original.repo,
          original.job.issue_number,
          input.commentId,
          async () => {
            const now = await check();
            if (now.revision !== original.revision)
              fail(
                "GITHUB_APP_CHANGED",
                "The original GitHub App changed during verification",
                409,
              );
          },
        );
    if (comment.body !== original.job.body)
      fail(
        "GITHUB_COMMENT_MISMATCH",
        "This GitHub comment does not contain the reviewed text",
        409,
      );
    return db.transaction(async (tx) => {
      await accountLock(tx);
      const a = await human(tx, actor),
        job = await tx.one("SELECT * FROM github_comment_jobs WHERE id=$1 FOR UPDATE", [
          input.jobId,
        ]);
      if (!job) fail("NOT_FOUND", "GitHub comment action not found", 404);
      const thread = await threadRow(tx, a, job.thread_id, "maintain");
      await access(tx, a, job.project_id, "maintain");
      if (thread.project_id !== job.project_id || job.status !== "uncertain")
        fail("CONFLICT", "This comment action changed during verification", 409);
      if (
        (await appRevision(tx, config, job.github_app_id, original.repo.owner)) !==
        original.revision
      )
        fail(
          "GITHUB_APP_CHANGED",
          "The original GitHub App changed during verification",
          409,
        );
      const saved = await tx.one(
        "UPDATE github_comment_jobs SET status='delivered',comment_id=$2,comment_url=$3,error_code=NULL,delivered_at=now() WHERE id=$1 RETURNING *",
        [job.id, comment.id, comment.url],
      );
      await event(tx, a, job.project_id, thread.id, "github.commentReconciled", {
        jobId: job.id,
        delivered: true,
      });
      return summary(saved);
    });
  }
  return db.transaction(async (tx) => {
    await accountLock(tx);
    const a = await human(tx, actor);
    if (actor.kind !== "human")
      fail("FORBIDDEN", "A signed-in human maintainer is required", 403);
    if (name === "github.commentHistory") {
      const thread = await threadRow(tx, a, input.threadId, "read"),
        jobs = await tx.query(
          "SELECT * FROM github_comment_jobs WHERE thread_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100",
          [thread.id],
        ),
        allowed = new Set<string>();
      for (const projectId of new Set<string>(jobs.map((j) => j.project_id))) {
        try {
          await access(tx, a, projectId, "maintain");
          allowed.add(projectId);
        } catch (error) {
          if (!["FORBIDDEN", "NOT_FOUND"].includes((error as any)?.code)) throw error;
        }
      }
      return {
        items: jobs
          .filter((j) => allowed.has(j.project_id))
          .map((j) => summary(j, j.project_id !== thread.project_id)),
      };
    }
    if (name === "github.commentReconcile") {
      const job = await tx.one(
        "SELECT * FROM github_comment_jobs WHERE id=$1 FOR UPDATE",
        [input.jobId],
      );
      if (!job) fail("NOT_FOUND", "GitHub comment action not found", 404);
      await access(tx, a, job.project_id, "maintain");
      const thread = await threadRow(tx, a, job.thread_id, "maintain");
      if (thread.project_id !== job.project_id || job.status !== "uncertain")
        fail("CONFLICT", "Only current uncertain actions need reconciliation", 409);
      const saved = await tx.one(
        "UPDATE github_comment_jobs SET status='abandoned',error_code=NULL WHERE id=$1 RETURNING *",
        [job.id],
      );
      await event(tx, a, job.project_id, thread.id, "github.commentReconciled", {
        jobId: job.id,
        delivered: false,
      });
      return summary(saved);
    }
    const binding = await target(tx, a, input, config),
      previous = await tx.one(
        "SELECT * FROM github_comment_jobs WHERE created_by=$1 AND idempotency_key=$2",
        [a.userId, input.idempotencyKey],
      ),
      inputHash = hash(JSON.stringify(input));
    if (previous) {
      if (previous.input_hash !== inputHash)
        fail("IDEMPOTENCY_CONFLICT", "This retry key was used for another comment", 409);
      return summary(previous);
    }
    checkRevision(binding.row, input.revision);
    const budget = await tx.one(
      "SELECT count(*)::int n FROM github_comment_jobs WHERE created_by=$1 AND created_at>now()-interval '1 minute'",
      [a.userId],
    );
    if (budget.n >= 10)
      fail("RATE_LIMITED", "Wait one minute before sending more GitHub comments", 429);
    const job = await tx.one(
      "INSERT INTO github_comment_jobs(id,thread_id,project_id,github_app_id,app_revision,repository,issue_url,issue_number,body,actor,created_by,idempotency_key,input_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *",
      [
        randomUUID(),
        binding.row.id,
        binding.row.project_id,
        binding.appId,
        binding.appRevision,
        binding.repo.fullName,
        input.issueUrl,
        binding.number,
        input.body,
        JSON.stringify({
          id: a.userId,
          userId: a.userId,
          kind: "human",
          owner: false,
          name: a.name,
        }),
        a.userId,
        input.idempotencyKey,
        inputHash,
      ],
    );
    return summary(job);
  });
}

export async function processGithubComments(
  db: Database,
  config: Config,
  client = new GithubApp(config),
  store?: AssetStore,
) {
  await db.query(
    "UPDATE github_comment_jobs SET status='uncertain',error_code='GITHUB_COMMENT_INTERRUPTED',lease_until=NULL WHERE status='processing' AND lease_until<now()",
  );
  config = await managedGithubConfig(db, config, store);
  client = client.withConfig(config);
  for (let count = 0; count < 10; count++) {
    const job = await db.transaction(async (tx) => {
      await accountLock(tx);
      const row = await tx.one(
        "SELECT * FROM github_comment_jobs WHERE status='pending' AND next_at<=now() ORDER BY next_at,id LIMIT 1 FOR UPDATE SKIP LOCKED",
      );
      if (!row) return null;
      return tx.one(
        "UPDATE github_comment_jobs SET status='processing',attempts=attempts+1,lease_until=now()+interval '2 minutes' WHERE id=$1 RETURNING *",
        [row.id],
      );
    });
    if (!job) return;
    let sending = false,
      accepted = false,
      commentId: number | null = null;
    try {
      const check = () =>
        db.transaction(async (tx) => {
          await accountLock(tx);
          const binding = await target(
            tx,
            job.actor,
            { threadId: job.thread_id, issueUrl: job.issue_url },
            config,
          );
          if (
            binding.row.project_id !== job.project_id ||
            binding.appId !== job.github_app_id ||
            binding.appRevision !== job.app_revision ||
            binding.repo.fullName.toLowerCase() !== job.repository.toLowerCase()
          )
            fail("GITHUB_APP_CHANGED", "This comment's original connection changed", 409);
          if (
            !(await tx.one(
              "SELECT id FROM github_comment_jobs WHERE id=$1 AND status='processing' AND attempts=$2 AND lease_until>now()",
              [job.id, job.attempts],
            ))
          )
            fail("GITHUB_COMMENT_LEASE_EXPIRED", "The comment attempt expired", 409);
          return binding;
        });
      const binding = await check();
      const comment = await client
        .forApp(job.github_app_id)
        .createIssueComment(binding.repo, job.issue_number, job.body, async () => {
          await check();
          sending = true;
        });
      accepted = true;
      commentId = comment.id;
      await db.transaction(async (tx) => {
        await accountLock(tx);
        await checkCurrentResult(tx, job, config);
        await tx.query(
          "UPDATE github_comment_jobs SET status='delivered',comment_id=$2,comment_url=$3,error_code=NULL,lease_until=NULL,delivered_at=now() WHERE id=$1 AND status='processing' AND attempts=$4",
          [job.id, comment.id, comment.url, job.attempts],
        );
      });
    } catch (error) {
      const code =
          typeof (error as any)?.code === "string"
            ? (error as any).code
            : "GITHUB_COMMENT_UNAVAILABLE",
        definitelyRejected =
          error instanceof GithubCommentError &&
          !error.uncertain &&
          ["GITHUB_COMMENT_REJECTED", "GITHUB_COMMENT_RATE_LIMIT"].includes(code),
        uncertain =
          accepted ||
          (error instanceof GithubCommentError && error.uncertain) ||
          (sending && !definitelyRejected),
        retry =
          !uncertain &&
          [
            "GITHUB_UNAVAILABLE",
            "GITHUB_COMMENT_NETWORK",
            "GITHUB_COMMENT_RATE_LIMIT",
          ].includes(code) &&
          job.attempts < 5;
      await db.query(
        "UPDATE github_comment_jobs SET status=$2,error_code=$3,comment_id=coalesce($4,comment_id),lease_until=NULL,next_at=now()+($5::int*interval '1 second') WHERE id=$1 AND status='processing' AND attempts=$6",
        [
          job.id,
          uncertain ? "uncertain" : retry ? "pending" : "failed",
          code,
          commentId ??
            (error instanceof GithubCommentError ? (error.commentId ?? null) : null),
          Math.max(
            Math.min(3600, 30 * 2 ** job.attempts),
            error instanceof GithubCommentError ? (error.retryAfterSeconds ?? 0) : 0,
          ),
          job.attempts,
        ],
      );
    }
  }
}
async function checkCurrentResult(db: Database, job: any, config: Config) {
  const binding = await target(
    db,
    job.actor,
    { threadId: job.thread_id, issueUrl: job.issue_url },
    config,
  );
  if (
    binding.row.project_id !== job.project_id ||
    binding.appId !== job.github_app_id ||
    binding.appRevision !== job.app_revision
  )
    fail("GITHUB_APP_CHANGED", "The comment's original connection changed", 409);
  if (
    !(await db.one(
      "SELECT id FROM github_comment_jobs WHERE id=$1 AND status='processing' AND attempts=$2 AND lease_until>now()",
      [job.id, job.attempts],
    ))
  )
    fail("GITHUB_COMMENT_LEASE_EXPIRED", "The comment attempt expired", 409);
}
