import {
  readFile,
  writeFile,
  mkdir,
  rm,
  lstat,
  copyFile,
  appendFile,
} from "node:fs/promises";
import { resolve, join, basename, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const root = resolve(import.meta.dirname, "..");
const requiredJobs = [
  "check (22)",
  "check (24)",
  "containers",
  "extension-browser",
  "android-host",
  "secrets",
];
const versionPattern =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*)?$/;
function assertTag(tag, version) {
  if (!versionPattern.test(version) || tag !== `v${version}`)
    throw new Error("Release tag must exactly match v<package.json version>.");
}
const digest = (data) => createHash("sha256").update(data).digest("hex");
const jsonFile = async (path) => JSON.parse(await readFile(path, "utf8"));
function command(program, args, cwd = root) {
  return execFileSync(program, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export function assertReleaseTarget({ tag, version, sha, onMain, run, jobs }) {
  assertTag(tag, version);
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("Invalid release target SHA.");
  if (!onMain) throw new Error("Release target must be on origin/main.");
  if (
    !run ||
    run.head_sha !== sha ||
    run.head_branch !== "main" ||
    run.event !== "push" ||
    run.conclusion !== "success" ||
    run.path !== ".github/workflows/ci.yml"
  )
    throw new Error("Successful main push CI is required on the exact release target.");
  for (const name of requiredJobs)
    if (!jobs.some((job) => job.name === name && job.conclusion === "success"))
      throw new Error(`Required CI job did not succeed: ${name}`);
}

export function assertDraftRelease(release, tag, sha) {
  if (!release.draft)
    throw new Error("An already published release is immutable; use a new version.");
  if (release.tag_name !== tag || release.target_commitish !== sha)
    throw new Error("Existing draft has a different release target.");
}

// Every input is fixed below. Reject symlinks in both files and parent directories.
async function safeFile(base, path) {
  if (
    path.startsWith("/") ||
    path.split("/").some((part) => !part || part === "." || part === "..") ||
    path.includes("\\")
  )
    throw new Error("Invalid artifact path.");
  const parts = path.split("/");
  for (let i = 1; i <= parts.length; i++) {
    const stat = await lstat(join(base, ...parts.slice(0, i)));
    if (stat.isSymbolicLink()) throw new Error(`Artifact symlink refused: ${path}`);
    if (i === parts.length && !stat.isFile())
      throw new Error(`Artifact is not a file: ${path}`);
  }
  return join(base, path);
}

export async function prepareRelease({ root: base = root, tag, sha }) {
  const { name: packageName, version } = await jsonFile(join(base, "package.json"));
  assertTag(tag, version);
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("Invalid release target SHA.");
  const extension = await jsonFile(join(base, "extension/manifest.json"));
  const plugin = await jsonFile(join(base, "plugins/feedbacks/plugin.json"));
  if (
    !/^\d+(?:\.\d+){2,3}$/.test(extension.version) ||
    !versionPattern.test(plugin.version)
  )
    throw new Error("Invalid extension or plugin version.");
  const inputs = [
    [
      `dist/releases/feedbacks-source-${version}.tar.gz`,
      `feedbacks-source-${version}.tar.gz`,
      true,
    ],
    [
      `dist/extension/feedbacks-extension-${extension.version}.zip`,
      `feedbacks-extension-${extension.version}.zip`,
      true,
    ],
    [
      "dist/feedbacks-codex-plugin.zip",
      `feedbacks-codex-plugin-${plugin.version}.zip`,
      true,
    ],
    [
      "dist/feedbacks-claude-plugin.zip",
      `feedbacks-claude-plugin-${plugin.version}.zip`,
      true,
    ],
    ["dist/releases/sbom.cdx.json", `feedbacks-sbom-${version}.cdx.json`, false],
  ];
  const assets = [];
  for (const [input, name, checksum] of inputs) {
    const path = await safeFile(base, input),
      data = await readFile(path),
      sha256 = digest(data);
    if (!data.length) throw new Error(`Empty release artifact: ${input}`);
    if (checksum) {
      const record = await readFile(await safeFile(base, input + ".sha256"), "utf8");
      if (record !== `${sha256}  ${basename(input)}\n`)
        throw new Error(`Artifact checksum mismatch: ${input}`);
    }
    assets.push({ name, sha256, bytes: data.length });
  }
  const sourcePackage = JSON.parse(
    command("tar", ["-xOf", join(base, inputs[0][0]), "./package.json"], base),
  );
  const zipExtension = JSON.parse(
    command("unzip", ["-p", join(base, inputs[1][0]), "manifest.json"], base),
  );
  const zipPlugin = JSON.parse(
    command("unzip", ["-p", join(base, inputs[2][0]), "plugin.json"], base),
  );
  const zipClaudePlugin = JSON.parse(
    command(
      "unzip",
      ["-p", join(base, inputs[3][0]), ".claude-plugin/plugin.json"],
      base,
    ),
  );
  if (zipClaudePlugin.version !== plugin.version)
    throw new Error("Claude plugin archive version mismatch.");
  if (sourcePackage.version !== version)
    throw new Error("Source archive version mismatch.");
  if (zipExtension.version !== extension.version)
    throw new Error("Extension archive version mismatch.");
  if (zipPlugin.version !== plugin.version)
    throw new Error("Plugin archive version mismatch.");
  const release = await jsonFile(
    await safeFile(base, "dist/web/downloads/extension-release.json"),
  );
  if (
    release.version !== extension.version ||
    release.sha256 !== assets[1].sha256 ||
    release.bytes !== assets[1].bytes
  )
    throw new Error("Extension download metadata does not match the release artifact.");
  const sbom = await jsonFile(join(base, inputs[4][0]));
  if (
    sbom.bomFormat !== "CycloneDX" ||
    sbom.metadata?.component?.version !== version ||
    // npm can use the checkout directory as the display name; purl retains package identity.
    sbom.metadata?.component?.purl !== `pkg:npm/${packageName}@${version}`
  )
    throw new Error("SBOM does not describe this application version.");
  const output = join(base, "dist/releases/github");
  // The output must not resolve through a symlink before recursive cleanup.
  for (const path of ["dist", "dist/releases", "dist/releases/github"]) {
    try {
      if ((await lstat(join(base, path))).isSymbolicLink())
        throw new Error("Release output symlink refused.");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  for (const [input, name] of inputs)
    await copyFile(join(base, input), join(output, name));
  const manifest = {
    tag,
    sha,
    versions: {
      application: version,
      extension: extension.version,
      plugin: plugin.version,
    },
    assets,
  };
  await writeFile(join(output, "release.json"), JSON.stringify(manifest, null, 2) + "\n");
  await writeFile(
    join(output, "release-notes.md"),
    `Feedbacks ${tag}\n\nSource commit: ${sha}\n\n- Application and source: ${version}\n- Chrome extension: ${extension.version}\n- Codex and Claude Code plugins: ${plugin.version}\n\nThese components have separate version schemes. The Git tag follows the application version.\n\nAssets include the reviewed source export, public extension ZIP, standalone plugins and CycloneDX dependency inventory. Verify SHA256SUMS before installation.\n\nThis is a draft for release review. Record upgrade instructions, compatibility and known limitations before publishing. Container registry publication, hosted deployment and Chrome Web Store upload/review are separate steps; this workflow does not perform them.\n`,
  );
  const names = [
    ...assets.map((asset) => asset.name),
    "release.json",
    "release-notes.md",
  ];
  await writeFile(
    join(output, "SHA256SUMS"),
    (
      await Promise.all(
        names.map(
          async (name) => `${digest(await readFile(join(output, name)))}  ${name}`,
        ),
      )
    ).join("\n") + "\n",
  );
  return output;
}

async function verifyTarget(tag) {
  const { version } = await jsonFile(join(root, "package.json"));
  assertTag(tag, version);
  const sha = command("git", ["rev-parse", `refs/tags/${tag}^{commit}`]);
  const onMain = command("git", ["merge-base", sha, "origin/main"]) === sha;
  if (command("git", ["rev-parse", "HEAD"]) !== sha)
    throw new Error("Checkout must be the exact tagged target.");
  const repo = process.env.GITHUB_REPOSITORY;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo || ""))
    throw new Error("GITHUB_REPOSITORY is required.");
  const response = JSON.parse(
    command("gh", [
      "api",
      `repos/${repo}/actions/workflows/ci.yml/runs?head_sha=${sha}&event=push&per_page=100`,
    ]),
  );
  const run = response.workflow_runs.find(
    (item) =>
      item.head_sha === sha &&
      item.head_branch === "main" &&
      item.conclusion === "success",
  );
  const jobs = run
    ? JSON.parse(
        command("gh", ["api", `repos/${repo}/actions/runs/${run.id}/jobs?per_page=100`]),
      ).jobs
    : [];
  assertReleaseTarget({ tag, version, sha, onMain, run, jobs });
  if (process.env.GITHUB_OUTPUT)
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `sha=${sha}\ntag=${tag}\nci_run=${run.id}\n`,
    );
  return sha;
}

export async function publishDraft({
  directory = join(root, "dist/releases/github"),
  repository = process.env.GITHUB_REPOSITORY,
  token = process.env.GH_TOKEN,
  request = fetch,
}) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository || "") || !token)
    throw new Error("Repository and release token are required.");
  const manifest = await jsonFile(await safeFile(directory, "release.json"));
  assertTag(manifest.tag, manifest.versions.application);
  if (!/^[a-f0-9]{40}$/.test(manifest.sha))
    throw new Error("Invalid release target SHA.");
  const expected = [
    `feedbacks-source-${manifest.versions.application}.tar.gz`,
    `feedbacks-extension-${manifest.versions.extension}.zip`,
    `feedbacks-codex-plugin-${manifest.versions.plugin}.zip`,
    `feedbacks-claude-plugin-${manifest.versions.plugin}.zip`,
    `feedbacks-sbom-${manifest.versions.application}.cdx.json`,
  ];
  if (
    JSON.stringify(manifest.assets.map((asset) => asset.name)) !==
    JSON.stringify(expected)
  )
    throw new Error("Unexpected release asset path.");
  const names = [...expected, "release.json", "release-notes.md", "SHA256SUMS"];
  const files = new Map();
  for (const name of names)
    files.set(name, await readFile(await safeFile(directory, name)));
  const checksums =
    [...expected, "release.json", "release-notes.md"]
      .map((name) => `${digest(files.get(name))}  ${name}`)
      .join("\n") + "\n";
  if (
    files.get("SHA256SUMS").toString() !== checksums ||
    manifest.assets.some(
      (asset) =>
        asset.sha256 !== digest(files.get(asset.name)) ||
        asset.bytes !== files.get(asset.name).length,
    )
  )
    throw new Error("Prepared release checksum mismatch.");
  const api = `https://api.github.com/repos/${repository}`;
  async function call(url, method = "GET", body, raw = false) {
    let response;
    try {
      response = await request(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": raw ? "application/octet-stream" : "application/json",
        },
        ...(body !== undefined ? { body: raw ? body : JSON.stringify(body) } : {}),
      });
    } catch {
      throw new Error("GitHub release request failed (network error).");
    }
    if (!response.ok)
      throw new Error(`GitHub release request failed (${response.status}).`);
    try {
      return await response.json();
    } catch {
      throw new Error("GitHub release response was invalid.");
    }
  }
  // The authenticated list includes drafts; the by-tag endpoint is for published releases.
  const matches = [];
  for (let page = 1; ; page++) {
    const releases = await call(`${api}/releases?per_page=100&page=${page}`);
    if (!Array.isArray(releases)) throw new Error("GitHub release response was invalid.");
    matches.push(...releases.filter((item) => item.tag_name === manifest.tag));
    if (releases.length < 100) break;
  }
  if (matches.length > 1)
    throw new Error(
      "Multiple releases use this tag; manually recover the draft before retrying.",
    );
  let release = matches[0];
  if (release) assertDraftRelease(release, manifest.tag, manifest.sha);
  else
    release = await call(`${api}/releases`, "POST", {
      tag_name: manifest.tag,
      target_commitish: manifest.sha,
      name: `Feedbacks ${manifest.tag}`,
      body: files.get("release-notes.md").toString(),
      draft: true,
      prerelease: manifest.versions.application.includes("-"),
      make_latest: "false",
    });
  assertDraftRelease(release, manifest.tag, manifest.sha);
  function assertExistingAssets(current) {
    for (const old of current.assets)
      if (files.has(old.name) && old.digest !== `sha256:${digest(files.get(old.name))}`)
        throw new Error(
          "An existing release asset has a different or unavailable digest; manually recover the unpublished draft before retrying.",
        );
  }
  assertExistingAssets(release);
  // Never delete or overwrite an asset. Keep the draft unpublished while uploads run.
  for (const name of names) {
    release = await call(`${api}/releases/${release.id}`);
    if (!release) throw new Error("Draft release disappeared.");
    assertDraftRelease(release, manifest.tag, manifest.sha);
    assertExistingAssets(release);
    const old = release.assets.find((asset) => asset.name === name);
    if (old) continue;
    const upload = `https://uploads.github.com/repos/${repository}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`;
    await call(upload, "POST", files.get(name), true);
  }
  console.log(`Prepared draft release: ${release.html_url}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [mode, tag] = process.argv.slice(2);
  if (mode === "verify") await verifyTarget(tag);
  else if (mode === "prepare")
    console.log(
      relative(
        root,
        await prepareRelease({ tag, sha: command("git", ["rev-parse", "HEAD"]) }),
      ),
    );
  else if (mode === "publish-draft") {
    const manifest = await jsonFile(join(root, "dist/releases/github/release.json"));
    const sha = await verifyTarget(manifest.tag);
    if (sha !== manifest.sha)
      throw new Error("Prepared artifacts belong to a different target.");
    await publishDraft({});
  } else
    throw new Error(
      "Usage: node scripts/prepare-release.mjs verify|prepare <vVERSION> | publish-draft",
    );
}
