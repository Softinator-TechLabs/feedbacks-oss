import { createSha256Hasher } from "./sha256.js";

const encoder = new TextEncoder();
const archiveName = (manifest) =>
  `feedbacks-diagnostics-${manifest.id}-${manifest.startedAt.slice(0, 10)}.tar.gz`;
const fileName = (file) =>
  `${file.kind}/${file.fileId}.${file.kind === "dom" ? "html.txt" : "bin"}`;

function header(name, size) {
  const bytes = new Uint8Array(512);
  const field = (offset, length, value) =>
    bytes.set(encoder.encode(value).subarray(0, length), offset);
  const octal = (offset, length, value) =>
    field(offset, length, value.toString(8).padStart(length - 1, "0") + "\0");
  field(0, 100, name);
  octal(100, 8, 0o600);
  octal(108, 8, 0);
  octal(116, 8, 0);
  octal(124, 12, size);
  octal(136, 12, 0);
  bytes.fill(32, 148, 156);
  bytes[156] = 48;
  field(257, 6, "ustar\0");
  field(263, 2, "00");
  field(
    148,
    8,
    bytes
      .reduce((sum, byte) => sum + byte, 0)
      .toString(8)
      .padStart(6, "0") + "\0 ",
  );
  return bytes;
}

async function* tarEntries(store, evidenceId, manifest) {
  const metadata = encoder.encode(JSON.stringify(manifest, null, 2) + "\n");
  yield header("manifest.json", metadata.byteLength);
  yield metadata;
  yield new Uint8Array((512 - (metadata.byteLength % 512)) % 512);
  for (const file of manifest.files) {
    yield header(fileName(file), file.byteLength);
    const fileHash = createSha256Hasher();
    for (const chunk of file.chunks) {
      const local = await store.getEvidenceChunk(evidenceId, file.fileId, chunk.sequence);
      if (
        !local ||
        local.byteLength !== chunk.byteLength ||
        local.sha256 !== chunk.sha256
      )
        throw Error("A local diagnostic chunk is missing or changed.");
      const chunkHash = createSha256Hasher();
      chunkHash.update(local.bytes);
      if (chunkHash.hexDigest() !== chunk.sha256)
        throw Error("A local diagnostic chunk failed its checksum.");
      fileHash.update(local.bytes);
      yield local.bytes;
    }
    if (fileHash.hexDigest() !== file.sha256)
      throw Error("A local diagnostic file failed its checksum.");
    yield new Uint8Array((512 - (file.byteLength % 512)) % 512);
  }
  yield new Uint8Array(1024);
}

export async function diagnosticArchiveStream(store, evidenceId) {
  const state = await store.getEvidenceState(evidenceId);
  if (!state?.manifest) throw Error("Local screenshot diagnostics are unavailable.");
  const iterator = tarEntries(store, evidenceId, state.manifest);
  const tar = new ReadableStream({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (next.done) controller.close();
        else controller.enqueue(next.value);
      } catch (error) {
        controller.error(error);
      }
    },
  });
  return {
    filename: archiveName(state.manifest),
    stream: tar.pipeThrough(new CompressionStream("gzip")),
    rawBytes: state.manifest.totalBytes,
  };
}

const SMALL_BLOB_LIMIT = 8 * 1024 * 1024;
const PRIVATE_FILE_PREFIX = "feedbacks-diag-export-";
const PRIVATE_FILE_LIFETIME = 60 * 60 * 1000;
export const PRIVATE_ARCHIVE_CLEANUP_ALARM = "feedbacks-diagnostic-archive-cleanup";

