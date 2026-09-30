import type { Thread } from "../api.js";

// A thread can mix capture methods. Keep these separate from category and status.
export function threadEvidenceLabels(
  thread: Pick<Thread, "assets" | "context" | "recordingModes" | "annotationStates">,
) {
  const labels: string[] = [];
  if (
    thread.context.annotations?.some(
      (point) =>
        point.textEdit && thread.annotationStates?.[point.id]?.state !== "removed",
    )
  )
    labels.push("Text edit");
  if (thread.context.document) labels.push("Document");
  const captures = (thread.assets ?? []).filter(
    (asset) => asset.rendition !== "thumbnail" && !asset.recordingFrame,
  );
  const images = captures.filter((asset) => asset.contentType?.startsWith("image/"));
  const fullPage = images.some(
    (asset) => asset.filename?.startsWith("full-page-") || asset.captureSections?.length,
  );
  if (fullPage) labels.push("Full page");
  else if (images.length) labels.push("Screenshot");
  const modes = thread.recordingModes ?? [];
  if (modes.includes("video")) labels.push("Video + session");
  else {
    if (captures.some((asset) => asset.contentType?.startsWith("video/")))
      labels.push("Video");
    if (modes.includes("session")) labels.push("Session recording");
  }
  if (
    captures.some(
      (asset) =>
        !asset.contentType?.startsWith("image/") &&
        !asset.contentType?.startsWith("video/"),
    )
  )
    labels.push("File");
  return labels.length ? labels : ["Text"];
}
