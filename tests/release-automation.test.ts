import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { zipFiles } from "../scripts/zip.mjs";
import {
  assertReleaseTarget,
  assertDraftRelease,
  prepareRelease,
  publishDraft,
} from "../scripts/prepare-release.mjs";

const sha = "a".repeat(40);
const target = () => ({
  tag: "v1.2.3",
  version: "1.2.3",
  sha,
  onMain: true,
  run: {
    head_sha: sha,
    head_branch: "main",
    event: "push",
    conclusion: "success",
    path: ".github/workflows/ci.yml",
  },
  jobs: [
    "check (22)",
    "check (24)",
    "containers",
    "extension-browser",
    "android-host",
    "secrets",
  ].map((name) => ({ name, conclusion: "success" })),
});

test("release authorization rejects tag tricks, different versions and unverified commits", () => {
  assert.doesNotThrow(() => assertReleaseTarget(target()));
  for (const tag of ["main", "v1.2.3/../main", "v1.2.4", "v01.2.3", "v1.2.3\n"]) {
    assert.throws(() => assertReleaseTarget({ ...target(), tag }), /tag|version/);
  }
  assert.throws(() => assertReleaseTarget({ ...target(), onMain: false }), /main/);
  assert.throws(
    () =>
      assertReleaseTarget({
        ...target(),
        run: { ...target().run, head_sha: "b".repeat(40) },
      }),
    /CI/,
  );
  assert.throws(
    () =>
      assertReleaseTarget({
        ...target(),
        run: { ...target().run, event: "pull_request" },
      }),
    /CI/,
  );
  assert.throws(
    () => assertReleaseTarget({ ...target(), jobs: target().jobs.slice(1) }),
    /check/,
  );
  assert.throws(
    () =>
      assertReleaseTarget({
        ...target(),
        jobs: target().jobs.map((job) => ({ ...job, conclusion: "skipped" })),
      }),
    /check/,
  );
});

test("published releases and drafts belonging to another target are immutable", () => {
  assert.doesNotThrow(() =>
    assertDraftRelease(
      { draft: true, tag_name: "v1.2.3", target_commitish: sha },
      "v1.2.3",
      sha,
    ),
  );
  assert.throws(
    () =>
      assertDraftRelease(
        { draft: false, tag_name: "v1.2.3", target_commitish: sha },
        "v1.2.3",
        sha,
      ),
    /published/,
  );
  assert.throws(
    () =>
      assertDraftRelease(
        { draft: true, tag_name: "v1.2.3", target_commitish: "main" },
        "v1.2.3",
        sha,
      ),
    /target/,
  );
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "feedbacks-release-"));
  async function put(path: string, data: string | Buffer) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), data);
  }
  const json = (value: unknown) => JSON.stringify(value);
  await put("package.json", json({ name: "feedbacks", version: "1.2.3" }));
  await put("extension/manifest.json", json({ version: "0.9.8" }));
  await put("plugins/feedbacks/plugin.json", json({ version: "0.4.0" }));
  await put(
    "dist/releases/source/package.json",
    json({ name: "feedbacks", version: "1.2.3" }),
  );
  execFileSync("tar", [
    "-czf",
    join(root, "dist/releases/feedbacks-source-1.2.3.tar.gz"),
    "-C",
    join(root, "dist/releases/source"),
    ".",
  ]);
  const extension = zipFiles([
    { name: "manifest.json", data: Buffer.from(json({ version: "0.9.8" })) },
  ]);
  const plugin = zipFiles([
    { name: "plugin.json", data: Buffer.from(json({ version: "0.4.0" })) },
  ]);
  await put("dist/extension/feedbacks-extension-0.9.8.zip", extension);
  await put("dist/feedbacks-codex-plugin.zip", plugin);
  const hash = (data: Buffer) => createHash("sha256").update(data).digest("hex");
  for (const path of [
    "dist/releases/feedbacks-source-1.2.3.tar.gz",
    "dist/extension/feedbacks-extension-0.9.8.zip",
    "dist/feedbacks-codex-plugin.zip",
  ])
    await put(
      path + ".sha256",
      hash(await readFile(join(root, path))) + "  " + path.split("/").at(-1) + "\n",
    );
  await put(
    "dist/web/downloads/extension-release.json",
    json({ version: "0.9.8", bytes: extension.length, sha256: hash(extension) }),
  );
  await put(
    "dist/releases/sbom.cdx.json",
    json({
      bomFormat: "CycloneDX",
      metadata: {
        component: {
          name: "feedbacks-oss",
          version: "1.2.3",
          purl: "pkg:npm/feedbacks@1.2.3",
        },
      },
    }),
  );
  return { root, put };
}

