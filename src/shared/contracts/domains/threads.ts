import { z } from "zod";
import {
  id,
  text,
  name,
  revision,
  page,
  categorySchema,
  tagsSchema,
  workPlanSchema,
  reviewFiltersSchema,
  contextSchema,
  tm,
  diagnosticsSchema,
} from "../common.js";
import {
  discussionLikesOutput,
  deletionOutput,
  threadOutput,
  reviewViewOutput,
} from "../output-common.js";

export const threadsInputs = {
  "threads.list": z
    .object({
      projectId: id,
      includeSummary: z.boolean().default(false),
      ...page,
      ...reviewFiltersSchema.shape,
    })
    .refine(
      (i) =>
        !i.createdAfter ||
        !i.createdBefore ||
        Date.parse(i.createdAfter) < Date.parse(i.createdBefore),
      { message: "createdAfter must precede createdBefore" },
    ),
  "threads.neighbors": z.object({ threadId: id, ...reviewFiltersSchema.shape }),
  "threads.organize": z.object({
    ...tm,
    category: categorySchema.default("general"),
    tags: tagsSchema,
  }),
  "threads.plan": z.object({ ...tm, workPlan: workPlanSchema }),
  "threads.annotationPlan": z.object({
    ...tm,
    annotationId: id,
    workPlan: workPlanSchema,
  }),
  "threads.priority": z.object({ ...tm, topPriority: z.boolean() }),
  "reviewViews.list": z.object({ projectId: id }),
  "reviewViews.save": z.object({
    projectId: id,
    viewId: id.optional(),
    revision: z.number().int().min(0).default(0),
    name: z.string().trim().min(1).max(80),
    filters: reviewFiltersSchema,
  }),
  "reviewViews.delete": z.object({ projectId: id, viewId: id, revision }),
  "threads.get": z.object({ threadId: id }),
  "threads.activity": z.object({
    threadId: id,
    before: z
      .string()
      .regex(/^\d{1,19}$/)
      .optional(),
    limit: z.number().int().min(1).max(50).default(20),
  }),
  "threads.issueDraft": z.object({
    threadId: id,
    repositoryUrl: z.string().url().max(1000).optional(),
  }),
  "threads.like": z.object({
    threadId: id,
    replyId: id.optional(),
    liked: z.boolean(),
  }),
  "threads.create": z
    .object({
      projectId: id,
      body: text,
      context: contextSchema.optional(),
      document: z
        .object({
          documentId: id,
          page: z.number().int().min(1).max(25),
          x: z.number().min(0).max(1),
          y: z.number().min(0).max(1),
        })
        .optional(),
      category: categorySchema.default("general"),
      tags: tagsSchema.default([]),
      diagnostics: diagnosticsSchema.optional(),
      idempotencyKey: z.string().min(8).max(200),
    })
    .refine((input) => !!input.context !== !!input.document, {
      message: "Choose one website context or document position",
    }),
  "threads.reply": z.object({
    ...tm,
    body: text,
    intent: z.enum(["request", "response"]).optional(),
    idempotencyKey: z.string().min(8).max(200),
    mentions: z.array(id).max(30).default([]),
  }),
  "threads.editReply": z.object({
    ...tm,
    replyId: id,
    body: text,
    mentions: z.array(id).max(30).default([]),
    idempotencyKey: z.string().min(8).max(200),
  }),
  "threads.deleteReply": z.object({
    ...tm,
    replyId: id,
    idempotencyKey: z.string().min(8).max(200),
  }),
  "threads.status": z.object({
    ...tm,
    state: z.enum(["open", "in_progress", "ready_for_review", "resolved", "declined"]),
    note: z.string().trim().max(12000).optional(),
    duplicateOf: id.optional(),
  }),
  "threads.annotationStatus": z.object({
    ...tm,
    annotationId: id,
    state: z.enum(["open", "resolved", "removed"]),
  }),
  "threads.review": z.object({
    ...tm,
    decision: z.enum(["approved", "changes_requested", "reopen"]),
    note: z.string().trim().max(4000).default(""),
  }),
  "threads.linkIssue": z.object({
    ...tm,
    url: z.string().url(),
    createdAt: z.string().datetime().optional(),
  }),
  "threads.figmaReference": z.object({
    ...tm,
    url: z.string().url().max(2000).nullable(),
  }),
  "threads.evidence": z.object({
    ...tm,
    url: z.string().url().max(2000),
    note: text,
    kind: z
      .enum(["commit", "pull_request", "variant", "incorporated_in"])
      .default("incorporated_in"),
  }),
  "threads.archive": z.object({ ...tm, archived: z.boolean() }),
  "threads.move": z.object({ ...tm, projectId: id }),
  "threads.delete": z.object({
    projectId: id,
    threads: z
      .array(z.object(tm))
      .min(1)
      .max(50)
      .refine(
        (items) => new Set(items.map((item) => item.threadId)).size === items.length,
        "Select distinct threads",
      ),
    idempotencyKey: z.string().min(8).max(200),
    confirmation: z.literal("DELETE"),
  }),
  "threads.deletions": z.object({ projectId: id, activeOnly: z.boolean().optional() }),
  "threads.retryDeletion": z.object({ projectId: id, deletionId: id }),
};

