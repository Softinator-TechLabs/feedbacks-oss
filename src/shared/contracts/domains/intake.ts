import { z } from "zod";
import { id } from "../common.js";
const exactOrigin = z
  .string()
  .url()
  .max(300)
  .refine((value) => {
    try {
      const u = new URL(value);
      return (
        ["http:", "https:"].includes(u.protocol) &&
        u.origin === value &&
        !u.username &&
        !u.password
      );
    } catch {
      return false;
    }
  }, "Use an exact HTTP or HTTPS origin");
export const intakeConfig = z.object({
  origins: z.array(exactOrigin).min(1).max(20),
  label: z.string().trim().min(1).max(60).default("Send feedback"),
  position: z.enum(["right", "left"]).default("right"),
  color: z.enum(["oxford", "forest", "slate"]).default("oxford"),
  privacyText: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .default(
      "Your feedback and page address go to this website's team. Do not include passwords or other sensitive information.",
    ),
  privacyUrl: z
    .string()
    .url()
    .max(1000)
    .refine((value) => {
      const u = new URL(value);
      return u.protocol === "https:" && !u.username && !u.password;
    })
    .nullable()
    .default(null),
  collectContact: z.boolean().default(false),
  dailyLimit: z.number().int().min(1).max(1000).default(100),
});
const settings = z.object({
  configured: z.boolean(),
  id: id.nullable(),
  revision: z.number().int().nonnegative(),
  enabled: z.boolean(),
  config: intakeConfig.nullable(),
  snippet: z.string().nullable(),
});
const inspect = z.object({ intakeId: id });
const submit = z
  .object({
    intakeId: id,
    requestId: id,
    name: z.string().trim().max(120).default(""),
    body: z.string().trim().min(1).max(12000),
    url: z.string().url().max(4096),
    viewport: z
      .object({
        width: z.number().int().min(1).max(20000),
        height: z.number().int().min(1).max(20000),
      })
      .strict(),
    element: z
      .object({
        tag: z.string().regex(/^[a-z][a-z0-9-]{0,30}$/),
        x: z.number().min(0).max(1),
        y: z.number().min(0).max(1),
      })
      .strict()
      .optional(),
    contact: z
      .object({ email: z.string().trim().email().max(254), consent: z.literal(true) })
      .strict()
      .optional(),
    website: z.string().max(200).default(""),
    turnstileToken: z.string().min(1).max(2048),
  })
  .strict();
export const intakeInputs = {
  "intake.settings": z.object({ projectId: id }),
  "intake.save": z.object({
    projectId: id,
    revision: z.number().int().min(0),
    enabled: z.boolean(),
    config: intakeConfig,
  }),
  "intake.inspect": inspect,
  "intake.submit": submit,
};
export const intakeOutputs = {
  "intake.settings": settings,
  "intake.save": settings,
  "intake.inspect": z.object({
    label: z.string(),
    position: z.enum(["right", "left"]),
    color: z.enum(["oxford", "forest", "slate"]),
    privacyText: z.string(),
    privacyUrl: z.string().nullable(),
    collectContact: z.boolean(),
    turnstileSiteKey: z.string(),
  }),
  "intake.submit": z.object({ posted: z.literal(true) }),
};
export type IntakeConfig = z.infer<typeof intakeConfig>;
export type IntakeSubmission = z.infer<typeof submit>;
