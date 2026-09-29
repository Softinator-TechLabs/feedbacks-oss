import { randomUUID } from "node:crypto";
import type { Database } from "./db.js";
import type { Actor } from "../shared/contracts.js";
import { access, canReadPolicy, event } from "./access.js";
import { hash, publicActor } from "./auth.js";
import { fail } from "./errors.js";
import { normalizeUrl, viewContext } from "./views.js";
import { priorityScore, threadQuery } from "./review-views.js";
import { setDiscussionLike } from "./discussion-likes.js";
import { issueDraft } from "./issue-draft.js";
import { requireConnectedGithubRepo } from "./github-repositories.js";
import { reportedIssue } from "./issue-links.js";
import { documentRow } from "./documents.js";
import { assertProjectCategory } from "./projects.js";
import { figmaReferenceUrl } from "./figma-reference.js";
import {
  annotationSummary,
  setAnnotationPlan,
  setAnnotationStatus,
} from "./annotation-status.js";
import type { Config } from "./config.js";
import { fullThread, listData, threadRow } from "./thread-read-model.js";
export { discussionResponse, fullThread, threadRow } from "./thread-read-model.js";

export async function saveThread(
  db: Database,
  a: Actor,
  row: any,
  kind: string,
  eventData: Record<string, unknown> = {},
) {
  row.data.lastActor = publicActor(a);
  row.data.lastActivityAt = new Date().toISOString();
  const saved = await db.one(
    "UPDATE threads SET data=$1,revision=revision+1,updated_at=now() WHERE id=$2 AND revision=$3 RETURNING *",
    [JSON.stringify(row.data), row.id, row.revision],
  );
  if (!saved) fail("CONFLICT", "Feedback changed; reload before retrying", 409);
  await event(db, a, row.project_id, row.id, kind, {
    revision: saved.revision,
    ...eventData,
  });
  return saved;
}
export function checkRevision(row: any, revision: number) {
  if (row.revision !== revision)
    fail("CONFLICT", "Feedback changed; reload before retrying", 409);
}
export async function retry(db: Database, a: Actor, op: string, i: any) {
  if (!i.idempotencyKey) return null;
  const item = await db.one(
    "SELECT * FROM idempotency WHERE actor_id=$1 AND operation=$2 AND key=$3",
    [a.id, op, i.idempotencyKey],
  );
  if (!item) return null;
  // In-flight drafts made before optional tags existed retain their retry identity.
  const legacy = { ...i };
  if (op === "threads.create" && !i.tags?.length && !i.diagnostics) delete legacy.tags;
  if (
    item.input_hash !== hash(JSON.stringify(i)) &&
    item.input_hash !== hash(JSON.stringify(legacy))
  )
    fail("IDEMPOTENCY_CONFLICT", "Retry key was used with different content", 409);
  return item.entity_id;
}
export async function remember(db: Database, a: Actor, op: string, i: any, id: string) {
  if (i.idempotencyKey)
    await db.query(
      "INSERT INTO idempotency(actor_id,operation,key,input_hash,entity_id) VALUES($1,$2,$3,$4,$5)",
      [a.id, op, i.idempotencyKey, hash(JSON.stringify(i)), id],
    );
}
export async function feedback(
  db: Database,
  a: Actor,
  op: string,
  i: any,
  config?: Config,
): Promise<any> {
  if (op === "threads.get") return fullThread(db, a, await threadRow(db, a, i.threadId));
  if (op === "threads.issueDraft") {
    const thread = await fullThread(db, a, await threadRow(db, a, i.threadId));
    const project = await access(db, a, thread.projectId);
    const repo = project.githubConnected
      ? requireConnectedGithubRepo(project, i.repositoryUrl)
      : null;
    if (i.repositoryUrl && !repo)
      fail(
        "GITHUB_NOT_CONNECTED",
        "This repository is not connected to the project",
        409,
      );
    return issueDraft(
      thread,
      repo ? `https://github.com/${repo.fullName}` : project.repositoryUrl,
    );
  }
  if (op === "threads.neighbors") {
    const row = await threadRow(db, a, i.threadId);
    if (i.sort === "priority" && !canReadPolicy(a))
      fail("FORBIDDEN", "Priority order requires approved policy access", 403);
    const { filter, args, order, orderArgs } = threadQuery(row.project_id, i);
    args.push(...orderArgs, row.id);
    const result = await db.one(
      `WITH ordered AS (
      SELECT id, lag(id) OVER (ORDER BY ${order}) AS previous,
      lead(id) OVER (ORDER BY ${order}) AS next,
      row_number() OVER (ORDER BY ${order})::integer AS position
      FROM threads WHERE ${filter}
    ) SELECT previous,next,position,(SELECT count(*)::integer FROM ordered) AS total
      FROM (SELECT 1) seed LEFT JOIN ordered ON ordered.id=$${args.length}`,
      args,
    );
    return result;
  }
  if (op === "threads.list") {
    await access(db, a, i.projectId);
    if (i.sort === "priority" && !canReadPolicy(a))
      fail("FORBIDDEN", "Priority order requires approved policy access", 403);
    const { filter, args, order, orderArgs } = threadQuery(i.projectId, i);
    const count = await db.one(
      `SELECT count(*)::integer AS total FROM threads WHERE ${filter}`,
      args,
    );
    args.push(...orderArgs, i.limit, i.offset);
    const rows = await db.query(
      `SELECT threads.*${i.sort === "priority" ? `,${priorityScore} AS priority_score` : ""} FROM threads WHERE ${filter} ORDER BY ${order} LIMIT $${args.length - 1} OFFSET $${args.length}`,
      args,
    );
    const websiteRows = await db.query(
      "SELECT DISTINCT data->'context'->>'domain' AS domain,data->'context'->>'hostname' AS hostname FROM threads WHERE project_id=$1 AND data->'context'->'document' IS NULL AND COALESCE((data->>'archived')::boolean,false)=$2",
      [i.projectId, i.archived === true],
    );
    const data = rows.length ? await listData(db, a, rows) : undefined;
    return {
      ...(i.includeSummary
        ? { summary: await annotationSummary(db, i.projectId, i) }
        : {}),
      items: data
        ? await Promise.all(
            rows.map(async (r) => ({
              ...(await fullThread(db, a, r, data)),
              ...(i.sort === "priority" ? { priorityScore: r.priority_score } : {}),
            })),
          )
        : [],
      total: count.total,
      nextOffset: i.offset + rows.length < count.total ? i.offset + rows.length : null,
      websiteFilters: {
        domains: [
          ...new Set(websiteRows.map((row) => row.domain).filter(Boolean)),
        ].sort(),
        hostnames: [
          ...new Set(websiteRows.map((row) => row.hostname).filter(Boolean)),
        ].sort(),
      },
    };
  }
  if (op === "threads.create") {
    const p = await access(db, a, i.projectId, "write");
    await db.query("SELECT id FROM projects WHERE id=$1 FOR UPDATE", [i.projectId]);
    const prior = await retry(db, a, op, i);
    if (prior) return fullThread(db, a, await threadRow(db, a, prior));
    assertProjectCategory(p, i.category);
    const u = await db.one(
      "SELECT u.policy,u.policy_version,g.policy AS override FROM users u LEFT JOIN grants g ON g.user_id=u.id AND g.project_id=$1 WHERE u.id=$2",
      [i.projectId, a.userId],
    );
    const actor = publicActor(a),
      now = new Date().toISOString(),
      id = randomUUID();
    let context;
    if (i.document) {
      if (!config) fail("VALIDATION", "Document context is unavailable");
      const document = await documentRow(db, a, i.document.documentId);
      if (document.project_id !== i.projectId)
        fail("FORBIDDEN", "Document belongs to another project", 403);
      if (i.document.page > document.data.pageCount)
        fail("VALIDATION", "Page is outside this document");
      const pageSize = document.data.pages?.[i.document.page - 1] ?? document.data;
      context = viewContext(
        {
          url: `${config.appOrigin}/projects/${i.projectId}/documents/${document.id}?page=${i.document.page}`,
          title: document.data.name,
          viewport: {
            width: Math.max(100, pageSize.width ?? 100),
            height: Math.max(100, pageSize.height ?? 100),
          },
          anchor: {
            confidence: "coordinate-only",
            screenshotPoint: { x: i.document.x, y: i.document.y },
          },
          document: {
            id: document.id,
            name: document.data.name,
            kind: document.data.kind,
            page: i.document.page,
            x: i.document.x,
            y: i.document.y,
          },
        },
        { ...p, captureMode: "any" },
      );
    } else context = viewContext(i.context, p);
    const data = {
      body: i.body,
      category: i.category,
      tags: i.tags,
      ...(i.diagnostics ? { diagnostics: i.diagnostics } : {}),
      context,
      author: actor,
      lastActor: actor,
      archived: false,
      response: {
        state: "unanswered",
        lastHumanRequest: { actor, at: now },
        lastResponse: null,
      },
      work: { state: "open", history: [] },
      review: { round: 1, state: "open", history: [] },
      externalIssues: [],
      figmaReference: null,
      fixEvidence: [],
      importance: {
        feedbackTime: {
          policy: u.override ?? u.policy,
          policyVersion: u.policy_version,
        },
      },
      trust: "untrusted_discussion",
    };
    const row = await db.one(
      "INSERT INTO threads(id,project_id,data) VALUES($1,$2,$3) RETURNING *",
      [id, i.projectId, JSON.stringify(data)],
    );
    await remember(db, a, op, i, id);
    await event(db, a, i.projectId, id, "thread.created", { revision: 1 });
    return fullThread(db, a, row);
  }
  const row = await threadRow(
      db,
      a,
      i.threadId,
      ["threads.figmaReference", "threads.priority"].includes(op) ? "maintain" : "write",
      true,
    ),
    data = row.data;
  if (op === "threads.like") return setDiscussionLike(db, a, row, i);
  const prior = await retry(db, a, op, i);
  if (prior) return fullThread(db, a, row);
  checkRevision(row, i.revision);
  const actor = publicActor(a),
    at = new Date().toISOString();
  if (op === "threads.annotationStatus") {
    await setAnnotationStatus(db, a, row, i);
  } else if (op === "threads.annotationPlan") {
    await setAnnotationPlan(db, a, row, i);
  } else if (op === "threads.organize") {
    assertProjectCategory(await access(db, a, row.project_id), i.category, data.category);
    data.category = i.category;
    data.tags = i.tags;
  } else if (op === "threads.plan") {
    data.workPlan = i.workPlan;
  } else if (op === "threads.priority") {
    data.topPriority = i.topPriority;
  } else if (op === "threads.reply") {
    data.response = (await fullThread(db, a, row)).response;
    for (const userId of i.mentions) {
      const member = await db.one(
        "SELECT u.id FROM users u LEFT JOIN grants g ON g.user_id=u.id AND g.project_id=$1 WHERE u.id=$2 AND u.active=true AND (u.owner=true OR g.user_id IS NOT NULL)",
        [row.project_id, userId],
      );
      if (!member)
        fail("FORBIDDEN", "Mention must reference an active project member", 403);
    }
    const intent = i.intent ?? (a.kind === "agent" ? "response" : "request");
    if (a.kind === "agent" && intent === "request")
      fail("VALIDATION", "Only a human participant can create a human request");
    await db.query("INSERT INTO replies(id,thread_id,data) VALUES($1,$2,$3)", [
      randomUUID(),
      row.id,
      JSON.stringify({
        body: i.body,
        intent,
        author: actor,
        mentions: i.mentions,
        trust: "untrusted_discussion",
      }),
    ]);
    if (intent === "request") {
      data.response.state = data.response.lastResponse ? "needs-follow-up" : "unanswered";
      data.response.lastHumanRequest = { actor, at };
    } else {
      data.response.state = "responded";
      data.response.lastResponse = { actor, at };
    }
  } else if (op === "threads.status") {
    await access(
      db,
      a,
      row.project_id,
      ["resolved", "declined"].includes(i.state) ? "resolve" : "write",
    );
    if (i.duplicateOf) {
      if (i.duplicateOf === row.id)
        fail("VALIDATION", "A thread cannot duplicate itself");
      const other = await threadRow(db, a, i.duplicateOf);
      if (other.project_id !== row.project_id)
        fail("VALIDATION", "Duplicate must belong to this project");
    }
    data.work.state = i.state;
    data.work.note = i.note ?? null;
    data.work.duplicateOf = i.duplicateOf ?? null;
    data.work.history.push({
      state: i.state,
      note: i.note ?? null,
      actor,
      at,
      duplicateOf: i.duplicateOf ?? null,
    });
  } else if (op === "threads.review") {
    if (a.kind !== "human")
      fail("FORBIDDEN", "A signed-in human reviewer must record a review decision", 403);
    const project = await access(db, a, row.project_id);
    if (!project.reviewEnabled)
      fail("FORBIDDEN", "Review decisions are turned off for this project", 403);
    const review = data.review ?? { round: 1, state: "open", history: [] };
    if (i.decision === "reopen") {
      if (review.state === "open") fail("VALIDATION", "Review round is already open");
      review.round += 1;
      review.state = "open";
    } else {
      if (review.state !== "open")
        fail("VALIDATION", "Reopen the review round before a new decision");
      review.state = i.decision;
    }
    review.history.push({
      round: review.round,
      decision: i.decision,
      note: i.note,
      actor,
      at,
    });
    data.review = review;
  } else if (op === "threads.linkIssue") {
    const issue = reportedIssue(i.url);
    if (
      !data.externalIssues.some(
        (link: any) =>
          link.url === issue.url ||
          (issue.provider === "linear" &&
            link.provider === "linear" &&
            link.workspace === issue.workspace &&
            link.issueKey === issue.issueKey),
      )
    )
      data.externalIssues.push({
        ...issue,
        verification: "reported",
        linkedBy: actor,
        linkedAt: at,
        reportedCreatedAt: i.createdAt ?? null,
      });
  } else if (op === "threads.figmaReference") {
    if (a.kind !== "human")
      fail("FORBIDDEN", "A signed-in project maintainer must link Figma", 403);
    data.figmaReference = i.url
      ? { url: figmaReferenceUrl(i.url), linkedBy: actor, linkedAt: at }
      : null;
  } else if (op === "threads.evidence") {
    data.fixEvidence.push({
      url: normalizeUrl(i.url),
      note: i.note,
      kind: i.kind,
      actor,
      at,
      verification: "reported",
    });
  } else if (op === "threads.archive") {
    await access(db, a, row.project_id, "maintain");
    data.archived = i.archived;
  } else fail("NOT_FOUND", "Unknown thread operation", 404);
  const saved = await saveThread(
    db,
    a,
    row,
    op,
    op === "threads.plan"
      ? { workPlan: i.workPlan }
      : op === "threads.annotationPlan"
        ? { annotationId: i.annotationId, workPlan: i.workPlan }
        : op === "threads.priority"
          ? { topPriority: i.topPriority }
          : op === "threads.annotationStatus"
            ? { annotationId: i.annotationId, state: i.state }
            : {},
  );
  await remember(db, a, op, i, row.id);
  return fullThread(db, a, saved);
}
