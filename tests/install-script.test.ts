import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { releaseMetadata } from "../scripts/prepare-quickstart.mjs";

const installer = fileURLToPath(new URL("../site/public/install.sh", import.meta.url));
const run = (args: string[], env = process.env) =>
  spawnSync("/bin/bash", [installer, ...args], { encoding: "utf8", env });

test("the shipped quickstart Compose matches the installer download pin", async () => {
  const manifest = await readFile(
    new URL("../site/public/quickstart-stable.txt", import.meta.url),
    "utf8",
  );
  const pin = manifest.match(/^compose_sha256=([a-f0-9]{64})$/m)?.[1];
  const compose = await readFile(
    new URL("../site/public/compose.quickstart.yaml", import.meta.url),
  );
  assert.equal(pin, createHash("sha256").update(compose).digest("hex"));
});

test("installer help works without Docker or a terminal", () => {
  const result = run(["--help"], { PATH: "/nonexistent" });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /localhost/);
});

test("installer preserves existing files and refuses directory symlinks before any setup", async () => {
  const directory = await mkdtemp(join(tmpdir(), "feedbacks-install-"));
  const alias = directory + "-link";
  try {
    await writeFile(join(directory, ".env"), "operator-private-placeholder");
    const result = run(["--directory", directory], { PATH: "/nonexistent" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Existing path preserved/);
    assert.doesNotMatch(result.stdout + result.stderr, /operator-private-placeholder/);
    assert.equal(
      await readFile(join(directory, ".env"), "utf8"),
      "operator-private-placeholder",
    );
    await symlink(directory, alias);
    assert.match(run(["--directory", alias]).stderr, /Existing path preserved/);
  } finally {
    await rm(alias, { force: true });
    await rm(directory, { recursive: true, force: true });
  }
});

test("installer refuses invalid arguments and missing prerequisites without creating a directory", async () => {
  assert.notEqual(run(["--directory"]).status, 0);
  const parent = await mkdtemp(join(tmpdir(), "feedbacks-install-missing-"));
  try {
    const directory = join(parent, "new");
    const result = run(["--directory", directory], { PATH: "/nonexistent" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Install docker first/);
    await assert.rejects(readFile(join(directory, ".env")), { code: "ENOENT" });
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("a tampered Compose download cannot start containers or write credentials", async () => {
  const root = await mkdtemp(join(tmpdir(), "feedbacks-install-tamper-"));
  try {
    const calls = join(root, "docker-calls");
    const docker = join(root, "docker");
    const curl = join(root, "curl");
    await writeFile(
      docker,
      '#!/bin/bash\nprintf "%s\\n" "$*" >> "$INSTALL_TEST_CALLS"\n',
    );
    await writeFile(
      curl,
      '#!/bin/bash\nfor arg in "$@"; do [[ "$arg" == *quickstart-stable.txt ]] && manifest=1; done\nwhile [[ $# -gt 0 ]]; do if [[ "$1" == --output ]]; then if [[ -n "$manifest" ]]; then cat "$INSTALL_TEST_MANIFEST" > "$2"; else printf "tampered" > "$2"; fi; exit; fi; shift; done\nexit 1\n',
    );
    await chmod(docker, 0o700);
    await chmod(curl, 0o700);
    const directory = join(root, "installation");
    const result = run(["--directory", directory, "--port", String(await freePort())], {
      ...process.env,
      PATH: root + ":" + process.env.PATH,
      INSTALL_TEST_MANIFEST: fileURLToPath(
        new URL("../site/public/quickstart-stable.txt", import.meta.url),
      ),
      INSTALL_TEST_CALLS: calls,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /checksum did not match/);
    const invoked = (await readFile(calls, "utf8")).trim().split("\n");
    assert.deepEqual(invoked, ["compose version", "info"]);
    await assert.rejects(readFile(join(directory, ".env")), { code: "ENOENT" });
    await assert.rejects(readFile(join(directory, "owner-password")), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

test("occupied port fails before network downloads, Docker startup or file creation", async () => {
  const root = await mkdtemp(join(tmpdir(), "feedbacks-install-busy-"));
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const docker = join(root, "docker");
    await writeFile(docker, "#!/bin/bash\nexit 99\n");
    await chmod(docker, 0o700);
    const target = join(root, "installation");
    const result = run(["--directory", target, "--port", String(address.port)], {
      ...process.env,
      PATH: root + ":" + process.env.PATH,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /already in use.*--port 3300/);
    await assert.rejects(readFile(join(target, ".env")), { code: "ENOENT" });
  } finally {
    server.close();
    await rm(root, { recursive: true, force: true });
  }
});

async function fixture(metadata?: string, startupFailure = false) {
  const root = await mkdtemp(join(tmpdir(), "feedbacks-install-progress-"));
  const manifest = await readFile(
    new URL("../site/public/quickstart-stable.txt", import.meta.url),
    "utf8",
  );
  await writeFile(
    join(root, "release.txt"),
    metadata ?? manifest.replace("version=0.2.3", "version=0.9.7"),
  );
  await writeFile(
    join(root, "docker"),
    `#!/bin/bash
printf '%s\\n' "$*" >> "$INSTALL_TEST_CALLS"
if [[ "$*" == *'up -d --wait'* && "$INSTALL_TEST_FAIL" == 1 ]]; then exit 17; fi
if [[ "$*" == *'bootstrap.js'* ]]; then cat >/dev/null; fi
`,
  );
  await writeFile(
    join(root, "curl"),
    `#!/bin/bash
for arg in "$@"; do [[ "$arg" == *quickstart-stable.txt ]] && source_file="$INSTALL_TEST_MANIFEST"; done
while [[ $# -gt 0 ]]; do
  if [[ "$1" == --output ]]; then cp "\${source_file:-$INSTALL_TEST_COMPOSE}" "$2"; exit; fi
  shift
done
exit 1
`,
  );
  for (const name of ["docker", "curl"]) await chmod(join(root, name), 0o700);
  const target = join(root, "installation");
  const calls = join(root, "docker-calls");
  const result = run(["--directory", target, "--port", String(await freePort())], {
    ...process.env,
    PATH: root + ":" + process.env.PATH,
    INSTALL_TEST_MANIFEST: join(root, "release.txt"),
    INSTALL_TEST_COMPOSE: fileURLToPath(
      new URL("../site/public/compose.quickstart.yaml", import.meta.url),
    ),
    INSTALL_TEST_CALLS: calls,
    INSTALL_TEST_FAIL: startupFailure ? "1" : "0",
  });
  return { root, target, calls, result };
}

test("fresh install follows stable metadata and prints progress and management commands without secrets", async () => {
  const f = await fixture();
  try {
    assert.equal(f.result.status, 0, f.result.stderr);
    assert.match(f.result.stdout, /Selected Feedbacks 0.9.7/);
    for (let step = 1; step <= 7; step++)
      assert.ok(f.result.stdout.includes(`[${step}/7]`));
    for (const label of ["Stop:", "Start:", "Status:", "Logs:"])
      assert.ok(f.result.stdout.includes(label));
    const calls = await readFile(f.calls, "utf8");
    assert.match(calls, /pull/);
    assert.doesNotMatch(calls, /pull --quiet/);
    assert.match(calls, /--wait-timeout 180/);
    const secret = await readFile(join(f.target, "owner-password"), "utf8");
    assert.ok(!f.result.stdout.includes(secret) && !calls.includes(secret));
    assert.match(
      await readFile(join(f.target, ".env"), "utf8"),
      /FEEDBACKS_IMAGE=softinator\/feedbacks@sha256:/,
    );
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("untrusted release metadata is validated as data rather than executed", async () => {
  for (const metadata of [
    "version=0.2.3\nimage=$(touch should-never-execute)\n",
    "version=0.2.3\nversion=0.2.4\n",
    "version=0.2.3-beta\n",
    "unknown=unexpected\n",
  ]) {
    const f = await fixture(metadata);
    try {
      assert.notEqual(f.result.status, 0);
      const calls = await readFile(f.calls, "utf8");
      assert.doesNotMatch(calls, /pull|up -d|bootstrap/);
      await assert.rejects(readFile(join(f.target, ".env")), { code: "ENOENT" });
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  }
});

test("startup failure retains private configuration and prints recovery commands", async () => {
  const f = await fixture(undefined, true);
  try {
    assert.notEqual(f.result.status, 0);
    assert.match(f.result.stderr, /Files and volumes are preserved/);
    assert.match(f.result.stderr, /Logs:.*--project-name feedbacks-/);
    assert.ok((await readFile(join(f.target, "owner-password"))).length > 0);
    assert.doesNotMatch(await readFile(f.calls, "utf8"), /bootstrap/);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("stable promotion rejects drafts, prereleases and incomplete image architectures", async () => {
  const compose = await readFile(
    new URL("../site/public/compose.quickstart.yaml", import.meta.url),
    "utf8",
  );
  const release = { tagName: "v1.2.3", isDraft: false, isPrerelease: false };
  const image = `Digest: sha256:${"a".repeat(64)}\nPlatform: linux/amd64\nPlatform: linux/arm64`;
  const revision = "b".repeat(40);
  assert.match(
    releaseMetadata("v1.2.3", revision, release, image, compose),
    /^version=1.2.3/,
  );
  for (const changed of [
    { ...release, isDraft: true },
    { ...release, isPrerelease: true },
    { ...release, tagName: "v1.2.2" },
  ])
    assert.throws(() => releaseMetadata("v1.2.3", revision, changed, image, compose));
  assert.throws(() =>
    releaseMetadata(
      "v1.2.3",
      revision,
      release,
      image.replace("linux/arm64", "unknown"),
      compose,
    ),
  );
});
