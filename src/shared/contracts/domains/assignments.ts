import { z } from "zod";
import {
  id,
  revision,
  categorySchema,
  tagsSchema,
  assignmentOutput,
  delegationActorOutput,
  delegationOutput,
  delegationPage,
} from "../common.js";

export const assignmentsInputs = {
  "assignments.delegations": z.object({
    projectId: id,
    threadId: id.optional(),
    userId: id.optional(),
    state: z.enum(["active", "all"]).default("active"),
    ...delegationPage,
  }),
  "assignments.assign": z
    .object({
      threadId: id,
      threadRevision: revision,
      delegationId: id.optional(),
      revision: revision.optional(),
      annotationIds: z.array(id).max(100).default([]),
      userId: id,
      summary: z.string().trim().min(1).max(500),
      category: categorySchema,
      tags: tagsSchema,
      githubDecision: z.enum([
        "undecided",
        "create_issue",
        "not_needed",
        "already_linked",
      ]),
      githubRationale: z.string().trim().min(1).max(1000),
      idempotencyKey: z.string().min(1).max(200),
    })
    .refine(
      (i) => !!i.delegationId === !!i.revision,
      "Reassignment requires both delegationId and revision",
    ),
  "assignments.cancel": z.object({
    delegationId: id,
    revision,
    reason: z.string().trim().min(1).max(500),
    idempotencyKey: z.string().min(1).max(200),
  }),
  "assignments.history": z.object({ delegationId: id, ...delegationPage }),
  "assignments.list": z.object({
    projectId: id,
    threadId: id.optional(),
    userId: id.optional(),
    state: z.enum(["active", "all"]).default("active"),
    offset: z.number().int().min(0).max(100000).default(0),
    limit: z.number().int().min(1).max(50).default(10),
  }),
  "assignments.claim": z.object({
    threadId: id,
    revision,
    annotationIds: z.array(id).max(100).default([]),
    summary: z.string().min(1).max(500),
    idempotencyKey: z.string().min(1).max(200),
  }),
  "assignments.renew": z.object({ assignmentId: id, revision }),
  "assignments.release": z.object({
    assignmentId: id,
    revision,
    outcome: z.enum(["completed", "paused"]),
  }),
};

export const assignmentsOutputs = {
  "assignments.delegations": z.object({
    items: z.array(delegationOutput),
    total: z.number(),
    nextOffset: z.number().nullable(),
  }),
  "assignments.assign": delegationOutput,
  "assignments.cancel": delegationOutput,
  "assignments.history": z.object({
    items: z.array(
      z.object({
        id,
        delegationId: id,
        action: z.enum(["assigned", "reassigned", "cancelled"]),
        revision,
        actor: delegationActorOutput,
        reason: z.string().nullable(),
        assignment: delegationOutput,
        createdAt: z.string(),
      }),
    ),
    total: z.number(),
    nextOffset: z.number().nullable(),
  }),
  "assignments.list": z.object({
    items: z.array(assignmentOutput),
    total: z.number(),
    nextOffset: z.number().nullable(),
  }),
  "assignments.claim": assignmentOutput,
  "assignments.renew": assignmentOutput,
  "assignments.release": assignmentOutput,
};
