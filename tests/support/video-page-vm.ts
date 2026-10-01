import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { reviewTime } from "../../extension/session-review.js";
import {
  recordingDefaults,
  captureMicrophone,
  audioAccessError,
} from "../../extension/recordings/audio-access.js";

// These tests evaluate the page entrypoint in a VM with fake Chrome and DOM APIs.
// Load its local factories in that same context so timers use the fixture clock.
export async function installVideoPageModules(context: vm.Context): Promise<void> {
  context.reviewTime = reviewTime;
  context.recordingDefaults = recordingDefaults;
  context.captureMicrophone = () => captureMicrophone(context.navigator);
  context.audioAccessError = audioAccessError;
  // Member-picker DOM/keyboard behavior is exercised in packaged browser QA.
  // This fixture focuses on recorder state and approved submission snapshots.
  context.createCaptureTriage = () => ({
    value: () => context.captureTriageValue,
    reset() {},
    setDisabled() {},
  });
  for (const module of ["capture-health", "crop-controls"]) {
    const source = await readFile(
      new URL(`../../extension/video/${module}.js`, import.meta.url),
      "utf8",
    );
    vm.runInContext(
      source.replace(/^import .*;\n/gm, "").replace(/^export /gm, ""),
      context,
    );
  }
}
