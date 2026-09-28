export type RecordingChannel =
  | "replay"
  | "console"
  | "network"
  | "activity"
  | "performance";
export type RecordingEvent = {
  seq: number;
  atMs: number;
  type: RecordingChannel;
  data: unknown;
};
export type RecordingVideo = {
  assetId: string;
  offsetMs: number;
  segments?: { sourceStartMs: number; sourceEndMs: number; outputStartMs: number }[];
};
export type RecordingSummary = {
  id: string;
  threadId: string;
  startedAt: string;
  durationMs: number;
  mode: "session" | "video";
  url: string;
  eventCount: number;
  privacy: { maskText: boolean; maskInputs: boolean; networkBodies: boolean };
  coverage: { channel: string; status: string; detail?: string }[];
  video?: RecordingVideo | null;
};
export type Recording = RecordingSummary & {
  environment: unknown;
  events: RecordingEvent[];
};

export function recordingAnnotation(
  events: RecordingEvent[],
  frame: { annotationId?: string; atMs: number },
): { id: string; body: string; atMs: number } | null {
  if (!frame.annotationId) return null;
  const event = events.find((event) => {
    const data = event.data as Record<string, unknown> | null;
    return (
      event.type === "activity" &&
      event.atMs === frame.atMs &&
      data?.action === "annotation" &&
      data.annotationId === frame.annotationId
    );
  });
  if (!event) return null;
  const data = event.data as Record<string, unknown>;
  return {
    id: frame.annotationId,
    body: typeof data.body === "string" ? data.body : "Screenshot comment",
    atMs: event.atMs,
  };
}

export function clampTime(atMs: number, durationMs: number): number {
  return Math.min(Math.max(Number.isFinite(atMs) ? atMs : 0, 0), Math.max(durationMs, 0));
}

export function formatRecordingTime(atMs: number): string {
  const tenths = Math.round(Math.max(0, Number.isFinite(atMs) ? atMs : 0) / 100);
  return `${Math.floor(tenths / 600)}:${String(Math.floor(tenths / 10) % 60).padStart(2, "0")}.${tenths % 10}`;
}

export function entriesAt(
  events: RecordingEvent[],
  type: RecordingChannel,
  fromMs = 0,
): RecordingEvent[] {
  return events
    .filter((entry) => entry.type === type && entry.atMs >= fromMs)
    .sort((a, b) => a.atMs - b.atMs || a.seq - b.seq);
}

export function entriesThrough(
  events: RecordingEvent[],
  type: RecordingChannel,
  throughMs: number,
): RecordingEvent[] {
  return entriesAt(events, type).filter((entry) => entry.atMs <= throughMs);
}

export function consoleAt(events: RecordingEvent[], throughMs: number): RecordingEvent[] {
  const reached = entriesThrough(events, "console", throughMs);
  for (let index = reached.length - 1; index >= 0; index--) {
    const data = reached[index]?.data;
    if (
      data &&
      typeof data === "object" &&
      (data as Record<string, unknown>).level === "clear"
    )
      return reached.slice(index + 1);
  }
  return reached;
}

export function mapRecordingToVideoTime(
  atMs: number,
  video: RecordingVideo,
): number | null {
  if (!video.segments?.length) {
    const videoTime = atMs + video.offsetMs;
    return videoTime >= 0 ? videoTime : null;
  }
  const segment = video.segments.find(
    ({ sourceStartMs, sourceEndMs }) => atMs >= sourceStartMs && atMs <= sourceEndMs,
  );
  return segment ? segment.outputStartMs + atMs - segment.sourceStartMs : null;
}

export function mapVideoToRecordingTime(
  outputMs: number,
  video: RecordingVideo,
): number | null {
  if (!video.segments?.length) {
    const recordingTime = outputMs - video.offsetMs;
    return recordingTime >= 0 ? recordingTime : null;
  }
  // Edited segments can meet at one output timestamp. The decoded frame at
  // that boundary belongs to the segment starting there.
  const segment = [...video.segments]
    .reverse()
    .find(
      ({ sourceStartMs, sourceEndMs, outputStartMs }) =>
        outputMs >= outputStartMs &&
        outputMs <= outputStartMs + sourceEndMs - sourceStartMs,
    );
  return segment ? segment.sourceStartMs + outputMs - segment.outputStartMs : null;
}

