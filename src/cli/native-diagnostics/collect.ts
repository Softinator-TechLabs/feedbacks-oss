import { spawn } from "node:child_process";
import {
  nativeCollectors,
  nativeDiagnosticReportSchema,
  redactNativeDiagnosticText,
  NATIVE_DIAGNOSTIC_MAX_BYTES,
  type NativeDiagnosticReport,
  type NativePlatform,
} from "../../shared/native-diagnostics.js";
import {
  nativeCollectionRequest,
  nativeCommand,
  type NativeCommand,
} from "./commands.js";

export type CommandResult = {
  stdout: string;
  reason?:
    | "tool_not_found"
    | "permission_denied"
    | "query_failed"
    | "timed_out"
    | "output_limit";
};
export function runNativeCommand(
  command: NativeCommand,
  limits = { timeoutMs: 20_000, maxBytes: 2_097_152 },
): Promise<CommandResult> {
  return new Promise((resolve) => {
    // Do not pass Feedbacks credentials or other application secrets to an OS tool.
    const env: NodeJS.ProcessEnv = {};
    for (const name of ["SystemRoot", "WINDIR", "TEMP", "TMP", "HOME", "LANG", "LC_ALL"])
      if (process.env[name]) env[name] = process.env[name];
    const child = spawn(command.executable, command.args, {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...env, ...command.env },
    });
    let size = 0,
      reason: CommandResult["reason"],
      chunks: Buffer[] = [];
    let errorBytes = 0;
    const errorChunks: Buffer[] = [];
    let forceKill: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      child.kill();
      forceKill ??= setTimeout(() => child.kill("SIGKILL"), 500);
    };
    const timeout = setTimeout(() => {
      reason = "timed_out";
      stop();
    }, limits.timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      const remaining = limits.maxBytes - size;
      if (remaining > 0) {
        chunks.push(chunk.subarray(0, remaining));
        size += Math.min(chunk.length, remaining);
      }
      if (chunk.length > remaining) {
        reason = "output_limit";
        stop();
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const remaining = 8192 - errorBytes;
      if (remaining > 0) {
        errorChunks.push(chunk.subarray(0, remaining));
        errorBytes += Math.min(chunk.length, remaining);
      }
    });
    child.once("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timeout);
      clearTimeout(forceKill);
      resolve({
        stdout: "",
        reason:
          error.code === "ENOENT"
            ? "tool_not_found"
            : error.code === "EACCES"
              ? "permission_denied"
              : "query_failed",
      });
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      clearTimeout(forceKill);
      const denied =
        /access.{0,8}denied|permission denied|operation not permitted|unauthori[sz]ed|insufficient permissions/i.test(
          Buffer.concat(errorChunks).toString("utf8"),
        );
      resolve({
        stdout: Buffer.concat(chunks).toString("utf8"),
        ...(reason || code !== 0
          ? {
              reason:
                reason ??
                (denied ? ("permission_denied" as const) : ("query_failed" as const)),
            }
          : {}),
      });
    });
  });
}

