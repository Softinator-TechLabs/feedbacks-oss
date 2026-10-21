import { z } from "zod";
import { id, revision, page } from "../common.js";
import {
  notificationEvent,
  notificationTemplates,
  notificationTemplate,
  mailTransport,
  mailIdentity,
} from "../../notifications.js";
const scope = { projectId: id.optional() };
const settings = z.object({
  revision: z.number().int().nonnegative(),
  enabled: z.boolean(),
  provider: z.enum(["smtp", "mailjet", "ses"]).nullable(),
  sesAuthMode: z.enum(["role", "keys"]).nullable(),
  identity: mailIdentity.nullable(),
  templates: notificationTemplates,
  effectiveTemplates: notificationTemplates,
  inherited: z.boolean(),
  identityOverridden: z.boolean(),
  inheritedTemplates: notificationTemplates,
  configured: z.boolean(),
});
const subscription = z.object({
  events: z.array(notificationEvent).max(5),
  includeSelf: z.boolean(),
  includeContent: z.boolean(),
  revision: z.number().int().nonnegative(),
});
export const notificationsInputs = {
  "notifications.settings": z.object(scope).strict(),
  "notifications.configure": z
    .object({
      ...scope,
      revision: z.number().int().nonnegative(),
      enabled: z.boolean(),
      transport: mailTransport.optional(),
      identity: mailIdentity.optional(),
      inheritTransport: z.boolean().optional(),
      templates: notificationTemplates,
    })
    .strict(),
  "notifications.preview": z
    .object({ ...scope, event: notificationEvent, template: notificationTemplate })
    .strict(),
  "notifications.subscription": z.object({ projectId: id }).strict(),
  "notifications.subscribe": z.object({ projectId: id, ...subscription.shape }).strict(),
  "notifications.deliveries": z.object({ ...scope, ...page }).strict(),
  "notifications.reconcile": z
    .object({
      ...scope,
      deliveryId: id,
      revision,
      decision: z.enum(["retry", "accepted", "cancel"]),
      confirmedNotAccepted: z.literal(true).optional(),
    })
    .strict(),
  "notifications.test": z
    .object({ ...scope, idempotencyKey: z.string().min(8).max(200) })
    .strict(),
};
export const notificationsOutputs = {
  "notifications.settings": settings,
  "notifications.configure": settings,
  "notifications.preview": z.object({ subject: z.string(), text: z.string() }),
  "notifications.subscription": subscription,
  "notifications.subscribe": subscription,
  "notifications.test": z.object({ queued: z.literal(true), deliveryId: id }),
  "notifications.deliveries": z.object({
    items: z.array(
      z.object({
        id,
        projectId: id.nullable(),
        event: z.string(),
        recipient: z.string(),
        status: z.string(),
        attempts: z.number(),
        revision,
        createdAt: z.string(),
        acceptedAt: z.string().nullable(),
        errorCode: z.string().nullable(),
      }),
    ),
    nextOffset: z.number().nullable(),
  }),
  "notifications.reconcile": z.object({ updated: z.literal(true) }),
};
