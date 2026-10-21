import { z } from "zod";
import { id } from "../common.js";
const issueUrl = z.string().url().max(2048);
const commentId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const job = z.object({
  id,
  threadId: id,
  issueUrl,
  status: z.enum([
    "pending",
    "processing",
    "delivered",
    "failed",
    "uncertain",
    "abandoned",
    "cancelled",
  ]),
  attempts: z.number().int(),
  errorCode: z.string().nullable(),
  commentId: commentId.nullable(),
  commentUrl: z.string().nullable(),
  createdAt: z.string(),
  historical: z.boolean(),
});
export const githubCommentsInputs = {
  "github.comments": z.object({
    threadId: id,
    issueUrl,
    page: z.number().int().min(1).max(1000).default(1),
  }),
  "github.commentQueue": z.object({
    threadId: id,
    revision: z.number().int().positive(),
    issueUrl,
    reviewed: z.literal(true),
    body: z.string().trim().min(1).max(12000),
    idempotencyKey: z.string().min(8).max(120),
  }),
  "github.commentHistory": z.object({ threadId: id }),
  "github.commentReconcile": z.object({
    jobId: id,
    outcome: z.enum(["delivered", "not_delivered"]),
    commentId: commentId.optional(),
    confirmed: z.literal(true),
  }),
};
export const githubCommentsOutputs = {
  "github.comments": z.object({
    items: z
      .array(
        z.object({
          id: commentId,
          url: z.string(),
          body: z.string(),
          author: z.string().nullable(),
          createdAt: z.string(),
        }),
      )
      .max(20),
    hasMore: z.boolean(),
    page: z.number().int(),
  }),
  "github.commentQueue": job,
  "github.commentHistory": z.object({ items: z.array(job).max(100) }),
  "github.commentReconcile": job,
};
