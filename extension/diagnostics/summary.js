// The manifest stores exact counters when capture supports them. Older evidence
// has no counters; channel observedCount measures CDP events, not requests.
export function summarizeLocalDiagnostics(manifest) {
  const count = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : null);
  const files = Array.isArray(manifest?.files) ? manifest.files : null;
  const domBytes = files
    ? files
        .filter(
          (file) =>
            file.kind === "dom" &&
            file.mimeType?.split(";")[0].trim().toLowerCase() === "text/html",
        )
        .reduce((total, file) => total + file.byteLength, 0)
    : null;
  const stats = manifest?.stats;
  return {
    startedAt: typeof manifest?.startedAt === "string" ? manifest.startedAt : null,
    endedAt: typeof manifest?.endedAt === "string" ? manifest.endedAt : null,
    domBytes: count(domBytes),
    consoleCount: count(stats?.consoleCount),
    errorCount: count(stats?.errorCount),
    httpRequestCount: count(stats?.httpRequestCount),
    responseCount: count(stats?.responseCount),
    responseBodyCount: count(stats?.responseBodyCount),
  };
}
