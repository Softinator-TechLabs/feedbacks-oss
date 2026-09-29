import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { diagnosticsOutputs } from "../shared/contracts/domains/diagnostics.js";
import { diagnosticMaterializeInput } from "../shared/diagnostic-export.js";
import {
  DIAGNOSTIC_CHUNK_BYTES,
  DIAGNOSTIC_MAX_BYTES,
  diagnosticArchiveName,
  type DiagnosticFile,
} from "../shared/screenshot-diagnostics.js";

type Execute = (name: string, input: unknown) => Promise<unknown>;
type DownloadChunk = (
  evidenceId: string,
  fileId: string,
  sequence: number,
) => Promise<Uint8Array>;

/** The server describes metadata only. Each authorized chunk is fetched and verified on demand. */
export async function materializeDiagnostics(
  execute: Execute,
  downloadChunk: DownloadChunk,
  options: { evidenceId: string; baseDirectory?: string },
) {
  const { evidenceId } = diagnosticMaterializeInput.parse({
    evidenceId: options.evidenceId,
  });
  const files: DiagnosticFile[] = [];
  const names = new Set<string>();
  let evidence: any;
  let coverage: any;
  let total: number | undefined;
  for (let offset = 0; ; ) {
    const page = diagnosticsOutputs["diagnostics.describe"].parse(
      await execute("diagnostics.describe", { evidenceId, offset, limit: 100 }),
    );
    if (page.evidence.id !== evidenceId || page.evidence.status !== "complete")
      throw Error("Diagnostic evidence identity or status mismatch");
    if (!page.coverage) throw Error("Diagnostic coverage is missing");
    if (evidence && JSON.stringify(page.evidence) !== JSON.stringify(evidence))
      throw Error("Diagnostic evidence changed during export");
    if (coverage && JSON.stringify(page.coverage) !== JSON.stringify(coverage))
      throw Error("Diagnostic coverage changed during export");
    if (total !== undefined && total !== page.total)
      throw Error("Diagnostic file count changed during export");
    evidence = page.evidence;
    coverage = page.coverage;
    total = page.total;
    if (total > 16_384) throw Error("Diagnostic file count exceeds limit");
    for (const file of page.files) {
      const name = diagnosticArchiveName(file.kind, file.fileId);
      if (names.has(name)) throw Error("Duplicate diagnostic file name collision");
      names.add(name);
      files.push(file);
    }
    if (files.length > total) throw Error("Diagnostic file count mismatch");
    if (page.nextOffset === null) break;
    if (page.nextOffset !== offset + page.files.length || page.nextOffset <= offset)
      throw Error("Invalid diagnostic file pagination");
    offset = page.nextOffset;
  }
  if (!evidence || files.length !== total || files.length !== evidence.fileCount)
    throw Error("Diagnostic file count mismatch");
  const aggregate = files.reduce((sum, file) => sum + file.byteLength, 0);
  if (aggregate !== evidence.totalBytes || aggregate > DIAGNOSTIC_MAX_BYTES)
    throw Error("Diagnostic aggregate length mismatch");

  const directory = await mkdtemp(
    join(options.baseDirectory ?? tmpdir(), "feedbacks-diagnostics-"),
  );
  const written: {
    fileId: string;
    kind: DiagnosticFile["kind"];
    path: string;
    byteLength: number;
    sha256: string;
  }[] = [];
  try {
    await chmod(directory, 0o700);
    const manifest = join(directory, "manifest.json");
    await writeFile(
      manifest,
      JSON.stringify({ evidence, coverage, files }, null, 2) + "\n",
      {
        flag: "wx",
        mode: 0o600,
      },
    );
    for (const file of files) {
      const path = join(directory, diagnosticArchiveName(file.kind, file.fileId));
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      const handle = await open(path, "wx", 0o600);
      const fullHash = createHash("sha256");
      let byteLength = 0;
      try {
        for (const chunk of file.chunks) {
          const raw = await downloadChunk(evidenceId, file.fileId, chunk.sequence);
          if (
            !(raw instanceof Uint8Array) ||
            raw.byteLength > DIAGNOSTIC_CHUNK_BYTES ||
            raw.byteLength !== chunk.byteLength ||
            createHash("sha256").update(raw).digest("hex") !== chunk.sha256
          )
            throw Error("Diagnostic chunk integrity mismatch");
          await handle.writeFile(raw);
          fullHash.update(raw);
          byteLength += raw.byteLength;
        }
      } finally {
        await handle.close();
      }
      if (byteLength !== file.byteLength || fullHash.digest("hex") !== file.sha256)
        throw Error("Diagnostic file integrity mismatch");
      written.push({
        fileId: file.fileId,
        kind: file.kind,
        path,
        byteLength,
        sha256: file.sha256,
      });
    }
    return { directory, manifest, evidenceId, coverage, files: written };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
