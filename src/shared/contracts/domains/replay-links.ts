import { z } from "zod";
import { id } from "../common.js";
export const replayLinksInputs = {
  "replayLinks.list": z.object({ threadId: id }),
  "replayLinks.add": z.object({
    threadId: id,
    revision: z.number().int().positive(),
    provider: z.enum(["fullstory", "logrocket"]),
    sessionUrl: z.string().url().max(4000),
    pageUrl: z.string().url().max(4096),
    capturedAt: z.string().datetime(),
    idempotencyKey: z.string().min(8).max(120),
  }),
  "replayLinks.remove": z.object({ linkId: id }),
};
export const replayLinksOutputs = {
  "replayLinks.list": z.object({
    items: z.array(
      z.object({
        id,
        threadId: id,
        provider: z.enum(["fullstory", "logrocket"]),
        sessionUrl: z.string(),
        pageUrl: z.string(),
        capturedAt: z.string(),
        attribution: z.literal("reviewer_provided"),
      }),
    ),
  }),
  "replayLinks.add": z.object({ id }),
  "replayLinks.remove": z.object({ removed: z.boolean() }),
};
