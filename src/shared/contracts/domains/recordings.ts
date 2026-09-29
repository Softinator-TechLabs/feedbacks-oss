import { z } from "zod";
import {
  id,
  tm,
  recordingSchema,
  recordingEventSchema,
  RECORDING_EVENTS_PAGE_MAX,
} from "../common.js";
import {
  threadOutput,
  recordingSummaryOutput,
  recordingExportThreadOutput,
} from "../output-common.js";

export const recordingsInputs = {
  "recordings.upload": z.object({
    ...tm,
    recording: recordingSchema,
    idempotencyKey: z.string().min(8).max(200),
  }),
  "recordings.list": z.object({ threadId: id }),
  "recordings.get": z.object({ recordingId: id }),
  "recordings.events": z.object({
    recordingId: id,
    offset: z.number().int().min(0).max(50000).default(0),
    limit: z.number().int().min(1).max(RECORDING_EVENTS_PAGE_MAX).default(100),
    type: recordingEventSchema.shape.type.optional(),
    fromMs: z.number().finite().min(0).max(300000).optional(),
    toMs: z.number().finite().min(0).max(300000).optional(),
  }),
  "recordings.export": z.object({ recordingId: id }),
};

export const recordingsOutputs = {
  "recordings.upload": z.object({
    recording: recordingSummaryOutput,
    thread: threadOutput,
  }),
  "recordings.list": z.object({ items: z.array(recordingSummaryOutput) }),
  "recordings.get": z.object({ recording: recordingSchema }),
  "recordings.events": z.object({
    items: z.array(recordingEventSchema),
    nextOffset: z.number().nullable(),
    total: z.number(),
  }),
  "recordings.export": z.object({
    recording: recordingSchema,
    thread: recordingExportThreadOutput,
  }),
};
