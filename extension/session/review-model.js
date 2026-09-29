// Local pre-send review. Page evidence is text-only outside the isolated DOM player.
export function sourceToVideo(atMs, video) {
  if (!video?.segments?.length)
    return atMs + (video?.offsetMs || 0) >= 0 ? atMs + (video?.offsetMs || 0) : null;
  const s = video.segments.find((s) => atMs >= s.sourceStartMs && atMs <= s.sourceEndMs);
  return s ? s.outputStartMs + atMs - s.sourceStartMs : null;
}
export function videoToSource(atMs, video) {
  if (!video?.segments?.length) return Math.max(0, atMs - (video?.offsetMs || 0));
  const s = [...video.segments]
    .reverse()
    .find(
      (s) =>
        atMs >= s.outputStartMs &&
        atMs <= s.outputStartMs + s.sourceEndMs - s.sourceStartMs,
    );
  return s ? s.sourceStartMs + atMs - s.outputStartMs : null;
}
export const networkKey = (event) => event.data?.requestId || `event-${event.seq}`;
export function reviewState(events, atMs) {
  let console = [];
  const network = new Map();
  const activity = [];
  for (const e of events
    .filter((e) => e.atMs <= atMs)
    .sort((a, b) => a.atMs - b.atMs || a.seq - b.seq)) {
    if (e.type === "console") {
      if (e.data?.level === "clear") console = [];
      else console.push(e);
    }
    if (e.type === "activity") activity.push(e);
    if (e.type === "network") {
      const key = networkKey(e);
      const prior = network.get(key);
      network.set(key, {
        ...e,
        atMs: prior?.atMs ?? e.atMs,
        data: { ...prior?.data, ...e.data },
      });
    }
  }
  return { console, network: [...network.values()], activity };
}
const text = (value) =>
  typeof value === "string" ? value : (JSON.stringify(value) ?? "");
export function eventLabel(e) {
  const d = e.data || {},
    target = d.target || d;
  const name =
    target.label ||
    target.name ||
    target.id ||
    target.testId ||
    target.role ||
    target.tag ||
    "page";
  if (e.type === "activity") {
    if (d.action === "loading")
      return `Loading: ${text(d.phase || "page")} · ${text(d.url || "")}`;
    if (d.action === "annotation")
      return `Comment: ${text(d.body || "Screenshot comment")}`;
    if (d.action === "click")
      return `Click ${name} at (${d.x ?? "?"}, ${d.y ?? "?"}) · button ${d.button ?? 0}`;
    if (d.action === "input")
      return `Type in ${name}: ${d.valueMasked ? "[masked]" : d.value !== undefined ? text(d.value) : d.checked !== undefined ? (d.checked ? "checked" : "unchecked") : "[value unavailable]"}${d.valueTruncated ? " [truncated]" : ""}`;
    return `${d.action || "Activity"} ${name}`;
  }
  if (e.type === "console")
    return `${d.level || "log"}: ${text(d.args ?? d.message ?? d.text ?? d)}`;
  if (e.type === "performance")
    return `${text(d.name || d.entryType || "Performance entry")}${Number.isFinite(d.durationMs) ? ` · ${Math.round(d.durationMs)} ms` : ""}`;
  if (e.type === "environment") {
    const viewport = d.viewport;
    return [
      d.browser || d.userAgent || "Browser details captured at start",
      viewport?.width && viewport?.height ? `${viewport.width} × ${viewport.height}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
  }
  return `${d.method || ""} ${d.url || d.requestId || "Request"} · ${d.error ? "failed: " + text(d.error) : (d.status ?? d.phase ?? "pending")}`;
}
const resource =
  /^(?:src|srcset|href|xlink:href|poster|action|formaction|data|background|content|srcdoc)$/i;
export function safeReplay(value, key = "") {
  if (typeof value === "string")
    return resource.test(key)
      ? key.includes("href")
        ? "#"
        : "data:,"
      : value
          .replace(/(?:url\s*\([^)]*\)|@import\s+[^;]+;?)/gi, "/* unavailable */")
          .replace(
            /(?:https?:|blob:|file:|\/\/)[^\s"'<>)};]+/gi,
            "[resource unavailable]",
          );
  if (Array.isArray(value)) return value.map((v) => safeReplay(v, key));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([k]) => !/^on/i.test(k))
      .map(([k, v]) => [
        k,
        k === "tagName" && /^(script|iframe|object|embed|base|meta|link)$/i.test(v)
          ? "div"
          : safeReplay(v, k),
      ]),
  );
}
export function reviewTime(ms) {
  return `${Math.floor(ms / 60000)}:${((ms / 1000) % 60).toFixed(1).padStart(4, "0")}`;
}
