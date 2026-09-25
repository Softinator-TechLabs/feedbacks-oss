import type { Actor } from "../shared/contracts.js";
import type { Database } from "./db.js";
import type { Config } from "./config.js";
import { GithubApp, githubRepo } from "./github-app.js";
import { event } from "./access.js";
import { saveThread } from "./feedback.js";

const syncActor: Actor = {
  id: "00000000-0000-0000-0000-000000000000",
  userId: "00000000-0000-0000-0000-000000000000",
  kind: "agent",
  name: "GitHub status sync",
  owner: true,
  canResolve: true,
};

type GithubState = "open" | "closed";
const desiredGithubState = (state: string): GithubState | null =>
  state === "declined" ? null : state === "resolved" ? "closed" : "open";

export async function pollGithubStatusSync(
  db: Database,
  config: Config,
  client: GithubApp = new GithubApp(config),
) {
  if (!config.githubAppId || !config.githubAppPrivateKey || !config.githubAppSlug) return;
  const rows = await db.query(`SELECT t.id FROM threads t
    JOIN projects p ON p.id=t.project_id
    LEFT JOIN github_status_sync s ON s.thread_id=t.id
    WHERE p.data->>'githubConnected'='true' AND p.data->>'githubStatusSync'='true'
      AND (SELECT count(*) FROM jsonb_array_elements(coalesce(t.data->'externalIssues','[]'::jsonb)) e
        WHERE e->>'verification'='github_verified' AND lower(e->>'repository')=lower(trim(trailing '/' from substring(p.data->>'repositoryUrl' from '^https://github.com/(.*)$'))))=1
      AND (s.thread_id IS NULL OR (s.status IN ('ready','error') AND s.next_at<=now() AND (s.lease_until IS NULL OR s.lease_until<now())))
    ORDER BY s.next_at NULLS FIRST,t.id LIMIT 10`);
  for (const candidate of rows) {
    const claimed = await db.transaction(async (tx) => {
      const row = await tx.one(
        "SELECT t.*,p.data AS project FROM threads t JOIN projects p ON p.id=t.project_id WHERE t.id=$1 FOR UPDATE OF t",
        [candidate.id],
      );
      if (!row?.project.githubConnected || !row.project.githubStatusSync) return null;
      const repo = githubRepo(row.project.repositoryUrl);
      const links = (row.data.externalIssues ?? []).filter(
        (link: any) =>
          link.verification === "github_verified" &&
          link.repository?.toLowerCase() === repo.fullName.toLowerCase(),
      );
      if (links.length !== 1) return null;
      const link = links[0];
      await tx.query(
        `INSERT INTO github_status_sync(thread_id,issue_url) VALUES($1,$2)
        ON CONFLICT(thread_id) DO NOTHING`,
        [row.id, link.url],
      );
      const sync = await tx.one(
        `UPDATE github_status_sync SET lease_until=now()+interval '2 minutes'
        WHERE thread_id=$1 AND issue_url=$2 AND status IN ('ready','error')
          AND next_at<=now() AND (lease_until IS NULL OR lease_until<now()) RETURNING *`,
        [row.id, link.url],
      );
      return sync ? { row, repo, link, sync } : null;
    });
    if (!claimed) continue;
    const { repo, link } = claimed;
    try {
      const issue = await client.readIssue(repo, link.number);
      if (issue.url !== link.url) throw new Error("GITHUB_ISSUE_INVALID");
      const fresh = await db.one(
        `SELECT t.*,p.data AS project,s.feedbacks_state,s.github_state,s.status AS sync_status,s.issue_url AS sync_issue_url
        FROM threads t JOIN projects p ON p.id=t.project_id
        JOIN github_status_sync s ON s.thread_id=t.id WHERE t.id=$1`,
        [claimed.row.id],
      );
      if (
        !fresh?.project.githubConnected ||
        !fresh.project.githubStatusSync ||
        fresh.sync_issue_url !== link.url ||
        (fresh.sync_status !== "ready" && fresh.sync_status !== "error") ||
        githubRepo(fresh.project.repositoryUrl).fullName.toLowerCase() !==
          repo.fullName.toLowerCase()
      )
        continue;
      const row = fresh;
      const sync = fresh;
      const local = desiredGithubState(row.data.work.state);
      const baseline = sync.github_state as GithubState | null;
      const localBaseline = desiredGithubState(sync.feedbacks_state);
      if (
        !local ||
        (baseline && localBaseline && issue.state !== baseline && local !== localBaseline)
      ) {
        await setOutcome(db, row.id, "conflict", null, null);
        continue;
      }
      if (!baseline) {
        if (local !== issue.state) {
          await setOutcome(db, row.id, "conflict", null, null);
          continue;
        }
        await applyOutcome(db, row.id, issue.state, null, issue.url, row.revision);
        continue;
      }
      if (issue.state !== baseline && local === localBaseline) {
        await applyOutcome(db, row.id, issue.state, "github", issue.url, row.revision);
        continue;
      }
      if (local !== localBaseline && issue.state === baseline) {
        const reserved = await db.transaction(async (tx) => {
          const result = await tx.one(
            `UPDATE github_status_sync SET status='uncertain',pending_target=$2,
          error_code=NULL,lease_until=NULL,updated_at=now()
          WHERE thread_id=$1 AND issue_url=$5 AND status IN ('ready','error') AND
          EXISTS(SELECT 1 FROM threads t JOIN projects p ON p.id=t.project_id
            WHERE t.id=$1 AND t.revision=$3 AND p.data->>'githubConnected'='true'
              AND p.data->>'githubStatusSync'='true' AND p.data->>'repositoryUrl'=$4)
          RETURNING thread_id`,
            [row.id, local, row.revision, row.project.repositoryUrl, issue.url],
          );
          if (result)
            await event(
              tx,
              syncActor,
              row.project_id,
              row.id,
              "github.statusSync.uncertain",
              {
                issueUrl: issue.url,
                pendingTarget: local,
              },
            );
          return result;
        });
        if (!reserved) continue;
        try {
          await client.setIssueState(repo, link.number, local);
        } catch {
          // A PATCH can succeed despite a timeout. A maintainer reconciles it.
          continue;
        }
        await applyOutcome(db, row.id, local, "feedbacks", issue.url, row.revision);
        continue;
      }
      await applyOutcome(db, row.id, issue.state, null, issue.url, row.revision);
    } catch (error) {
      const code =
        typeof error === "object" && error && "code" in error
          ? String(error.code)
          : "GITHUB_UNAVAILABLE";
      const current = await db.one(
        "SELECT status FROM github_status_sync WHERE thread_id=$1",
        [claimed.row.id],
      );
      if (current?.status !== "uncertain")
        await setOutcome(db, claimed.row.id, "error", null, code);
    }
  }
}

