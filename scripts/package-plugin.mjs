import { build } from "esbuild";
import { cp, copyFile, mkdir, rm, readFile, writeFile, readdir } from "node:fs/promises";
import { resolve, join, relative } from "node:path";
import { zipFiles } from "./zip.mjs";
import { createHash } from "node:crypto";
const root = resolve(import.meta.dirname, ".."),
  out = join(root, "dist/codex-plugin/feedbacks");
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(join(root, "plugins/feedbacks"), out, { recursive: true });
for (const file of ["LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.md"])
  await copyFile(join(root, file), join(out, file));
await build({
  absWorkingDir: root,
  entryPoints: [join(root, "src/cli/mcp.ts")],
  outfile: join(out, "mcp.mjs"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  banner: {
    js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
  },
  sourcemap: false,
  legalComments: "linked",
  metafile: true,
}).then(async (result) => {
  const { devDependencies } = JSON.parse(
    await readFile(join(root, "package.json"), "utf8"),
  );
  const inputs = Object.keys(result.metafile.inputs).sort();
  const packageRoots = new Set(
    inputs.flatMap((input) => {
      const match = input.match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//);
      return match ? [match[1]] : [];
    }),
  );
  const licenses = [];
  for (const packageRoot of [...packageRoots].sort()) {
    const dir = resolve(root, packageRoot),
      pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
    const names = (await readdir(dir))
      .filter((name) => /^(?:licen[sc]e|copying|notice)(?:[.-]|$)/i.test(name))
      .sort();
    if (!names.length)
      throw new Error(`Bundled dependency is missing license text: ${pkg.name}`);
    const destination = join(out, "licenses", pkg.name);
    await mkdir(destination, { recursive: true });
    for (const name of names)
      await cp(join(dir, name), join(destination, name), { recursive: true });
    licenses.push({
      name: pkg.name,
      version: pkg.version,
      license: pkg.license,
      files: names.map((name) => `licenses/${pkg.name}/${name}`),
    });
  }
  await writeFile(
    join(out, "BUILD.json"),
    JSON.stringify(
      {
        entryPoint: "src/cli/mcp.ts",
        tool: { name: "esbuild", version: devDependencies.esbuild },
        dependencies: licenses,
        inputs: inputs.map((name) => relative(root, resolve(root, name))),
      },
      null,
      2,
    ) + "\n",
  );
});
const archive = join(root, "dist/feedbacks-codex-plugin.zip"),
  entries = [];
async function walk(dir, prefix = "") {
  for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const path = join(dir, entry.name),
      name = prefix + entry.name;
    if (entry.isDirectory()) await walk(path, name + "/");
    else entries.push({ name, data: await readFile(path) });
  }
}
await walk(out);
await rm(archive, { force: true });
await writeFile(archive, zipFiles(entries));
await writeFile(
  archive + ".sha256",
  createHash("sha256")
    .update(await readFile(archive))
    .digest("hex") + "  feedbacks-codex-plugin.zip\n",
);
console.log(`Built standalone Codex plugin (${entries.length} files).`);

const market = join(root, "dist/codex-plugin/.agents/plugins");
await mkdir(market, { recursive: true });
await writeFile(
  join(market, "marketplace.json"),
  JSON.stringify(
    {
      name: "feedbacks-local",
      interface: { displayName: "Feedbacks local build" },
      plugins: [
        {
          name: "feedbacks",
          source: { source: "local", path: "./feedbacks" },
          policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
          category: "Productivity",
        },
      ],
    },
    null,
    2,
  ) + "\n",
);
