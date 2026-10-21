import { randomUUID } from "node:crypto";
import type { Actor } from "../shared/contracts.js";
import { missingOperationScopes } from "../shared/contracts.js";
import { defaultBoardConfiguration, type BoardConfiguration } from "../shared/board.js";
import { access, canReadPolicy, event } from "./access.js";
import { hash } from "./auth.js";
import type { Database } from "./db.js";
import { delegations } from "./delegations.js";
import { fail } from "./errors.js";
import { checkRevision, feedback, saveThread } from "./feedback.js";
import { priorityScore, threadQuery } from "./review-views.js";
import { fullThread, listData, threadRow } from "./thread-read-model.js";

async function configuration(db: Database, projectId: string) {
  const row = await db.one(
    "SELECT revision,configuration FROM project_boards WHERE project_id=$1",
    [projectId],
  );
  return {
    projectId,
    revision: row?.revision ?? 0,
    configuration: (row?.configuration ??
      structuredClone(defaultBoardConfiguration)) as BoardConfiguration,
  };
}
function assertBoardRevision(board: { revision: number }, revision: number) {
  if (board.revision !== revision)
    fail("CONFLICT", "Board columns changed; reload before continuing", 409);
}
function assignmentVersion(rows: any[]) {
  return hash(
    JSON.stringify(
      rows
        .map((row) => [row.id, row.revision, row.user_id, row.annotation_ids])
        .sort((left, right) => String(left[0]).localeCompare(String(right[0]))),
    ),
  );
}
async function activeAssignments(db: Database, threadIds: string[]) {
  const rows = await db.query(
    "SELECT d.*,u.name FROM work_delegations d JOIN users u ON u.id=d.user_id WHERE d.thread_id=ANY($1::uuid[]) AND d.state='active' ORDER BY d.id",
    [threadIds],
  );
  const result = new Map<string, any[]>();
  for (const row of rows)
    result.set(row.thread_id, [...(result.get(row.thread_id) ?? []), row]);
  return result;
}
function requireActionScope(a: Actor, operation: string) {
  if (missingOperationScopes(a.scopes, operation).length)
    fail("FORBIDDEN", `This action also requires ${operation}`, 403);
}

