import { randomUUID } from "node:crypto";
import type { Database } from "./db.js";
import type { Actor } from "../shared/contracts.js";
import { access, canReadPolicy, event } from "./access.js";
import { hash, publicActor } from "./auth.js";
import { fail } from "./errors.js";
import { normalizeUrl, viewContext, viewStats } from "./views.js";
import { reviewerContext } from "./accounts.js";
import { threadQuery } from "./review-views.js";
import { discussionLikes, setDiscussionLike } from "./discussion-likes.js";
// Legacy human messages had no reliable intent. Treat them as requests on read;
// preserve agent responses and explicit intent without rewriting work history.
export function discussionResponse(author: any, createdAt: string, replies: any[]) {
  const response: any = {
    state: "unanswered",
    lastHumanRequest: { actor: author, at: createdAt },
    lastResponse: null,
  };
  for (const reply of replies) {
    const intent =
      reply.intent ?? (reply.author.kind === "agent" ? "response" : "request");
    if (intent === "request") {
      response.lastHumanRequest = { actor: reply.author, at: reply.createdAt };
      response.state = response.lastResponse ? "needs-follow-up" : "unanswered";
    } else {
      response.lastResponse = { actor: reply.author, at: reply.createdAt };
      response.state = "responded";
    }
  }
  return response;
}
export async function threadRow(
  db: Database,
  a: Actor,
  id: string,
  mode: "read" | "write" | "maintain" | "resolve" = "read",
  lock = false,
) {
  const row = await db.one(
    `SELECT * FROM threads WHERE id=$1${lock ? " FOR UPDATE" : ""}`,
    [id],
  );
  if (!row) fail("NOT_FOUND", "Feedback not found", 404);
  await access(db, a, row.project_id, mode);
  return row;
}
export async function fullThread(db: Database, a: Actor, row: any) {
  const likes = await discussionLikes(db, a, row.id);
  const data = structuredClone(row.data),
    replies = await db.query(
      "SELECT id,data,created_at FROM replies WHERE thread_id=$1 ORDER BY created_at,id",
      [row.id],
    );
  const assets = await db.query(
    "SELECT id,data FROM assets WHERE thread_id=$1 AND status='validated' ORDER BY data->>'createdAt',id",
    [row.id],
  );
  data.response = discussionResponse(
    data.author,
    new Date(row.created_at).toISOString(),
    replies.map((r) => ({
      ...r.data,
      createdAt: new Date(r.created_at).toISOString(),
    })),
  );
  if (!canReadPolicy(a)) delete data.importance;
  else {
    data.reviewerContext = await reviewerContext(db, a, row.project_id, [
      data.author.userId,
      ...replies.map((r) => r.data.author.userId),
    ]);
    const u = await db.one(
      "SELECT u.policy,u.policy_version,g.policy AS override FROM users u LEFT JOIN grants g ON g.user_id=u.id AND g.project_id=$1 WHERE u.id=$2",
      [row.project_id, data.author.userId],
    );
    data.importance = {
      ...data.importance,
      current: u
        ? { policy: u.override ?? u.policy, policyVersion: u.policy_version }
        : null,
    };
  }
  return {
    ...data,
    review: data.review ?? { round: 1, state: "open", history: [] },
    tags: data.tags ?? [],
    id: row.id,
    projectId: row.project_id,
    revision: row.revision,
    likes: likes.get(row.id) ?? { uniqueLikes: 0, liked: false },
    replies: replies.map((r) => ({
      id: r.id,
      ...r.data,
      likes: likes.get(r.id) ?? { uniqueLikes: 0, liked: false },
      createdAt: new Date(r.created_at).toISOString(),
    })),
    assets: assets.map((r) => ({
      id: r.id,
      ...r.data,
      url: `/api/assets/${r.id}`,
    })),
    pins: {
      defaultVisible:
        !data.archived && !["resolved", "declined"].includes(data.work.state),
    },
    view: await viewStats(db, a, row.project_id, data.context.fingerprint),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}
export async function saveThread(db: Database, a: Actor, row: any, kind: string) {
  row.data.lastActor = publicActor(a);
  row.data.lastActivityAt = new Date().toISOString();
  const saved = await db.one(
    "UPDATE threads SET data=$1,revision=revision+1,updated_at=now() WHERE id=$2 AND revision=$3 RETURNING *",
    [JSON.stringify(row.data), row.id, row.revision],
  );
  if (!saved) fail("CONFLICT", "Feedback changed; reload before retrying", 409);
  await event(db, a, row.project_id, row.id, kind, {
    revision: saved.revision,
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
export async function feedback(db: Database, a: Actor, op: string, i: any): Promise<any> {
  if (op === "threads.get") return fullThread(db, a, await threadRow(db, a, i.threadId));
  if (op === "threads.neighbors") {
    const row = await threadRow(db, a, i.threadId);
    const { filter, args, order } = threadQuery(row.project_id, i);
    args.push(row.id);
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
    const { filter, args, order } = threadQuery(i.projectId, i);
    const count = await db.one(
      `SELECT count(*)::integer AS total FROM threads WHERE ${filter}`,
      args,
    );
    args.push(i.limit, i.offset);
    const rows = await db.query(
      `SELECT * FROM threads WHERE ${filter} ORDER BY ${order} LIMIT $${args.length - 1} OFFSET $${args.length}`,
      args,
    );
    const websiteRows = await db.query(
      "SELECT DISTINCT data->'context'->>'domain' AS domain,data->'context'->>'hostname' AS hostname FROM threads WHERE project_id=$1 AND COALESCE((data->>'archived')::boolean,false)=false",
      [i.projectId],
    );
    return {
      items: await Promise.all(rows.map((r) => fullThread(db, a, r))),
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
    const u = await db.one(
      "SELECT u.policy,u.policy_version,g.policy AS override FROM users u LEFT JOIN grants g ON g.user_id=u.id AND g.project_id=$1 WHERE u.id=$2",
      [i.projectId, a.userId],
    );
    const actor = publicActor(a),
      now = new Date().toISOString(),
      id = randomUUID();
    const data = {
      body: i.body,
      category: i.category,
      tags: i.tags,
      ...(i.diagnostics ? { diagnostics: i.diagnostics } : {}),
      context: viewContext(i.context, p),
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
  const row = await threadRow(db, a, i.threadId, "write", true),
    data = row.data;
  if (op === "threads.like") return setDiscussionLike(db, a, row, i);
  const prior = await retry(db, a, op, i);
  if (prior) return fullThread(db, a, row);
  checkRevision(row, i.revision);
  const actor = publicActor(a),
    at = new Date().toISOString();
  if (op === "threads.organize") {
    data.category = i.category;
    data.tags = i.tags;
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
    const u = new URL(i.url),
      match = u.pathname.match(/^\/([^/]+)\/([^/]+)\/issues\/([1-9]\d*)\/?$/);
    if (
      u.origin !== "https://github.com" ||
      u.username ||
      u.password ||
      u.search ||
      u.hash ||
      !match
    )
      fail("VALIDATION", "Expected https://github.com/OWNER/REPO/issues/NUMBER");
    const url = `https://github.com/${match[1]}/${match[2]}/issues/${match[3]}`;
    if (!data.externalIssues.some((link: any) => link.url === url))
      data.externalIssues.push({
        url,
        repository: `${match[1]}/${match[2]}`,
        number: Number(match[3]),
        verification: "reported",
        linkedBy: actor,
        linkedAt: at,
        reportedCreatedAt: i.createdAt ?? null,
      });
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
  const saved = await saveThread(db, a, row, op);
  await remember(db, a, op, i, row.id);
  return fullThread(db, a, saved);
}
