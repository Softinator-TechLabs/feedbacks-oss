import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  writeFile,
  rm,
  mkdir,
  symlink,
  realpath,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { helpHtml } from "../src/server/help.js";

test("setup explicitly includes user skill installation and fresh-chat discovery", () => {
  const html = helpHtml("https://feedbacks.example.test", null);
  assert.ok(html.includes("feedbacks_guide"));
  assert.ok(html.includes("fresh chat"));
  assert.ok(html.includes("secret-free"));
  assert.ok(html.includes("user-level"));
});

test("skill installer checks without writing, installs all references, preserves custom files and rejects symlinks", async () => {
  const root = await mkdtemp(join(await realpath(tmpdir()), "feedbacks-skill-"));
  const target = join(root, "review-feedback");
  const run = (...args: string[]) =>
    spawnSync(
      process.execPath,
      ["plugins/feedbacks/install-skill.mjs", "--directory", target, ...args],
      { encoding: "utf8" },
    );
  try {
    assert.equal(run("--check").status, 0);
    await assert.rejects(readFile(join(target, "SKILL.md")), { code: "ENOENT" });
    assert.equal(run().status, 0);
    assert.match(await readFile(join(target, "SKILL.md"), "utf8"), /createdAfter/);
    assert.match(await readFile(join(target, "references/media.md"), "utf8"), /ORIGINAL/);
    await writeFile(join(target, "SKILL.md"), "custom");
    assert.notEqual(run().status, 0);
    assert.equal(await readFile(join(target, "SKILL.md"), "utf8"), "custom");
    assert.equal(run("--replace").status, 0);
    await rm(target, { recursive: true });
    await mkdir(join(root, "outside"));
    await symlink(join(root, "outside"), target);
    assert.notEqual(run().status, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
