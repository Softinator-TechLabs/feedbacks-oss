import { diagnosticCollector } from "./diagnostics.js";
import { createDiagnosticEvidenceStore } from "./evidence-store.js";
import { sameDiagnosticBinding } from "./identity.js";
import { createRawDiagnosticCapture } from "./raw-debug.js";
import { capturePreparedDom } from "../capture/dom-stream.js";

export function createWorkerDiagnostics({
  chrome,
  sessionCapture,
  debuggerLease,
  sessionFor,
  accountIdentity,
}) {
  const diagnosticEvidenceStore = createDiagnosticEvidenceStore();
  const rawDiagnostics = new Map();
  async function retireRawDiagnostics(tabId) {
    const raw = rawDiagnostics.get(tabId);
    if (!raw) return;
    await raw.stop().catch(() => {});
    await diagnosticEvidenceStore.deleteEvidence(raw.status().evidenceId);
    rawDiagnostics.delete(tabId);
  }
  const rawDebuggerSource = {
    attach: (tabId) => debuggerLease.acquire(tabId, "screenshot-diagnostics"),
    detach: (tabId) => debuggerLease.release(tabId, "screenshot-diagnostics"),
    subscribeRawDebugger: (tabId, subscriber) =>
      sessionCapture.subscribeRawDebugger(tabId, subscriber),
    sendCommand: (tabId, method, params = {}, sessionId) =>
      chrome.debugger.sendCommand(
        { tabId, ...(sessionId ? { sessionId } : {}) },
        method,
        params,
      ),
  };
  async function captureScreenshotDiagnostics({
    tabId,
    sourceUrl,
    signature,
    captureEpoch,
    sourceOrigin,
    server,
    projectId,
    reviewId,
    ownerIdentity,
    pointSnapshot = false,
    onProgress,
  }) {
    const raw = rawDiagnostics.get(tabId);
    let rawStatus = raw?.status();
    const binding = { server, projectId, reviewId, ownerIdentity };
    const contextChanged =
      !!rawStatus &&
      (rawStatus.sourceOrigin !== sourceOrigin ||
        !sameDiagnosticBinding(rawStatus.binding, binding));
    if (raw) {
      await onProgress?.("network");
      rawStatus = await raw.stop();
      rawDiagnostics.delete(tabId);
      if (contextChanged) {
        await diagnosticEvidenceStore.deleteEvidence(rawStatus.evidenceId);
        rawStatus = null;
      }
    }
    const evidenceId = rawStatus?.evidenceId || crypto.randomUUID();
    const startedAt = rawStatus?.startedAt || new Date().toISOString();
    try {
      await onProgress?.("dom");
      const captured = await capturePreparedDom({
        tabId,
        evidenceId,
        expectedUrl: sourceUrl,
        expectedSignature: signature,
        captureEpoch,
        store: diagnosticEvidenceStore,
        remainingBytes: 268_435_456 - (rawStatus?.totalBytes || 0),
        onChannelDone: (channel) => {
          const next = {
            dom: "storage",
            storage: "performance",
            performance: "environment",
          }[channel];
          return next ? onProgress?.(next) : undefined;
        },
      });
      const coverage =
        rawStatus?.coverage ||
        Object.fromEntries(
          [
            "dom",
            "console",
            "network",
            "body",
            "storage",
            "environment",
            "performance",
            "coverage",
          ].map((kind) => [
            kind,
            {
              status: "unavailable",
              observedCount: 0,
              capturedBytes: 0,
              reasons: [
                kind === "console" || kind === "network" || kind === "body"
                  ? "prestart_history_unavailable"
                  : "not_collected",
              ],
            },
          ]),
        );
      for (const [channel, state] of Object.entries(captured.coverage))
        coverage[channel] = state;
      if (rawStatus)
        for (const kind of ["console", "network", "body"]) {
          if (coverage[kind].status === "complete") coverage[kind].status = "partial";
          const reason = pointSnapshot
            ? "trace_ended_before_dom_snapshot"
            : "trace_ended_before_pixels";
          if (!coverage[kind].reasons.includes(reason))
            coverage[kind].reasons.push(reason);
        }
      if (contextChanged)
        for (const kind of ["console", "network", "body"]) {
          if (!coverage[kind].reasons.includes("capture_context_changed"))
            coverage[kind].reasons.push("capture_context_changed");
        }
      if (pointSnapshot) {
        coverage.dom.status = "partial";
        if (!coverage.dom.reasons.includes("point_snapshot_at_finalize"))
          coverage.dom.reasons.push("point_snapshot_at_finalize");
      }
      const files = [...(rawStatus?.files || []), ...captured.files];
      const manifest = {
        schemaVersion: 1,
        id: evidenceId,
        sourceOrigin,
        startedAt,
        endedAt: new Date().toISOString(),
        coverage,
        ...(rawStatus?.stats ? { stats: rawStatus.stats } : {}),
        files,
        totalBytes: files.reduce((total, file) => total + file.byteLength, 0),
      };
      await diagnosticEvidenceStore.putEvidenceState(evidenceId, { manifest, sourceUrl });
      return { evidenceId, totalBytes: manifest.totalBytes, coverage };
    } catch (error) {
      await diagnosticEvidenceStore.deleteEvidence(evidenceId).catch(() => {});
      throw error;
    }
  }
  async function runDiagnostics(sender, action) {
    const tab = await chrome.tabs.get(sender.tab.id);
    if (!tab.active || !["start", "stop", "status"].includes(action))
      throw Error("Select the review page first.");
    const session = await sessionFor(sender);
    const binding = {
      server: session.server,
      projectId: session.projectId,
      reviewId: session.reviewId,
      ownerIdentity: await accountIdentity(session.server),
    };
    let raw = rawDiagnostics.get(tab.id);
    let rawStatus;
    if (
      raw &&
      (raw.status().sourceOrigin !== session.origin ||
        !sameDiagnosticBinding(raw.status().binding, binding))
    ) {
      const previousReviewId = raw.status().binding?.reviewId;
      const old = await raw.stop();
      rawDiagnostics.delete(tab.id);
      await diagnosticEvidenceStore.deleteEvidence(old.evidenceId);
      if (previousReviewId)
        await chrome.scripting
          .executeScript({
            target: { tabId: tab.id },
            world: "MAIN",
            func: diagnosticCollector,
            args: ["stop", previousReviewId],
          })
          .catch(() => {});
      raw = null;
    }
    if (action === "start" && !raw?.status().active) {
      if (raw) {
        await raw.stop().catch(() => {});
        await diagnosticEvidenceStore.deleteEvidence(raw.status().evidenceId);
        rawDiagnostics.delete(tab.id);
      }
      raw = createRawDiagnosticCapture({
        tabId: tab.id,
        sourceOrigin: session.origin,
        binding,
        store: diagnosticEvidenceStore,
        debuggerSource: rawDebuggerSource,
      });
      rawStatus = await raw.start();
      rawDiagnostics.set(tab.id, raw);
    } else if (action === "stop" && raw) {
      rawStatus = await raw.stop();
      rawDiagnostics.delete(tab.id);
      await diagnosticEvidenceStore.deleteEvidence(rawStatus.evidenceId);
    } else rawStatus = raw?.status();
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: diagnosticCollector,
      args: [action, session.reviewId],
    });
    return {
      active: results[0]?.result?.active === true,
      evidenceId: rawStatus?.evidenceId,
      coverage: rawStatus?.coverage,
    };
  }

  async function retireIfBindingChanged(tabId, currentSession, reviewId) {
    const raw = rawDiagnostics.get(tabId);
    if (
      raw &&
      (raw.status().sourceOrigin !== currentSession?.origin ||
        !sameDiagnosticBinding(raw.status().binding, {
          server: currentSession?.server,
          projectId: currentSession?.projectId,
          reviewId,
          ownerIdentity: await accountIdentity(currentSession?.server),
        }))
    )
      await retireRawDiagnostics(tabId);
  }

  return {
    evidenceStore: diagnosticEvidenceStore,
    retireRawDiagnostics,
    captureScreenshotDiagnostics,
    runDiagnostics,
    retireIfBindingChanged,
  };
}
