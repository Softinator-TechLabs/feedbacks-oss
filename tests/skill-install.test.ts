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
import { agentSetupPrompt } from "../src/web/agent-setup.js";

test("setup explicitly includes user skill installation and fresh-chat discovery", () => {
  const html = helpHtml("https://feedbacks.example.test", null);
  assert.ok(html.includes("feedbacks_guide"));
  assert.ok(html.includes("fresh chat"));
  assert.ok(html.includes("secret-free"));
  assert.ok(html.includes("user-level"));
});

test("copied setup instructions require a bounded read-only preview and a truthful client handoff", () => {
  const html = helpHtml("https://feedbacks.example.test", null);
  const template = html.match(
    /<template id="agent-setup-instructions">([\s\S]*?)<\/template>/,
  )?.[1];
  assert.ok(template, "private instructions stay in the authenticated Help template");
  assert.match(template, /projects\.list/);
  assert.match(template, /first bounded task preview/);
  assert.match(template, /limit:10/);
  assert.match(template, /threads and points separately/);
  assert.match(template, /zero accessible projects is a valid result/);
  assert.match(template, /Codex or Antigravity/);
  assert.match(template, /exact app or connection/);
  assert.match(template, /fresh chat/);
  assert.match(template, /Do not restart or quit apps automatically/);
  assert.match(template, /Do not claim ready/);
  assert.match(template, /No business writes/);
});

test("a zero-project setup retains the issued read scopes without inventing project access", () => {
  const html = helpHtml("https://feedbacks.example.test", null);
  const template = html.match(
    /<template id="agent-setup-instructions">([\s\S]*?)<\/template>/,
  )![1];
  const prompt = agentSetupPrompt(
    {
      id: "synthetic-key",
      token: "synthetic-secret",
      origin: "https://feedbacks.example.test",
      name: "Read-only setup",
      projects: [],
      scopes: ["auth.me", "projects.list", "members.profile.get"],
      expiresAt: "2026-12-01T00:00:00.000Z",
      canResolve: false,
    },
    template,
  );
  const metadata = JSON.parse(prompt.match(/```json\n([\s\S]*?)\n```/)![1]);
  assert.deepEqual(metadata.projects, []);
  assert.deepEqual(metadata.scopes, ["auth.me", "projects.list", "members.profile.get"]);
  assert.equal(metadata.ownerAdmin, false);
  assert.equal(metadata.projectAccess, "listed projects only");
  assert.equal(metadata.endpoint, "https://feedbacks.example.test/mcp?profile=compact");
  assert.ok(!prompt.includes("{{MCP_ENDPOINT_JSON}}"));
  assert.match(prompt, /If threads\.list is not scoped, mark the preview unavailable/);
});

test("setup keeps the credential out of the default prompt and includes it only in explicit quick mode", () => {
  const issued = {
    id: "synthetic-key",
    token: "synthetic-sensitive-credential",
    origin: "https://feedbacks.example.test",
    name: "Personal key",
    projects: [{ id: "synthetic-project", name: "``` <script>untrusted</script>" }],
    scopes: ["auth.me", "projects.list"],
    expiresAt: "2026-12-01T00:00:00.000Z",
    canResolve: false,
  };
  const separate = agentSetupPrompt(issued, "Connect {{MCP_ENDPOINT_JSON}}");
  assert.equal(separate.includes(issued.token), false);
  const separateData = JSON.parse(separate.match(/```json\n([\s\S]*?)\n```/)![1]);
  assert.deepEqual(separateData.authentication, {
    type: "bearer",
    source: "local-clipboard",
  });
  assert.deepEqual(separateData.projects, issued.projects);
  assert.equal(separate.includes("<script>"), false);
  const quick = agentSetupPrompt(issued, "Connect {{MCP_ENDPOINT_JSON}}", "quick");
  const quickData = JSON.parse(quick.match(/```json\n([\s\S]*?)\n```/)![1]);
  assert.equal(quickData.authentication.secret, issued.token);
  assert.deepEqual(quickData.scopes, separateData.scopes);
  assert.equal(quickData.tokenId, separateData.tokenId);
  assert.equal(
    issued.token,
    "synthetic-sensitive-credential",
    "copy mode must not mutate the issuance snapshot",
  );
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
    assert.match(
      await readFile(join(root, "manage-feedbacks-context/SKILL.md"), "utf8"),
      /members.profile/,
    );
    assert.match(await readFile(join(target, "SKILL.md"), "utf8"), /createdAfter/);
    assert.equal(
      await readFile(join(target, "references/workflow.md"), "utf8"),
      await readFile(
        "plugins/feedbacks/skills/review-feedback/references/workflow.md",
        "utf8",
      ),
      "the installed workflow must include current delegation guidance verbatim",
    );
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
