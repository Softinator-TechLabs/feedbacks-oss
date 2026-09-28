import { randomUUID } from "node:crypto";
import type { Database } from "./db.js";
import type { Actor } from "../shared/contracts.js";
import { access, event } from "./access.js";
import { hash } from "./auth.js";
import { threadRow } from "./feedback.js";
import { delegations, checkDelegatedOwnership } from "./delegations.js";
import { fail } from "./errors.js";

function receipt(r: any) {
  return {
    id: r.id,
    projectId: r.project_id,
    threadId: r.thread_id,
    annotationIds: r.annotation_ids,
    userId: r.user_id,
    memberName: r.member_name,
    agentId: r.agent_id,
    agentName: r.agent_name,
    summary: r.summary,
    state:
      r.state === "active" && new Date(r.expires_at).getTime() <= Date.now()
        ? "expired"
        : r.state,
    revision: r.revision,
    expiresAt: new Date(r.expires_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}
export async function assignments(db: Database, a: Actor, op: string, i: any) {
  if (
    [
      "assignments.delegations",
      "assignments.assign",
      "assignments.cancel",
      "assignments.history",
    ].includes(op)
  )
    return delegations(db, a, op, i);
  const select =
    "SELECT c.*,u.name AS member_name FROM work_claims c JOIN users u ON u.id=c.user_id";
  const read = (id: string) => db.one(`${select} WHERE c.id=$1`, [id]);
  if (op === "assignments.list") {
    await access(db, a, i.projectId);
    const values: any[] = [i.projectId];
    const where = ["c.project_id=$1"];
    if (i.state === "active") where.push("c.state='active' AND c.expires_at>now()");
    for (const [field, value] of [
      ["thread_id", i.threadId],
      ["user_id", i.userId],
    ])
      if (value) {
        values.push(value);
        where.push(`c.${field}=$${values.length}`);
      }
    const clause = where.join(" AND ");
    const total = Number(
      (await db.one(`SELECT count(*) FROM work_claims c WHERE ${clause}`, values)).count,
    );
    const rows = await db.query(
      `${select} WHERE ${clause} ORDER BY c.updated_at DESC,c.id LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, i.limit, i.offset],
    );
    return {
      items: rows.map(receipt),
      total,
      nextOffset: i.offset + rows.length < total ? i.offset + rows.length : null,
    };
  }
  let row: any;
  if (op === "assignments.claim") {
    const t = await threadRow(db, a, i.threadId, "write");
    const points = [...new Set(i.annotationIds as string[])].sort();
    const inputHash = hash(
      JSON.stringify({ threadId: i.threadId, points, summary: i.summary }),
    );
    const previous = await db.one(`${select} WHERE c.agent_id=$1 AND c.request_key=$2`, [
      a.id,
      i.idempotencyKey,
    ]);
    if (previous) {
      if (previous.input_hash !== inputHash)
        fail("CONFLICT", "Claim request key already used for different work", 409);
      return receipt(previous);
    }
    if (t.revision !== i.revision)
      fail("CONFLICT", "Thread changed; reload before claiming work", 409);
    if (t.data.archived || ["resolved", "declined"].includes(t.data.work.state))
      fail("CONFLICT", "Thread is closed; discuss reopening before claiming work", 409);
    for (const point of points) {
      if (!t.data.context.annotations?.some((p: any) => p.id === point))
        fail("VALIDATION", "Unknown annotation point");
      const state = t.data.annotationStates?.[point]?.state ?? "open";
      if (state !== "open") fail("CONFLICT", "Selected point is not open", 409);
    }
    await checkDelegatedOwnership(db, t.id, points, a.userId);
    const active = await db.query(
      "SELECT annotation_ids FROM work_claims WHERE thread_id=$1 AND state='active' AND expires_at>now()",
      [i.threadId],
    );
    if (
      active.some(
        (r) =>
          !points.length ||
          !r.annotation_ids.length ||
          r.annotation_ids.some((p: string) => points.includes(p)),
      )
    )
      fail(
        "CONFLICT",
        "Work already claimed; read assignments.list and coordinate before takeover",
        409,
      );
    const id = randomUUID();
    await db.query(
      "INSERT INTO work_claims(id,project_id,thread_id,annotation_ids,user_id,agent_id,agent_name,summary,request_key,input_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [
        id,
        t.project_id,
        t.id,
        JSON.stringify(points),
        a.userId,
        a.id,
        a.name,
        i.summary,
        i.idempotencyKey,
        inputHash,
      ],
    );
    row = await read(id);
  } else {
    row = await read(i.assignmentId);
    if (!row) fail("NOT_FOUND", "Work claim not found", 404);
    await access(db, a, row.project_id, "write");
    const own = row.agent_id === a.id || (a.kind === "human" && row.user_id === a.userId);
    if (op === "assignments.renew" && !own)
      fail("FORBIDDEN", "Only the claiming agent or member can renew this claim", 403);
    if (!own) await access(db, a, row.project_id, "maintain");
    if (row.revision !== i.revision)
      fail("CONFLICT", "Claim changed; reload before updating", 409);
    if (row.state !== "active") fail("CONFLICT", "Claim is already released", 409);
    if (op === "assignments.renew") {
      if (new Date(row.expires_at).getTime() <= Date.now())
        fail(
          "CONFLICT",
          "Claim expired; inspect current work before claiming again",
          409,
        );
      const t = await threadRow(db, a, row.thread_id, "write");
      if (t.data.archived || ["resolved", "declined"].includes(t.data.work.state))
        fail("CONFLICT", "Thread is closed; release this claim", 409);
      await checkDelegatedOwnership(db, t.id, row.annotation_ids, a.userId);
      await db.query(
        "UPDATE work_claims SET expires_at=now()+interval '2 hours',updated_at=now(),revision=revision+1 WHERE id=$1",
        [row.id],
      );
    } else
      await db.query(
        "UPDATE work_claims SET state=$1,updated_at=now(),revision=revision+1 WHERE id=$2",
        [i.outcome, row.id],
      );
    row = await read(row.id);
  }
  await event(db, a, row.project_id, row.id, op, {
    threadId: row.thread_id,
    revision: row.revision,
  });
  return receipt(row);
}
