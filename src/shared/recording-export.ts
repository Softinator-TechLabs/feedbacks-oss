import { z } from "zod";

export const materializeInput = z
  .object({
    recordingId: z.string().uuid(),
    includeVideo: z.boolean().default(true),
  })
  .strict();

export const materializeOutput = z.object({
  directory: z.string(),
  readme: z.string(),
  manifest: z.string(),
  recordingId: z.string().uuid(),
  eventCount: z.number().int().nonnegative(),
  complete: z.boolean(),
  warnings: z.array(z.string()),
  files: z.array(z.string()),
});
