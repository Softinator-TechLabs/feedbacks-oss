import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { nativeReport } from "./fixtures/native-diagnostics.js";
import {
  nativeDiagnosticReportSchema,
  redactNativeDiagnosticText,
} from "../src/shared/native-diagnostics.js";
import {
  nativeCommand,
  nativeCollectionRequest,
} from "../src/cli/native-diagnostics/commands.js";
import {
  collectNativeDiagnostics,
  parseNativeEvents,
  runNativeCommand,
} from "../src/cli/native-diagnostics/collect.js";

const now = new Date("2026-10-21T04:15:00.000Z");

test("OS commands bind exact process/time values as data and reject shell/predicate syntax", () => {
  for (const processName of [
    'App" OR TRUE',
    "app; whoami",
    "$(whoami)",
    "/Applications/App",
    "app\nother",
  ])
    assert.equal(nativeCollectionRequest.safeParse({ processName }).success, false);
  const request = nativeCollectionRequest.parse({ processName: "SyntheticApp" });
  const mac = nativeCommand(
    "macos",
    request,
    nativeReport().startedAt,
    nativeReport().endedAt,
  );
  assert.equal(mac.executable, "/usr/bin/log");
  assert.equal(mac.args.at(-1), 'process == "SyntheticApp"');
  assert.ok(mac.args.includes("--start") && mac.args.includes("--end"));
  const linux = nativeCommand(
    "linux",
    request,
    nativeReport().startedAt,
    nativeReport().endedAt,
  );
  assert.ok(linux.args.includes("_COMM=SyntheticApp"));
  assert.ok(linux.args.includes("--lines=101"));
  assert.throws(
    () =>
      nativeCommand(
        "linux",
        { ...request, processName: "LongProcessNameOver15" },
        nativeReport().startedAt,
        nativeReport().endedAt,
      ),
    /15 bytes/,
  );
  assert.throws(
    () =>
      nativeCommand("windows", request, nativeReport().startedAt, nativeReport().endedAt),
    /\.exe/,
  );
  const windows = nativeCommand(
    "windows",
    { ...request, processName: "SyntheticApp.exe" },
    nativeReport().startedAt,
    nativeReport().endedAt,
  );
  assert.match(windows.executable, /WindowsPowerShell\\v1\.0\\powershell\.exe$/);
  const script = Buffer.from(windows.args.at(-1)!, "base64").toString("utf16le");
  assert.ok(
    script.includes("Get-WinEvent") &&
      script.includes("$process = $env:FEEDBACKS_DIAGNOSTIC_PROCESS") &&
      script.includes("-LogName Application -FilterXPath $query -MaxEvents 101") &&
      script.includes("EventData[Data='$process']") &&
      script.includes("@SystemTime >= '$start' and @SystemTime <= '$end'") &&
      script.includes("$PSModuleAutoLoadingPreference = 'None'") &&
      script.includes("$PSHOME\\Modules\\Microsoft.PowerShell.Diagnostics\\") &&
      script.includes("$PSHOME\\Modules\\Microsoft.PowerShell.Utility\\"),
  );
  assert.ok(!script.includes("SyntheticApp.exe"));
  assert.equal(windows.env!.FEEDBACKS_DIAGNOSTIC_PROCESS, "SyntheticApp.exe");
});

