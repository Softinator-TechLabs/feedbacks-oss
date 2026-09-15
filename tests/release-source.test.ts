import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import {
  sourceFiles,
  sourceRootFiles,
  sourceDirectories,
} from "../scripts/source-files.mjs";

test("public source export excludes history and runtime state and refuses nested secrets or symlinks", async () => {
  const root = await mkdtemp(join(tmpdir(), "feedbacks-export-"));
  try {
    for (const path of sourceRootFiles) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), "fixture\n");
    }
    for (const dir of [...sourceDirectories, ".git", ".local", "node_modules", "dist"])
      await mkdir(join(root, dir), { recursive: true });
    for (const path of [
      ".git/config",
      ".local/private.txt",
      "node_modules/private.txt",
      "dist/private.txt",
      ".env",
    ])
      await writeFile(join(root, path), "must not export\n");
    await writeFile(join(root, "docs/public.md"), "public\n");
    const files = await sourceFiles(root);
    assert.ok(files.includes(".gitignore"));
    assert.ok(files.includes(".env.example"));
    assert.ok(files.includes("docs/public.md"));
    assert.ok(
      !files.some(
        (file: string) =>
          [".git/", ".local/", "node_modules/", "dist/"].some((prefix) =>
            file.startsWith(prefix),
          ) || file === ".env",
      ),
    );
    await symlink(join(root, ".env"), join(root, "docs/leak.md"));
    await assert.rejects(sourceFiles(root), /refuses symlinks/);
    await rm(join(root, "docs/leak.md"));
    await writeFile(join(root, "docs/private.key"), "fixture\n");
    await assert.rejects(sourceFiles(root), /Private or generated file/);
    await rm(join(root, "docs/private.key"));
    await writeFile(join(root, "docs/.env"), "fixture\n");
    await assert.rejects(sourceFiles(root), /Unexpected source entry/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
