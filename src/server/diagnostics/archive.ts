import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import type { Response } from "express";
import type { AssetStore } from "../assets.js";
import type { DiagnosticManifestV1 } from "../../shared/screenshot-diagnostics.js";
import { diagnosticArchiveName } from "../../shared/screenshot-diagnostics.js";
import { checkedDiagnosticBytes } from "./read.js";
import { fail } from "../errors.js";

function octal(value: number, width: number): Buffer {
  return Buffer.from(value.toString(8).padStart(width - 1, "0") + "\0", "ascii");
}

export function tarHeader(name: string, size: number): Buffer {
  if (
    !/^[a-z0-9./-]+$/.test(name) ||
    name.includes("..") ||
    name.startsWith("/") ||
    Buffer.byteLength(name) > 100
  )
    throw new TypeError("Invalid generated archive name");
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, "ascii");
  octal(0o600, 8).copy(header, 100);
  octal(0, 8).copy(header, 108);
  octal(0, 8).copy(header, 116);
  octal(size, 12).copy(header, 124);
  octal(0, 12).copy(header, 136);
  header.fill(0x20, 148, 156);
  header.write("0", 156, "ascii");
  header.write("ustar\0", 257, "ascii");
  header.write("00", 263, "ascii");
  const sum = header.reduce((total, byte) => total + byte, 0);
  Buffer.from(sum.toString(8).padStart(6, "0") + "\0 ", "ascii").copy(header, 148);
  return header;
}

export function padding(size: number): Buffer | null {
  const length = (512 - (size % 512)) % 512;
  return length ? Buffer.alloc(length) : null;
}

export async function* diagnosticTarEntries(
  store: AssetStore,
  manifest: DiagnosticManifestV1,
  chunks: any[],
): AsyncGenerator<Buffer> {
  const chunkBySelector = new Map(
    chunks.map((chunk) => [`${chunk.file_id}:${chunk.sequence}`, chunk]),
  );
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + "\n", "utf8");
  yield tarHeader("manifest.json", manifestBytes.length);
  yield manifestBytes;
  const manifestPad = padding(manifestBytes.length);
  if (manifestPad) yield manifestPad;
  for (const file of manifest.files) {
    yield tarHeader(diagnosticArchiveName(file.kind, file.fileId), file.byteLength);
    const digest = createHash("sha256");
    for (const expected of file.chunks) {
      const row = chunkBySelector.get(`${file.fileId}:${expected.sequence}`);
      if (!row || row.sha256 !== expected.sha256 || row.byte_size !== expected.byteLength)
        fail("EVIDENCE_UNAVAILABLE", "Diagnostic archive chunk is missing", 503);
      const bytes = await checkedDiagnosticBytes(store, row);
      digest.update(bytes);
      yield bytes;
    }
    if (digest.digest("hex") !== file.sha256)
      fail("EVIDENCE_UNAVAILABLE", "Diagnostic archive file failed integrity check", 503);
    const pad = padding(file.byteLength);
    if (pad) yield pad;
  }
  yield Buffer.alloc(1024);
}

export async function streamDiagnosticArchive(
  res: Response,
  store: AssetStore,
  manifest: DiagnosticManifestV1,
  chunks: any[],
) {
  res.set({
    "Cache-Control": "private, no-store",
    "Content-Type": "application/gzip",
    "Content-Disposition": `attachment; filename="feedbacks-diagnostics-${manifest.id}.tar.gz"`,
  });
  await pipeline(
    Readable.from(diagnosticTarEntries(store, manifest, chunks)),
    createGzip(),
    res,
  );
}
