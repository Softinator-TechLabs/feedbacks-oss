// Bind an extension recorder tab to the exact page and review selected at setup.
// Only the sanitized URL reaches the Feedbacks server; the route digest also detects
// hash-router changes without storing a potentially sensitive fragment.
export async function videoTarget(tab, session, safeUrl) {
  const bytes = new TextEncoder().encode(tab.url);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const routeFingerprint = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return {
    sourceTabId: tab.id,
    projectId: session.projectId,
    reviewId: session.reviewId,
    server: session.server,
    url: safeUrl(tab.url),
    viewport: { width: tab.width || 1280, height: tab.height || 720 },
    routeFingerprint,
  };
}

export async function videoCreateInput(target, tab, session, safeUrl, body, key) {
  const current = await videoTarget(tab, session, safeUrl);
  if (
    !target ||
    current.sourceTabId !== target.sourceTabId ||
    current.projectId !== target.projectId ||
    current.reviewId !== target.reviewId ||
    current.server !== target.server ||
    current.url !== target.url ||
    current.routeFingerprint !== target.routeFingerprint ||
    current.viewport.width !== target.viewport?.width ||
    current.viewport.height !== target.viewport?.height
  )
    throw Error("The review page changed. Restore the original tab and retry.");
  return {
    projectId: target.projectId,
    body,
    context: { url: target.url, viewport: target.viewport },
    idempotencyKey: key,
  };
}
