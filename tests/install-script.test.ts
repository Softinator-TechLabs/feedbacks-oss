import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const installer = fileURLToPath(new URL("../site/public/install.sh", import.meta.url));
const run = (args: string[], env = process.env) =>
  spawnSync("/bin/bash", [installer, ...args], { encoding: "utf8", env });

test("the shipped quickstart Compose matches the installer download pin", async () => {
  const script = await readFile(installer, "utf8");
  const pin = script.match(/checksum='([a-f0-9]{64})'/)?.[1];
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
      '#!/bin/bash\nwhile [[ $# -gt 0 ]]; do if [[ "$1" == --output ]]; then printf "tampered" > "$2"; exit; fi; shift; done\nexit 1\n',
    );
    await chmod(docker, 0o700);
    await chmod(curl, 0o700);
    const directory = join(root, "installation");
    const result = run(["--directory", directory], {
      ...process.env,
      PATH: root + ":" + process.env.PATH,
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
