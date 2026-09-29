import { diagnosticPreview, downloadDraftDiagnostics } from "./archive.js";
import { summarizeLocalDiagnostics } from "./summary.js";

export function createEditorDiagnostics({
  diagnosticStore,
  getDraft,
  setDraft,
  isLoadingBase,
  send,
  persist,
  schedule,
  status,
}) {
  const $ = (id) => document.getElementById(id);
  function renderDiagnostics() {
    const draft = getDraft();
    const artifact = draft?.diagnosticEvidence;
    $("diagnostics-review").hidden = !artifact && !draft?.diagnostics;
    $("include-diagnostics").checked = !!draft?.includeDiagnostics;
    const entries = $("diagnostics-entries");
    entries.replaceChildren();
    $("diagnostics-legacy-hint").hidden = !!artifact;
    $("diagnostics-legacy-limit").hidden = !!artifact;
    $("download-diagnostics").hidden = !artifact;
    if (artifact) {
      const id = artifact.evidenceId;
      const summary = document.createElement("p");
      summary.className = "hint";
      summary.textContent = `Captured ${(artifact.totalBytes / 1048576).toFixed(1)} MiB of raw page diagnostics. The archive contains available DOM, console, network, bodies, storage and browser context. Missing channels are recorded in coverage.`;
      entries.append(summary);
      const facts = document.createElement("dl");
      facts.className = "diagnostic-facts";
      facts.textContent = "Loading capture summary…";
      entries.append(facts);
      void diagnosticStore
        .getEvidenceState(id)
        .then((state) => {
          if (getDraft()?.diagnosticEvidence?.evidenceId !== id) return;
          const manifest = state?.manifest;
          const metrics = summarizeLocalDiagnostics(manifest);
          const unavailable = "Unavailable for this capture";
          const count = (value) =>
            value === null ? unavailable : value.toLocaleString();
          const coverage = (channel) => {
            const status = manifest?.coverage?.[channel]?.status;
            return status && status !== "complete" ? ` · ${status} coverage` : "";
          };
          const add = (name, value) => {
            const term = document.createElement("dt");
            const detail = document.createElement("dd");
            term.textContent = name;
            detail.textContent = value;
            facts.append(term, detail);
          };
          facts.replaceChildren();
          add(
            "Capture window",
            metrics.startedAt
              ? `${new Date(metrics.startedAt).toLocaleString()} → ${metrics.endedAt ? new Date(metrics.endedAt).toLocaleString() : "end unavailable"}`
              : unavailable,
          );
          add(
            "DOM snapshot",
            metrics.domBytes === null
              ? unavailable
              : `${metrics.domBytes.toLocaleString()} bytes${coverage("dom")}`,
          );
          add(
            "Console / errors",
            metrics.consoleCount === null || metrics.errorCount === null
              ? unavailable
              : `${count(metrics.consoleCount)} messages · ${count(metrics.errorCount)} errors${coverage("console")}`,
          );
          add(
            "HTTP requests",
            metrics.httpRequestCount === null
              ? unavailable
              : `${count(metrics.httpRequestCount)} observed${coverage("network")}`,
          );
          add(
            "Response bodies",
            metrics.responseBodyCount === null || metrics.responseCount === null
              ? unavailable
              : `${count(metrics.responseBodyCount)} captured · ${count(metrics.responseCount)} HTTP responses observed${coverage("body")}`,
          );
        })
        .catch(() => {
          facts.textContent = "Capture summary is unavailable in this browser.";
        });
      for (const [channel, value] of Object.entries(artifact.coverage || {})) {
        const line = document.createElement("p");
        line.className = "diagnostic-coverage";
        line.textContent = `${channel}: ${value.status} · ${value.observedCount} items · ${value.capturedBytes} bytes${value.reasons?.length ? ` · ${value.reasons.join(", ")}` : ""}`;
        entries.append(line);
      }
      const sample = document.createElement("pre");
      sample.className = "diagnostic-sample";
      sample.textContent = "Loading a small local preview…";
      entries.append(sample);
      void diagnosticPreview(diagnosticStore, id)
        .then((value) => {
          if (getDraft()?.diagnosticEvidence?.evidenceId !== id) return;
          sample.textContent = value?.samples.length
            ? value.samples.map((item) => `${item.kind}\n${item.text}`).join("\n\n")
            : "No text preview is available. Download the archive to inspect captured files.";
        })
        .catch(() => {
          sample.textContent = "Local preview unavailable; retry from this browser.";
        });
      return;
    }
    if (!draft?.diagnostics) return;
    for (const kind of ["console", "network"]) {
      const heading = document.createElement("h3");
      heading.textContent = `${kind === "console" ? "Console" : "Network"} (${draft.diagnostics[kind].length})`;
      entries.append(heading);
      for (const [index, entry] of draft.diagnostics[kind].entries()) {
        const label = document.createElement("label"),
          input = document.createElement("input"),
          text = document.createElement("span");
        label.className = "diagnostic-entry";
        input.type = "checkbox";
        input.value = String(index);
        input.dataset.diagnosticKind = kind;
        input.checked = draft.diagnosticsSelection
          ? draft.diagnosticsSelection[kind]?.includes(index)
          : true;
        input.onchange = schedule;
        text.textContent =
          kind === "console"
            ? `${entry.level} · ${entry.atMs} ms`
            : `${entry.type} · ${entry.status ?? "status unavailable"} · ${entry.durationMs} ms · ${entry.url}`;
        label.append(input, text);
        entries.append(label);
        if (kind === "console") {
          const message = document.createElement("textarea"),
            mask = document.createElement("button");
          message.className = "diagnostic-message";
          message.value = entry.message;
          message.readOnly = true;
          message.rows = 2;
          message.setAttribute("aria-label", `Console message ${index + 1}`);
          mask.type = "button";
          mask.dataset.diagnosticMask = "";
          mask.textContent = "Mask selected text";
          mask.disabled = !!draft.frozen;
          mask.onclick = async () => {
            const currentDraft = getDraft();
            if (!currentDraft || currentDraft.frozen || isLoadingBase()) return;
            const start = message.selectionStart,
              end = message.selectionEnd;
            if (end <= start) {
              status("Select the private text in the message first.", "error");
              return;
            }
            mask.disabled = true;
            try {
              await persist();
              setDraft(
                await send({
                  type: "redactDiagnostic",
                  id: getDraft().id,
                  index,
                  start,
                  end,
                }),
              );
              renderDiagnostics();
              status("Selected text masked in the local draft.");
            } catch (error) {
              status(error.message, "error");
              mask.disabled = false;
            }
          };
          entries.append(message, mask);
        }
      }
    }
  }
  $("download-diagnostics").onclick = async () => {
    const id = getDraft()?.diagnosticEvidence?.evidenceId;
    if (!id) return;
    try {
      await downloadDraftDiagnostics(diagnosticStore, id);
      status("Diagnostic archive downloaded.");
    } catch (error) {
      if (error.name !== "AbortError") status(error.message, "error");
    }
  };
  return renderDiagnostics;
}