// Operations calls this inside its account-locked transaction. A batch either
// commits every existing domain operation and its audit events, or rolls back.
export async function boardOperation(db: Database, a: Actor, op: string, i: any) {
  await access(
    db,
    a,
    i.projectId,
    op === "board.configure" ? "maintain" : op === "board.batch" ? "write" : "read",
  );
  const board = await configuration(db, i.projectId);
  if (op === "board.get") return board;
  if (op === "board.configure") {
    assertBoardRevision(board, i.revision);
    const saved = await db.one(
      `INSERT INTO project_boards(project_id,configuration) VALUES($1,$2)
       ON CONFLICT(project_id) DO UPDATE SET configuration=$2,revision=project_boards.revision+1,updated_at=now()
       RETURNING revision,configuration`,
      [i.projectId, JSON.stringify(i.configuration)],
    );
    await event(db, a, i.projectId, i.projectId, op, { revision: saved.revision });
    return { projectId: i.projectId, ...saved };
  }
  if (op === "board.column") {
    assertBoardRevision(board, i.boardRevision);
    const column = board.configuration.columns.find((column) => column.id === i.columnId);
    if (!column) fail("NOT_FOUND", "Board column not found", 404);
    if (i.filters.sort === "priority" && !canReadPolicy(a))
      fail("FORBIDDEN", "Priority order requires approved policy access", 403);
    const { filter, args, order, orderArgs } = threadQuery(i.projectId, i.filters);
    args.push(column.states);
    const where = `${filter} AND data->'work'->>'state'=ANY($${args.length}::text[])`;
    const total = Number(
      (
        await db.one(
          `SELECT count(*)::integer AS total FROM threads WHERE ${where}`,
          args,
        )
      ).total,
    );
    // threadQuery numbers its optional work-plan sort argument immediately after
    // its filter arguments. Insert the column predicate after that argument.
    const pageQuery = threadQuery(i.projectId, i.filters);
    const queryArgs = [
      ...pageQuery.args,
      ...pageQuery.orderArgs,
      column.states,
      i.limit,
      i.offset,
    ];
    const columnArgument = pageQuery.args.length + pageQuery.orderArgs.length + 1;
    const rows = await db.query(
      `SELECT threads.*${i.filters.sort === "priority" ? `,${priorityScore} AS priority_score` : ""} FROM threads
       WHERE ${pageQuery.filter} AND data->'work'->>'state'=ANY($${columnArgument}::text[])
       ORDER BY ${order} LIMIT $${queryArgs.length - 1} OFFSET $${queryArgs.length}`,
      queryArgs,
    );
    const bulk = rows.length ? await listData(db, a, rows) : undefined;
    const assignments = rows.length
      ? await activeAssignments(
          db,
          rows.map((row) => row.id),
        )
      : new Map<string, any[]>();
    return {
      columnId: column.id,
      boardRevision: board.revision,
      total,
      nextOffset: i.offset + rows.length < total ? i.offset + rows.length : null,
      items: bulk
        ? await Promise.all(
            rows.map(async (row) => {
              const assigned = assignments.get(row.id) ?? [];
              return {
                thread: {
                  ...(await fullThread(db, a, row, bulk)),
                  ...(i.filters.sort === "priority"
                    ? { priorityScore: row.priority_score }
                    : {}),
                },
                assignmentVersion: assignmentVersion(assigned),
                assignments: assigned.map((item) => ({
                  id: item.id,
                  userId: item.user_id,
                  name: item.name,
                  revision: item.revision,
                  annotationIds: item.annotation_ids,
                })),
              };
            }),
          )
        : [],
    };
  }
  if (op !== "board.batch") fail("NOT_FOUND", "Unknown board operation", 404);
  const inputHash = hash(JSON.stringify(i));
  const previous = await db.one(
    "SELECT project_id,input_hash,receipt FROM board_batch_receipts WHERE actor_id=$1 AND request_key=$2",
    [a.id, i.idempotencyKey],
  );
  if (previous) {
    if (previous.project_id !== i.projectId || previous.input_hash !== inputHash)
      fail(
        "IDEMPOTENCY_CONFLICT",
        "Retry key was used with different board changes",
        409,
      );
    return previous.receipt;
  }
  assertBoardRevision(board, i.boardRevision);
  const action = i.action;
  let targetState: string | undefined;
  if (action.type === "move") {
    requireActionScope(a, "threads.status");
    const column = board.configuration.columns.find(
      (column) => column.id === action.columnId,
    );
    if (!column) fail("NOT_FOUND", "Board column not found", 404);
    targetState = action.state ?? column.entryState;
    if (!column.states.includes(targetState as any))
      fail("VALIDATION", "Work status does not belong to this column");
    await access(
      db,
      a,
      i.projectId,
      ["resolved", "declined"].includes(targetState!) ? "resolve" : "write",
    );
  } else if (action.type === "archive") {
    requireActionScope(a, "threads.archive");
    await access(db, a, i.projectId, "maintain");
  } else {
    requireActionScope(a, action.userId ? "assignments.assign" : "assignments.cancel");
  }
  const rows: any[] = [];
  for (const selected of [...i.threads].sort((left: any, right: any) =>
    left.threadId.localeCompare(right.threadId),
  )) {
    const row = await threadRow(db, a, selected.threadId, "write", true);
    if (row.project_id !== i.projectId)
      fail("FORBIDDEN", "Every selected feedback must belong to this project", 403);
    checkRevision(row, selected.revision);
    rows.push(row);
  }
  const assignments = await activeAssignments(
    db,
    rows.map((row) => row.id),
  );
  for (const selected of i.threads) {
    const assigned = assignments.get(selected.threadId) ?? [];
    if (assignmentVersion(assigned) !== selected.assignmentVersion)
      fail("CONFLICT", "Assignments changed; reload and review your selection", 409);
    if (action.type === "assign" && assigned.some((item) => item.annotation_ids.length))
      fail(
        "CONFLICT",
        "This feedback has point assignments. Open its discussion to coordinate those assignments",
        409,
      );
  }
  const saved: Array<{ threadId: string; revision: number }> = [];
  for (const row of rows) {
    let updated;
    if (action.type === "move") {
      updated = await feedback(db, a, "threads.status", {
        threadId: row.id,
        revision: row.revision,
        state: targetState,
        ...(row.data.work.note ? { note: row.data.work.note } : {}),
        ...(row.data.work.duplicateOf ? { duplicateOf: row.data.work.duplicateOf } : {}),
      });
    } else if (action.type === "archive") {
      updated = await feedback(db, a, "threads.archive", {
        threadId: row.id,
        revision: row.revision,
        archived: action.archived,
      });
    } else {
      const current = assignments.get(row.id)?.[0];
      const key = `${i.idempotencyKey.slice(0, 100)}:${row.id}`;
      if (action.userId) {
        await delegations(db, a, "assignments.assign", {
          threadId: row.id,
          threadRevision: row.revision,
          ...(current ? { delegationId: current.id, revision: current.revision } : {}),
          userId: action.userId,
          annotationIds: [],
          summary: row.data.body.slice(0, 500),
          category: current?.category ?? row.data.category ?? "general",
          tags: current?.tags ?? row.data.tags ?? [],
          githubDecision: current?.github_decision ?? "undecided",
          githubRationale:
            current?.github_rationale ??
            "Assigned from the project board; issue decision remains available in the discussion.",
          ...(current ? { summary: current.summary } : {}),
          idempotencyKey: key,
        });
      } else if (current) {
        await delegations(db, a, "assignments.cancel", {
          delegationId: current.id,
          revision: current.revision,
          reason: "Unassigned from the project board",
          idempotencyKey: key,
        });
      }
      updated = await saveThread(db, a, row, "threads.boardAssignment", {
        userId: action.userId,
      });
    }
    saved.push({ threadId: row.id, revision: updated.revision });
  }
  const receipt = {
    id: randomUUID(),
    projectId: i.projectId,
    affected: saved.length,
    action: action.type,
    threads: saved,
    completedAt: new Date().toISOString(),
  };
  await db.query(
    "INSERT INTO board_batch_receipts(id,project_id,actor_id,request_key,input_hash,receipt) VALUES($1,$2,$3,$4,$5,$6)",
    [receipt.id, i.projectId, a.id, i.idempotencyKey, inputHash, JSON.stringify(receipt)],
  );
  return receipt;
}
