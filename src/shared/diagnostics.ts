import { z } from "zod";
export function diagnosticText(value: string) {
  return value
    .replace(/https?:\/\/[^\s<>"']+/gi, (match) => {
      try {
        const url = new URL(match);
        return url.origin;
      } catch {
        return "[url]";
      }
    })
    .replace(/\b(?:bearer\s+)[\w.+/=-]+/gi, "Bearer [redacted]")
    .replace(
      /\b(token|password|secret|api[_-]?key|authorization|cookie)\s*[:=]\s*[^\s,;]+/gi,
      "$1=[redacted]",
    )
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[email]")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .slice(0, 400);
}
const url = z
  .string()
  .url()
  .max(4096)
  .refine((s) => /^https?:/.test(s), "HTTP(S) resource required")
  .transform((s) => {
    const u = new URL(s);
    return u.origin;
  });
const ms = z.number().finite().min(0).max(3600000);
export const diagnosticsSchema = z
  .object({
    approved: z.literal(true),
    source: z.literal("browser_opt_in"),
    startedAt: z.string().datetime(),
    endedAt: z.string().datetime(),
    console: z
      .array(
        z
          .object({
            level: z.enum(["error", "warn", "exception", "rejection"]),
            message: z.string().max(2000).transform(diagnosticText),
            atMs: ms,
          })
          .strict(),
      )
      .max(25),
    network: z
      .array(
        z
          .object({
            url,
            type: z.string().regex(/^[a-zA-Z0-9_-]{1,30}$/),
            durationMs: ms,
            atMs: ms,
            status: z.number().int().min(100).max(599).nullable(),
          })
          .strict(),
      )
      .max(50),
  })
  .strict()
  .transform((value) => ({ ...value, trust: "untrusted_diagnostics" as const }));
export type Diagnostics = z.infer<typeof diagnosticsSchema>;
