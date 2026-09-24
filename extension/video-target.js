// Bind an extension recorder tab to the exact page and review selected at setup.
// Only the sanitized URL reaches the Feedbacks server; the route digest also detects
// hash-router changes without storing a potentially sensitive fragment.
export async function videoFingerprint(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function videoTarget(tab, session, safeUrl) {
  const routeFingerprint = await videoFingerprint(tab.url);
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

// Save the approved create input before the network call. The server may commit
// even when the recorder never receives its acknowledgement. A retry then uses
// the same validated input without depending on a tab that may have closed.
export async function replayableVideoCreate(
  message,
  storage,
  accountFingerprint,
  validate,
  create,
  scheduleExpiry,
) {
  if (
    !/^[a-f0-9-]{36}$/i.test(message.idempotencyKey) ||
    !message.target ||
    message.server !== message.target.server
  )
    throw Error("Invalid video submission request.");
  const key = `videoCreate:${message.idempotencyKey}`;
  const request = JSON.stringify({
    sourceTabId: message.sourceTabId,
    server: message.server,
    target: message.target,
    body: message.body,
    idempotencyKey: message.idempotencyKey,
  });
  const cached = (await storage.get(key))[key];
  if (cached && cached.expiresAt > Date.now()) {
    if (cached.request !== request) throw Error("Retry the original request only.");
    if (cached.accountFingerprint !== accountFingerprint)
      throw Error("The connected account changed. Reopen Feedbacks.");
    return create(cached.input);
  }
  if (cached) await storage.remove(key);
  const input = await validate();
  const expiresAt = Date.now() + 10 * 60 * 1000;
  await storage.set({
    [key]: {
      request,
      accountFingerprint,
      input,
      expiresAt,
    },
  });
  try {
    await scheduleExpiry?.(key, expiresAt);
  } catch (error) {
    await storage.remove(key);
    throw error;
  }
  try {
    return await create(input);
  } catch (error) {
    // Definite client errors cannot have committed a new thread.
    if (error.status >= 400 && error.status < 500) await storage.remove(key);
    throw error;
  }
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
