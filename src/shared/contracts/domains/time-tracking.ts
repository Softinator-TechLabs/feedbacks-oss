import { z } from "zod";
import { id, calendarDateSchema } from "../common.js";
const remoteId = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9_-]+$/);
export const timeDestination = z.object({
  accountId: remoteId,
  projectId: remoteId,
  taskId: remoteId,
  userId: remoteId.optional(),
});
export const timeTrackingInputs = {
  "timeTracking.list": z.object({ projectId: id }),
  "timeTracking.save": z.object({
    projectId: id,
    connectionId: id.optional(),
    revision: z.number().int().positive().optional(),
    provider: z.enum(["harvest", "timedoctor"]),
    label: z.string().trim().min(1).max(100),
    destination: timeDestination,
    token: z.string().trim().min(5).max(16000).optional(),
  }),
  "timeTracking.disable": z.object({
    connectionId: id,
    revision: z.number().int().positive(),
  }),
  "timeTracking.test": z.object({ connectionId: id }),
  "timeTracking.log": z.object({
    connectionId: id,
    threadId: id,
    revision: z.number().int().positive(),
    spentDate: calendarDateSchema,
    minutes: z.number().int().min(1).max(1440),
    startedAt: z.string().datetime().optional(),
    note: z.string().trim().min(1).max(4000),
    idempotencyKey: z.string().min(8).max(120),
  }),
  "timeTracking.history": z.object({ threadId: id }),
  "timeTracking.reconcile": z.object({
    entryId: id,
    remoteId: remoteId.optional(),
    delivered: z.boolean(),
  }),
};
const connection = z.object({
  id,
  projectId: id,
  provider: z.enum(["harvest", "timedoctor"]),
  label: z.string(),
  destination: timeDestination,
  enabled: z.boolean(),
  revision: z.number().int(),
  health: z.string(),
  errorCode: z.string().nullable(),
});
const entry = z.object({
  historical: z.boolean(),
  id,
  connectionId: id,
  threadId: id,
  minutes: z.number().int(),
  spentDate: z.string(),
  status: z.string(),
  remoteId: z.string().nullable(),
  errorCode: z.string().nullable(),
});
export const timeTrackingOutputs = {
  "timeTracking.list": z.object({ connections: z.array(connection) }),
  "timeTracking.save": connection,
  "timeTracking.disable": connection,
  "timeTracking.test": z.object({
    healthy: z.boolean(),
    targetName: z.string(),
    errorCode: z.string().nullable(),
  }),
  "timeTracking.log": entry,
  "timeTracking.history": z.object({ entries: z.array(entry) }),
  "timeTracking.reconcile": entry,
};
