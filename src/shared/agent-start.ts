import type { AgentExecutor } from "./agent-workflow.js";
import { taskCounts, reviewedPage } from "./agent-task-context.js";

const relevantOperations = [
  "threads.get",
  "threads.activity",
  "assets.get",
  "instructions.get",
  "assignments.delegations",
  "assignments.list",
  "assignments.claim",
  "assignments.renew",
  "assignments.release",
  "threads.status",
  "threads.reply",
  "threads.evidence",
  "threads.annotationStatus",
  "recordings.list",
  "recordings.get",
  "recordings.events",
  "recordings.export",
  "diagnostics.list",
  "diagnostics.describe",
  "diagnostics.search",
  "diagnostics.read",
];

export async function startTask(
  execute: AgentExecutor,
  input: { threadId: string; snapshotRevision?: number },
) {
  async function optional(operation: string, args: unknown, permitted?: boolean) {
    if (permitted === false)
      return {
        status: "missing_scope",
        operation,
        requiredScopes: [operation],
        recovery:
          "Ask the credential owner for a replacement key in Account with the listed scope; do not change credentials automatically.",
      };
    try {
      return { status: "available", data: await execute(operation, args) };
    } catch (error: any) {
      if (["UNAUTHENTICATED", "PASSWORD_CHANGE_REQUIRED"].includes(error?.code))
        throw error;
      if (!["FORBIDDEN", "NOT_FOUND"].includes(error?.code)) throw error;
      return {
        status: "unavailable",
        operation,
        code: error.code,
        message: error.message,
        ...(error.details ?? {}),
      };
    }
  }
  const identity = await optional("auth.me", {});
  const me = identity.status === "available" ? identity.data : undefined;
  const scoped = me?.credential?.operationScopes;
  const permitted = (name: string) => (scoped ? scoped.includes(name) : undefined);
  // This is the one indispensable read. A denied task never looks empty.
  const thread = await execute("threads.get", { threadId: input.threadId });
  const project = me?.projects?.find((p: any) => p.id === thread.projectId);
  const args = {
    projectId: thread.projectId,
    threadId: thread.id,
    state: "active",
    limit: 10,
  };
  const [instructions, delegations, claims] = await Promise.all([
    optional(
      "instructions.get",
      { projectId: thread.projectId },
      permitted("instructions.get"),
    ),
    optional("assignments.delegations", args, permitted("assignments.delegations")),
    optional("assignments.list", args, permitted("assignments.list")),
  ]);
  const boundedAssignments = (result: any) =>
    result.status !== "available"
      ? result
      : {
          status: result.status,
          total: result.data.total,
          nextOffset: result.data.nextOffset,
          items: result.data.items.map((item: any) => ({
            id: item.id,
            userId: item.userId,
            memberName: item.memberName,
            agentName: item.agentName,
            annotationIds: item.annotationIds,
            state: item.state,
            expiresAt: item.expiresAt,
            revision: item.revision,
            summary: item.summary?.slice(0, 300),
          })),
        };
  const approvedInstructions =
    instructions.status !== "available"
      ? instructions
      : {
          status: "available",
          trust: instructions.data.trust,
          revision: instructions.data.revision,
          items: instructions.data.items.slice(0, 5).map((item: any) => ({
            id: item.id,
            version: item.version,
            body: item.body.slice(0, 4000),
          })),
          truncated:
            instructions.data.items.length > 5 ||
            instructions.data.items.some((item: any) => item.body.length > 4000),
          readFull: "instructions.get",
        };
  return {
    task: {
      id: thread.id,
      projectId: thread.projectId,
      revision: thread.revision,
      archived: thread.archived,
      work: { state: thread.work.state },
      workPlan: thread.workPlan,
      preview: thread.body.slice(0, 240),
      counts: taskCounts(thread),
    },
    reviewedPage: reviewedPage(thread.context.url, me?.serverOrigin, thread.id),
    identity: me
      ? {
          status: "available",
          actor: me.actor,
          member: me.member ?? { id: me.actor.userId, name: null },
        }
      : identity,
    capabilities: Object.fromEntries(
      relevantOperations.map((name) => [name, permitted(name) ?? null]),
    ),
    capabilityNote:
      "These are operation-scope grants, not a promise of project/domain authorization. Null means this server did not report credential scopes.",
    project: project
      ? { id: project.id, name: project.name, permissions: project.permissions }
      : { id: thread.projectId, permissions: "not_reported" },
    approvedInstructions,
    coordination: {
      verified:
        delegations.status === "available" &&
        claims.status === "available" &&
        delegations.data.nextOffset === null &&
        claims.data.nextOffset === null,
      delegations: boundedAssignments(delegations),
      claims: boundedAssignments(claims),
      note: "Read remaining assignment pages before claiming. Status is not a claim. Respect the selected scope and existing workers.",
    },
    snapshot: {
      matches:
        input.snapshotRevision === undefined
          ? null
          : input.snapshotRevision === thread.revision,
      next:
        input.snapshotRevision === thread.revision
          ? "Reuse complete included text; fetch only missing or changed relevant sections. Inspect media only when needed for the task."
          : "Read relevant current sections through feedbacks_thread.",
    },
    media: {
      items: (thread.assets ?? []).slice(0, 10).map((asset: any) => ({
        assetId: asset.id,
        filename: asset.filename,
        contentType: asset.contentType,
        width: asset.width,
        height: asset.height,
      })),
      total: thread.assets?.length ?? 0,
      nextOffset: thread.assets?.length > 10 ? 10 : null,
      inspected: false,
    },
    diagnosticEvidence: thread.diagnosticEvidence ?? { count: 0 },
    next:
      thread.archived || ["resolved", "declined"].includes(thread.work.state)
        ? "This task is closed or archived. Report its state; obtain explicit reopening authorization."
        : "Use relevant task text and source first. Read images when pixels matter; recordings, diagnostics and debug bundles only to answer an unresolved task question. Start with bounded reads. Keep task and reviewed-page scope separate, preserve claims/plans and report verified results when authorized.",
  };
}
