import { z } from "zod";
import {
  id,
  name,
  revision,
  categorySchema,
  projectCategoryInput,
  projectTagInput,
  workPlanSchema,
  reviewFiltersSchema,
  screenshotMarkSchema,
  imageMarkupSchema,
  recordingFrameSchema,
  captureRegionSchema,
  captureSectionSchema,
  captureMode,
  reviewerContextOutput,
  recordingSchema,
} from "./common.js";

export const discussionLikesOutput = z.object({
  uniqueLikes: z.number().int().nonnegative(),
  liked: z.boolean(),
});
export const assetMetadataOutput = z.object({
  id,
  captureId: id,
  rendition: z.enum(["screenshot", "annotated", "thumbnail", "tabVideo"]),
  width: z.number().optional(),
  height: z.number().optional(),
  bytes: z.number(),
  contentType: z.enum(["image/webp", "video/webm"]),
  durationMs: z.number().int().positive().max(300000).optional(),
  createdAt: z.string(),
  url: z.string(),
  filename: z.string().optional(),
  captureRegion: captureRegionSchema.optional(),
  recordingFrame: recordingFrameSchema.optional(),
  captureSections: z.array(captureSectionSchema).optional(),
  markings: z.array(screenshotMarkSchema).optional(),
  markup: imageMarkupSchema.optional(),
  baseAssetId: id.optional(),
  projectId: id.optional(),
  threadId: id.optional(),
});
export const imagePreviewOutput = z.object({
  mimeType: z.literal("image/webp"),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  sourceWidth: z.number().int().positive().optional(),
  sourceHeight: z.number().int().positive().optional(),
  crop: z
    .object({
      left: z.number().int().min(0),
      top: z.number().int().min(0),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    })
    .optional(),
});
export const assetOutput = assetMetadataOutput.extend({
  image: imagePreviewOutput.extend({ data: z.string().max(2800000) }).optional(),
  preview: imagePreviewOutput.optional(),
});
export const deletionOutput = z.object({
  id,
  projectId: id,
  deletedCount: z.number().int(),
  createdAt: z.string(),
  cleanup: z.object({
    state: z.enum(["pending", "failed", "complete"]),
    total: z.number().int(),
    remaining: z.number().int(),
    failed: z.number().int(),
  }),
});
export const diagnosticEvidenceSummaryOutput = z.object({
  id,
  threadId: id,
  projectId: id,
  status: z.enum(["pending", "complete", "expired"]),
  startedAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  totalBytes: z.number().int().nonnegative(),
  fileCount: z.number().int().nonnegative(),
  coverage: z.record(
    z.string(),
    z.enum(["complete", "partial", "unavailable", "stopped"]),
  ),
});
export const threadOutput = z
  .object({
    id,
    projectId: id,
    revision,
    annotationStates: z
      .record(
        z.string().uuid(),
        z.object({
          state: z.enum(["open", "resolved", "removed"]),
          actor: z.object({}).passthrough(),
          at: z.string().datetime(),
        }),
      )
      .optional(),
    annotationPlans: z.record(z.string().uuid(), workPlanSchema).optional(),
    body: z.string(),
    // Older immutable export snapshots may predate explicit priority.
    topPriority: z.boolean().optional(),
    // Older immutable snapshots may predate attachment metadata.
    assets: z.array(assetMetadataOutput).optional(),
    // Pre-migration immutable export snapshots have no discussion-like fields.
    likes: discussionLikesOutput.optional(),
    replies: z.array(
      z.object({ id, likes: discussionLikesOutput.optional() }).passthrough(),
    ),
    context: z.object({}).passthrough(),
    response: z
      .object({ state: z.enum(["unanswered", "responded", "needs-follow-up"]) })
      .passthrough(),
    work: z
      .object({
        state: z.enum([
          "open",
          "in_progress",
          "ready_for_review",
          "resolved",
          "declined",
        ]),
      })
      .passthrough(),
    workPlan: workPlanSchema.optional(),
    // Older immutable export snapshots predate review rounds.
    review: z
      .object({
        round: z.number().int().positive(),
        state: z.enum(["open", "approved", "changes_requested"]),
        history: z.array(z.object({}).passthrough()),
      })
      .optional(),
    externalIssues: z.array(
      z
        .object({
          url: z.string(),
          provider: z.enum(["github", "jira", "linear"]).optional(),
          verification: z.enum(["reported", "github_verified"]),
        })
        .passthrough(),
    ),
    figmaReference: z
      .object({
        url: z.string().url(),
        linkedBy: z.object({}).passthrough(),
        linkedAt: z.string().datetime(),
      })
      .nullable()
      .optional(),
    fixEvidence: z.array(z.object({}).passthrough()),
    pins: z.object({ defaultVisible: z.boolean() }),
    lastActor: z.object({}).passthrough(),
    updatedAt: z.string(),
    priorityScore: z.number().optional(),
    reviewerContext: reviewerContextOutput.optional(),
    diagnosticEvidence: z
      .object({
        count: z.number().int().nonnegative(),
        latest: z.array(diagnosticEvidenceSummaryOutput).max(3),
        followUp: z.array(z.string()),
      })
      .optional(),
  })
  .passthrough();