export const threadsOutputs = {
  "threads.list": z.object({
    items: z.array(threadOutput),
    summary: z
      .object({
        threads: z.object({
          open: z.number().int(),
          closed: z.number().int(),
          total: z.number().int(),
        }),
        points: z.object({
          open: z.number().int(),
          resolved: z.number().int(),
          closed: z.number().int(),
          removed: z.number().int(),
          total: z.number().int(),
        }),
      })
      .optional(),
    total: z.number().int(),
    nextOffset: z.number().int().nullable(),
    websiteFilters: z.object({
      domains: z.array(z.string()),
      hostnames: z.array(z.string()),
    }),
  }),
  "threads.get": threadOutput,
  "threads.activity": z.object({
    threadId: id,
    revision: z.number(),
    coverage: z.literal("recorded_events_only"),
    limitation: z.string(),
    items: z.array(
      z.object({
        cursor: z.string(),
        kind: z.string(),
        createdAt: z.string(),
        revision: z.number().optional(),
      }),
    ),
    nextBefore: z.string().nullable(),
  }),
  "threads.issueDraft": z.object({
    projectId: id,
    threadId: id,
    revision,
    repositoryUrl: z.string().nullable(),
    sourcePath: z.string(),
    title: z.string(),
    body: z.string(),
    trust: z.literal("untrusted_discussion"),
    requiresReview: z.literal(true),
    warnings: z.array(z.string()),
  }),
  "threads.neighbors": z.object({
    previous: id.nullable(),
    next: id.nullable(),
    position: z.number().int().nullable(),
    total: z.number().int(),
  }),
  "threads.organize": threadOutput,
  "threads.plan": threadOutput,
  "threads.annotationPlan": threadOutput,
  "threads.priority": threadOutput,
  "reviewViews.list": z.object({ items: z.array(reviewViewOutput) }),
  "reviewViews.save": reviewViewOutput,
  "reviewViews.delete": z.object({ deleted: z.boolean() }),
  "threads.like": discussionLikesOutput.extend({
    threadId: id,
    replyId: id.nullable(),
  }),
  "threads.create": threadOutput,
  "threads.reply": threadOutput,
  "threads.editReply": threadOutput,
  "threads.deleteReply": threadOutput,
  "threads.status": threadOutput,
  "threads.annotationStatus": threadOutput,
  "threads.review": threadOutput,
  "threads.linkIssue": threadOutput,
  "threads.figmaReference": threadOutput,
  "threads.evidence": threadOutput,
  "threads.archive": threadOutput,
  "threads.move": threadOutput,
  "threads.delete": deletionOutput,
  "threads.deletions": z.object({ items: z.array(deletionOutput) }),
  "threads.retryDeletion": deletionOutput,
};