export type NetworkExchange = {
  key: string;
  atMs: number;
  method: string;
  url: string;
  status?: number;
  requestHeaders?: unknown;
  requestBody?: unknown;
  responseHeaders?: unknown;
  responseBody?: unknown;
  error?: unknown;
  phases: string[];
};

export function networkExchanges(
  events: RecordingEvent[],
  throughMs = Infinity,
): NetworkExchange[] {
  const grouped = new Map<string, NetworkExchange>();
  for (const event of entriesThrough(events, "network", throughMs)) {
    const data =
      event.data && typeof event.data === "object"
        ? (event.data as Record<string, unknown>)
        : {};
    const key =
      typeof data.requestId === "string" && data.requestId
        ? data.requestId
        : `event-${event.seq}`;
    const previous = grouped.get(key) ?? {
      key,
      atMs: event.atMs,
      method: "",
      url: "",
      phases: [],
    };
    previous.atMs = Math.min(previous.atMs, event.atMs);
    if (typeof data.method === "string") previous.method = data.method;
    if (typeof data.url === "string") previous.url = data.url;
    if (typeof data.status === "number") previous.status = data.status;
    for (const field of [
      "requestHeaders",
      "requestBody",
      "responseHeaders",
      "responseBody",
      "error",
    ] as const) {
      if (field in data) previous[field] = data[field];
    }
    if (typeof data.phase === "string" && !previous.phases.includes(data.phase))
      previous.phases.push(data.phase);
    grouped.set(key, previous);
  }
  return [...grouped.values()].sort(
    (a, b) => a.atMs - b.atMs || a.key.localeCompare(b.key),
  );
}

const resourceAttribute =
  /^(?:src|srcset|href|xlink:href|poster|action|formaction|data|background|content|srcdoc)$/i;
const embeddedResource =
  /(?:(?:-webkit-)?image-set\s*\([^)]*\)|url\s*\(\s*[^)]*\)|@import\s+(?:url\s*\([^)]*\)|["'][^"']*["'])\s*;?)/gi;
const absoluteResource = /(?:https?:|blob:|data:|file:|\/\/)[^\s"'<>)};]+/gi;

function stripResources(value: string): string {
  return value
    .replace(embeddedResource, "/* resource unavailable in replay */")
    .replace(absoluteResource, "[resource unavailable]");
}

function safeNode(value: unknown, parentKey = ""): unknown {
  if (typeof value === "string")
    return resourceAttribute.test(parentKey)
      ? parentKey.toLowerCase().includes("href")
        ? "#"
        : "data:,"
      : stripResources(value);
  if (Array.isArray(value)) return value.map((child) => safeNode(child, parentKey));
  if (!value || typeof value !== "object") return value;
  const source = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(source)) {
    if (
      key === "tagName" &&
      typeof child === "string" &&
      /^(script|iframe|object|embed|base|meta|link)$/i.test(child)
    ) {
      output[key] = "div";
    } else if (
      key === "attributes" &&
      child &&
      typeof child === "object" &&
      !Array.isArray(child)
    ) {
      output[key] = Object.fromEntries(
        Object.entries(child).map(([name, attribute]) => [
          name,
          resourceAttribute.test(name)
            ? name.toLowerCase().includes("href")
              ? "#"
              : "data:,"
            : safeNode(attribute, name),
        ]),
      );
    } else {
      output[key] = safeNode(child, key);
    }
  }
  return output;
}

// A detached CSSOM parse resolves escaped functions before property filtering.
// rrweb stores fetched linked stylesheets in _cssText; retain their resource-free
// layout rules without allowing the replay to refetch the original stylesheet.
// CSSOM validates property syntax. Resource safety is enforced on every value,
// including custom properties, so var() cannot smuggle a resource into a rule.
const replaySafeFunctions = new Set([
  "var",
  "repeat",
  "minmax",
  "fit-content",
  "linear-gradient",
  "radial-gradient",
  "conic-gradient",
  "repeating-linear-gradient",
  "repeating-radial-gradient",
  "cubic-bezier",
  "steps",
  "env",
  "rgb",
  "rgba",
  "hsl",
  "hsla",
  "calc",
  "min",
  "max",
  "clamp",
  "translate",
  "translatex",
  "translatey",
  "translate3d",
  "scale",
  "scalex",
  "scaley",
  "rotate",
  "skew",
  "skewx",
  "skewy",
  "matrix",
  "matrix3d",
]);

