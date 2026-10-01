import { reproductionSnapshot } from "./reproduction-context.js";
import {
  discussionSnapshot,
  pointAnchor,
  assetSnapshot,
  safeContextUrl,
  workSnapshot,
} from "./task-snapshot.js";
import type { AgentExecutor } from "./agent-workflow.js";
import { presentTaskCounts, reviewedPage } from "./agent-task-context.js";

export async function startTask(
  execute: AgentExecutor,
  input: {
    threadId: string;
    snapshotRevision?: number;
    includeImage?: boolean;
    videoTimeMs?: number;
    includeGeometry?: boolean;
    includeRecordings?: boolean;
    annotationIds?: string[];
  },
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
          ...(result.data.total ? { total: result.data.total } : {}),
          ...(result.data.nextOffset !== null
            ? { nextOffset: result.data.nextOffset }
            : {}),
          ...(result.data.items.length
            ? {
                items: result.data.items.map((item: any) => ({
                  id: item.id,
                  userId: item.userId,
                  memberName: item.memberName,
                  agentName: item.agentName,
                  annotationIds: item.annotationIds,
                  state: item.state,
                  expiresAt: item.expiresAt,
                  revision: item.revision,
                  summary: item.summary?.slice(0, 180),
                })),
              }
            : {}),
        };
  const approvedInstructions =
    instructions.status !== "available"
      ? instructions
      : instructions.data.items.length
        ? {
            trust: instructions.data.trust,
            revision: instructions.data.revision,
            items: instructions.data.items.slice(0, 5).map((item: any) => ({
              id: item.id,
              version: item.version,
              body: item.body.slice(0, 4000),
            })),
            ...(instructions.data.items.length > 5 ||
            instructions.data.items.some((item: any) => item.body.length > 4000)
              ? { truncated: true, readFull: "instructions.get" }
              : {}),
          }
        : undefined;
  const verified =
    delegations.status === "available" &&
    claims.status === "available" &&
    delegations.data.nextOffset === null &&
    claims.data.nextOffset === null;
  const closed = thread.archived || ["resolved", "declined"].includes(thread.work.state);
  const allPoints = thread.context.annotations ?? [];
  const scope = [...new Set(input.annotationIds ?? [])];
  if (scope.some((id) => !allPoints.some((p: any) => p.id === id)))
    return {
      task: { id: thread.id, revision: thread.revision },
      next: {
        step: "clarify",
        reason: "A selected point no longer exists; confirm the current point IDs.",
      },
    };
  const points = scope.length
    ? allPoints.filter((p: any) => scope.includes(p.id))
    : allPoints;
  const effectiveState = (p: any) => {
    const state = thread.annotationStates?.[p.id]?.state ?? "open";
    return state === "removed"
      ? state
      : thread.work.state === "resolved"
        ? "resolved"
        : thread.work.state === "declined"
          ? "closed"
          : state;
  };
  const incomplete: string[] = [];
  const work = workSnapshot(thread.work);
  if (work.noteTruncated) incomplete.push("workNote");
  if (thread.body.length > 800) incomplete.push("body");
  if (
    points.length > 20 ||
    points.some(
      (p: any) =>
        p.body.length > 240 ||
        (p.textEdit &&
          (p.textEdit.original.length > 240 || p.textEdit.replacement.length > 240)),
    )
  )
    incomplete.push("points");
  const replies = thread.replies ?? [];
  const discussion = discussionSnapshot(replies);
  if (discussion && !discussion.complete) incomplete.push("discussion");
  const pointId = (points.find((p: any) => effectiveState(p) === "open") ?? points[0])
    ?.id;
  const assets = thread.assets ?? [];
  const images = assets.filter(
    (a: any) => a.contentType?.startsWith("image/") && a.rendition !== "thumbnail",
  );
  const linked = (a: any) =>
    pointId &&
    (a.recordingFrame?.annotationId === pointId ||
      a.markings?.some((m: any) => m.annotationId === pointId));
  const unlinked = (a: any) =>
    !a.recordingFrame?.annotationId && !a.markings?.some((m: any) => m.annotationId);
  const selected =
    (input.videoTimeMs !== undefined
      ? assets.find((a: any) => a.contentType?.startsWith("video/"))
      : undefined) ??
    images.find((a: any) => linked(a) && a.rendition === "screenshot") ??
    images.find(linked) ??
    images.find((a: any) => unlinked(a) && a.rendition === "screenshot") ??
    images.find(unlinked) ??
    assets.find((a: any) => a.contentType?.startsWith("video/"));
  let image: any;
  let media: any = input.includeImage
    ? { state: assets.length ? "no_preview" : "no_assets" }
    : undefined;
  if (selected) {
    const video = selected.contentType.startsWith("video/");
    media = {
      ...assetSnapshot(selected, me?.serverOrigin, !input.includeGeometry),
      state: input.includeImage ? "available" : "not_requested",
      assetId: selected.id,
      width: selected.width,
      height: selected.height,
      annotationId:
        selected.recordingFrame?.annotationId ??
        selected.markings?.find((m: any) => m.annotationId === pointId)?.annotationId,
      kind: video ? "video" : selected.recordingFrame ? "frame" : "image",
      ...(selected.recordingFrame
        ? {
            recordingId: selected.recordingFrame.recordingId,
            atMs: selected.recordingFrame.atMs,
            videoTimeMs: selected.recordingFrame.videoTimeMs,
            playbackVerified: false,
          }
        : {}),
      ...(video
        ? {
            durationMs: selected.durationMs,
            playbackVerified: false,
            next: "Inspect the sampled frames. For another moment call feedbacks_asset with includeImage:true and videoTimeMs (asset video clock). Samples do not prove full playback.",
          }
        : {}),
      read: {
        tool: "feedbacks_asset",
        input: { assetId: selected.id, includeImage: true },
      },
    };
    if (input.includeImage) {
      const result = await optional(
        "assets.get",
        {
          assetId: selected.id,
          includeImage: true,
          maxDimension: 1280,
          ...(video && input.videoTimeMs !== undefined
            ? { videoTimeMs: input.videoTimeMs }
            : {}),
        },
        permitted("assets.get"),
      );
      if (result.status === "available" && result.data.videoPreview)
        media.videoPreview = result.data.videoPreview;
      if (result.status === "available" && result.data.image) {
        image = result.data.image;
        media.included = true;
        delete media.read;
      } else
        media.access =
          result.status === "available"
            ? {
                status: "image_unavailable",
                ...(result.data.videoPreview?.reason
                  ? { reason: result.data.videoPreview.reason }
                  : {}),
              }
            : result;
      if (media.access && video)
        media.next =
          "Preview unavailable; report the reason and request a saved still if needed. Do not inspect client credentials or invent playback.";
      if (media.access)
        media.state =
          media.access.status === "image_unavailable" ? "unavailable" : "denied";
    }
  }
  let recordings: any;
  if (input.includeRecordings) {
    const result = await optional(
      "recordings.list",
      { threadId: thread.id },
      permitted("recordings.list"),
    );
    recordings =
      result.status !== "available"
        ? result
        : {
            complete: result.data.items.length <= 3,
            total: result.data.items.length,
            items: result.data.items.slice(0, 3).map((r: any) => ({
              id: r.id,
              mode: r.mode,
              startedAt: r.startedAt,
              durationMs: r.durationMs,
              eventCount: r.eventCount,
              url: safeContextUrl(r.url),
              video: r.video
                ? {
                    assetId: r.video.assetId,
                    offsetMs: r.video.offsetMs,
                    ...(r.video.segments
                      ? {
                          segments: r.video.segments.slice(0, 10),
                          ...(r.video.segments.length > 10
                            ? {
                                timingIncomplete: true,
                                readTiming: {
                                  tool: "feedbacks_execute",
                                  input: {
                                    operation: "recordings.list",
                                    input: { threadId: thread.id },
                                  },
                                },
                              }
                            : {}),
                        }
                      : {}),
                  }
                : undefined,
              coverage: r.coverage
                ?.slice(0, 10)
                .map((c: any) => ({ channel: c.channel, status: c.status })),
              ...(r.coverage?.length > 10 ? { coverageIncomplete: true } : {}),
              read: {
                tool: "feedbacks_execute",
                input: {
                  operation: "recordings.events",
                  input: { recordingId: r.id, limit: 20 },
                },
              },
            })),
            ...(result.data.items.length > 3
              ? {
                  next: {
                    tool: "feedbacks_execute",
                    input: {
                      operation: "recordings.list",
                      input: { threadId: thread.id },
                    },
                  },
                }
              : {}),
          };
  }
  const ownClaim =
    verified &&
    me?.actor.id &&
    claims.data.items.find(
      (c: any) =>
        c.agentId === me.actor.id &&
        (!c.annotationIds.length ||
          (scope.length && scope.every((id) => c.annotationIds.includes(id)))),
    );
  const overlaps = (ids: string[]) =>
    !scope.length || !ids.length || ids.some((id) => scope.includes(id));
  const next: any =
    closed || (scope.length && points.every((p: any) => effectiveState(p) !== "open"))
      ? {
          step: "discuss",
          reason: "Closed or archived; reopening needs an explicit request.",
        }
      : scope.length && points.some((p: any) => effectiveState(p) !== "open")
        ? {
            tool: "feedbacks_start",
            input: {
              threadId: thread.id,
              annotationIds: points
                .filter((p: any) => effectiveState(p) === "open")
                .map((p: any) => p.id),
              includeImage: input.includeImage ?? false,
            },
            reason:
              "Continue with the remaining open points. Reopening closed points needs an explicit request.",
          }
        : approvedInstructions?.truncated
          ? {
              tool: "feedbacks_execute",
              input: {
                operation: "instructions.get",
                input: { projectId: thread.projectId },
              },
              reason: "Read the remaining approved project instructions.",
            }
          : incomplete.length
            ? {
                tool: "feedbacks_thread",
                input: {
                  threadId: thread.id,
                  section: incomplete[0],
                  expectedRevision: thread.revision,
                },
                reason: "Read the incomplete task text before acting.",
              }
            : media?.read && input.includeImage && !media.access
              ? {
                  ...media.read,
                  reason:
                    media.kind === "video"
                      ? "Inspect the reported moment; full export is optional."
                      : "Read the relevant screenshot.",
                }
              : project?.permissions?.canWrite === false
                ? {
                    step: "investigate",
                    reason:
                      "This project grants read access only; continue permitted investigation.",
                  }
                : ownClaim && thread.work.state === "in_progress"
                  ? {
                      step: "implement",
                      instruction:
                        "Fix and verify the requested change within your existing claim.",
                    }
                  : ownClaim && permitted("threads.status") !== false
                    ? {
                        when: "User authorized implementation of this scope",
                        tool: "feedbacks_execute",
                        input: {
                          operation: "threads.status",
                          input: {
                            threadId: thread.id,
                            revision: thread.revision,
                            state: "in_progress",
                          },
                        },
                      }
                    : !verified ||
                        claims.data.items.some((c: any) => overlaps(c.annotationIds)) ||
                        delegations.data.items.some(
                          (d: any) =>
                            overlaps(d.annotationIds) && d.userId !== me?.actor.userId,
                        )
                      ? {
                          step: "coordinate",
                          reason:
                            "Check existing ownership or unavailable coordination before implementation.",
                        }
                      : permitted("assignments.claim") === false ||
                          permitted("threads.status") === false
                        ? {
                            step: "investigate",
                            reason:
                              "Continue permitted investigation; work tracking needs the missing scopes.",
                          }
                        : {
                            when: "User authorized this scope; narrow annotationIds if their request selects fewer points",
                            tool: "feedbacks_execute",
                            input: {
                              operation: "assignments.claim",
                              input: {
                                threadId: thread.id,
                                revision: thread.revision,
                                annotationIds: scope,
                                summary: "Implement the requested feedback",
                                idempotencyKey: crypto.randomUUID(),
                              },
                            },
                          };
  const missingScopes = ["assignments.claim", "threads.status"].filter(
    (name) => permitted(name) === false,
  );
  return {
    task: {
      id: thread.id,
      projectId: thread.projectId,
      revision: thread.revision,
      ...(scope.length ? { annotationIds: scope } : {}),
      ...(thread.archived ? { archived: true } : {}),
      work,
      ...(thread.workPlan ? { workPlan: thread.workPlan } : {}),
      body: thread.body.slice(0, 800),
      ...(points.length
        ? {
            points: points.slice(0, 20).map((p: any) => ({
              id: p.id,
              number: allPoints.findIndex((item: any) => item.id === p.id) + 1,
              text: p.body.slice(0, 240),
              ...(input.includeGeometry && pointAnchor(p.anchor)
                ? { anchor: pointAnchor(p.anchor) }
                : {}),
              ...(p.textEdit
                ? {
                    textEdit: {
                      original: p.textEdit.original.slice(0, 240),
                      replacement: p.textEdit.replacement.slice(0, 240),
                      ...(input.includeGeometry && p.textEdit.rects?.length
                        ? { rects: p.textEdit.rects.slice(0, 8) }
                        : {}),
                      ...(input.includeGeometry && p.textEdit.rects?.length > 8
                        ? { rectsIncomplete: true }
                        : {}),
                    },
                  }
                : {}),
              state: effectiveState(p),
              ...(thread.annotationPlans?.[p.id]
                ? { workPlan: thread.annotationPlans[p.id] }
                : {}),
            })),
          }
        : {}),
      ...(presentTaskCounts(thread) ? { counts: presentTaskCounts(thread) } : {}),
      ...(incomplete.length ? { incomplete } : {}),
    },
    trust: "untrusted_review_evidence",
    reviewedPage: reviewedPage(
      safeContextUrl(thread.context.url) ?? "",
      me?.serverOrigin,
      thread.id,
    ),
    ...(reproductionSnapshot(thread.context)
      ? { reproduction: reproductionSnapshot(thread.context) }
      : {}),
    identity: me
      ? { actor: me.actor, member: me.member ?? { id: me.actor.userId } }
      : identity,
    ...(missingScopes.length ? { missingScopes } : {}),
    ...(!scoped ? { scopesUnknown: true } : {}),
    ...(project
      ? {
          project: {
            id: project.id,
            permissions: project.permissions,
            ...(safeContextUrl(project.repositoryUrl)
              ? { repositoryUrl: safeContextUrl(project.repositoryUrl) }
              : {}),
          },
        }
      : {}),
    ...(approvedInstructions ? { approvedInstructions } : {}),
    coordination: {
      verified,
      ...(delegations.status !== "available" || delegations.data.total
        ? { delegations: boundedAssignments(delegations) }
        : {}),
      ...(claims.status !== "available" || claims.data.total
        ? { claims: boundedAssignments(claims) }
        : {}),
    },
    ...(input.snapshotRevision !== undefined
      ? { snapshot: { matches: input.snapshotRevision === thread.revision } }
      : {}),
    ...(discussion
      ? {
          discussion: {
            ...discussion,
            ...(!discussion.complete
              ? {
                  next: {
                    tool: "feedbacks_thread",
                    input: {
                      threadId: thread.id,
                      section: "discussion",
                      expectedRevision: thread.revision,
                    },
                  },
                }
              : {}),
          },
        }
      : {}),
    ...(media ? { media } : {}),
    ...(recordings ? { recordings } : {}),
    ...(image ? { image } : {}),
    ...(thread.diagnosticEvidence?.count
      ? {
          diagnosticEvidence: {
            count: thread.diagnosticEvidence.count,
            evidenceIds: thread.diagnosticEvidence.latest?.map((d: any) => d.id),
          },
        }
      : {}),
    next,
  };
}
