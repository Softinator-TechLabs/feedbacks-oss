import { randomUUID } from "node:crypto";
import type { Database } from "./db.js";
import type { Actor } from "../shared/contracts.js";
import { access, event } from "./access.js";
import { hash } from "./auth.js";
import { threadRow } from "./feedback.js";
import { fail } from "./errors.js";
import { assertProjectCategory } from "./projects.js";

export function scopesOverlap(left: string[], right: string[]) {
  return !left.length || !right.length || left.some((id) => right.includes(id));
}
export async function checkDelegatedOwnership(
  db: Database,
  threadId: string,
  points: string[],
  userId: string,
) {
  const active = await db.query(
    "SELECT user_id,annotation_ids FROM work_delegations WHERE thread_id=$1 AND state='active'",
    [threadId],
  );
  if (active.some((r) => r.user_id !== userId && scopesOverlap(points, r.annotation_ids)))
    fail(
      "CONFLICT",
      "Work is delegated to another member; coordinate before claiming",
      409,
    );
}
function receipt(r: any) {
  return {
    id: r.id,
    projectId: r.project_id,
    threadId: r.thread_id,
    annotationIds: r.annotation_ids,
    userId: r.user_id,
    memberName: r.member_name,
    summary: r.summary,
    category: r.category,
    tags: r.tags,
    githubDecision: r.github_decision,
    githubRationale: r.github_rationale,
    state: r.state,
    revision: r.revision,
    updatedBy: r.updated_by,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}
function historyReceipt(r: any) {
  return {
    id: r.id,
    delegationId: r.delegation_id,
    action: r.action,
    revision: r.revision,
    actor: r.actor,
    reason: r.reason,
    assignment: r.assignment,
    createdAt: new Date(r.created_at).toISOString(),
  };
}
export async function delegations(db: Database, a: Actor, op: string, i: any) {
  // Operations holds accountLock for current membership and all conflicting writes.
  const select =
    "SELECT d.*,u.name AS member_name FROM work_delegations d JOIN users u ON u.id=d.user_id";
  const read = (id: string) => db.one(`${select} WHERE d.id=$1`, [id]);
  if (op === "assignments.delegations") {
    await access(db, a, i.projectId);
    const values: any[] = [i.projectId],
      where = ["d.project_id=$1"];
    if (i.state === "active") where.push("d.state='active'");
    for (const [field, value] of [
      ["thread_id", i.threadId],
      ["user_id", i.userId],
    ])
      if (value) {
        values.push(value);
        where.push(`d.${field}=$${values.length}`);
      }
    const clause = where.join(" AND ");
    const total = Number(
      (await db.one(`SELECT count(*) FROM work_delegations d WHERE ${clause}`, values))
        .count,
    );
    const rows = await db.query(
      `${select} WHERE ${clause} ORDER BY d.updated_at DESC,d.id LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, i.limit, i.offset],
    );
    return {
      items: rows.map(receipt),
      total,
      nextOffset: i.offset + rows.length < total ? i.offset + rows.length : null,
    };
  }
  let row = i.delegationId ? await read(i.delegationId) : undefined;
  if (i.delegationId && !row) fail("NOT_FOUND", "Assignment not found", 404);
  if (row)
    await access(db, a, row.project_id, op === "assignments.history" ? "read" : "write");
  if (op === "assignments.history") {
    const total = Number(
      (
        await db.one(
          "SELECT count(*) FROM work_delegation_history WHERE delegation_id=$1",
          [row.id],
        )
      ).count,
    );
    const rows = await db.query(
      "SELECT * FROM work_delegation_history WHERE delegation_id=$1 ORDER BY revision DESC LIMIT $2 OFFSET $3",
      [row.id, i.limit, i.offset],
    );
    return {
      items: rows.map(historyReceipt),
      total,
      nextOffset: i.offset + rows.length < total ? i.offset + rows.length : null,
    };
  }
  const points =
    op === "assignments.assign" ? [...new Set(i.annotationIds as string[])].sort() : [];
  const thread =
    op === "assignments.assign" ? await threadRow(db, a, i.threadId, "write") : undefined;
  if (row && thread && row.thread_id !== thread.id)
    fail("VALIDATION", "An assignment cannot move to another thread");
  const { idempotencyKey, ...input } = i;
  const inputHash = hash(
    JSON.stringify({ op, ...input, ...(thread ? { annotationIds: points } : {}) }),
  );
  const previous = await db.one(
    "SELECT * FROM work_delegation_history WHERE actor_id=$1 AND request_key=$2",
    [a.id, idempotencyKey],
  );
  if (previous) {
    if (previous.input_hash !== inputHash)
      fail("CONFLICT", "Assignment request key already used for different input", 409);
    return previous.assignment;
  }
  if (row && row.revision !== i.revision)
    fail("CONFLICT", "Assignment changed; reload before updating", 409);
  if (row && row.state !== "active")
    fail("CONFLICT", "Assignment is cancelled; create new work explicitly", 409);
  const member = await db.one("SELECT name FROM users WHERE id=$1", [a.userId]);
  const actor = {
    userId: a.userId,
    memberName: member.name,
    agentId: a.kind === "agent" ? a.id : null,
    agentName: a.kind === "agent" ? a.name : null,
  };
  const action =
    op === "assignments.cancel" ? "cancelled" : row ? "reassigned" : "assigned";
  if (thread) {
    assertProjectCategory(
      await access(db, a, thread.project_id),
      i.category,
      row?.category,
    );
    if (thread.revision !== i.threadRevision)
      fail("CONFLICT", "Thread changed; reload before assigning work", 409);
    if (thread.data.archived || ["resolved", "declined"].includes(thread.data.work.state))
      fail("CONFLICT", "Thread is closed; discuss reopening before assigning work", 409);
    for (const point of points) {
      if (!thread.data.context.annotations?.some((p: any) => p.id === point))
        fail("VALIDATION", "Unknown annotation point");
      if ((thread.data.annotationStates?.[point]?.state ?? "open") !== "open")
        fail("CONFLICT", "Selected point is not open", 409);
    }
    if (
      i.githubDecision === "already_linked" &&
      !thread.data.externalIssues?.some((issue: any) => {
        try {
          const url = new URL(issue.url);
          return (
            url.protocol === "https:" &&
            url.hostname === "github.com" &&
            /^\/[^/]+\/[^/]+\/issues\/\d+\/?$/.test(url.pathname)
          );
        } catch {
          return false;
        }
      })
    )
      fail(
        "VALIDATION",
        "Link a GitHub issue to this thread before choosing already linked",
      );
    const target = await db.one(
      "SELECT u.active,u.removed_at,u.owner,g.role FROM users u LEFT JOIN grants g ON g.user_id=u.id AND g.project_id=$2 WHERE u.id=$1",
      [i.userId, thread.project_id],
    );
    if (
      !target?.active ||
      target.removed_at ||
      !(target.owner || ["reviewer", "maintainer"].includes(target.role))
    )
      fail("VALIDATION", "Assignee must be an active writable project member or owner");
    const active = await db.query(
      "SELECT id,annotation_ids FROM work_delegations WHERE thread_id=$1 AND state='active'",
      [thread.id],
    );
    if (active.some((r) => r.id !== row?.id && scopesOverlap(points, r.annotation_ids)))
      fail(
        "CONFLICT",
        "Work already assigned; read assignments.delegations and coordinate before reassignment",
        409,
      );
    const claims = await db.query(
      "SELECT user_id,annotation_ids FROM work_claims WHERE thread_id=$1 AND state='active' AND expires_at>now()",
      [thread.id],
    );
    if (
      claims.some(
        (r) => r.user_id !== i.userId && scopesOverlap(points, r.annotation_ids),
      )
    )
      fail(
        "CONFLICT",
        "Another member is actively working on this scope; coordinate release before assigning",
        409,
      );
    if (row) {
      await db.query(
        "UPDATE work_delegations SET annotation_ids=$2,user_id=$3,summary=$4,category=$5,tags=$6,github_decision=$7,github_rationale=$8,updated_by=$9,revision=revision+1,updated_at=now() WHERE id=$1",
        [
          row.id,
          JSON.stringify(points),
          i.userId,
          i.summary,
          i.category,
          JSON.stringify(i.tags),
          i.githubDecision,
          i.githubRationale,
          JSON.stringify(actor),
        ],
      );
    } else {
      const id = randomUUID();
      await db.query(
        "INSERT INTO work_delegations(id,project_id,thread_id,annotation_ids,user_id,summary,category,tags,github_decision,github_rationale,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
        [
          id,
          thread.project_id,
          thread.id,
          JSON.stringify(points),
          i.userId,
          i.summary,
          i.category,
          JSON.stringify(i.tags),
          i.githubDecision,
          i.githubRationale,
          JSON.stringify(actor),
        ],
      );
      row = { id };
    }
  } else {
    await db.query(
      "UPDATE work_delegations SET state='cancelled',revision=revision+1,updated_by=$2,updated_at=now() WHERE id=$1",
      [row.id, JSON.stringify(actor)],
    );
  }
  row = await read(row.id);
  const result = receipt(row);
  await db.query(
    "INSERT INTO work_delegation_history(id,delegation_id,action,revision,actor,reason,assignment,actor_id,request_key,input_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
    [
      randomUUID(),
      row.id,
      action,
      row.revision,
      JSON.stringify(actor),
      i.reason ?? null,
      JSON.stringify(result),
      a.id,
      idempotencyKey,
      inputHash,
    ],
  );
  await event(db, a, row.project_id, row.id, op, {
    threadId: row.thread_id,
    revision: row.revision,
  });
  return result;
}
