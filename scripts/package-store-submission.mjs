import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import sharp from "sharp";
import { zipFiles } from "./zip.mjs";

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(
  await readFile(join(root, "extension/manifest.json"), "utf8"),
);
const release = JSON.parse(
  await readFile(join(root, "dist/web/downloads/extension-release.json"), "utf8"),
);
const extensionName = `feedbacks-extension-${manifest.version}.zip`;
const extensionPath = join(root, "dist/extension", extensionName);
const extensionBytes = await readFile(extensionPath);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
if (
  release.version !== manifest.version ||
  release.bytes !== extensionBytes.length ||
  release.sha256 !== digest(extensionBytes)
)
  throw Error("Build the current extension before making the Store bundle.");
const unpackedManifest = JSON.parse(
  await readFile(join(root, "dist/extension/unpacked/manifest.json"), "utf8"),
);
if (JSON.stringify(unpackedManifest) !== JSON.stringify(manifest))
  throw Error("The unpacked extension does not match the source manifest.");

const worksheet = await readFile(join(root, "docs/chrome-web-store.md"), "utf8");
const fencedCopy = (heading) => {
  const section = worksheet.split(heading)[1];
  const match = section?.match(/```text\n([\s\S]*?)\n```/);
  if (!match) throw Error(`Missing Store copy under ${heading}`);
  return `${match[1]}\n`;
};
const screenshots = [
  "01-review-controls.png",
  "02-point-comment.png",
  "03-saved-draft.png",
  "04-screenshot-editor.png",
];
const images = [
  ["dist/store-assets/icon-128.png", "artwork/icon-128.png", 128, 128],
  ["dist/store-assets/promo-440x280.png", "artwork/promo-440x280.png", 440, 280],
  ...screenshots.map((name) => [
    `dist/store-submission/screenshots/${name}`,
    `screenshots/${name}`,
    1280,
    800,
  ]),
];
for (const [source, , width, height] of images) {
  const info = await sharp(join(root, source)).metadata();
  if (info.format !== "png" || info.width !== width || info.height !== height)
    throw Error(`${source} must be a ${width} × ${height} PNG.`);
}

const output = join(root, "dist/store-submission");
const folder = join(output, `feedbacks-web-store-${manifest.version}`);
await rm(folder, { recursive: true, force: true });
await mkdir(folder, { recursive: true });
const included = [];
const add = async (name, bytes) => {
  const path = join(folder, name);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
  included.push({ name, data: Buffer.from(bytes) });
};
const addFile = async (source, name) => {
  await add(name, await readFile(join(root, source)));
};
await add(`extension-upload/${extensionName}`, extensionBytes);
await add("listing/title.txt", `${manifest.name}\n`);
await add("listing/short-description.txt", `${manifest.description}\n`);
await add(
  "listing/detailed-description.txt",
  fencedCopy("## Store listing → Detailed description"),
);
await add(
  "listing/single-purpose.txt",
  fencedCopy("## Privacy practices → Single purpose"),
);
await add("listing/remote-code-explanation.txt", fencedCopy("### Remote code"));
await add("listing/dashboard-worksheet.md", worksheet);
await addFile("site/privacy.html", "privacy/privacy-policy-source.html");
await addFile("extension/manifest.json", "extension-manifest.json");
for (const [source, name] of images) await addFile(source, name);

const revision = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();
const readme = `# Feedbacks Chrome Web Store update ${manifest.version}

Source revision: ${revision}
Existing Store item: dcpfpkfmegpgbfkeeileabpcbbmnoobo

Upload only \`extension-upload/${extensionName}\` in the Store Dashboard's Package tab. This outer ZIP is a handoff bundle and must not be uploaded as the extension package.

Use the files in \`listing/\` for copy and field-by-field guidance. Upload the four ordered images in \`screenshots/\`, plus the icon and small promo tile in \`artwork/\`. The privacy source is supplied under \`privacy/\`; publish it on the public website and verify the live URL before submitting the Store draft.

The worksheet lists each permission, data category, reviewer step and Dashboard location. Reviewer account details belong only in Google's private fields. ZIP creation does not submit, approve or publish a Store update.
`;
await add("README.md", readme);
const checksums = included.map(({ name, data }) => `${digest(data)}  ${name}`).join("\n");
await add("SHA256SUMS.txt", `${checksums}\n`);

const outerName = `feedbacks-web-store-bundle-${manifest.version}.zip`;
const outerPath = join(output, outerName);
const outerBytes = zipFiles(included.sort((a, b) => a.name.localeCompare(b.name)));
await writeFile(outerPath, outerBytes);
await writeFile(`${outerPath}.sha256`, `${digest(outerBytes)}  ${basename(outerPath)}\n`);
console.log(
  JSON.stringify({
    bundle: outerPath,
    sha256: digest(outerBytes),
    extension: extensionPath,
    version: manifest.version,
    screenshots: screenshots.length,
    sourceRevision: revision,
  }),
);
