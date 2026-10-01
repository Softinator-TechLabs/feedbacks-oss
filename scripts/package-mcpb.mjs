import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { zipFiles } from "./zip.mjs";

// Reuse the reviewed, self-contained stdio adapter; MCPB only adds client setup.
const root = resolve(import.meta.dirname, ".."),
  source = process.argv[2]
    ? resolve(process.argv[2])
    : join(root, "dist/codex-plugin/feedbacks"),
  output = join(root, "dist/mcp-bundle/feedbacks"),
  plugin = JSON.parse(await readFile(join(source, "plugin.json"), "utf8"));
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const file of [
  "mcp.mjs",
  "mcp.mjs.LEGAL.txt",
  "licenses",
  "LICENSE",
  "NOTICE",
  "THIRD_PARTY_NOTICES.md",
  "BUILD.json",
])
  await cp(join(source, file), join(output, file), { recursive: true });
const manifest = {
  manifest_version: "0.3",
  name: "feedbacks",
  display_name: "Feedbacks",
  version: plugin.version,
  description: plugin.description,
  author: plugin.author,
  homepage: plugin.homepage,
  repository: { type: "git", url: plugin.repository },
  documentation: "https://feedbacks.softinator.ai/docs/guide/mcp",
  support: "https://github.com/Softinator-TechLabs/feedbacks-oss/issues",
  license: plugin.license,
  privacy_policies: ["https://feedbacks.softinator.ai/privacy.html"],
  server: {
    type: "node",
    entry_point: "mcp.mjs",
    mcp_config: {
      command: "node",
      args: ["${__dirname}/mcp.mjs"],
      env: {
        FEEDBACKS_URL: "${user_config.server_url}",
        FEEDBACKS_TOKEN: "${user_config.token}",
      },
    },
  },
  compatibility: { runtimes: { node: "^22.12.0 || ^24.0.0" } },
  tools_generated: true,
  user_config: {
    server_url: {
      type: "string",
      title: "Your Feedbacks server URL",
      description:
        "Your team's HTTPS server origin, such as https://feedback.example.com. Loopback HTTP is allowed for development.",
      required: true,
    },
    token: {
      type: "string",
      title: "Personal agent key",
      description:
        "Create your own project-scoped key in Feedbacks Setup. Start with read access; grant writes only when needed.",
      required: true,
      sensitive: true,
    },
  },
};
await writeFile(join(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
await writeFile(
  join(output, "README.md"),
  `# Feedbacks MCP bundle

Install this MCPB in a client that supports Node MCP bundles. Use Node.js 22.12+ or 24. Enter your own server URL and personal scoped agent key in the client's secure configuration. There is no shared hosted account, built-in credential or runtime npm install.

This package contains the stdio adapter and dependency licenses. Claude Code/Codex skills are provided separately by the native plugins: https://github.com/Softinator-TechLabs/feedbacks-plugins . Installing the adapter does not grant server access. Revoke unused keys in Feedbacks Setup.
`,
);
const entries = [];
async function walk(directory, prefix = "") {
  for (const file of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const path = join(directory, file.name),
      name = prefix + file.name;
    if (file.isDirectory()) await walk(path, name + "/");
    else entries.push({ name, data: await readFile(path) });
  }
}
await walk(output);
const archive = join(root, "dist/feedbacks-mcp.mcpb"),
  data = zipFiles(entries);
await writeFile(archive, data);
await writeFile(
  archive + ".sha256",
  createHash("sha256").update(data).digest("hex") + "  feedbacks-mcp.mcpb\n",
);
console.log(`Built Feedbacks MCPB ${plugin.version} (${entries.length} files).`);
