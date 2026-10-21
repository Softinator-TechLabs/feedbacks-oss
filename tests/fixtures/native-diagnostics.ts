import {
  nativeCollectors,
  type NativeDiagnosticReport,
  type NativePlatform,
} from "../../src/shared/native-diagnostics.js";

export function nativeReport(platform: NativePlatform = "linux"): NativeDiagnosticReport {
  return {
    schemaVersion: 1,
    source: "os_logs",
    platform,
    processName: platform === "windows" ? "SyntheticApp.exe" : "SyntheticApp",
    collector: nativeCollectors[platform],
    startedAt: "2026-10-21T04:00:00.000Z",
    endedAt: "2026-10-21T04:15:00.000Z",
    coverage: "partial",
    reasons: ["bounded_snapshot", "os_visibility_limited"],
    events: [
      {
        at: "2026-10-21T04:10:00.000Z",
        level: "error",
        message:
          "Synthetic app failure token=synthetic-secret user@example.test https://api.example.test/private?key=secret",
      },
    ],
  };
}
