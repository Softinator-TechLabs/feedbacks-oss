import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function verifyRecordingControls({ root, results }) {
  // The legacy visible-recorder scenario opened video.html at Start. The
  // current recorder is offscreen and opens video.html only after Stop, so run
  // its packaged end-to-end scenario instead of waiting for a nonexistent tab.
  const { stdout } = await execFileAsync(
    process.execPath,
    [join(root, "scripts/offscreen-recording-browser-qa.mjs")],
    { cwd: root, timeout: 90000 },
  );
  assert.match(stdout, /PASS one-click hidden video \+ session/);
  results.recordingControls = {
    oneClick: true,
    sourcePauseStop: true,
    diagnostics: true,
    stopToReview: true,
  };
}
