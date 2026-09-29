export const DIAGNOSTIC_EVENT_INDEX_ROWS = 50_000;
export const DIAGNOSTIC_EVENT_LINE_BYTES = 262_144;
export const DIAGNOSTIC_EVENT_SCAN_LINES = 100_000;

export type DiagnosticEventLocator = {
  fileId: string;
  sequence: number;
  byteOffset: number;
  byteLength: number;
  ingressAt: number;
  requestId: string | null;
  method: string;
};

// Parse one JSONL file while retaining at most one bounded line. The returned
// locators point into the original private chunks; captured values stay there.
export function createDiagnosticEventIndexer(
  fileId: string,
  {
    maxRows = DIAGNOSTIC_EVENT_INDEX_ROWS,
    maxLineBytes = DIAGNOSTIC_EVENT_LINE_BYTES,
    maxEvents = DIAGNOSTIC_EVENT_SCAN_LINES,
  }: { maxRows?: number; maxLineBytes?: number; maxEvents?: number } = {},
) {
  const rows: DiagnosticEventLocator[] = [];
  const reasons = new Set<string>();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let parts: Uint8Array[] = [];
  let lineBytes = 0;
  let start: { sequence: number; byteOffset: number } | null = null;
  let oversized = false;
  let scannedCount = 0;
  let scanStopped = false;

  function append(bytes: Uint8Array) {
    lineBytes += bytes.byteLength;
    if (oversized || rows.length >= maxRows || bytes.byteLength === 0) return;
    if (lineBytes > maxLineBytes) {
      oversized = true;
      parts = [];
      reasons.add("event_too_large");
      return;
    }
    parts.push(bytes.slice());
  }

  function completeLine(hasNewline: boolean) {
    const byteLength = lineBytes + (hasNewline ? 1 : 0);
    scannedCount++;
    if (!oversized && lineBytes > 0) {
      if (rows.length >= maxRows) reasons.add("index_row_limit");
      else {
        try {
          const line = decoder.decode(
            parts.length === 1 ? parts[0] : Buffer.concat(parts, lineBytes),
          );
          const value = JSON.parse(line);
          if (
            !value ||
            typeof value !== "object" ||
            typeof value.method !== "string" ||
            value.method.length < 1 ||
            value.method.length > 100 ||
            !Number.isSafeInteger(value.ingressAt) ||
            value.ingressAt < 0
          )
            throw new TypeError("Invalid diagnostic event metadata");
          const candidate = value.params?.requestId;
          const requestId =
            typeof candidate === "string" &&
            candidate.length > 0 &&
            candidate.length <= 512
              ? candidate
              : null;
          if (typeof candidate === "string" && requestId === null)
            reasons.add("request_id_omitted");
          rows.push({
            fileId,
            sequence: start!.sequence,
            byteOffset: start!.byteOffset,
            byteLength,
            ingressAt: value.ingressAt,
            requestId,
            method: value.method,
          });
        } catch {
          reasons.add("invalid_event");
        }
      }
    } else if (!oversized) reasons.add("invalid_event");
    parts = [];
    lineBytes = 0;
    start = null;
    oversized = false;
  }

  function push(sequence: number, bytes: Uint8Array) {
    let offset = 0;
    while (offset < bytes.byteLength) {
      if (scanStopped || scannedCount >= maxEvents) {
        reasons.add("event_scan_limit");
        scanStopped = true;
        parts = [];
        start = null;
        return;
      }
      if (start === null) start = { sequence, byteOffset: offset };
      const newline = bytes.indexOf(10, offset);
      if (newline < 0) {
        append(bytes.subarray(offset));
        break;
      }
      append(bytes.subarray(offset, newline));
      completeLine(true);
      offset = newline + 1;
    }
  }

  function finish() {
    if (start !== null) completeLine(false);
    return {
      rows,
      scannedCount,
      status: reasons.size ? ("partial" as const) : ("complete" as const),
      reasons: [...reasons],
    };
  }

  return { push, finish };
}
