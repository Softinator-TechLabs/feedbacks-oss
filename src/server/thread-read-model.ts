import type { Database } from "./db.js";
import type { Actor } from "../shared/contracts.js";
import { access, canReadPolicy } from "./access.js";
import { fail } from "./errors.js";
import { reviewerContext } from "./accounts.js";
import { discussionLikes } from "./discussion-likes.js";
import { viewStats } from "./views.js";
import { diagnosticSummary } from "./diagnostic-summary.js";

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
type ListData = {
  likes: Map<string, Map<string, { uniqueLikes: number; liked: boolean }>>;
  replies: Map<string, any[]>;
  assets: Map<string, any[]>;
  diagnostics: Map<
    string,
    { count: number; latest: ReturnType<typeof diagnosticSummary>[] }
  >;
  views: Map<string, any>;
  reviewers?: { trust: "owner_approved_advisory_reviewer_context"; items: any[] };
  policies?: Map<string, any>;
};
function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const id = key(row);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id)!.push(row);
  }
  return groups;
}
export async function listData(db: Database, a: Actor, rows: any[]): Promise<ListData> {
  const ids = rows.map((row) => row.id);
  const fingerprints = [...new Set(rows.map((row) => row.data.context.fingerprint))];
  const [replyRows, assetRows, likeRows, viewRows, countRows, diagnosticRows] =
    await Promise.all([
      db.query(
        "SELECT id,thread_id,data,created_at FROM replies WHERE thread_id=ANY($1::uuid[]) ORDER BY created_at,id",
        [ids],
      ),
      db.query(
        "SELECT id,thread_id,data FROM assets WHERE thread_id=ANY($1::uuid[]) AND status='validated' ORDER BY data->>'createdAt',data->>'filename',id",
        [ids],
      ),
      db.query(
        'SELECT thread_id,COALESCE(reply_id,thread_id) AS id,count(*)::integer AS "uniqueLikes",bool_or(user_id=$2) AS liked FROM discussion_likes WHERE thread_id=ANY($1::uuid[]) GROUP BY thread_id,COALESCE(reply_id,thread_id)',
        [ids, a.userId],
      ),
      db.query(
        "SELECT fingerprint,count(*)::integer AS count,bool_or(user_id=$3) AS liked FROM view_likes WHERE project_id=$1 AND fingerprint=ANY($2::text[]) GROUP BY fingerprint",
        [rows[0].project_id, fingerprints, a.userId],
      ),
      db.query(
        "SELECT t.data->'context'->>'fingerprint' AS fingerprint,count(DISTINCT t.id)::integer AS threads,count(r.id)::integer AS replies FROM threads t LEFT JOIN replies r ON r.thread_id=t.id WHERE t.project_id=$1 AND t.data->'context'->>'fingerprint'=ANY($2::text[]) GROUP BY fingerprint",
        [rows[0].project_id, fingerprints],
      ),
      db.query(
        `SELECT id,project_id,thread_id,status,summary,started_at,created_at,total
       FROM (SELECT id,project_id,thread_id,status,summary,started_at,created_at,
         count(*) OVER(PARTITION BY thread_id)::integer AS total,
         row_number() OVER(PARTITION BY thread_id ORDER BY created_at DESC,id DESC) AS rank
         FROM diagnostic_evidence WHERE thread_id=ANY($1::uuid[])) ranked WHERE rank<=3`,
        [ids],
      ),
    ]);
  const diagnostics = new Map<
    string,
    { count: number; latest: ReturnType<typeof diagnosticSummary>[] }
  >();
  for (const item of diagnosticRows) {
    const group = diagnostics.get(item.thread_id) ?? {
      count: Number(item.total),
      latest: [],
    };
    group.latest.push(diagnosticSummary(item));
    diagnostics.set(item.thread_id, group);
  }
  const likes = new Map<string, Map<string, { uniqueLikes: number; liked: boolean }>>();
  for (const row of likeRows) {
    if (!likes.has(row.thread_id)) likes.set(row.thread_id, new Map());
    likes.get(row.thread_id)!.set(row.id, {
      uniqueLikes: row.uniqueLikes,
      liked: a.kind === "human" && !!row.liked,
    });
  }
  const views = new Map<string, any>();
  const counts = new Map(countRows.map((row) => [row.fingerprint, row]));
  const votes = new Map(viewRows.map((row) => [row.fingerprint, row]));
  let reviewers: ListData["reviewers"];
  let policies: ListData["policies"];
  let weights = new Map<string, number>();
  if (canReadPolicy(a)) {
    reviewers = await reviewerContext(db, a, rows[0].project_id);
    const authorIds = [...new Set(rows.map((row) => row.data.author.userId))];
    policies = new Map(
      (
        await db.query(
          "SELECT u.id,u.policy,u.policy_version,g.policy AS override FROM users u LEFT JOIN grants g ON g.user_id=u.id AND g.project_id=$1 WHERE u.id=ANY($2::uuid[])",
          [rows[0].project_id, authorIds],
        )
      ).map((row) => [row.id, row]),
    );
    const weightedRows = await db.query(
      "SELECT v.fingerprint,u.policy,g.policy AS override FROM view_likes v JOIN users u ON u.id=v.user_id LEFT JOIN grants g ON g.user_id=u.id AND g.project_id=v.project_id WHERE v.project_id=$1 AND v.fingerprint=ANY($2::text[])",
      [rows[0].project_id, fingerprints],
    );
    weights = new Map();
    for (const row of weightedRows)
      weights.set(
        row.fingerprint,
        (weights.get(row.fingerprint) ?? 0) +
          (row.override?.general ?? row.policy.general ?? 1),
      );
  }
  for (const fingerprint of fingerprints) {
    const vote = votes.get(fingerprint),
      count = counts.get(fingerprint);
    views.set(fingerprint, {
      fingerprint,
      uniqueLikes: vote?.count ?? 0,
      liked: !!vote?.liked,
      discussionCount: (count?.threads ?? 0) + (count?.replies ?? 0),
      ...(canReadPolicy(a) ? { weightedPreference: weights.get(fingerprint) ?? 0 } : {}),
    });
  }
  return {
    likes,
    replies: groupBy(replyRows, (row) => row.thread_id),
    assets: groupBy(assetRows, (row) => row.thread_id),
    diagnostics,
    views,
    reviewers,
    policies,
  };
}
export async function fullThread(db: Database, a: Actor, row: any, list?: ListData) {
  // Queue pages bulk-load bounded summaries; direct reads query the same shape.
  // Neither path selects manifest JSON or private object keys.
  const diagnosticCount = list
    ? (list.diagnostics.get(row.id)?.count ?? 0)
    : Number(
        (
          await db.one(
            "SELECT count(*)::integer AS total FROM diagnostic_evidence WHERE thread_id=$1",
            [row.id],
          )
        ).total,
      );
  const diagnosticLatest = list
    ? (list.diagnostics.get(row.id)?.latest ?? [])
    : diagnosticCount
      ? (
          await db.query(
            `SELECT id,project_id,thread_id,status,summary,started_at,created_at
         FROM diagnostic_evidence WHERE thread_id=$1 ORDER BY created_at DESC,id DESC LIMIT 3`,
            [row.id],
          )
        ).map(diagnosticSummary)
      : [];
  const likes =
    list?.likes.get(row.id) ?? (list ? new Map() : await discussionLikes(db, a, row.id));
  const data = structuredClone(row.data),
    replies = list
      ? (list.replies.get(row.id) ?? [])
      : await db.query(
          "SELECT id,data,created_at FROM replies WHERE thread_id=$1 ORDER BY created_at,id",
          [row.id],
        );
  const assets = list
    ? (list.assets.get(row.id) ?? [])
    : await db.query(
        "SELECT id,data FROM assets WHERE thread_id=$1 AND status='validated' ORDER BY data->>'createdAt',data->>'filename',id",
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
    const userIds = [data.author.userId, ...replies.map((r) => r.data.author.userId)];
    data.reviewerContext = list?.reviewers
      ? {
          ...list.reviewers,
          items: list.reviewers.items.filter((item) => userIds.includes(item.userId)),
        }
      : await reviewerContext(db, a, row.project_id, userIds);
    const u = list
      ? list.policies?.get(data.author.userId)
      : await db.one(
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
    diagnosticEvidence: {
      count: diagnosticCount,
      latest: diagnosticLatest,
      followUp: ["diagnostics.list", "diagnostics.describe", "diagnostics.read"],
    },
    workPlan: data.workPlan ?? {
      priority: "normal",
      schedule: "unscheduled",
      scheduledFor: null,
      timeZone: "UTC",
    },
    topPriority: data.topPriority === true,
    review: data.review ?? { round: 1, state: "open", history: [] },
    figmaReference: data.figmaReference ?? null,
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
    assets: assets
      .filter((r) => !r.data.supersededBy)
      .map((r) => ({
        id: r.id,
        ...r.data,
        url: `/api/assets/${r.id}`,
      })),
    pins: {
      defaultVisible:
        !data.archived && !["resolved", "declined"].includes(data.work.state),
    },
    view: list
      ? list.views.get(data.context.fingerprint)
      : await viewStats(db, a, row.project_id, data.context.fingerprint),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}
