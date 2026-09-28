import { z } from "zod";

export const RECORDING_MAX_BYTES = 16 * 1024 * 1024;
export const RECORDING_MAX_EVENTS = 50_000;
export const RECORDING_MAX_DURATION_MS = 300_000;
export const RECORDING_EVENTS_PAGE_MAX = 500;
export const RECORDING_SNAPSHOT_MAX_NODES = 500_000;
const uuid = z.string().uuid();
function boundedJson(value: unknown, maxNodes = 100_000): boolean {
  let nodes = 0;
  const visit = (item: unknown, depth: number): boolean => {
    if (++nodes > maxNodes || depth > 256) return false;
    if (item === null || typeof item === "string" || typeof item === "boolean")
      return true;
    if (typeof item === "number") return Number.isFinite(item);
    if (Array.isArray(item)) return item.every((child) => visit(child, depth + 1));
    if (typeof item === "object")
      return Object.entries(item).every(
        ([key, child]) =>
          key.length <= 200 && child !== undefined && visit(child, depth + 1),
      );
    return false;
  };
  return visit(value, 0);
}
const jsonValue = z.unknown().superRefine((value, ctx) => {
  if (!boundedJson(value))
    ctx.addIssue({ code: "custom", message: "Expected bounded JSON data" });
});
export const recordingEventSchema = z
  .object({
    seq: z.number().int().min(0).max(RECORDING_MAX_EVENTS),
    atMs: z.number().finite().min(0).max(RECORDING_MAX_DURATION_MS),
    type: z.enum(["replay", "console", "network", "activity", "performance"]),
    data: z.unknown(),
  })
  .superRefine((event, ctx) => {
    // A full rrweb DOM baseline contains many small node/attribute values even
    // when it fits the capture byte budget. Diagnostics keep the smaller bound.
    const fullSnapshot =
      event.type === "replay" &&
      event.data !== null &&
      typeof event.data === "object" &&
      (event.data as { type?: unknown }).type === 2;
    if (!boundedJson(event.data, fullSnapshot ? RECORDING_SNAPSHOT_MAX_NODES : 100_000))
      ctx.addIssue({
        code: "custom",
        path: ["data"],
        message: "Expected bounded JSON data",
      });
  });
export const recordingSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: uuid,
    startedAt: z.iso.datetime({ offset: true }),
    durationMs: z.number().int().min(0).max(RECORDING_MAX_DURATION_MS),
    mode: z.enum(["session", "video"]),
    url: z.string().url().max(4096),
    environment: jsonValue,
    privacy: z.object({
      maskText: z.boolean(),
      maskInputs: z.boolean(),
      networkBodies: z.boolean(),
    }),
    coverage: z
      .array(
        z.object({
          channel: z.string().min(1).max(80),
          status: z.string().min(1).max(80),
          detail: z.string().max(500).optional(),
        }),
      )
      .max(100),
    events: z.array(recordingEventSchema).max(RECORDING_MAX_EVENTS),
    video: z
      .object({
        assetId: uuid,
        offsetMs: z
          .number()
          .finite()
          .min(-RECORDING_MAX_DURATION_MS)
          .max(RECORDING_MAX_DURATION_MS),
        segments: z
          .array(
            z.object({
              sourceStartMs: z.number().finite().min(0).max(RECORDING_MAX_DURATION_MS),
              sourceEndMs: z.number().finite().min(0).max(RECORDING_MAX_DURATION_MS),
              outputStartMs: z.number().finite().min(0).max(RECORDING_MAX_DURATION_MS),
            }),
          )
          .max(100)
          .optional(),
      })
      .optional(),
  })
  .superRefine((recording, ctx) => {
    if (recording.mode === "video" && !recording.video)
      ctx.addIssue({
        code: "custom",
        path: ["video"],
        message: "Video mode requires a video asset",
      });
    if (recording.mode === "session" && recording.video)
      ctx.addIssue({
        code: "custom",
        path: ["video"],
        message: "Session mode cannot link video",
      });
    try {
      const url = new URL(recording.url);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
        ctx.addIssue({
          code: "custom",
          path: ["url"],
          message: "Use a credential-free web URL",
        });
    } catch {
      /* URL format is reported by Zod. */
    }
    let previousAt = -1;
    for (let n = 0; n < recording.events.length; n++) {
      const event = recording.events[n];
      if (
        event.seq !== n ||
        event.atMs < previousAt ||
        event.atMs > recording.durationMs
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["events", n],
          message: "Events must have contiguous sequence and ordered in-range time",
        });
        break;
      }
      previousAt = event.atMs;
    }
    if (new TextEncoder().encode(JSON.stringify(recording)).length > RECORDING_MAX_BYTES)
      ctx.addIssue({ code: "custom", message: "Recording exceeds 16 MiB" });
  });
export type Recording = z.infer<typeof recordingSchema>;
export type RecordingEvent = z.infer<typeof recordingEventSchema>;

