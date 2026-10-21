import { win32 } from "node:path";
import { z } from "zod";
import {
  nativeProcessNameSchema,
  type NativePlatform,
} from "../../shared/native-diagnostics.js";

export const nativeCollectionRequest = z.strictObject({
  processName: nativeProcessNameSchema,
  minutes: z.number().int().min(1).max(60).default(15),
});
export type NativeCollectionRequest = z.infer<typeof nativeCollectionRequest>;
export type NativeCommand = {
  executable: string;
  args: string[];
  env?: Record<string, string>;
};

// The only script is fixed source. User-selected values travel as data, never code.
const windowsScript = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$PSModuleAutoLoadingPreference = 'None'
Import-Module "$PSHOME\\Modules\\Microsoft.PowerShell.Diagnostics\\Microsoft.PowerShell.Diagnostics.psd1" -ErrorAction Stop
Import-Module "$PSHOME\\Modules\\Microsoft.PowerShell.Utility\\Microsoft.PowerShell.Utility.psd1" -ErrorAction Stop
$process = $env:FEEDBACKS_DIAGNOSTIC_PROCESS
$start = [DateTimeOffset]::Parse($env:FEEDBACKS_DIAGNOSTIC_START).UtcDateTime.ToString('o')
$end = [DateTimeOffset]::Parse($env:FEEDBACKS_DIAGNOSTIC_END).UtcDateTime.ToString('o')
$query = "*[System[(Provider[@Name='Application Error'] or Provider[@Name='Application Hang'] or Provider[@Name='Windows Error Reporting']) and TimeCreated[@SystemTime >= '$start' and @SystemTime <= '$end']] and EventData[Data='$process']]"
try { $events = @(Get-WinEvent -LogName Application -FilterXPath $query -MaxEvents 101 -ErrorAction Stop) }
catch { if ($_.FullyQualifiedErrorId -like 'NoMatchingEventsFound*') { $events = @() } else { throw } }
$result = @($events | ForEach-Object { $message = [string]$_.Message; [PSCustomObject]@{at=$_.TimeCreated.ToUniversalTime().ToString('o'); level=[int]$_.Level; eventId=[string]$_.Id; message=$message.Substring(0,[Math]::Min(4000,$message.Length))} })
ConvertTo-Json -InputObject $result -Compress -Depth 4
`;

export function nativeCommand(
  platform: NativePlatform,
  request: NativeCollectionRequest,
  startedAt: string,
  endedAt: string,
): NativeCommand {
  if (platform === "macos")
    return {
      executable: "/usr/bin/log",
      args: [
        "show",
        "--style",
        "ndjson",
        "--start",
        `@${Math.floor(Date.parse(startedAt) / 1000)}`,
        "--end",
        `@${Math.floor(Date.parse(endedAt) / 1000)}`,
        "--info",
        "--debug",
        "--predicate",
        `process == "${request.processName}"`,
      ],
    };
  if (platform === "linux") {
    if (Buffer.byteLength(request.processName) > 15)
      throw Error(
        "Linux _COMM process names must be at most 15 bytes; use the process name shown by the OS.",
      );
    return {
      executable: "/usr/bin/journalctl",
      args: [
        "--no-pager",
        "--quiet",
        "--output=json",
        "--lines=101",
        `--since=@${Math.floor(Date.parse(startedAt) / 1000)}`,
        `--until=@${Math.floor(Date.parse(endedAt) / 1000)}`,
        `_COMM=${request.processName}`,
      ],
    };
  }
  if (!/\.exe$/i.test(request.processName))
    throw Error("Use the Windows executable name, including .exe.");
  return {
    executable: win32.join(
      process.env.SystemRoot ?? "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    ),
    args: [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(windowsScript, "utf16le").toString("base64"),
    ],
    env: {
      FEEDBACKS_DIAGNOSTIC_PROCESS: request.processName,
      FEEDBACKS_DIAGNOSTIC_START: startedAt,
      FEEDBACKS_DIAGNOSTIC_END: endedAt,
    },
  };
}
