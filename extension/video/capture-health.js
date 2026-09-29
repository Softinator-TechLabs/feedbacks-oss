import { reviewTime } from "../session-review.js";

export function createCaptureHealth({ $, send, getState }) {
  let timer,
    generation = 0,
    busy = false;

  function stop() {
    clearInterval(timer);
    generation++;
    busy = false;
  }

  async function refresh() {
    const { debugSession, nativeState } = getState();
    if (busy || !debugSession || !["recording", "paused"].includes(nativeState)) return;
    const current = generation;
    busy = true;
    try {
      const health = await send({ type: "sessionHealth" });
      if (current !== generation) return;
      const counts = health.counts || {};
      $("capture-health-counts").textContent =
        `${counts.activity || 0} actions · ${counts.console || 0} console · ${counts.network || 0} network · ${counts.replay || 0} replay events`;
      const warnings = (health.coverage || [])
        .filter((item) =>
          ["partial", "unavailable", "failed", "error", "stopped"].includes(item.status),
        )
        .map((item) => item.detail || `${item.channel}: ${item.status}`);
      if (Number.isFinite(health.replayStoppedAtMs))
        warnings.push(
          `DOM replay ends at ${reviewTime(health.replayStoppedAtMs)}. Video and available diagnostics continue.`,
        );
      if (!health.active)
        warnings.push("Debug capture has stopped. Video is still recording.");
      $("capture-health-warning").textContent = [...new Set(warnings)].join(" ");
    } catch (error) {
      if (current !== generation) return;
      $("capture-health-counts").textContent = "Capture counts unavailable";
      $("capture-health-warning").textContent =
        `Debug capture status unavailable: ${error.message} Video is still recording.`;
    } finally {
      if (current === generation) busy = false;
    }
  }

  function start() {
    stop();
    $("capture-health").hidden = false;
    $("capture-health-counts").textContent = getState().debugSession
      ? "Checking debug capture…"
      : "Video only · debug context is off";
    $("capture-health-warning").textContent = "";
    if (!getState().debugSession) return;
    void refresh();
    timer = setInterval(() => void refresh(), 2000);
  }

  return { start, stop };
}
