import "./utils.js";

export function pageOverviewTarget(server, projectId, pageUrl, width, scope = "page") {
  const url = globalThis.FeedbacksUtil.safeUrl(pageUrl);
  if (!/^https?:/.test(url)) throw Error("Open a website to view its feedback.");
  const filters =
    scope === "website"
      ? { hostname: new URL(url).hostname }
      : {
          url,
          ...(scope === "view"
            ? { deviceClass: globalThis.FeedbacksUtil.device(width) }
            : {}),
        };
  const query = new URLSearchParams({ ...filters, showResolved: "true" });
  return { filters, url: `${server}/projects/${encodeURIComponent(projectId)}?${query}` };
}
