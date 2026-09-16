import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";

export const sourceDirectories = [
  "plugins",
  "src",
  "extension",
  "site",
  "scripts",
  "tests",
  "docs",
  ".github",
];
export const sourceRootFiles = [
  ".dockerignore",
  ".editorconfig",
  ".env.example",
  ".gitignore",
  ".gitleaks.toml",
  ".impeccable/config.json",
  ".impeccable/design.json",
  ".nvmrc",
  ".prettierignore",
  ".prettierrc.json",
  "README.md",
  "CHANGELOG.md",
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
  "GOVERNANCE.md",
  "LICENSE",
  "NOTICE",
  "SECURITY.md",
  "THIRD_PARTY_NOTICES.md",
  "TRADEMARKS.md",
  "PRODUCT.md",
  "DESIGN.md",
  "Dockerfile",
  "Dockerfile.site",
  "compose.yaml",
  "compose.dev.yaml",
  "compose.site.yaml",
  "index.html",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "vite.config.ts",
  "vite.site.config.ts",
  "ops/site.nginx.conf",
];

export async function sourceFiles(root) {
  const files = [];
  async function walk(relative) {
    const info = await lstat(join(root, relative));
    if (info.isSymbolicLink())
      throw new Error(`Source export refuses symlinks: ${relative}`);
    if (info.isDirectory()) {
      for (const entry of await readdir(join(root, relative))) {
        if (
          !/^[A-Za-z0-9_.-]+$/.test(entry) ||
          (entry.startsWith(".") &&
            !["plugins/feedbacks/.codex-plugin", "plugins/feedbacks/.mcp.json"].includes(
              `${relative}/${entry}`,
            ))
        )
          throw new Error(`Unexpected source entry: ${relative}/${entry}`);
        await walk(`${relative}/${entry}`);
      }
    } else if (info.isFile()) {
      if (
        relative !== ".env.example" &&
        /(?:^|\/)(?:\.env(?:\.|$)|(?:node_modules|dist|\.git|\.local)(?:\/|$))|\.(?:key|pem|p12|db|sqlite|zip|tar|gz|log)$/i.test(
          relative,
        )
      )
        throw new Error(`Private or generated file in source export: ${relative}`);
      files.push(relative);
    } else throw new Error(`Non-regular source entry: ${relative}`);
  }
  for (const path of [...sourceRootFiles, ...sourceDirectories]) await walk(path);
  return [...new Set(files)].sort();
}