async function setOutcome(
  db: Database,
  threadId: string,
  status: "conflict" | "uncertain" | "error",
  pendingTarget: GithubState | null,
  errorCode: string | null,
) {
  await db.transaction((tx) =>
    updateOutcome(tx, threadId, status, pendingTarget, errorCode),
  );
}

async function updateOutcome(
  tx: Database,
  threadId: string,
  status: "conflict" | "uncertain" | "error",
  pendingTarget: GithubState | null,
  errorCode: string | null,
) {
  const prior = await tx.one(
    `SELECT s.*,t.project_id FROM github_status_sync s
      JOIN threads t ON t.id=s.thread_id WHERE s.thread_id=$1 FOR UPDATE OF s`,
    [threadId],
  );
  if (!prior) return;
  await tx.query(
    `UPDATE github_status_sync SET status=$2,pending_target=$3,error_code=$4,
      next_at=now()+interval '5 minutes',lease_until=NULL,updated_at=now() WHERE thread_id=$1`,
    [threadId, status, pendingTarget, errorCode],
  );
  if (
    prior.status !== status ||
    prior.error_code !== errorCode ||
    prior.pending_target !== pendingTarget
  )
    await event(
      tx,
      syncActor,
      prior.project_id,
      threadId,
      `github.statusSync.${status}`,
      {
        issueUrl: prior.issue_url,
        errorCode,
        pendingTarget,
      },
    );
}

async function applyOutcome(
  db: Database,
  threadId: string,
  githubState: GithubState,
  source: "github" | "feedbacks" | null,
  issueUrl: string,
  expectedRevision: number,
) {
  await db.transaction(async (tx) => {
    const row = await tx.one(
      "SELECT t.*,p.data AS project FROM threads t JOIN projects p ON p.id=t.project_id WHERE t.id=$1 FOR UPDATE OF t",
      [threadId],
    );
    const sync = await tx.one(
      "SELECT * FROM github_status_sync WHERE thread_id=$1 FOR UPDATE",
      [threadId],
    );
    if (
      !row?.project.githubConnected ||
      !row.project.githubStatusSync ||
      !sync ||
      sync.issue_url !== issueUrl
    )
      return;
    if (row.revision !== expectedRevision) {
      await updateOutcome(
        tx,
        threadId,
        source === "feedbacks" ? "uncertain" : "conflict",
        githubState,
        null,
      );
      return;
    }
    if (
      sync.status !== (source === "feedbacks" ? "uncertain" : "ready") &&
      sync.status !== (source === "feedbacks" ? "uncertain" : "error")
    )
      return;
    const link = row.data.externalIssues?.find(
      (item: any) => item.url === issueUrl && item.verification === "github_verified",
    );
    if (
      !link ||
      link.repository.toLowerCase() !==
        githubRepo(row.project.repositoryUrl).fullName.toLowerCase()
    )
      return;
    const current = desiredGithubState(row.data.work.state);
    if (!current) {
      await updateOutcome(tx, threadId, "conflict", null, null);
      return;
    }
    if (source === "feedbacks" && current !== githubState) {
      await updateOutcome(tx, threadId, "conflict", null, null);
      return;
    }
    const next =
      source === "github"
        ? githubState === "closed"
          ? "resolved"
          : row.data.work.state === "resolved"
            ? "open"
            : row.data.work.state
        : row.data.work.state;
    if (next !== row.data.work.state || link.state !== githubState) {
      if (next !== row.data.work.state) {
        row.data.work.state = next;
        row.data.work.history.push({
          state: next,
          note: `Synced from GitHub Issue ${issueUrl}`,
          actor: {
            id: syncActor.id,
            userId: syncActor.userId,
            kind: syncActor.kind,
            name: syncActor.name,
          },
          at: new Date().toISOString(),
          duplicateOf: row.data.work.duplicateOf ?? null,
        });
      }
      link.state = githubState;
      link.checkedAt = new Date().toISOString();
      link.statusSyncedAt = link.checkedAt;
      link.statusSyncSource = source ?? "baseline";
      await saveThread(tx, syncActor, row, "github.statusSync");
      await event(tx, syncActor, row.project_id, row.id, "github.statusSynchronized", {
        issueUrl,
        source: source ?? "baseline",
        githubState,
        workState: next,
      });
    }
    await tx.query(
      `UPDATE github_status_sync SET feedbacks_state=$2,github_state=$3,status='ready',
      pending_target=NULL,error_code=NULL,next_at=now()+interval '5 minutes',lease_until=NULL,updated_at=now()
      WHERE thread_id=$1`,
      [threadId, next, githubState],
    );
  });
}