test("SBOM identity uses npm package URL despite a different checkout folder name", async () => {
  const { root, put } = await fixture();
  try {
    await prepareRelease({ root, tag: "v1.2.3", sha });
    for (const component of [
      { name: "feedbacks", version: "1.2.3", purl: "pkg:npm/other@1.2.3" },
      { name: "feedbacks", version: "1.2.3", purl: "pkg:npm/feedbacks@1.2.4" },
      { name: "feedbacks", version: "1.2.4", purl: "pkg:npm/feedbacks@1.2.3" },
    ]) {
      await put(
        "dist/releases/sbom.cdx.json",
        JSON.stringify({ bomFormat: "CycloneDX", metadata: { component } }),
      );
      await assert.rejects(prepareRelease({ root, tag: "v1.2.3", sha }), /SBOM/);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("preparation includes only versioned verified artifacts and records separate versions", async () => {
  const { root, put } = await fixture();
  try {
    await put("dist/releases/private-dump.sql", "never include");
    await put("dist/extension/feedbacks-extension-0.0.1.zip", "stale");
    const out = await prepareRelease({ root, tag: "v1.2.3", sha });
    const manifest = JSON.parse(await readFile(join(out, "release.json"), "utf8"));
    assert.deepEqual(manifest.versions, {
      application: "1.2.3",
      extension: "0.9.8",
      plugin: "0.4.0",
    });
    assert.deepEqual(
      manifest.assets.map((asset: { name: string }) => asset.name),
      [
        "feedbacks-source-1.2.3.tar.gz",
        "feedbacks-extension-0.9.8.zip",
        "feedbacks-codex-plugin-0.4.0.zip",
        "feedbacks-sbom-1.2.3.cdx.json",
      ],
    );
    const checksums = await readFile(join(out, "SHA256SUMS"), "utf8");
    for (const asset of manifest.assets) {
      assert.equal(
        createHash("sha256")
          .update(await readFile(join(out, asset.name)))
          .digest("hex"),
        asset.sha256,
      );
      assert.ok(checksums.includes(`${asset.sha256}  ${asset.name}\n`));
    }
    assert.ok(!checksums.includes("private-dump"));
    assert.match(
      await readFile(join(out, "release-notes.md"), "utf8"),
      /Chrome Web Store/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("preparation refuses tampering, wrong archive versions and symlinked artifact paths", async () => {
  const { root, put } = await fixture();
  try {
    await put(
      "dist/feedbacks-codex-plugin.zip.sha256",
      "0".repeat(64) + "  feedbacks-codex-plugin.zip\n",
    );
    await assert.rejects(prepareRelease({ root, tag: "v1.2.3", sha }), /checksum/);
    const data = await readFile(join(root, "dist/feedbacks-codex-plugin.zip"));
    await put(
      "dist/feedbacks-codex-plugin.zip.sha256",
      createHash("sha256").update(data).digest("hex") + "  feedbacks-codex-plugin.zip\n",
    );
    await put("plugins/feedbacks/plugin.json", JSON.stringify({ version: "0.4.1" }));
    await assert.rejects(
      prepareRelease({ root, tag: "v1.2.3", sha }),
      /plugin.*version/i,
    );
    await put("plugins/feedbacks/plugin.json", JSON.stringify({ version: "0.4.0" }));
    await rm(join(root, "dist/feedbacks-codex-plugin.zip"));
    await symlink(
      join(root, "dist/extension/feedbacks-extension-0.9.8.zip"),
      join(root, "dist/feedbacks-codex-plugin.zip"),
    );
    await assert.rejects(prepareRelease({ root, tag: "v1.2.3", sha }), /symlink/);
    await assert.rejects(prepareRelease({ root, tag: "v1.2.4", sha }), /tag|version/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects an existing published release without writes", async () => {
  const { root } = await fixture();
  try {
    const directory = await prepareRelease({ root, tag: "v1.2.3", sha });
    const calls: string[] = [];
    await assert.rejects(
      publishDraft({
        directory,
        repository: "example/feedbacks",
        token: "synthetic-test-token",
        request: async (url: string, options: { method: string }) => {
          calls.push(options.method + " " + url);
          if (url.endsWith("/releases/tags/v1.2.3"))
            return new Response(null, { status: 404 });
          assert.equal(
            url,
            "https://api.github.com/repos/example/feedbacks/releases?per_page=100&page=1",
          );
          return Response.json([
            {
              id: 7,
              draft: false,
              tag_name: "v1.2.3",
              target_commitish: sha,
              assets: [],
            },
          ]);
        },
      }),
      /published/,
    );
    assert.deepEqual(calls, [
      "GET https://api.github.com/repos/example/feedbacks/releases?per_page=100&page=1",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("draft publication retries known assets and preserves unrelated draft assets", async () => {
  const { root } = await fixture();
  try {
    const directory = await prepareRelease({ root, tag: "v1.2.3", sha });
    let release: null | {
      id: number;
      draft: boolean;
      tag_name: string;
      target_commitish: string;
      html_url: string;
      assets: { id: number; name: string; digest: string }[];
    } = null;
    let sequence = 10;
    const writes: string[] = [];
    const request = async (
      url: string,
      options: { method: string; body?: string | Buffer },
    ) => {
      if (options.method === "GET") {
        if (url.endsWith("/releases/tags/v1.2.3"))
          return new Response(null, { status: 404 });
        if (url.endsWith("/releases?per_page=100&page=1"))
          return Response.json(release ? [release] : []);
        if (url.endsWith("/releases/7") && release) return Response.json(release);
        throw Error("Unexpected GET endpoint: " + url);
      }
      writes.push(options.method + " " + url);
      if (options.method === "POST" && url.endsWith("/releases")) {
        const body = JSON.parse(options.body as string);
        assert.equal(body.draft, true);
        assert.equal(body.target_commitish, sha);
        assert.equal(body.make_latest, "false");
        release = {
          ...body,
          id: 7,
          html_url: "https://github.com/example/feedbacks/releases/tag/v1.2.3",
          assets: [{ id: 1, name: "maintainer-notes.txt", digest: "manual" }],
        };
        return Response.json(release);
      }
      assert.equal(options.method, "POST");
      assert.ok(
        url.startsWith(
          "https://uploads.github.com/repos/example/feedbacks/releases/7/assets?name=",
        ),
      );
      const name = new URL(url).searchParams.get("name")!;
      const asset = {
        id: sequence++,
        name,
        digest:
          "sha256:" +
          createHash("sha256")
            .update(options.body as Buffer)
            .digest("hex"),
      };
      release!.assets.push(asset);
      return Response.json(asset);
    };
    const options = {
      directory,
      repository: "example/feedbacks",
      token: "synthetic-test-token",
      request,
    };
    await publishDraft(options);
    assert.equal(writes.length, 8); // One draft and seven allowlisted uploads.
    writes.length = 0;
    await publishDraft(options);
    assert.deepEqual(writes, []); // Matching checksums make retries idempotent.
    release!.assets.find(
      (asset) => asset.name === "feedbacks-extension-0.9.8.zip",
    )!.digest = "sha256:stale";
    await assert.rejects(
      publishDraft(options),
      /different or unavailable digest.*recover.*draft/i,
    );
    assert.deepEqual(writes, []);
    assert.ok(
      release!.assets.some(
        (asset) => asset.name === "maintainer-notes.txt" && asset.id === 1,
      ),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("draft retry discovers an older draft through authenticated release pagination despite tag lookup returning 404", async () => {
  const { root } = await fixture();
  try {
    const directory = await prepareRelease({ root, tag: "v1.2.3", sha });
    const checksumLines = (await readFile(join(directory, "SHA256SUMS"), "utf8"))
      .trim()
      .split("\n");
    const assets = checksumLines.map((line, index) => {
      const [hash, name] = line.split("  ");
      return { id: index + 10, name, digest: "sha256:" + hash };
    });
    assets.push({
      id: 20,
      name: "SHA256SUMS",
      digest:
        "sha256:" +
        createHash("sha256")
          .update(await readFile(join(directory, "SHA256SUMS")))
          .digest("hex"),
    });
    const release = {
      id: 7,
      draft: true,
      tag_name: "v1.2.3",
      target_commitish: sha,
      html_url: "https://github.com/example/feedbacks/releases/tag/v1.2.3",
      assets,
    };
    const calls: string[] = [];
    await publishDraft({
      directory,
      repository: "example/feedbacks",
      token: "synthetic-test-token",
      request: async (
        url: string,
        options: { method: string; headers: { Authorization: string } },
      ) => {
        calls.push(options.method + " " + url);
        assert.equal(options.headers.Authorization, "Bearer synthetic-test-token");
        assert.equal(options.method, "GET");
        if (url.endsWith("/releases/tags/v1.2.3"))
          return new Response(null, { status: 404 });
        if (url.endsWith("/releases?per_page=100&page=1"))
          return Response.json(
            Array.from({ length: 100 }, (_, id) => ({
              id: id + 100,
              draft: false,
              tag_name: "v9.0." + id,
            })),
          );
        if (url.endsWith("/releases?per_page=100&page=2"))
          return Response.json([release]);
        if (url.endsWith("/releases/7")) return Response.json(release);
        throw Error("Unexpected endpoint: " + url);
      },
    });
    assert.ok(
      calls.includes(
        "GET https://api.github.com/repos/example/feedbacks/releases?per_page=100&page=2",
      ),
    );
    assert.ok(!calls.some((call) => call.includes("/releases/tags/")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("publisher failure messages expose neither credentials nor upstream response details", async () => {
  const { root } = await fixture();
  try {
    const directory = await prepareRelease({ root, tag: "v1.2.3", sha });
    const options = {
      directory,
      repository: "example/feedbacks",
      token: "synthetic-test-token",
    };
    await assert.rejects(
      publishDraft({
        ...options,
        request: async () => {
          throw Error("Upstream received synthetic-test-token");
        },
      }),
      (error) =>
        error instanceof Error &&
        error.message === "GitHub release request failed (network error).",
    );
    await assert.rejects(
      publishDraft({
        ...options,
        request: async () => new Response("private upstream content", { status: 403 }),
      }),
      (error) =>
        error instanceof Error &&
        error.message === "GitHub release request failed (403).",
    );
    await assert.rejects(
      publishDraft({
        ...options,
        request: async () => new Response("synthetic-test-token", { status: 200 }),
      }),
      (error) =>
        error instanceof Error &&
        error.message === "GitHub release response was invalid.",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("stops if the draft is published before the next upload", async () => {
  const { root } = await fixture();
  try {
    const directory = await prepareRelease({ root, tag: "v1.2.3", sha });
    const release = {
      id: 7,
      draft: true,
      tag_name: "v1.2.3",
      target_commitish: sha,
      assets: [],
    };
    const calls: string[] = [];
    await assert.rejects(
      publishDraft({
        directory,
        repository: "example/feedbacks",
        token: "synthetic-test-token",
        request: async (url: string, options: { method: string }) => {
          calls.push(options.method + " " + url);
          assert.equal(options.method, "GET");
          if (url.endsWith("/releases?per_page=100&page=1"))
            return Response.json([release]);
          assert.ok(url.endsWith("/releases/7"));
          return Response.json({ ...release, draft: false });
        },
      }),
      /published/,
    );
    assert.equal(calls.length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("draft publication refuses changed artifacts and arbitrary asset paths before contacting GitHub", async () => {
  const { root } = await fixture();
  try {
    let directory = await prepareRelease({ root, tag: "v1.2.3", sha });
    let requests = 0;
    const options = {
      directory,
      repository: "example/feedbacks",
      token: "synthetic-test-token",
      request: async () => {
        requests++;
        throw Error("unexpected network");
      },
    };
    await writeFile(join(directory, "feedbacks-extension-0.9.8.zip"), "tampered");
    await assert.rejects(publishDraft(options), /checksum/);
    directory = await prepareRelease({ root, tag: "v1.2.3", sha });
    const manifest = JSON.parse(await readFile(join(directory, "release.json"), "utf8"));
    manifest.assets[0].name = "../private.sql";
    await writeFile(join(directory, "release.json"), JSON.stringify(manifest));
    await assert.rejects(publishDraft(options), /asset path/);
    assert.equal(requests, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
