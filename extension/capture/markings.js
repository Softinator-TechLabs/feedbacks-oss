import { getPage, putPage } from "./page-store.js";

const unit = (value, size) => Math.max(0, Math.min(1, value / Math.max(1, size)));
export function pointShapes(item, index, region, sx, sy, marker = {}) {
  const anchor = item.anchor || {};
  const point = anchor.pagePoint;
  if (!point || point.y < region.startY || point.y >= region.endY) return [];
  return [
    {
      tool: "point",
      number: index + 1,
      markerStyle: marker.style || "ring",
      markerSize: marker.size || "small",
      points: [{ x: point.x * sx, y: (point.y - region.startY) * sy }],
    },
  ];
}
export function summarizeMarkings(shapes, width, height, annotations = []) {
  return (shapes || []).flatMap((shape) => {
    if (
      ![
        "point",
        "pencil",
        "arrow",
        "rectangle",
        "text",
        "highlighter",
        "steps",
        "blur",
        "sticker",
        "image",
      ].includes(shape.tool)
    )
      return [];
    const points = (shape.points || []).filter(
      (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
    );
    if (!points.length) return [];
    const xs = points.map((point) => unit(point.x, width));
    const ys = points.map((point) => unit(point.y, height));
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    const number =
      Number.isInteger(shape.number) && shape.number >= 1 && shape.number <= 100
        ? shape.number
        : undefined;
    const endpoints = points.length === 1 ? [points[0]] : [points[0], points.at(-1)];
    return [
      {
        tool: shape.tool,
        bounds: { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y },
        endpoints: endpoints.map((point) => ({
          x: unit(point.x, width),
          y: unit(point.y, height),
        })),
        ...(number ? { number } : {}),
        ...(number &&
        (shape.tool === "point" || shape.origin === "element") &&
        annotations[number - 1]
          ? { annotationId: annotations[number - 1].id }
          : {}),
        ...(shape.origin === "element" ? { origin: "element" } : {}),
        ...(["text", "sticker"].includes(shape.tool) && shape.text
          ? { text: String(shape.text).slice(0, 200) }
          : {}),
      },
    ];
  });
}
export function pagePixelSize(draft, page) {
  if (page.pixelWidth && page.pixelHeight)
    return { width: page.pixelWidth, height: page.pixelHeight };
  const width = draft.context.captureDimensions?.width || draft.context.viewport.width;
  const ratio =
    (draft.context.captureDimensions?.height || draft.context.viewport.height) /
    draft.context.viewport.height;
  return { width, height: Math.max(1, Math.round((page.endY - page.startY) * ratio)) };
}
export function continuousDraft(draft) {
  const indices = draft.capturePages
    .map((page, index) => index)
    .filter((index) => !draft.capturePages[index].annotationId);
  return {
    ...draft,
    capturePages: indices.map((index) => draft.capturePages[index]),
    pageToolStates: indices.map((index) => draft.pageToolStates?.[index]),
    indices,
  };
}
export async function attachPointEvidence(draft, retainedPointStates = new Map()) {
  const evidence = draft.context.pointEvidence || [];
  const annotations = draft.context.annotations || [];
  const missing = [];
  for (const [index, item] of annotations.entries()) {
    if (draft.capturePages.some((page) => page.annotationId === item.id)) continue;
    const snapshot = evidence.find((entry) => entry.id === item.id)?.snapshot;
    const blob = snapshot && (await getPage(`point-${draft.sourceTabId}`, snapshot.key));
    if (!blob) {
      missing.push(index + 1);
      continue;
    }
    const pageIndex = draft.capturePages.length;
    await putPage(draft.id, pageIndex, "source", blob);
    const { viewport, scroll } = snapshot;
    const page = {
      index: pageIndex,
      annotationId: item.id,
      pointNumber: index + 1,
      snapshotKey: snapshot.key,
      name: `point-${String(index + 1).padStart(3, "0")}-original.webp`,
      startY: scroll.y,
      endY: scroll.y + viewport.height,
      viewportWidth: viewport.width,
      pixelWidth: snapshot.width,
      pixelHeight: snapshot.height,
      capturedAt: snapshot.capturedAt,
    };
    draft.capturePages.push(page);
    draft.pageToolStates.push([
      ...(retainedPointStates.get(item.id) || []).filter(
        (shape) => shape.origin !== "element" && shape.tool !== "point",
      ),
      ...pointShapes(
        {
          ...item,
          anchor: {
            ...item.anchor,
            pagePoint: {
              x: item.anchor.pagePoint.x - scroll.x,
              y: item.anchor.pagePoint.y,
            },
          },
        },
        index,
        { startY: page.startY, endY: page.endY, width: viewport.width },
        snapshot.width / viewport.width,
        snapshot.height / viewport.height,
        draft.context.captureMarker,
      ),
    ]);
  }
  // Never send local storage references or current-page projections to the server.
  draft.context = { ...draft.context };
  delete draft.context.pointEvidence;
  delete draft.context.liveAnnotations;
  draft.missingPointImages = missing;
  if (evidence.length) {
    const count = draft.capturePages.filter((page) => page.annotationId).length;
    draft.captureNotice = `${count} original point views saved${draft.captureScope === "points" ? ". No extra screenshot taken." : " alongside the page capture."}${missing.length ? ` Points ${missing.join(", ")} have no original image.` : ""} Review every image before sending.`;
  }
  if (draft.capturePages.length) draft.noImage = false;
  return draft;
}
export function combinedMarkings(draft) {
  draft = continuousDraft(draft);
  const heights = draft.capturePages.map((page) => pagePixelSize(draft, page).height);
  const total = heights.reduce((sum, height) => sum + height, 0);
  let top = 0;
  return draft.capturePages.flatMap((page, index) => {
    const { width, height } = pagePixelSize(draft, page);
    const marks = summarizeMarkings(
      draft.pageToolStates?.[index],
      width,
      height,
      draft.context.annotations,
    ).map((mark) => ({
      ...mark,
      bounds: {
        ...mark.bounds,
        y: (top + mark.bounds.y * height) / total,
        height: (mark.bounds.height * height) / total,
      },
      endpoints: mark.endpoints.map((point) => ({
        ...point,
        y: (top + point.y * height) / total,
      })),
    }));
    top += height;
    return marks;
  });
}
export function combinedSections(draft) {
  draft = continuousDraft(draft);
  const heights = draft.capturePages.map((page) => pagePixelSize(draft, page).height);
  const total = heights.reduce((sum, height) => sum + height, 0);
  let top = 0;
  return draft.capturePages.map((page, index) => {
    const imageTop = top / total;
    top += heights[index];
    return {
      startY: page.startY,
      endY: page.endY,
      pageWidth: draft.context.viewport.width,
      imageTop,
      imageBottom: top / total,
    };
  });
}
