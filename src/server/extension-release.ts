import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const extensionDownloadPath = "/downloads/feedbacks-extension.zip";
const maxReleaseBytes = 100 * 1024 * 1024;

export type ExtensionRelease = {
  version: string;
  downloadPath: typeof extensionDownloadPath;
  sha256: string;
  bytes: number;
};

function validChromeVersion(value: unknown) {
  if (typeof value !== "string") return false;
  const parts = value.split(".");
  return (
    parts.length >= 1 &&
    parts.length <= 4 &&
    parts.every((part) => {
      if (!/^(?:0|[1-9]\d{0,4})$/.test(part)) return false;
      return Number(part) <= 65535;
    })
  );
}

export function validateExtensionRelease(value: unknown): ExtensionRelease | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(",") !== "bytes,downloadPath,sha256,version" ||
    !validChromeVersion(record.version) ||
    record.downloadPath !== extensionDownloadPath ||
    typeof record.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(record.sha256) ||
    !Number.isSafeInteger(record.bytes) ||
    (record.bytes as number) < 1 ||
    (record.bytes as number) > maxReleaseBytes
  )
    return null;
  return record as ExtensionRelease;
}

export async function readExtensionRelease(
  downloadsDirectory = path.resolve("dist/web/downloads"),
): Promise<ExtensionRelease | null> {
  try {
    const metadata = await readFile(
      path.join(downloadsDirectory, "extension-release.json"),
      "utf8",
    );
    if (metadata.length > 4096) return null;
    const release = validateExtensionRelease(JSON.parse(metadata));
    if (!release) return null;
    const archive = await readFile(
      path.join(downloadsDirectory, "feedbacks-extension.zip"),
    );
    if (
      archive.length !== release.bytes ||
      createHash("sha256").update(archive).digest("hex") !== release.sha256
    )
      return null;
    return release;
  } catch {
    return null;
  }
}
