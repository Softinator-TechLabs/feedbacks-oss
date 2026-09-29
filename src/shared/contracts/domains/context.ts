import { z } from "zod";
import { id, page, reviewerContextOutput } from "../common.js";
import {
  threadOutput,
  actorOutput,
  projectOutput,
  instructionsOutput,
} from "../output-common.js";

export const contextInputs = {
  "context.reviewers": z.object({ projectId: id }),
  "context.export": z.object({
    projectId: id,
    ...page,
    snapshotId: id.optional(),
  }),
  "context.changes": z.object({
    projectId: id,
    cursor: z.string().regex(/^\d+$/).default("0"),
    limit: z.number().int().min(1).max(100).default(50),
  }),
};

export const contextOutputs = {
  "context.reviewers": reviewerContextOutput,
  "context.export": z.object({
    schemaVersion: z.literal(1),
    project: projectOutput,
    approvedInstructions: instructionsOutput,
    discussionTrust: z.literal("untrusted_discussion"),
    cursor: z.string(),
    items: z.array(threadOutput),
    snapshotId: id,
    total: z.number().int(),
    nextOffset: z.number().int().nullable(),
  }),
  "context.changes": z.object({
    schemaVersion: z.literal(1),
    items: z.array(
      z.object({
        cursor: z.string(),
        entityId: z.string(),
        kind: z.string(),
        // Discussion-like changes intentionally omit voter attribution.
        actor: actorOutput.optional(),
        createdAt: z.string(),
      }),
    ),
    cursor: z.string(),
    hasMore: z.boolean(),
  }),
};
