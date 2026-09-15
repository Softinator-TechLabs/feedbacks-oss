import { readFile, writeFile, mkdir, readdir, copyFile } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { deflateRawSync } from "node:zlib";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { compareChromeVersions, validateReleaseRecord } from "../extension/updates.js";

const root = resolve(import.meta.dirname, ".."),
  source = resolve(root, "extension");
const manifest = JSON.parse(await readFile(resolve(source, "manifest.json"), "utf8"));
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
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (b) => {
  let c = 0xffffffff;
  for (const byte of b) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
let offset = 0;
const chunks = [],
  central = [];
const names = [];
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
  const data = await readFile(path),
    filename = Buffer.from(name),
    compressed = deflateRawSync(data),
    crc = crc32(data);
  if (
    name.endsWith(".js") &&
    /\beval\s*\(|new\s+Function\s*\(|sourceMappingURL/.test(data.toString())
  )
    throw Error(`Unsafe executable content: ${name}`);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt16LE(33, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(filename.length, 26);
  const entry = Buffer.alloc(46);
  entry.writeUInt32LE(0x02014b50, 0);
  entry.writeUInt16LE(20, 4);
  entry.writeUInt16LE(20, 6);
  entry.writeUInt16LE(8, 10);
  entry.writeUInt16LE(33, 14);
  entry.writeUInt32LE(crc, 16);
  entry.writeUInt32LE(compressed.length, 20);
  entry.writeUInt32LE(data.length, 24);
  entry.writeUInt16LE(filename.length, 28);
  entry.writeUInt32LE(offset, 42);
  chunks.push(local, filename, compressed);
  central.push(entry, filename);
  offset += local.length + filename.length + compressed.length;
  names.push(name);
}
if (!names.includes("manifest.json") || !names.includes("icons/128.png"))
  throw Error("Missing manifest or icon.");
const directory = Buffer.concat(central),
  end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(names.length, 8);
end.writeUInt16LE(names.length, 10);
end.writeUInt32LE(directory.length, 12);
end.writeUInt32LE(offset, 16);
const zip = Buffer.concat([...chunks, directory, end]),
  hash = createHash("sha256").update(zip).digest("hex");
const owner = resolve(root, `dist/extension/feedbacks-extension-${manifest.version}.zip`),
  download = resolve(root, "dist/web/downloads/feedbacks-extension.zip"),
  store = resolve(root, "dist/store-assets");
for (const dir of [
  resolve(root, "dist/extension"),
  resolve(root, "dist/web/downloads"),
  store,
])
  await mkdir(dir, { recursive: true });
await writeFile(owner, zip);
await writeFile(download, zip);
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