const secretKey =
  /(?:^|[_-])(?:password|passwd|secret|token|authorization|cookie|credential|api[_-]?key|session[_-]?key|private[_-]?key)(?:$|[_-])|^(?:accessToken|refreshToken|idToken|authToken|clientSecret|apiKey|sessionKey|privateKey|setCookie)$/i;
const secretValue =
  /\b(?:Bearer\s+[A-Za-z0-9._~+/-]{8,}|(?:sk|pk|ghp|gho|github_pat)_[A-Za-z0-9_-]{12,})\b/g;
const assignmentSecret =
  /\b(password|passwd|secret|token|authorization|api[_-]?key|session[_-]?key|cookie|credential|private[_-]?key)(\s*[=:]\s*)([^\r\n&,;]+)/gi;
function sanitizeString(value: string): string {
  const replaced = value
    .replace(secretValue, "[redacted]")
    .replace(assignmentSecret, "$1$2[redacted]");
  try {
    const url = new URL(replaced);
    if (!["http:", "https:"].includes(url.protocol)) return replaced;
    url.username = "";
    url.password = "";
    for (const key of [...url.searchParams.keys()])
      if (secretKey.test(key)) url.searchParams.set(key, "[redacted]");
    return url.toString();
  } catch {
    return replaced;
  }
}
export function redactEvidenceValue(value: unknown): unknown {
  const walk = (item: unknown, key = ""): unknown => {
    if (secretKey.test(key)) return "[redacted]";
    if (typeof item === "string") return sanitizeString(item);
    if (Array.isArray(item)) return item.map((child) => walk(child));
    if (item && typeof item === "object")
      return Object.fromEntries(
        Object.entries(item).map(([name, child]) => [name, walk(child, name)]),
      );
    return item;
  };
  return walk(value);
}

// Keep rrweb event structure intact: redact values, never remove identity/timing fields.
export function redactRecording(recording: Recording): Recording {
  const isSensitiveAttributes = (attrs: Record<string, unknown>): boolean =>
    attrs.type === "password" ||
    attrs.type === "hidden" ||
    (typeof attrs.name === "string" && secretKey.test(attrs.name)) ||
    (typeof attrs.id === "string" && secretKey.test(attrs.id)) ||
    (typeof attrs.autocomplete === "string" &&
      /password|one-time-code/i.test(attrs.autocomplete));
  const sensitiveNodeIds = new Set<number>();
  const findSensitiveNodes = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) findSensitiveNodes(item);
      return;
    }
    const node = value as Record<string, unknown>;
    const attrs = node.attributes as Record<string, unknown> | undefined;
    if (attrs && typeof node.id === "number" && isSensitiveAttributes(attrs))
      sensitiveNodeIds.add(node.id);
    for (const child of Object.values(node)) findSensitiveNodes(child);
  };
  for (const item of recording.events)
    if (item.type === "replay") findSensitiveNodes(item.data);
  const walk = (
    value: unknown,
    key = "",
    parent: Record<string, unknown> | null = null,
    network = false,
    sensitiveValue = false,
  ): unknown => {
    if (
      network &&
      !recording.privacy.networkBodies &&
      /(?:body|postData|payload)/i.test(key)
    )
      return "[omitted]";
    if (secretKey.test(key)) return "[redacted]";
    if (typeof value === "string") {
      if (
        (sensitiveValue ||
          (parent &&
            (parent.type === "password" ||
              parent.inputType === "password" ||
              (parent.attributes &&
                typeof parent.attributes === "object" &&
                (parent.attributes as Record<string, unknown>).type === "password") ||
              (typeof parent.id === "number" && sensitiveNodeIds.has(parent.id))))) &&
        ["value", "text", "textContent"].includes(key)
      )
        return "[redacted]";
      if (key.toLowerCase().includes("body") && /^[\s]*[\[{]/.test(value)) {
        try {
          return JSON.stringify(
            walk(JSON.parse(value), key, parent, network, sensitiveValue),
          );
        } catch {
          /* Preserve non-JSON bodies. */
        }
      }
      return sanitizeString(value);
    }
    if (Array.isArray(value))
      return value.map((item) => walk(item, "", null, network, sensitiveValue));
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([childKey, child]) => [
          childKey,
          walk(
            child,
            childKey,
            value as Record<string, unknown>,
            network || (value as Record<string, unknown>).type === "network",
            sensitiveValue ||
              (childKey === "attributes" &&
                !!child &&
                typeof child === "object" &&
                ((typeof (value as Record<string, unknown>).id === "number" &&
                  sensitiveNodeIds.has(
                    (value as Record<string, unknown>).id as number,
                  )) ||
                  isSensitiveAttributes(child as Record<string, unknown>))),
          ),
        ]),
      );
    return value;
  };
  return walk(recording) as Recording;
}