async function clearOldPrivateArchives(root) {
  if (typeof root.entries !== "function") return;
  try {
    let nextCleanup = Infinity;
    for await (const [name] of root.entries()) {
      const match = /^feedbacks-diag-export-(\d{13})-[0-9a-f-]{36}\.tar\.gz$/.exec(name);
      if (!match) continue;
      const expiresAt = Number(match[1]) + PRIVATE_FILE_LIFETIME;
      if (Date.now() >= expiresAt) {
        try {
          await root.removeEntry(name);
        } catch {
          nextCleanup = Math.min(nextCleanup, Date.now() + PRIVATE_FILE_LIFETIME);
        }
      } else nextCleanup = Math.min(nextCleanup, expiresAt);
    }
    if (Number.isFinite(nextCleanup))
      await globalThis.chrome?.alarms?.create(PRIVATE_ARCHIVE_CLEANUP_ALARM, {
        when: Math.max(Date.now() + 60_000, nextCleanup),
      });
  } catch {
    // Cleanup is best-effort; a storage enumeration error must not block export.
  }
}

export async function cleanupPrivateDiagnosticArchives() {
  const root = await globalThis.navigator?.storage?.getDirectory?.();
  if (root) await clearOldPrivateArchives(root);
}

async function downloadFromPrivateFile(stream, filename, root) {
  await clearOldPrivateArchives(root);
  const temporaryName = `${PRIVATE_FILE_PREFIX}${Date.now()}-${crypto.randomUUID()}.tar.gz`;
  const temporary = await root.getFileHandle(temporaryName, { create: true });
  let url;
  try {
    await stream.pipeTo(await temporary.createWritable());
    const file = await temporary.getFile();
    url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    await globalThis.chrome?.alarms?.create(PRIVATE_ARCHIVE_CLEANUP_ALARM, {
      when: Date.now() + PRIVATE_FILE_LIFETIME,
    });
    setTimeout(
      () => {
        URL.revokeObjectURL(url);
        void root.removeEntry(temporaryName).catch(() => {});
      },
      60 * 60 * 1000,
    );
  } catch (error) {
    if (url) URL.revokeObjectURL(url);
    await root.removeEntry(temporaryName).catch(() => {});
    throw error;
  }
}

export async function downloadDraftDiagnostics(store, evidenceId) {
  const picker = globalThis.showSaveFilePicker;
  const handle = picker
    ? await picker({
        suggestedName: `feedbacks-diagnostics-${evidenceId}.tar.gz`,
        types: [
          {
            description: "Compressed diagnostic archive",
            accept: { "application/gzip": [".gz"] },
          },
        ],
      })
    : null;
  const { filename, stream, rawBytes } = await diagnosticArchiveStream(store, evidenceId);
  if (handle) {
    const writable = await handle.createWritable();
    try {
      await stream.pipeTo(writable);
    } catch (error) {
      await writable.abort().catch(() => {});
      throw error;
    }
  } else {
    let root;
    try {
      root = await globalThis.navigator?.storage?.getDirectory?.();
    } catch {
      // Small archives can still use the browser's ordinary Blob download.
    }
    if (root) {
      await downloadFromPrivateFile(stream, filename, root);
      return;
    }
    if (!Number.isSafeInteger(rawBytes) || rawBytes < 0 || rawBytes > SMALL_BLOB_LIMIT)
      throw Error(
        "This browser cannot stream a large diagnostic archive to disk. Use Chrome's file saving support and retry the download.",
      );
    const blob = await new Response(stream).blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
}

export async function diagnosticPreview(store, evidenceId) {
  const state = await store.getEvidenceState(evidenceId);
  if (!state?.manifest) return null;
  const samples = [];
  const seen = new Set();
  for (const file of state.manifest.files) {
    if (
      seen.has(file.kind) ||
      samples.length >= 5 ||
      !file.chunks.length ||
      !/^(?:text\/|application\/(?:json|jsonl))/.test(file.mimeType)
    )
      continue;
    seen.add(file.kind);
    const first = await store.getEvidenceChunk(evidenceId, file.fileId, 0);
    if (!first) continue;
    samples.push({
      kind: file.kind,
      text: new TextDecoder().decode(first.bytes.subarray(0, 512)),
    });
  }
  return { manifest: state.manifest, samples };
}
