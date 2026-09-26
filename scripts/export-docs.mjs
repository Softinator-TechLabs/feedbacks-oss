import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, dirname } from "node:path";

const source = new URL("../site-docs/", import.meta.url);
const output = new URL("../dist/site/docs/", import.meta.url);
const files = [];
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (entry.name.endsWith(".md")) files.push(path);
  }
}
await walk(source.pathname);
const links = [];
for (const path of files.sort()) {
  const name = relative(source.pathname, path);
  const target = join(output.pathname, name);
  await mkdir(dirname(target), { recursive: true });
  const markdown = await readFile(path, "utf8");
  await writeFile(target, markdown);
  const heading = markdown.match(/^# (.+)$/m)?.[1] ?? name;
  links.push(`- [${heading}](https://feedbacks.softinator.ai/docs/${name}): ${heading}`);
}
const index = `# Feedbacks documentation\n\nFeedbacks is an open-source website review workspace with a Chrome extension, team app, API and MCP connection.\n\n## Pages\n\n${links.join("\n")}\n\nSource and issue tracker: https://github.com/Softinator-TechLabs/feedbacks-oss\n`;
await writeFile(join(output.pathname, "llms.txt"), index);
await writeFile(new URL("../dist/site/llms.txt", import.meta.url), index);
