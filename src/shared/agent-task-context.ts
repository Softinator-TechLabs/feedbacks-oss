export function taskCounts(thread: any) {
  const points = thread.context.annotations ?? [];
  return {
    points: points.length,
    openPoints: ["resolved", "declined"].includes(thread.work.state)
      ? 0
      : points.filter(
          (p: any) => (thread.annotationStates?.[p.id]?.state ?? "open") === "open",
        ).length,
    replies: thread.replies?.length ?? 0,
    assets: thread.assets?.length ?? 0,
    legacyAnchor: !points.length && !!thread.context.anchor,
  };
}
export function reviewedPage(raw: string, serverOrigin?: string, taskId?: string) {
  const result: { url: string; relationship: string; threadId?: string } = {
    url: raw,
    relationship: "reviewed_page",
  };
  try {
    const url = new URL(raw);
    const match =
      /^\/threads\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i.exec(
        url.pathname,
      );
    if (
      serverOrigin &&
      url.origin === new URL(serverOrigin).origin &&
      !url.username &&
      !url.password &&
      match &&
      match[1] !== taskId
    )
      return { ...result, relationship: "reviewed_thread", threadId: match[1] };
  } catch {
    /* An unrecognized URL remains evidence, never a navigation instruction. */
  }
  return result;
}
