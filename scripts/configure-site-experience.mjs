import { copyFile, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export async function configurePublicSiteExperience(directory) {
  const pages = [];
  async function walk(folder) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && entry.name.endsWith(".html")) pages.push(path);
    }
  }
  await walk(directory);
  const status =
    '<div id="site-thinking" class="site-thinking" role="status" aria-live="polite" aria-atomic="true" hidden><span class="site-thinking-label">Thinking…</span><span class="site-thinking-line" aria-hidden="true"></span></div><script async data-cfasync="false" src="/site-experience.js"></script>';
  const prepared = await Promise.all(
    pages.map(async (path) => {
      const html = await readFile(path, "utf8");
      if (
        !html.includes("</head>") ||
        !/<body\b[^>]*>/.test(html) ||
        html.includes('id="site-thinking"')
      )
        throw new Error(`Expected an unconfigured public HTML page: ${path}`);
      return [
        path,
        html
          .replace(
            "</head>",
            '<link rel="stylesheet" href="/site-experience.css"></head>',
          )
          .replace(/<body\b[^>]*>/, (body) => body + status),
      ];
    }),
  );
  for (const [path, html] of prepared) await writeFile(path, html);
  for (const extension of ["js", "css"])
    await copyFile(
      new URL(`../site/experience.${extension}`, import.meta.url),
      join(directory, `site-experience.${extension}`),
    );
  return { pages: pages.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await configurePublicSiteExperience(resolve("dist/site"));
  console.log(`Public page readiness configured: ${result.pages} HTML pages.`);
}