test("native report redaction handles common credentials, URL details, personal paths and terminal controls", () => {
  const syntheticMacHome = ["", "Users", "person", "private"].join("/");
  const message = `{"password":"sensitive value", "api_key": "fixture-key"}\nAuthorization: Bearer fixture-secret\nCookie: session=fixture; other=private\nmail@example.test ${syntheticMacHome} /home/person/log C:\\Users\\person\\log https://api.example.test/private?q=secret\u001b[31m`;
  const redacted = redactNativeDiagnosticText(message);
  for (const secret of [
    "sensitive value",
    "fixture-key",
    "fixture-secret",
    "session=fixture",
    "other=private",
    "mail@example.test",
    "/person/",
    "\\person\\",
    "?q=secret",
    "\u001b",
  ])
    assert.ok(!redacted.includes(secret), secret);
  assert.ok(redacted.includes("https://api.example.test"));
  assert.equal(redactNativeDiagnosticText(redacted), redacted);
  const report = nativeDiagnosticReportSchema.parse(nativeReport());
  assert.ok(!report.events[0].message.includes("synthetic-secret"));
  for (const invalid of [
    { ...report, coverage: "complete" },
    { ...report, collector: "windows_event_log" },
    { ...report, endedAt: "2026-10-22T00:00:00Z" },
    { ...report, coverage: "unavailable" },
    { ...report, events: Array(101).fill(report.events[0]) },
    { ...report, processName: "app; command" },
    { ...report, extra: "fabricated" },
  ])
    assert.equal(nativeDiagnosticReportSchema.safeParse(invalid).success, false);
});

test("each OS parser preserves native severity/time and omits unsupported records", () => {
  const mac = parseNativeEvents(
    "macos",
    JSON.stringify({
      timestamp: now.toISOString(),
      messageType: "Fault",
      eventMessage: "macOS failure",
    }) + "\nnot-json\n",
  );
  assert.equal(mac.events[0].level, "error");
  assert.equal(mac.events[0].at, now.toISOString());
  assert.equal(mac.invalid, true);
  assert.deepEqual(parseNativeEvents("macos", '{"count":0,"finished":1}\n'), {
    events: [],
    invalid: false,
  });
  assert.equal(parseNativeEvents("macos", '{"count":"bad","finished":1}').invalid, true);
  const linux = parseNativeEvents(
    "linux",
    JSON.stringify({
      __REALTIME_TIMESTAMP: String(now.getTime() * 1000),
      PRIORITY: "4",
      MESSAGE: "Linux warning",
    }),
  );
  assert.equal(linux.events[0].level, "warning");
  assert.equal(linux.events[0].at, now.toISOString());
  const windows = parseNativeEvents(
    "windows",
    JSON.stringify([
      { at: now.toISOString(), level: 2, eventId: "1000", message: "Windows crash" },
    ]),
  );
  assert.equal(windows.events[0].level, "error");
  assert.equal(windows.events[0].eventId, "1000");
  assert.equal(parseNativeEvents("linux", '{"MESSAGE":[1,2]}').events.length, 0);
  assert.deepEqual(parseNativeEvents("linux", JSON.stringify({ MESSAGE: "\u202e" })), {
    events: [],
    invalid: true,
  });
});

test("collection caps events and bytes, records unavailable tools, and never invents full coverage", async () => {
  const stdout = Array.from({ length: 101 }, () =>
    JSON.stringify({ MESSAGE: "🙂".repeat(1000), PRIORITY: "3" }),
  ).join("\n");
  const report = await collectNativeDiagnostics(
    { processName: "SyntheticApp" },
    { platform: "linux", now, run: async () => ({ stdout }) },
  );
  assert.ok(report.events.length <= 100);
  assert.ok(Buffer.byteLength(JSON.stringify(report)) <= 131072);
  assert.ok(
    report.reasons.includes("event_limit") && report.reasons.includes("output_limit"),
  );
  assert.equal(report.coverage, "partial");
  for (const reason of [
    "tool_not_found",
    "permission_denied",
    "query_failed",
    "timed_out",
  ] as const) {
    const failed = await collectNativeDiagnostics(
      { processName: "SyntheticApp" },
      { platform: "linux", now, run: async () => ({ stdout, reason }) },
    );
    assert.equal(failed.coverage, "unavailable");
    assert.equal(failed.events.length, 0);
    assert.ok(failed.reasons.includes(reason));
  }
  const empty = await collectNativeDiagnostics(
    { processName: "SyntheticApp" },
    { platform: "linux", now, run: async () => ({ stdout: "" }) },
  );
  assert.equal(empty.coverage, "partial");
  assert.ok(empty.reasons.includes("no_matching_events"));
});

