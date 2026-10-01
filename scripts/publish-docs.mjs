import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

// Publish the canonical manuals inside the docs site; do not maintain duplicate guides.
const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "site-docs/reference/manual");
const queue = [
  "self-hosting",
  "development",
  "operations",
  "verification",
  "api",
  "generated/operations",
  "review-workflow",
  "project-routing",
  "agent-setup",
  "agents",
  "mcp-contract",
  "extension",
  "webhooks",
].map((name) => `docs/${name}.md`);
queue.push("plugins/feedbacks/skills/review-feedback/SKILL.md");
const pages = new Map();
const sourceUrl = "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/main/";
function route(path) {
  return `/reference/manual/${path
    .replace(/^docs\//, "")
    .replace(/^plugins\//, "plugin/")
    .replace(/\.md$/, "")}`;
}
for (let i = 0; i < queue.length; i++) {
  const path = queue[i];
  if (pages.has(path)) continue;
  let markdown = await readFile(resolve(root, path), "utf8");
  markdown = markdown.replace(/\]\(([^\s)]+)([^)]*)\)/g, (match, href, title) => {
    if (/^(?:[a-z]+:|#|\/)/i.test(href)) return match;
    const [file, hash] = href.split("#");
    const target = relative(root, resolve(root, dirname(path), file));
    let url;
    if (target.startsWith("site-docs/"))
      url = `/${target.slice(10).replace(/\.md$/, "")}`;
    else if (/^(docs|plugins)\/.+\.md$/.test(target)) {
      if (!queue.includes(target)) queue.push(target);
      url = route(target);
    } else url = sourceUrl + target;
    return `](${url}${hash ? `#${hash}` : ""}${title})`;
  });
  pages.set(path, markdown);
}
for (const [path, markdown] of pages) {
  const target = resolve(output, route(path).slice("/reference/manual/".length) + ".md");
  await mkdir(dirname(target), { recursive: true });
  // Generated routes have no editable counterpart under site-docs/. Preserve
  // source frontmatter while suppressing the theme's otherwise broken edit URL.
  const content = markdown.startsWith("---\n")
    ? markdown.replace("---\n", "---\neditLink: false\n")
    : `---\neditLink: false\n---\n\n${markdown}`;
  await writeFile(
    target,
    `${content}\n\n<!-- Generated from ${path} by scripts/publish-docs.mjs. Edit the source. -->\n`,
  );
}
console.log(`Published ${pages.size} canonical manuals inside /docs/reference/manual/.`);
