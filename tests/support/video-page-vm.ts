import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { reviewTime } from "../../extension/session-review.js";

// These tests evaluate the page entrypoint in a VM with fake Chrome and DOM APIs.
// Load its local factories in that same context so timers use the fixture clock.
export async function installVideoPageModules(context: vm.Context): Promise<void> {
  context.reviewTime = reviewTime;
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
