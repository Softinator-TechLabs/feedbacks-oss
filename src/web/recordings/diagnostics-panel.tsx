import React, { useMemo } from "react";
import {
  consoleAt,
  entriesAt,
  entriesThrough,
  formatRecordingTime,
  networkExchanges,
  type Recording,
  type RecordingChannel,
  type NetworkExchange,
} from "./model.js";

export type DiagnosticTab =
  | "activity"
  | "console"
  | "network"
  | "performance"
  | "environment";
export type EvidenceScope = "playhead" | "all";
const tabs: { id: DiagnosticTab; label: string }[] = [
  { id: "activity", label: "Activity" },
  { id: "console", label: "Console" },
  { id: "network", label: "Network" },
  { id: "performance", label: "Performance" },
  { id: "environment", label: "Environment" },
];

function evidenceText(value: unknown): string {
  if (value === undefined || value === null || value === "") return "Not captured";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function eventTitle(type: RecordingChannel, data: unknown): string {
  if (!data || typeof data !== "object") return type;
  const entry = data as Record<string, unknown>;
  if (type === "console")
    return `${String(entry.level ?? "log")} · ${Array.isArray(entry.args) ? entry.args.map((part) => (typeof part === "string" ? part : evidenceText(part))).join(" ") : evidenceText(entry.message)}`;
  if (type === "activity") return activityTitle(entry);
  if (type === "performance")
    return `${String(entry.name ?? entry.entryType ?? "Performance entry")}${typeof entry.durationMs === "number" ? ` · ${Math.round(entry.durationMs)} ms` : ""}`;
  return String(entry.name ?? entry.entryType ?? type);
}

function activityTitle(entry: Record<string, unknown>): string {
  const action = String(entry.action ?? "activity");
  const target = entry.label ?? entry.id ?? entry.testId ?? entry.role ?? entry.tag;
  const name = target ? String(target) : "";
  if (action === "loading")
    return `Loading: ${String(entry.phase || "page")} · ${String(entry.url || "")}`;
  if (action === "annotation")
    return `Comment: ${String(entry.body || "Screenshot comment")}`;
  if (action === "input") {
    const inputType = String(entry.inputType ?? "");
    const verb =
      typeof entry.checked === "boolean" || inputType.startsWith("delete")
        ? "Changed"
        : inputType.toLowerCase().includes("paste")
          ? "Pasted into"
          : "Typed in";
    return `${verb} ${name || "a field"}`;
  }
  if (action === "click") return `Clicked ${name || "page"}`;
  if (action === "navigation") return `Visited ${String(entry.url || name || "page")}`;
  if (action === "visibility")
    return entry.state === "hidden" ? "Page hidden" : "Page visible";
  if (action === "scroll") return `Scrolled ${name || "page"}`;
  return `${action.charAt(0).toUpperCase()}${action.slice(1)}${name ? ` ${name}` : ""}`;
}

function activityDetail(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const entry = data as Record<string, unknown>;
  if (entry.action !== "input") return "";
  if (typeof entry.checked === "boolean") return entry.checked ? "Checked" : "Unchecked";
  if (entry.valueMasked === true) return "Value hidden";
  if ("value" in entry)
    return `Value: ${String(entry.value) || "(empty)"}${entry.valueTruncated ? " (truncated)" : ""}`;
  return "";
}

function NetworkDetail({ exchange }: { exchange: NetworkExchange }) {
  return (
    <div className="recording-network-detail" aria-label="Network request and response">
      <p>
        <strong>{exchange.method || "Request"}</strong>{" "}
        <span className="recording-break">{exchange.url || "URL unavailable"}</span>
      </p>
      {exchange.status !== undefined && <p>Status: {exchange.status}</p>}
      {exchange.status === undefined && !exchange.error && (
        <p>Response has not appeared at this point.</p>
      )}
      {exchange.error !== undefined && <p>Error: {evidenceText(exchange.error)}</p>}
      <div className="recording-payload-grid">
        <section>
          <h4>Request headers</h4>
          <pre>{evidenceText(exchange.requestHeaders)}</pre>
        </section>
        <section>
          <h4>Request body</h4>
          <pre>{evidenceText(exchange.requestBody)}</pre>
        </section>
        <section>
          <h4>Response headers</h4>
          <pre>{evidenceText(exchange.responseHeaders)}</pre>
        </section>
        <section>
          <h4>Response body</h4>
          <pre>{evidenceText(exchange.responseBody)}</pre>
        </section>
      </div>
    </div>
  );
}

export function RecordingDiagnostics({
  recording,
  annotationFrames,
  cursorMs,
  seek,
  diagnosticTab,
  setDiagnosticTab,
  evidenceScope,
  setEvidenceScope,
  selectedRequest,
  setSelectedRequest,
}: {
  recording: Recording;
  annotationFrames: {
    frame: { id: string; url: string };
    annotation: { body: string; atMs: number };
  }[];
  cursorMs: number;
  seek: (atMs: number) => void;
  diagnosticTab: DiagnosticTab;
  setDiagnosticTab: (tab: DiagnosticTab) => void;
  evidenceScope: EvidenceScope;
  setEvidenceScope: (scope: EvidenceScope) => void;
  selectedRequest: string;
  setSelectedRequest: (key: string) => void;
}) {
  const exchanges = useMemo(() => networkExchanges(recording.events), [recording]);
  const reachedExchanges = useMemo(
    () => networkExchanges(recording.events, cursorMs),
    [recording, cursorMs],
  );
  const visibleExchanges = evidenceScope === "all" ? exchanges : reachedExchanges;
  const activeRequest = reachedExchanges.find((item) => item.key === selectedRequest);
  const eventType =
    diagnosticTab === "activity" ||
    diagnosticTab === "console" ||
    diagnosticTab === "performance"
      ? diagnosticTab
      : null;
  const visibleEvents =
    recording && eventType
      ? evidenceScope === "all"
        ? entriesAt(recording.events, eventType)
        : eventType === "console"
          ? consoleAt(recording.events, cursorMs)
          : entriesThrough(recording.events, eventType, cursorMs)
      : [];
  const totalEvents =
    recording && eventType ? entriesAt(recording.events, eventType).length : 0;
  const visibleCount = eventType
    ? visibleEvents.length
    : diagnosticTab === "network"
      ? visibleExchanges.length
      : 0;
  const totalCount = eventType
    ? totalEvents
    : diagnosticTab === "network"
      ? exchanges.length
      : 0;
  return (
    <div className="recording-diagnostics">
      {annotationFrames.length > 0 && (
        <section aria-label="Screenshot comments" className="recording-tab-content">
          <h4>Screenshot comments ({annotationFrames.length})</h4>
          <ol className="recording-events">
            {annotationFrames.map(({ frame, annotation }) => (
              <li key={frame.id}>
                <button type="button" onClick={() => seek(annotation.atMs)}>
                  <time>{formatRecordingTime(annotation.atMs)}</time>
                  <span>{annotation.body}</span>
                </button>
                <div className="recording-saved-frame">
                  <a href={frame.url} target="_blank" rel="noopener noreferrer">
                    <img
                      src={frame.url}
                      alt={`Screenshot for comment at ${formatRecordingTime(annotation.atMs)}`}
                      loading="lazy"
                    />
                    <span>Open screenshot</span>
                  </a>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}
      <div className="recording-tabs" role="group" aria-label="Recording diagnostics">
        {tabs.map((item) => (
          <button
            type="button"
            key={item.id}
            aria-pressed={diagnosticTab === item.id}
            onClick={() => setDiagnosticTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {diagnosticTab !== "environment" && (
        <div className="recording-scope">
          <div role="group" aria-label="Event range">
            <button
              type="button"
              aria-pressed={evidenceScope === "playhead"}
              onClick={() => setEvidenceScope("playhead")}
            >
              At playhead
            </button>
            <button
              type="button"
              aria-pressed={evidenceScope === "all"}
              onClick={() => setEvidenceScope("all")}
            >
              All events
            </button>
          </div>
          <p>
            {evidenceScope === "playhead"
              ? `${visibleCount} of ${totalCount} through ${formatRecordingTime(cursorMs)}`
              : `${totalCount} total · Select a row to jump`}
          </p>
        </div>
      )}
      <div className="recording-tab-content">
        {eventType &&
          (visibleEvents.length ? (
            <ol className="recording-events">
              {visibleEvents.map((event) => (
                <li key={event.seq}>
                  <button
                    type="button"
                    className={Math.abs(cursorMs - event.atMs) < 500 ? "near-cursor" : ""}
                    onClick={() => seek(event.atMs)}
                  >
                    <time>{formatRecordingTime(event.atMs)}</time>
                    <span>
                      {eventTitle(eventType, event.data)}
                      {eventType === "activity" && activityDetail(event.data) && (
                        <small className="recording-event-detail">
                          {activityDetail(event.data)}
                        </small>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <p className="recording-state">
              {evidenceScope === "playhead" && totalEvents > 0
                ? `No ${diagnosticTab} events at this point. Play or seek forward, or choose All events to jump.`
                : `No ${diagnosticTab} events were captured.`}
            </p>
          ))}
        {diagnosticTab === "network" &&
          (visibleExchanges.length ? (
            <div className="recording-network">
              <ol className="recording-events">
                {visibleExchanges.map((item) => (
                  <li key={item.key}>
                    <button
                      type="button"
                      aria-expanded={selectedRequest === item.key}
                      onClick={() => {
                        setSelectedRequest(item.key);
                        seek(item.atMs);
                      }}
                    >
                      <time>{formatRecordingTime(item.atMs)}</time>
                      <span>
                        <strong>{item.method || "Request"}</strong>{" "}
                        {reachedExchanges.find((current) => current.key === item.key)
                          ?.status ?? "—"}{" "}
                        <span className="recording-break">
                          {item.url || "URL unavailable"}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
              {activeRequest && <NetworkDetail exchange={activeRequest} />}
            </div>
          ) : (
            <p className="recording-state">
              {evidenceScope === "playhead" && exchanges.length > 0
                ? "No network requests at this point. Play or seek forward, or choose All events to jump."
                : "No network events were captured."}
            </p>
          ))}
        {diagnosticTab === "environment" && (
          <div className="recording-environment">
            <h3>Browser environment</h3>
            <pre>{evidenceText(recording.environment)}</pre>
            <h3>Capture notes</h3>
            <ul>
              {recording.coverage.map((item, index) => (
                <li key={`${item.channel}-${index}`}>
                  <strong>{item.channel}</strong>: {item.status}
                  {item.detail ? ` · ${item.detail}` : ""}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
