import { z } from "zod";
import { id, contextSchema } from "../common.js";
import { viewOutput } from "../output-common.js";

export const viewsInputs = {
  "views.get": z.object({ projectId: id, context: contextSchema }),
  "views.like": z.object({
    projectId: id,
    context: contextSchema,
    liked: z.boolean(),
  }),
};

export const viewsOutputs = {
  "views.get": viewOutput,
  "views.like": viewOutput,
};
