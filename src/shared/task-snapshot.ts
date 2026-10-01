// Bounded evidence projections shared by clipboard and MCP. No interpretation or
// raw diagnostics: preserve quoted requirements and link back to the fresh task.
export function safeContextUrl(raw?: string | null) {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) return undefined;
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.href;
  } catch {
    return undefined;
  }
}
export function pointAnchor(anchor: any) {
  if (!anchor) return undefined;
  const result = {
    ...(anchor.selector ? { selector: anchor.selector } : {}),
    ...(anchor.confidence ? { confidence: anchor.confidence } : {}),
    ...(anchor.rect ? { rect: anchor.rect } : {}),
    ...(anchor.pagePoint ? { pagePoint: anchor.pagePoint } : {}),
    ...(anchor.point ? { point: anchor.point } : {}),
    ...(anchor.screenshotPoint ? { screenshotPoint: anchor.screenshotPoint } : {}),
    ...(anchor.viewport ? { viewport: anchor.viewport } : {}),
  };
  return Object.keys(result).length ? result : undefined;
}
export function workSnapshot(
  work: { state: string; note?: string | null },
  includeNote = true,
): { state: string; note?: string; noteTrust?: string; noteTruncated?: true } {
  if (!includeNote || !work.note) return { state: work.state };
  let note = work.note.slice(0, 600);
  while (JSON.stringify(note).length > 800)
    note = note.slice(0, Math.floor(note.length * 0.9));
  return {
    state: work.state,
    note,
    noteTrust: "untrusted_work_note",
    ...(note.length < work.note.length ? { noteTruncated: true as const } : {}),
  };
}
export function discussionSnapshot(replies: any[] = [], budget = 3000) {
  if (!replies.length) return undefined;
  const items: any[] = [];
  let size = 0;
  for (let index = replies.length - 1; index >= 0; index--) {
    const reply = replies[index];
    const item = {
      id: reply.id,
      author: reply.author?.name,
      createdAt: reply.createdAt,
      body: reply.body,
    };
    const length = JSON.stringify(item).length;
    if (size + length > budget || items.length >= 20) break;
    items.unshift(item);
    size += length;
  }
  const complete = items.length === replies.length;
  // A very long latest message is explicitly an excerpt, never a complete quote.
  if (!items.length) {
    const reply = replies.at(-1);
    items.push({
      id: reply.id,
      author: reply.author?.name?.slice(0, 100),
      createdAt: reply.createdAt,
      body: reply.body.slice(0, 400),
      truncated: true,
    });
  }
  return {
    complete,
    total: replies.length,
    items,
    ...(!complete ? { omitted: replies.length - items.length } : {}),
  };
}
export function assetSnapshot(asset: any, origin?: string, compact = false) {
  const base = safeContextUrl(origin);
  const markings = (asset.markings ?? []).slice(0, 8).map((m: any) => ({
    annotationId: m.annotationId,
    number: m.number,
    tool: m.tool,
    origin: m.origin,
    bounds: m.bounds,
    endpoints: m.endpoints,
    text: m.text?.slice(0, 200),
  }));
  return {
    id: asset.id,
    type: asset.contentType,
    width: asset.width,
    height: asset.height,
    ...(asset.durationMs ? { durationMs: asset.durationMs } : {}),
    ...(base
      ? { url: new URL(`/api/assets/${encodeURIComponent(asset.id)}`, base).href }
      : {}),
    ...(asset.recordingFrame ? { frame: asset.recordingFrame } : {}),
    ...(!compact && asset.captureRegion ? { captureRegion: asset.captureRegion } : {}),
    ...(!compact && asset.captureSections?.length
      ? { captureSections: asset.captureSections.slice(0, 8) }
      : {}),
    ...(!compact && markings.length
      ? { markings, markingsCoordinates: "normalized-image" }
      : {}),
    ...(!compact && (asset.markings?.length > 8 || asset.captureSections?.length > 8)
      ? { incomplete: true }
      : {}),
  };
}
