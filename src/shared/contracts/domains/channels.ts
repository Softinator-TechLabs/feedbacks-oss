import { z } from "zod";
import { id } from "../common.js";
export const channelEvents = ["created", "discussion", "status", "assignment"] as const;
export const channelsInputs = {
  "channels.list": z.object({ projectId: id }),
  "channels.save": z.object({
    projectId: id,
    channelId: id.optional(),
    revision: z.number().int().positive().optional(),
    provider: z.enum(["slack", "teams"]),
    label: z.string().trim().min(1).max(100),
    webhookUrl: z.string().url().max(4000).optional(),
    events: z.array(z.enum(channelEvents)).min(1).max(4),
  }),
  "channels.disable": z.object({ channelId: id, revision: z.number().int().positive() }),
  "channels.test": z.object({
    channelId: id,
    idempotencyKey: z.string().min(8).max(120),
  }),
  "channels.deliveries": z.object({ projectId: id }),
  "channels.reconcile": z.object({ deliveryId: id, delivered: z.boolean() }),
};
const summary = z.object({
  id,
  projectId: id,
  provider: z.enum(["slack", "teams"]),
  label: z.string(),
  revision: z.number().int(),
  enabled: z.boolean(),
  events: z.array(z.enum(channelEvents)),
  errorCode: z.string().nullable(),
});
export const channelsOutputs = {
  "channels.list": z.object({ channels: z.array(summary) }),
  "channels.save": summary,
  "channels.disable": summary,
  "channels.test": z.object({ deliveryId: id }),
  "channels.deliveries": z.object({
    items: z.array(
      z.object({
        id,
        channelId: id,
        event: z.string(),
        status: z.string(),
        attempts: z.number().int(),
        errorCode: z.string().nullable(),
        createdAt: z.string(),
      }),
    ),
  }),
  "channels.reconcile": z.object({ reconciled: z.boolean() }),
};
