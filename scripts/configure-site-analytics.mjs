import { copyFile, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function publicSiteAnalyticsConfiguration(environment) {
  const id = environment.PUBLIC_SITE_GA_ID ?? "";
  const host = environment.PUBLIC_SITE_GA_HOST ?? "";
  if (!id && !host) return undefined;
  if (!/^G-[A-Z0-9]{10}$/.test(id))
    throw new Error("PUBLIC_SITE_GA_ID must be a GA4 measurement ID (G-XXXXXXXXXX).");
  if (
    host.length > 253 ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(
      host,
    )
  )
    throw new Error("PUBLIC_SITE_GA_HOST must be one exact lowercase DNS hostname.");
  return { id, host };
}

export function analyticsContentSecurityPolicy(headers) {
  const origins = {
    "script-src": ["https://www.googletagmanager.com"],
    "img-src": ["https://www.googletagmanager.com", "https://*.google-analytics.com"],
    "connect-src": [
      "https://www.googletagmanager.com",
      "https://*.google-analytics.com",
      "https://analytics.google.com",
      "https://*.analytics.google.com",
    ],
  };
  return headers.replace(/Content-Security-Policy: ([^\n]+)/g, (_line, policy) => {
    const directives = policy.split(";").map((directive) => {
      const [name, ...values] = directive.trim().split(/\s+/);
      if (!origins[name]) return directive.trim();
      return [
        name,
        ...values.filter((value) => value !== "'none'"),
        ...origins[name],
      ].join(" ");
    });
    return `Content-Security-Policy: ${directives.join("; ")}`;
  });
}

export async function configurePublicSiteAnalytics(directory, environment = process.env) {
  const configuration = publicSiteAnalyticsConfiguration(environment);
  if (!configuration) return { enabled: false, pages: 0 };
  const html = [];
  async function walk(folder) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && entry.name.endsWith(".html")) html.push(path);
    }
  }
  await walk(directory);
  const injection = `<link rel="stylesheet" href="/site-analytics.css"><script id="feedbacks-public-analytics" data-cfasync="false" defer src="/site-analytics.js" data-ga-id="${configuration.id}" data-ga-host="${configuration.host}"></script>`;
  // Validate every page before writing: this step targets the complete public artifact,
  // after VitePress and Markdown export, never dist/web or the extension bundle.
  const pages = await Promise.all(
    html.map(async (path) => {
      const text = await readFile(path, "utf8");
      if (!text.includes("</head>") || text.includes('id="feedbacks-public-analytics"'))
        throw new Error(`Expected an unconfigured public HTML page: ${path}`);
      return [path, text.replace("</head>", `${injection}</head>`)];
    }),
  );
  const headersPath = join(directory, "_headers");
  const headers = analyticsContentSecurityPolicy(await readFile(headersPath, "utf8"));
  for (const [path, text] of pages) await writeFile(path, text);
  await writeFile(headersPath, headers);
  for (const extension of ["js", "css"])
    await copyFile(
      new URL(`../site/analytics.${extension}`, import.meta.url),
      join(directory, `site-analytics.${extension}`),
    );
  return { enabled: true, pages: pages.length, host: configuration.host };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await configurePublicSiteAnalytics(resolve("dist/site"));
  console.log(
    result.enabled
      ? `Optional public-site analytics configured for ${result.host}: ${result.pages} HTML pages; visitor consent required.`
      : "Optional public-site analytics disabled (no build configuration).",
  );
}
