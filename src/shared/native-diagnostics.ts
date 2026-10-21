import { z } from "zod";

export const NATIVE_DIAGNOSTIC_MAX_BYTES = 131_072;
export const nativePlatforms = ["windows", "macos", "linux"] as const;
export type NativePlatform = (typeof nativePlatforms)[number];
export const nativeCollectors = {
  windows: "windows_event_log",
  macos: "macos_unified_log",
  linux: "linux_journal",
} as const;

export function redactNativeDiagnosticText(text: string) {
  return text
    .replace(
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
      "[private key redacted]",
    )
    .replace(/\bBearer\s+[\w.+/=-]+/gi, "Bearer [redacted]")
    .replace(
      /\b(?:authorization|set-cookie|cookie)["']?\s*[:=]\s*[^\r\n]+/gi,
      "[credential redacted]",
    )
    .replace(
      /\b(token|access_token|refresh_token|password|secret|api[_-]?key|session[_-]?id)["']?\s*[:=]\s*(?:\[redacted\]|"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}\]]+)/gi,
      "$1=[redacted]",
    )
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[token redacted]")
    .replace(/https?:\/\/[^\s<>"']+/gi, (value) => {
      try {
        return new URL(value).origin;
      } catch {
        return "[url]";
      }
    })
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[email]")
    .replace(/(\/Users\/|\/home\/)[^/\s]+/g, "$1[user]")
    .replace(/([A-Z]:\\Users\\)[^\\\s]+/gi, "$1[user]")
    .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, " ")
    .slice(0, 1000);
}

export const nativeProcessNameSchema = z
  .string()
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9 ._()@+-]{0,119}$/,
    "Use an executable process name, without paths or shell syntax",
  );
export const nativeDiagnosticReportSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    source: z.literal("os_logs"),
    platform: z.enum(nativePlatforms),
    processName: nativeProcessNameSchema,
    collector: z.enum(["windows_event_log", "macos_unified_log", "linux_journal"]),
    startedAt: z.iso.datetime(),
    endedAt: z.iso.datetime(),
    coverage: z.enum(["partial", "unavailable"]),
    reasons: z
      .array(
        z.enum([
          "bounded_snapshot",
          "os_visibility_limited",
          "tool_not_found",
          "permission_denied",
          "query_failed",
          "timed_out",
          "output_limit",
          "event_limit",
          "invalid_records",
          "no_matching_events",
        ]),
      )
      .min(1)
      .max(10),
    events: z
      .array(
        z.strictObject({
          at: z.iso.datetime().optional(),
          level: z.enum(["error", "warning", "info", "debug", "unknown"]),
          eventId: z.string().max(80).optional(),
          message: z
            .string()
            .min(1)
            .max(1000)
            .transform(redactNativeDiagnosticText)
            .refine(
              (value) => !!value.trim(),
              "Diagnostic message is empty after redaction",
            ),
        }),
      )
      .max(100),
  })
  .superRefine((report, ctx) => {
    const duration = Date.parse(report.endedAt) - Date.parse(report.startedAt);
    if (duration < 0 || duration > 3_600_000)
      ctx.addIssue({
        code: "custom",
        message: "Choose a time window of at most one hour",
      });
    if (report.collector !== nativeCollectors[report.platform])
      ctx.addIssue({ code: "custom", message: "Collector does not match platform" });
    if (report.coverage === "unavailable" && report.events.length)
      ctx.addIssue({
        code: "custom",
        message: "Unavailable collection cannot contain events",
      });
    if (
      new TextEncoder().encode(JSON.stringify(report)).length >
      NATIVE_DIAGNOSTIC_MAX_BYTES
    )
      ctx.addIssue({
        code: "custom",
        message: "Native diagnostic snapshot exceeds 128 KiB",
      });
  });
export type NativeDiagnosticReport = z.infer<typeof nativeDiagnosticReportSchema>;

export function nativeDiagnosticSummary(report: NativeDiagnosticReport) {
  return {
    platform: report.platform,
    collector: report.collector,
    processName: report.processName,
    coverage: report.coverage,
    eventCount: report.events.length,
    reasons: report.reasons,
    trust: "untrusted_native_diagnostics" as const,
  };
}