function replayDeclarationValue(value: string): boolean {
  if (!/^[a-z\d\s#.,%+*/()"'\[\]_\-]+$/i.test(value)) return false;
  for (const match of value.matchAll(/([a-z][a-z\d-]*)\s*\(/gi))
    if (!replaySafeFunctions.has(match[1]!.toLowerCase())) return false;
  return true;
}

function replayDeclarations(style: CSSStyleDeclaration): string {
  const kept: string[] = [];
  // Unresolved var() shorthands enumerate as empty longhands in CSSOM.
  // Read the serialized shorthand name too, otherwise gap/background/font vanish.
  const properties = new Set([
    ...style,
    ...Array.from(
      style.cssText.matchAll(/(?:^|;)\s*([\w-]+)\s*:/g),
      (match) => match[1]!,
    ),
  ]);
  for (const property of properties) {
    // Seeking applies recorded positions immediately; page easing must not
    // animate those updates on a separate clock and move targets under the cursor.
    if (/^(?:scroll-behavior|animation(?:-.+)?|transition(?:-.+)?)$/.test(property))
      continue;
    const value = style.getPropertyValue(property);
    if (replayDeclarationValue(value))
      kept.push(
        `${property}:${value}${style.getPropertyPriority(property) ? " !important" : ""}`,
      );
  }
  return kept.join(";");
}

function replayInlineStyle(value: unknown): string {
  if (typeof value !== "string" || value.length > 200_000) return "";
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(`x{${value}}`);
    const rule = sheet.cssRules[0];
    return rule instanceof CSSStyleRule ? replayDeclarations(rule.style) : "";
  } catch {
    return "";
  }
}

function replayStylesheet(value: unknown): string {
  if (typeof value !== "string" || value.length > 3_000_000) return "";
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(value);
    const rules = (items: CSSRuleList): string => {
      const kept: string[] = [];
      for (const rule of items) {
        if (rule instanceof CSSStyleRule) {
          const declarations = replayDeclarations(rule.style);
          if (declarations) kept.push(`${rule.selectorText}{${declarations}}`);
        } else if (
          rule instanceof CSSMediaRule &&
          /^[a-z\d\s:().,%\-]+$/i.test(rule.conditionText)
        ) {
          const nested = rules(rule.cssRules);
          if (nested) kept.push(`@media ${rule.conditionText}{${nested}}`);
        }
      }
      return kept.join("\n");
    };
    return rules(sheet.cssRules);
  } catch {
    return "";
  }
}

function replayRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function scrubReplayAttributes(attributes: Record<string, unknown> | null): void {
  if (!attributes) return;
  if ("style" in attributes) attributes.style = replayInlineStyle(attributes.style);
  if ("_cssText" in attributes)
    attributes._cssText = replayStylesheet(attributes._cssText);
  for (const key of Object.keys(attributes)) {
    if (
      /^(?:filter|clip-path|mask(?:-image)?|cursor|marker(?:-start|-mid|-end)?)$/i.test(
        key,
      )
    ) {
      delete attributes[key];
    } else if (/^(?:fill|stroke)$/i.test(key)) {
      const value = String(attributes[key] ?? "");
      if (
        !/^[a-z\d\s#.,%()\-]+$/i.test(value) ||
        /(?:url|image-set|var|attr|paint)\s*\(/i.test(value)
      )
        delete attributes[key];
    }
  }
}

function sanitizeReplayCopies(
  events: Record<string, unknown>[],
): Record<string, unknown>[] {
  const styleTextIds = new Set<number>();
  const styleElementIds = new Set<number>();
  const mediaIds = new Set<number>();
  const node = (value: unknown, insideStyle = false): void => {
    const current = replayRecord(value);
    if (!current) return;
    const tag = String(current.tagName ?? "").toLowerCase();
    if (current.type === 2 && /^(?:video|audio)$/.test(tag)) {
      const original = replayRecord(current.attributes) || {};
      if (typeof current.id === "number") mediaIds.add(current.id);
      current.tagName = "div";
      current.attributes = {
        ...(typeof original.id === "string" ? { id: original.id } : {}),
        class:
          `${String(original.class || "")} feedbacks-replay-media-placeholder`.trim(),
        ...(typeof original.style === "string" ? { style: original.style } : {}),
        "data-feedbacks-media":
          tag === "video"
            ? "Video pixels unavailable in DOM replay"
            : "Audio unavailable in DOM replay",
      };
      current.childNodes = [];
      scrubReplayAttributes(replayRecord(current.attributes));
      return;
    }
    if (
      current.type === 2 &&
      /^(?:set|animate|animatecolor|animatemotion|animatetransform|discard|mpath)$/i.test(
        tag,
      )
    ) {
      current.tagName = "g";
      current.attributes = {};
      current.childNodes = [];
      return;
    }
    const isStyle = insideStyle || (current.type === 2 && tag === "style");
    if (current.type === 2 && tag === "style" && typeof current.id === "number")
      styleElementIds.add(current.id);
    const attributes = replayRecord(current.attributes);
    scrubReplayAttributes(attributes);
    // Preserve the absent layout box of rrweb's redacted hidden controls.
    if (attributes?.rr_width === "0px" && attributes?.rr_height === "0px")
      attributes.style = `${attributes.style || ""};display:none!important`;
    if (current.type === 2 && attributes?._cssText) {
      current.tagName = "link";
      current.attributes = { _cssText: attributes._cssText };
      current.childNodes = [];
      return;
    }
    if ((current.type === 3 || current.type === 4) && isStyle) {
      if (typeof current.id === "number") styleTextIds.add(current.id);
      current.textContent = replayStylesheet(current.textContent);
    }
    if (Array.isArray(current.childNodes)) {
      const children = current.childNodes.filter(
        (child) => replayRecord(child)?.type !== 0,
      );
      current.childNodes = children;
      for (const child of children) node(child, isStyle);
    }
  };
  return events.filter((event) => {
    if (event.type === 7) return false;
    const data = replayRecord(event.data);
    if (event.type === 2) node(data?.node);
    if (event.type !== 3) return true;
    if (!data || [7, 8, 10, 13, 15].includes(Number(data.source))) return false;
    if (data.source === 0) {
      const adds = Array.isArray(data.adds) ? data.adds : [];
      const keptAdds = adds.filter(
        (added) => replayRecord(replayRecord(added)?.node)?.type !== 0,
      );
      data.adds = keptAdds;
      for (const added of keptAdds) {
        const entry = replayRecord(added);
        const addedNode = replayRecord(entry?.node);
        if (
          addedNode?.type === 2 &&
          String(addedNode.tagName).toLowerCase() === "style"
        ) {
          if (typeof addedNode.id === "number") styleElementIds.add(addedNode.id);
        }
      }
      for (const added of keptAdds) {
        const entry = replayRecord(added);
        node(entry?.node, styleElementIds.has(Number(entry?.parentId)));
      }
      for (const change of Array.isArray(data.attributes) ? data.attributes : []) {
        const entry = replayRecord(change);
        if (!entry) continue;
        if (mediaIds.has(Number(entry.id))) {
          const next = replayRecord(entry.attributes) || {};
          entry.attributes = {
            ...(typeof next.class === "string"
              ? { class: `${next.class} feedbacks-replay-media-placeholder`.trim() }
              : {}),
            ...(typeof next.style === "string" ? { style: next.style } : {}),
          };
        }
        scrubReplayAttributes(replayRecord(entry.attributes));
      }
      for (const change of Array.isArray(data.texts) ? data.texts : []) {
        const entry = replayRecord(change);
        if (!entry) continue;
        if (styleTextIds.has(Number(entry.id)) || styleElementIds.has(Number(entry.id)))
          entry.value = replayStylesheet(entry.value);
      }
    }
    return true;
  });
}

// Replay only a detached, rewritten copy. The player also uses its own sandboxed iframe.
// Removing resource references prevents authenticated pages and third-party hosts from being refetched.
export function prepareReplayEvents(events: RecordingEvent[]): Record<string, unknown>[] {
  return sanitizeReplayCopies(
    entriesAt(events, "replay")
      .map((entry) => safeNode(entry.data))
      .filter(
        (event): event is Record<string, unknown> =>
          !!event && typeof event === "object" && !Array.isArray(event),
      ),
  );
}