test("OS runner bounds output and time, drains stderr, and does not inherit Feedbacks credentials", async () => {
  const noInput = await runNativeCommand(
    {
      executable: process.execPath,
      args: [
        "-e",
        "process.stdin.resume();process.stdin.on('end',()=>process.stdout.write('closed'))",
      ],
    },
    { timeoutMs: 2000, maxBytes: 1000 },
  );
  assert.deepEqual(noInput, { stdout: "closed" });
  const old = process.env.FEEDBACKS_TOKEN;
  process.env.FEEDBACKS_TOKEN = "synthetic-test-secret";
  try {
    const environment = await runNativeCommand({
      executable: process.execPath,
      args: [
        "-e",
        "process.stdout.write(String(process.env.FEEDBACKS_TOKEN ?? 'absent'))",
      ],
    });
    assert.equal(environment.stdout, "absent");
  } finally {
    if (old === undefined) delete process.env.FEEDBACKS_TOKEN;
    else process.env.FEEDBACKS_TOKEN = old;
  }
  const capped = await runNativeCommand(
    {
      executable: process.execPath,
      args: ["-e", "process.stdout.write('x'.repeat(20000));setInterval(()=>{},1000)"],
    },
    { timeoutMs: 2000, maxBytes: 1000 },
  );
  assert.equal(capped.reason, "output_limit");
  assert.equal(capped.stdout.length, 1000);
  const timed = await runNativeCommand(
    { executable: process.execPath, args: ["-e", "setInterval(()=>{},1000)"] },
    { timeoutMs: 50, maxBytes: 1000 },
  );
  assert.equal(timed.reason, "timed_out");
  const missing = await runNativeCommand({
    executable: `/missing-feedbacks-tool-${randomUUID()}`,
    args: [],
  });
  assert.equal(missing.reason, "tool_not_found");
  const failed = await runNativeCommand({
    executable: process.execPath,
    args: ["-e", "process.stderr.write('private error');process.exit(1)"],
  });
  assert.equal(failed.reason, "query_failed");
  assert.ok(!JSON.stringify(failed).includes("private error"));
  const denied = await runNativeCommand({
    executable: process.execPath,
    args: [
      "-e",
      "process.stderr.write('Permission denied: private path');process.exit(1)",
    ],
  });
  assert.equal(denied.reason, "permission_denied");
  assert.ok(!JSON.stringify(denied).includes("private path"));
});

test(
  "matching OS tool invocation for a unique empty process is bounded and does not upload",
  { skip: process.env.FEEDBACKS_NATIVE_OS_SMOKE !== "1", timeout: 30000 },
  async () => {
    const windows = process.platform === "win32";
    const name = windows
      ? `FeedbacksFixture-${randomUUID()}.exe`
      : `Fb${randomUUID().replaceAll("-", "").slice(0, 10)}`;
    if (windows) {
      const command = nativeCommand(
        "windows",
        { processName: name, minutes: 1 },
        now.toISOString(),
        now.toISOString(),
      );
      const probe = `[Console]::WriteLine('startup'); Import-Module Microsoft.PowerShell.Diagnostics -ErrorAction Stop; [Console]::WriteLine('module'); Get-WinEvent -ListLog Application -ErrorAction Stop | Out-Null; [Console]::WriteLine('channel')`;
      const startup = await runNativeCommand({
        ...command,
        args: [
          ...command.args.slice(0, -1),
          Buffer.from(probe, "utf16le").toString("base64"),
        ],
      });
      process.stdout.write(
        `${JSON.stringify({ probe: "windows-runtime", stages: startup.stdout.trim().split(/\s+/), reason: startup.reason })}\n`,
      );
    }
    const report = await collectNativeDiagnostics({ processName: name, minutes: 1 });
    process.stdout.write(
      `${JSON.stringify({ platform: report.platform, collector: report.collector, coverage: report.coverage, reasons: report.reasons, eventCount: report.events.length })}\n`,
    );
    assert.equal(report.processName, name);
    assert.equal(report.events.length, 0);
    assert.ok(["partial", "unavailable"].includes(report.coverage));
    assert.ok(report.reasons.includes("no_matching_events"));
    assert.ok(!report.reasons.includes("invalid_records"));
  },
);