function timestamp(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}
export function parseNativeEvents(platform: NativePlatform, stdout: string) {
  let invalid = false;
  const records: unknown[] = [];
  if (platform === "windows") {
    try {
      const data = JSON.parse(stdout.trim() || "[]");
      records.push(...(Array.isArray(data) ? data : [data]));
    } catch {
      invalid = true;
    }
  } else
    for (const line of stdout.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        records.push(JSON.parse(line));
      } catch {
        invalid = true;
      }
    }
  const events: NativeDiagnosticReport["events"] = [];
  for (const record of records) {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      invalid = true;
      continue;
    }
    const row = record as Record<string, unknown>;
    // log show's NDJSON stream ends with a count/control record, even when
    // the selected process has no messages. It is not a malformed event.
    if (
      platform === "macos" &&
      row.finished === 1 &&
      typeof row.count === "number" &&
      Number.isSafeInteger(row.count) &&
      row.count >= 0 &&
      row.eventMessage === undefined
    )
      continue;
    const message =
      platform === "windows"
        ? row.message
        : platform === "macos"
          ? row.eventMessage
          : row.MESSAGE;
    if (typeof message !== "string" || !message.trim()) {
      invalid = true;
      continue;
    }
    const safeMessage = redactNativeDiagnosticText(message);
    if (!safeMessage.trim()) {
      invalid = true;
      continue;
    }
    const number = Number(platform === "windows" ? row.level : row.PRIORITY);
    const kind = String(row.messageType ?? "").toLowerCase();
    const level: NativeDiagnosticReport["events"][number]["level"] =
      platform === "macos"
        ? kind === "error" || kind === "fault"
          ? "error"
          : kind === "debug"
            ? "debug"
            : kind === "info" || kind === "default"
              ? "info"
              : "unknown"
        : platform === "windows"
          ? number === 1 || number === 2
            ? "error"
            : number === 3
              ? "warning"
              : number === 4
                ? "info"
                : number === 5
                  ? "debug"
                  : "unknown"
          : number >= 0 && number <= 3
            ? "error"
            : number === 4
              ? "warning"
              : number === 5 || number === 6
                ? "info"
                : number === 7
                  ? "debug"
                  : "unknown";
    const at = timestamp(
      platform === "windows"
        ? row.at
        : platform === "macos"
          ? row.timestamp
          : typeof row.__REALTIME_TIMESTAMP === "string"
            ? Number(row.__REALTIME_TIMESTAMP) / 1000
            : undefined,
    );
    const eventId =
      platform === "windows" && typeof row.eventId === "string"
        ? row.eventId.slice(0, 80)
        : undefined;
    events.push({
      ...(at ? { at } : {}),
      level,
      ...(eventId ? { eventId } : {}),
      message: safeMessage,
    });
  }
  return { events, invalid };
}

export async function collectNativeDiagnostics(
  input: unknown,
  dependencies: {
    platform?: NativePlatform;
    now?: Date;
    run?: (command: NativeCommand) => Promise<CommandResult>;
  } = {},
) {
  const request = nativeCollectionRequest.parse(input);
  const platform =
    dependencies.platform ??
    ({ darwin: "macos", win32: "windows", linux: "linux" } as const)[
      process.platform as "darwin" | "win32" | "linux"
    ];
  if (!platform) throw Error("Native diagnostics support Windows, macOS and Linux.");
  const endedAt = (dependencies.now ?? new Date()).toISOString();
  const startedAt = new Date(
    Date.parse(endedAt) - request.minutes * 60_000,
  ).toISOString();
  const result = await (dependencies.run ?? runNativeCommand)(
    nativeCommand(platform, request, startedAt, endedAt),
  );
  const parsed = parseNativeEvents(platform, result.stdout);
  const reasons: NativeDiagnosticReport["reasons"] = [
    "bounded_snapshot",
    "os_visibility_limited",
  ];
  if (result.reason) reasons.push(result.reason);
  if (parsed.invalid) reasons.push("invalid_records");
  if (parsed.events.length > 100) reasons.push("event_limit");
  if (!parsed.events.length) reasons.push("no_matching_events");
  // Failed queries are not trustworthy partial successes. Only a capped output
  // may retain complete records received before the explicit cap was reached.
  const unavailable = !!result.reason && result.reason !== "output_limit";
  const report: NativeDiagnosticReport = {
    schemaVersion: 1,
    source: "os_logs",
    platform,
    processName: request.processName,
    collector: nativeCollectors[platform],
    startedAt,
    endedAt,
    coverage: unavailable ? "unavailable" : "partial",
    reasons,
    events: unavailable ? [] : parsed.events.slice(0, 100),
  };
  while (Buffer.byteLength(JSON.stringify(report)) > NATIVE_DIAGNOSTIC_MAX_BYTES) {
    report.events.pop();
    if (!report.reasons.includes("output_limit")) report.reasons.push("output_limit");
  }
  return nativeDiagnosticReportSchema.parse(report);
}