export const actorOutput = z.object({
  id,
  userId: id,
  name: z.string(),
  kind: z.enum(["human", "agent", "extension", "guest"]),
  owner: z.boolean().optional(),
  primaryOwner: z.boolean().optional(),
  mustChangePassword: z.boolean().optional(),
  ownerAdmin: z.boolean().optional(),
});
export const projectOutput = z.object({
  id,
  name: z.string(),
  origins: z.array(z.string()),
  captureMode: captureMode.optional(),
  repositoryUrl: z.string().nullable(),
  githubRepositories: z.array(z.string().url()).max(20).optional(),
  githubConnected: z.boolean().optional(),
  githubStatusSync: z.boolean().optional(),
  reviewEnabled: z.boolean().default(false),
  documentsEnabled: z.boolean().default(false),
  surveysEnabled: z.boolean().default(false),
  taxonomy: z
    .object({
      categories: z.array(projectCategoryInput.extend({ id: categorySchema })),
      tags: z.array(projectTagInput),
    })
    .optional(),
  revision,
  permissions: z.object({
    role: z.enum(["maintainer", "reviewer", "viewer"]),
    canWrite: z.boolean(),
    canMaintain: z.boolean(),
    canResolve: z.boolean(),
  }),
});
export const viewOutput = z.object({
  fingerprint: z.string(),
  uniqueLikes: z.number().int(),
  liked: z.boolean(),
  discussionCount: z.number().int(),
  weightedPreference: z.number().optional(),
});
export const instructionsOutput = z.object({
  trust: z.literal("approved_project_instructions"),
  revision: z.number().int(),
  items: z.array(
    z.object({
      id,
      version: z.number().int(),
      body: z.string(),
      actor: actorOutput,
      createdAt: z.string(),
    }),
  ),
});
export const reviewViewOutput = z.object({
  id,
  revision,
  name: z.string(),
  filters: reviewFiltersSchema,
});
export const documentOutput = z.object({
  id,
  projectId: id,
  name: z.string(),
  kind: z.enum(["pdf", "image"]),
  contentType: z.enum(["application/pdf", "image/webp"]),
  pageCount: z.number().int().positive(),
  pages: z.array(z.object({ width: z.number(), height: z.number() })).optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  bytes: z.number().int().positive(),
  createdAt: z.string(),
  url: z.string(),
});
export const recordingSummaryOutput = z.object({
  id,
  projectId: id,
  threadId: id,
  startedAt: z.string(),
  durationMs: z.number(),
  mode: z.enum(["session", "video"]),
  url: z.string(),
  privacy: recordingSchema.shape.privacy,
  coverage: recordingSchema.shape.coverage,
  eventCount: z.number(),
  video: recordingSchema.shape.video.optional(),
  createdAt: z.string(),
});
export const recordingExportThreadOutput = z.object({
  id,
  revision: z.number().int().positive(),
  projectId: id,
  body: z.string(),
  context: z.unknown(),
  createdAt: z.string(),
  discussionTruncated: z.boolean(),
  framesTruncated: z.boolean(),
  frames: z
    .array(
      z.object({
        id,
        contentType: z.string(),
        filename: z.string().optional(),
        recordingFrame: recordingFrameSchema,
      }),
    )
    .max(100),
  discussion: z.array(
    z.object({ id, body: z.string(), author: z.unknown(), createdAt: z.string() }),
  ),
});
