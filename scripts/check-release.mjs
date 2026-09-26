import { readFile, lstat } from "node:fs/promises";
import { dirname, resolve, join, relative } from "node:path";
import { sourceFiles } from "./source-files.mjs";
import { createHash } from "node:crypto";

const root = resolve(import.meta.dirname, "..");
const files = await sourceFiles(root);
const errors = [];
for (const file of files) {
  if (/\.(png|ttf|woff2?)$/.test(file)) continue;
  const text = await readFile(join(root, file), "utf8");
  if (
    file !== "scripts/check-release.mjs" &&
    /feedbacks\.softinator\.org|\/Users\/|vaultOrganizationId|vaultProjectId|runtimeSecretKey|softinator-feedbacks-prod/.test(
      text,
    )
  )
    errors.push(`${file}: private deployment reference`);
  // VitePress validates its base-relative Markdown links during build.
  if (/\.md$/.test(file) && !file.startsWith("site-docs/")) {
    for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const link = match[1].split("#")[0];
      if (!link || /^[a-z]+:/i.test(link)) continue;
      const target = resolve(dirname(join(root, file)), decodeURIComponent(link));
      const exportedTarget = relative(root, target);
      if (
        !files.includes(exportedTarget) &&
        !files.some((path) => path.startsWith(`${exportedTarget}/`))
      )
        errors.push(`${file}: relative link is outside the exported source: ${link}`);
      try {
        await lstat(target);
      } catch {
        errors.push(`${file}: broken relative link ${link}`);
      }
    }
  }
}
const license = await readFile(join(root, "LICENSE"), "utf8");
if (!license.includes("Apache License") || !license.includes("Version 2.0"))
  errors.push("Missing Apache-2.0 license");
const manifest = JSON.parse(
  await readFile(join(root, "extension/manifest.json"), "utf8"),
);
const release = JSON.parse(
  await readFile(join(root, "dist/web/downloads/extension-release.json"), "utf8"),
);
const zip = await readFile(join(root, "dist/web/downloads/feedbacks-extension.zip"));
if (
  release.version !== manifest.version ||
  release.bytes !== zip.length ||
  release.sha256 !== createHash("sha256").update(zip).digest("hex")
)
  errors.push("Extension metadata does not match the packaged ZIP");
const pluginZip = await readFile(join(root, "dist/feedbacks-codex-plugin.zip"));
const pluginDigest = (
  await readFile(join(root, "dist/feedbacks-codex-plugin.zip.sha256"), "utf8")
).split(/\s/)[0];
if (pluginDigest !== createHash("sha256").update(pluginZip).digest("hex"))
  errors.push("Plugin checksum does not match its ZIP");
for (const directory of ["plugins/feedbacks", "dist/codex-plugin/feedbacks"]) {
  const portable = JSON.parse(
    await readFile(join(root, directory, "plugin.json"), "utf8"),
  );
  const compatibility = JSON.parse(
    await readFile(join(root, directory, ".codex-plugin/plugin.json"), "utf8"),
  );
  if (portable.name !== compatibility.name || portable.version !== compatibility.version)
    errors.push("Plugin manifests have inconsistent identities");
}
await lstat(join(root, "dist/codex-plugin/feedbacks/mcp.mjs"));
await lstat(join(root, "dist/codex-plugin/.agents/plugins/marketplace.json"));
for (const file of [
  "dist/web/index.html",
  "dist/site/index.html",
  "dist/site/privacy.html",
  "dist/site/docs/index.html",
  "dist/site/docs/guide/mcp.html",
  "dist/site/docs/guide/github.html",
  "dist/site/docs/guide/mcp.md",
  "dist/site/docs/llms.txt",
  "dist/server/index.js",
])
  await lstat(join(root, file));
if (errors.length) throw new Error(errors.join("\n"));
console.log(
  `Release checks passed for ${files.length} public source files and all built entrypoints.`,
);
