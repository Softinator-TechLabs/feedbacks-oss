import { z } from "zod";
import {
  boardConfigurationSchema,
  boardColumnSchema,
  boardStateSchema,
} from "../../board.js";
import { id, page, reviewFiltersSchema, revision } from "../common.js";
import { threadOutput } from "../output-common.js";

const assignmentVersion = z.string().regex(/^[a-f0-9]{64}$/);
export const boardItemOutput = z.object({
  thread: threadOutput,
  assignmentVersion,
  assignments: z.array(
    z.object({
      id,
      userId: id,
      name: z.string(),
      revision,
      annotationIds: z.array(id),
    }),
  ),
});
export const boardInputs = {
  "board.get": z.object({ projectId: id }),
  "board.configure": z.object({
    projectId: id,
    revision: z.number().int().nonnegative(),
    configuration: boardConfigurationSchema,
  }),
  "board.column": z.object({
    projectId: id,
    boardRevision: z.number().int().nonnegative(),
    columnId: boardColumnSchema.shape.id,
    ...page,
    filters: reviewFiltersSchema,
  }),
  "board.batch": z.object({
    projectId: id,
    boardRevision: z.number().int().nonnegative(),
    threads: z
      .array(z.object({ threadId: id, revision, assignmentVersion }))
      .min(1)
      .max(50)
      .refine(
        (items) => new Set(items.map((item) => item.threadId)).size === items.length,
        "Select distinct feedback",
      ),
    action: z.discriminatedUnion("type", [
      z.object({
        type: z.literal("move"),
        columnId: boardColumnSchema.shape.id,
        state: boardStateSchema.optional(),
      }),
      z.object({ type: z.literal("assign"), userId: id.nullable() }),
      z.object({ type: z.literal("archive"), archived: z.boolean() }),
    ]),
    idempotencyKey: z.string().min(8).max(200),
  }),
};
const boardOutput = z.object({
  projectId: id,
  revision: z.number().int().nonnegative(),
  configuration: boardConfigurationSchema,
});
export const boardOutputs = {
  "board.get": boardOutput,
  "board.configure": boardOutput,
  "board.column": z.object({
    columnId: boardColumnSchema.shape.id,
    boardRevision: z.number().int().nonnegative(),
    items: z.array(boardItemOutput),
    total: z.number().int().nonnegative(),
    nextOffset: z.number().int().nullable(),
  }),
  "board.batch": z.object({
    id,
    projectId: id,
    affected: z.number().int().positive(),
    action: z.enum(["move", "assign", "archive"]),
    threads: z.array(z.object({ threadId: id, revision })),
    completedAt: z.string().datetime(),
  }),
};
