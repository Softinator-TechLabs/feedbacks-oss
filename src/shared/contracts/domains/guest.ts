import { z } from "zod";
import { id, text, name } from "../common.js";

export const guestInputs = {
  "guestLinks.create": z.object({
    threadId: id,
    label: z.string().trim().min(1).max(80),
    expiresInDays: z.number().int().min(1).max(30).default(7),
  }),
  "guestLinks.list": z.object({ threadId: id }),
  "guestLinks.revoke": z.object({ linkId: id }),
  "guest.inspect": z.object({ token: z.string().min(20).max(200) }),
  "guest.reply": z.object({
    token: z.string().min(20).max(200),
    name,
    body: text,
    turnstileToken: z.string().min(1).max(2048),
  }),
  "guestProjectLinks.create": z.object({
    projectId: id,
    label: z.string().trim().min(1).max(80),
    expiresInDays: z.number().int().min(1).max(30).default(7),
    maxSubmissions: z.number().int().min(1).max(50).default(10),
    widget: z.boolean().default(false),
  }),
  "guestProjectLinks.list": z.object({ projectId: id }),
  "guestProjectLinks.revoke": z.object({ linkId: id }),
  "guestProject.inspect": z.object({ token: z.string().min(20).max(200) }),
  "guestProject.submit": z.object({
    token: z.string().min(20).max(200),
    name,
    body: text,
    url: z.string().url().max(4096),
    turnstileToken: z.string().min(1).max(2048),
  }),
  "widget.inspect": z.object({ linkId: id, token: z.string().min(20).max(200) }),
  "widget.submit": z.object({
    linkId: id,
    token: z.string().min(20).max(200),
    name,
    body: text,
    url: z.string().url().max(4096),
    viewport: z.object({
      width: z.number().int().min(1).max(10000),
      height: z.number().int().min(1).max(10000),
    }),
    turnstileToken: z.string().min(1).max(2048),
  }),
};

export const guestOutputs = {
  "guestLinks.create": z.object({
    id,
    token: z.string(),
    expiresAt: z.string(),
    path: z.string(),
  }),
  "guestLinks.list": z.object({
    items: z.array(
      z.object({
        id,
        label: z.string(),
        expiresAt: z.string(),
        revokedAt: z.string().nullable(),
        replies: z.number().int(),
      }),
    ),
  }),
  "guestLinks.revoke": z.object({ revoked: z.boolean() }),
  "guest.inspect": z.object({
    projectName: z.string(),
    threadBody: z.string(),
    expiresAt: z.string(),
    turnstileSiteKey: z.string(),
  }),
  "guest.reply": z.object({ posted: z.boolean() }),
  "guestProjectLinks.create": z.object({
    id,
    token: z.string(),
    expiresAt: z.string(),
    path: z.string(),
    widgetSnippet: z.string().optional(),
  }),
  "guestProjectLinks.list": z.object({
    items: z.array(
      z.object({
        id,
        label: z.string(),
        expiresAt: z.string(),
        revokedAt: z.string().nullable(),
        submissions: z.number().int(),
        maxSubmissions: z.number().int(),
        widget: z.boolean(),
      }),
    ),
  }),
  "guestProjectLinks.revoke": z.object({ revoked: z.boolean() }),
  "guestProject.inspect": z.object({
    projectName: z.string(),
    expiresAt: z.string(),
    turnstileSiteKey: z.string(),
  }),
  "guestProject.submit": z.object({ posted: z.boolean() }),
  "widget.inspect": z.object({ projectName: z.string(), turnstileSiteKey: z.string() }),
  "widget.submit": z.object({ posted: z.boolean() }),
};
