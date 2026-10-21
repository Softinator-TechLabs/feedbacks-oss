import { z } from "zod";

export const notificationEvents = [
  "created",
  "reply",
  "mention",
  "status",
  "assignment",
] as const;
export const notificationEvent = z.enum(notificationEvents);
export const notificationTemplate = z
  .object({
    subject: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .refine((s) => !/[\r\n]/.test(s), "Subject must be one line"),
    text: z.string().trim().min(1).max(20000),
  })
  .strict();
export const notificationTemplates = z.partialRecord(
  notificationEvent,
  notificationTemplate,
);
export const templateVariables = [
  "project",
  "event",
  "actor",
  "title",
  "comment",
  "status",
  "threadUrl",
  "preferencesUrl",
] as const;
export const defaultTemplates = Object.fromEntries(
  notificationEvents.map((kind) => [
    kind,
    {
      subject: "[{{project}}] {{event}}",
      text: "{{actor}}: {{event}}\n\n{{title}}\n{{comment}}\n{{status}}\n\nOpen feedback: {{threadUrl}}\nNotification preferences: {{preferencesUrl}}",
    },
  ]),
) as Record<(typeof notificationEvents)[number], z.infer<typeof notificationTemplate>>;
const email = z.string().email().max(254);
const credential = z.string().min(1).max(10000);
export const mailTransport = z.discriminatedUnion("provider", [
  z
    .object({
      provider: z.literal("smtp"),
      host: z
        .string()
        .min(1)
        .max(253)
        .regex(/^[a-zA-Z0-9.-]+$/),
      port: z.union([z.literal(465), z.literal(587)]),
      user: z.string().min(1).max(254),
      password: credential.optional(),
      oauth: z
        .object({
          clientId: credential,
          clientSecret: credential,
          refreshToken: credential,
        })
        .strict()
        .optional(),
    })
    .strict(),
  z
    .object({
      provider: z.literal("mailjet"),
      apiKey: credential,
      apiSecret: credential.optional(),
    })
    .strict(),
  z
    .object({
      provider: z.literal("ses"),
      authMode: z.enum(["role", "keys"]).optional(),
      region: z.string().regex(/^[a-z]{2}(?:-[a-z]+)+-\d$/),
      accessKeyId: credential.optional(),
      secretAccessKey: credential.optional(),
      sessionToken: credential.optional(),
      configurationSet: z.string().max(64).optional(),
    })
    .strict(),
]);
export const mailIdentity = z
  .object({
    fromEmail: email,
    fromName: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .refine((s) => !/[\r\n]/.test(s)),
    replyTo: email.optional(),
  })
  .strict();
export type MailTransport = z.infer<typeof mailTransport>;
export type MailIdentity = z.infer<typeof mailIdentity>;
export type MailTemplate = z.infer<typeof notificationTemplate>;
export type NotificationEvent = (typeof notificationEvents)[number];
export function validateMailTemplates(
  templates: Partial<Record<NotificationEvent, MailTemplate>>,
) {
  for (const template of Object.values(templates)) {
    for (const source of [template.subject, template.text]) {
      const matches = [...source.matchAll(/\{\{([^{}]+)\}\}/g)];
      if (
        matches.some(
          (match) => !(templateVariables as readonly string[]).includes(match[1].trim()),
        ) ||
        /[{}]/.test(source.replace(/\{\{[^{}]+\}\}/g, ""))
      )
        throw Error("Use only the documented template variables");
    }
  }
}
export function renderMailTemplate(
  template: MailTemplate,
  variables: Record<string, string>,
) {
  validateMailTemplates({ created: template });
  const render = (text: string) =>
    text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => variables[key] ?? "");
  return {
    subject: render(template.subject)
      .replace(/[\r\n]+/g, " ")
      .slice(0, 200),
    text: render(template.text),
  };
}
