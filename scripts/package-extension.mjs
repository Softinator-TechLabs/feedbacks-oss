import { readFile, writeFile, mkdir, readdir, copyFile } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { zipFiles } from "./zip.mjs";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { compareChromeVersions, validateReleaseRecord } from "../extension/updates.js";

const root = resolve(import.meta.dirname, ".."),
  source = resolve(root, "extension");
const manifest = JSON.parse(await readFile(resolve(source, "manifest.json"), "utf8"));
const preset = process.env.FEEDBACKS_EXTENSION_DEFAULT_SERVER?.trim() || "";
if (preset) {
  const url = new URL(preset);
  if (url.origin !== preset || url.protocol !== "https:" || url.username || url.password)
    throw Error("A private extension preset must be an exact HTTPS server origin.");
}
if (manifest.manifest_version !== 3) throw Error("Invalid MV3 version.");
try {
  compareChromeVersions(manifest.version, manifest.version);
} catch {
  throw Error("Invalid MV3 version.");
}
const expected = ["activeTab", "scripting", "storage", "contextMenus", "alarms"];
if (
  JSON.stringify(manifest.permissions) !== JSON.stringify(expected) ||
  manifest.host_permissions ||
  manifest.externally_connectable ||
  manifest.web_accessible_resources
)
  throw Error("Unexpected extension permissions or page bridge. Review explicitly.");
for (const size of [16, 32, 48, 128]) {
  const icon = await sharp(resolve(source, `icons/${size}.png`)).metadata();
  if (icon.format !== "png" || icon.width !== size || icon.height !== size)
    throw Error(`Invalid ${size}px extension icon.`);
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  let files = [];
  for (const e of entries) {
    if (e.name.startsWith("."))
      throw Error(`Unexpected hidden extension file: ${e.name}`);
    const path = resolve(dir, e.name);
    if (e.isSymbolicLink()) throw Error("Symlinks are not packaged.");
    if (e.isDirectory()) files.push(...(await walk(path)));
    else files.push(path);
  }
  return files.sort();
}
const names = [],
  entries = [];
const packageFiles = (await walk(source)).map((path) => ({
  path,
  name: relative(source, path).replaceAll("\\", "/"),
}));
for (const name of ["LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.md"])
  packageFiles.push({ path: resolve(root, name), name });
for (const { path, name } of packageFiles) {
  if (
    !["LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.md"].includes(name) &&
    !/^(?:[a-z][a-z0-9-]*\.(?:js|html|css|json)|icons\/(?:16|32|48|128)\.png)$/.test(name)
  )
    throw Error(`File is not on the upload allowlist: ${name}`);
  let data = await readFile(path);
  if (name === "config.js")
    data = Buffer.from(`export const DEFAULT_SERVER = ${JSON.stringify(preset)};\n`);
  if (preset && name === "manifest.json")
    data = Buffer.from(
      JSON.stringify(
        { ...manifest, name: "Feedbacks Internal — website review" },
        null,
        2,
      ) + "\n",
    );
  if (
    name.endsWith(".js") &&
    /\beval\s*\(|new\s+Function\s*\(|sourceMappingURL/.test(data.toString())
  )
    throw Error(`Unsafe executable content: ${name}`);
  entries.push({ name, data });
  names.push(name);
}
if (!names.includes("manifest.json") || !names.includes("icons/128.png"))
  throw Error("Missing manifest or icon.");
const zip = zipFiles(entries),
  hash = createHash("sha256").update(zip).digest("hex");
const channel = preset ? "internal-" : "";
const owner = resolve(
    root,
    `dist/extension/feedbacks-extension-${channel}${manifest.version}.zip`,
  ),
  download = resolve(root, "dist/web/downloads/feedbacks-extension.zip"),
  store = resolve(root, "dist/store-assets");
for (const dir of [
  resolve(root, "dist/extension"),
  resolve(root, "dist/web/downloads"),
  store,
])
  await mkdir(dir, { recursive: true });
await writeFile(owner, zip);
if (!preset) await writeFile(download, zip);
await writeFile(owner + ".sha256", hash + "  " + owner.split("/").at(-1) + "\n");
await copyFile(resolve(source, "icons/128.png"), resolve(store, "icon-128.png"));
const promo =
  '<svg xmlns="http://www.w3.org/2000/svg" width="440" height="280"><rect width="440" height="280" fill="#f7f8f9"/><rect x="30" y="36" width="54" height="54" rx="10" fill="#17324d"/><path d="M42 48h30v21H56l-9 9v-9h-5z" fill="white"/><text x="30" y="139" font-family="sans-serif" font-size="36" font-weight="700" fill="#17324d">Feedbacks</text><text x="30" y="183" font-family="sans-serif" font-size="21" fill="#202c37">Review the website.</text><text x="30" y="214" font-family="sans-serif" font-size="21" fill="#202c37">Keep the context.</text><text x="30" y="250" font-family="sans-serif" font-size="14" fill="#596672">Capture · annotate · discuss</text></svg>';
await sharp(Buffer.from(promo)).png().toFile(resolve(store, "promo-440x280.png"));
const release = {
  version: manifest.version,
  downloadPath: "/downloads/feedbacks-extension.zip",
  sha256: hash,
  bytes: zip.length,
};
if (!validateReleaseRecord(release)) throw Error("Invalid extension release metadata.");
if (!preset)
  await writeFile(
    resolve(root, "dist/web/downloads/extension-release.json"),
    JSON.stringify(release) + "\n",
  );
console.log(
  JSON.stringify(
    {
      owner,
      download,
      sha256: hash,
      bytes: zip.length,
      release,
      files: names,
      storeAssets: store,
    },
    null,
    2,
  ),
);
