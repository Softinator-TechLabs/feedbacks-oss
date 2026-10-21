import { z } from "zod";

export const boardStates = [
  "open",
  "in_progress",
  "ready_for_review",
  "resolved",
  "declined",
] as const;
export const boardStateSchema = z.enum(boardStates);
export const boardColumnSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/),
  name: z.string().trim().min(1).max(60),
  states: z.array(boardStateSchema).min(1).max(5),
  entryState: boardStateSchema,
});
export const boardConfigurationSchema = z
  .object({
    columns: z.array(boardColumnSchema).min(1).max(5),
    intakeColumnId: boardColumnSchema.shape.id,
  })
  .superRefine((board, ctx) => {
    const states = board.columns.flatMap((column) => column.states);
    if (
      states.length !== boardStates.length ||
      new Set(states).size !== boardStates.length
    )
      ctx.addIssue({
        code: "custom",
        path: ["columns"],
        message: "Map every work status to exactly one column",
      });
    if (new Set(board.columns.map((column) => column.id)).size !== board.columns.length)
      ctx.addIssue({
        code: "custom",
        path: ["columns"],
        message: "Column IDs must be distinct",
      });
    if (
      new Set(board.columns.map((column) => column.name.toLowerCase())).size !==
      board.columns.length
    )
      ctx.addIssue({
        code: "custom",
        path: ["columns"],
        message: "Column names must be distinct",
      });
    board.columns.forEach((column, index) => {
      if (!column.states.includes(column.entryState))
        ctx.addIssue({
          code: "custom",
          path: ["columns", index, "entryState"],
          message: "Entry status must belong to this column",
        });
    });
    if (
      !board.columns
        .find((column) => column.id === board.intakeColumnId)
        ?.states.includes("open")
    )
      ctx.addIssue({
        code: "custom",
        path: ["intakeColumnId"],
        message: "The intake column must include Open",
      });
  });
export type BoardConfiguration = z.infer<typeof boardConfigurationSchema>;
export type BoardColumn = z.infer<typeof boardColumnSchema>;
export const defaultBoardConfiguration: BoardConfiguration = {
  columns: [
    { id: "intake", name: "Intake", states: ["open"], entryState: "open" },
    {
      id: "in_progress",
      name: "In progress",
      states: ["in_progress"],
      entryState: "in_progress",
    },
    {
      id: "review",
      name: "Ready for review",
      states: ["ready_for_review"],
      entryState: "ready_for_review",
    },
    {
      id: "done",
      name: "Done",
      states: ["resolved", "declined"],
      entryState: "resolved",
    },
  ],
  intakeColumnId: "intake",
};
