import {
  mkdir,
  copyFile,
  readFile,
  writeFile,
  rm,
  mkdtemp,
  rename,
} from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { sourceFiles } from "./source-files.mjs";

const root = resolve(import.meta.dirname, "..");
const output = join(root, "dist/releases");
await mkdir(output, { recursive: true });
const stage = await mkdtemp(join(output, ".source-"));
try {
  const files = await sourceFiles(root);
  const manifest = [];
  for (const file of files) {
    const destination = join(stage, file);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(join(root, file), destination);
    const digest = createHash("sha256")
      .update(await readFile(destination))
      .digest("hex");
    manifest.push(`${digest}  ${file}`);
  }
  await writeFile(join(stage, "SOURCE-MANIFEST.sha256"), manifest.join("\n") + "\n");
  const source = join(output, "source");
  await rm(source, { recursive: true, force: true });
  await rename(stage, source);
  const { version } = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version))
    throw new Error("Invalid release version");
  const archive = join(output, `feedbacks-source-${version}.tar.gz`);
  execFileSync("tar", ["-czf", archive, "-C", source, "."], {
    env: { ...process.env, COPYFILE_DISABLE: "1" },
  });
  const digest = createHash("sha256")
    .update(await readFile(archive))
    .digest("hex");
  await writeFile(`${archive}.sha256`, `${digest}  feedbacks-source-${version}.tar.gz\n`);
  console.log(
    JSON.stringify(
      { source, archive, sha256: digest, files: files.length, includesGitHistory: false },
      null,
      2,
    ),
  );
} finally {
  await rm(stage, { recursive: true, force: true });
}
