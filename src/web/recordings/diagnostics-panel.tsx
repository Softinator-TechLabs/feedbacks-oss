import React, { useEffect, useMemo, useRef, useState } from "react";
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
  | "everything"
  | "activity"
  | "console"
  | "network"
  | "performance"
  | "environment";
export type EvidenceScope = "playhead" | "all";
const tabs: { id: DiagnosticTab; label: string }[] = [
  { id: "everything", label: "Everything" },
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
  if (type === "network")
    return `${String(entry.method ?? "Request")} ${String(entry.url ?? "URL unavailable")} · ${String(entry.phase ?? "event")}${typeof entry.status === "number" ? ` · ${entry.status}` : ""}`;
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

function environmentSummary(value: unknown): string {
  if (!value || typeof value !== "object") return "Browser details captured at start";
  const entry = value as Record<string, unknown>;
  const viewport = entry.viewport as Record<string, unknown> | undefined;
  const size =
    typeof viewport?.width === "number" && typeof viewport.height === "number"
      ? `${viewport.width} × ${viewport.height}`
      : "";
  const userAgent = typeof entry.userAgent === "string" ? entry.userAgent : "";
  const browser =
    typeof entry.browser === "string"
      ? entry.browser
      : (userAgent.match(/(?:Chrome|Firefox|Edg|Safari)\/[\d.]+/)?.[0] ?? "Browser");
  return [browser, size].filter(Boolean).join(" · ");
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
  cursorMs,
  seek,
  playing,
  followPlayback,
  setFollowPlayback,
  diagnosticTab,
  setDiagnosticTab,
  evidenceScope,
  setEvidenceScope,
  selectedRequest,
  setSelectedRequest,
}: {
  recording: Recording;
  cursorMs: number;
  seek: (atMs: number) => void;
  playing: boolean;
  followPlayback: boolean;
  setFollowPlayback: (value: boolean) => void;
  diagnosticTab: DiagnosticTab;
  setDiagnosticTab: (tab: DiagnosticTab) => void;
  evidenceScope: EvidenceScope;
  setEvidenceScope: (scope: EvidenceScope) => void;
  selectedRequest: string;
  setSelectedRequest: (key: string) => void;
}) {
  const [everythingPage, setEverythingPage] = useState(0);
  const eventListRef = useRef<HTMLOListElement>(null);
  const followedEventRef = useRef<number | null>(null);
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
  const combinedEvents = useMemo(
    () =>
      recording.events
        .filter((event) =>
          ["activity", "console", "network", "performance"].includes(event.type),
        )
        .sort((a, b) => a.atMs - b.atMs || a.seq - b.seq),
    [recording],
  );
  const reachedEventCount = useMemo(() => {
    let low = 0;
    let high = combinedEvents.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (combinedEvents[middle].atMs <= cursorMs) low = middle + 1;
      else high = middle;
    }
    return low;
  }, [combinedEvents, cursorMs]);
  const visibleCombinedEvents =
    evidenceScope === "all" ? combinedEvents : combinedEvents.slice(0, reachedEventCount);
  const everythingPageSize = 200;
  const maxEverythingPage = Math.max(
    0,
    Math.ceil((visibleCombinedEvents.length + 1) / everythingPageSize) - 1,
  );
  const shownEverythingPage = Math.min(everythingPage, maxEverythingPage);
  const everythingPageStart = shownEverythingPage * everythingPageSize;
  const pageEvents = visibleCombinedEvents.slice(
    Math.max(0, everythingPageStart - 1),
    everythingPageStart === 0
      ? everythingPageSize - 1
      : everythingPageStart + everythingPageSize - 1,
  );
  const latestMoment = combinedEvents[reachedEventCount - 1] ?? null;
  const activeEventSeq = visibleEvents
    .filter((event) => event.atMs <= cursorMs)
    .at(-1)?.seq;
  const activeEverythingSeq = latestMoment?.seq;
  const activeExchangeKey = visibleExchanges
    .filter((exchange) => exchange.atMs <= cursorMs)
    .at(-1)?.key;
  const visibleCount = eventType
    ? visibleEvents.length
    : diagnosticTab === "everything"
      ? visibleCombinedEvents.length + 1
      : diagnosticTab === "network"
        ? visibleExchanges.length
        : 0;
  const totalCount = eventType
    ? totalEvents
    : diagnosticTab === "everything"
      ? combinedEvents.length + 1
      : diagnosticTab === "network"
        ? exchanges.length
        : 0;

  useEffect(() => {
    if (diagnosticTab !== "everything" || !followPlayback) return;
    setEverythingPage(Math.floor(reachedEventCount / everythingPageSize));
  }, [reachedEventCount, diagnosticTab, followPlayback, evidenceScope]);

  useEffect(() => {
    if (!playing || !followPlayback || !latestMoment) return;
    if (followedEventRef.current === latestMoment.seq) return;
    followedEventRef.current = latestMoment.seq;
    if (diagnosticTab !== "everything")
      setDiagnosticTab(latestMoment.type as DiagnosticTab);
    setEvidenceScope("all");
    if (latestMoment.type === "network") {
      const data = latestMoment.data as Record<string, unknown> | null;
      if (typeof data?.requestId === "string") setSelectedRequest(data.requestId);
    }
  }, [
    playing,
    followPlayback,
    latestMoment,
    diagnosticTab,
    setDiagnosticTab,
    setEvidenceScope,
    setSelectedRequest,
  ]);

  useEffect(() => {
    const list = eventListRef.current;
    if (!list) return;
    const current = list.querySelector<HTMLElement>('[aria-current="true"]');
    if (!current) return;
    const listBounds = list.getBoundingClientRect();
    const rowBounds = current.getBoundingClientRect();
    const centerDelta =
      rowBounds.top + rowBounds.height / 2 - (listBounds.top + listBounds.height / 2);
    if (Math.abs(centerDelta) > 8) list.scrollTop += centerDelta;
  }, [
    activeEventSeq,
    activeEverythingSeq,
    activeExchangeKey,
    diagnosticTab,
    evidenceScope,
    shownEverythingPage,
  ]);
  return (
    <div className="recording-diagnostics">
      <div className="recording-tabs" role="group" aria-label="Recording diagnostics">
        {tabs.map((item) => (
          <button
            type="button"
            key={item.id}
            aria-pressed={diagnosticTab === item.id}
            onClick={() => {
              setFollowPlayback(false);
              setDiagnosticTab(item.id);
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      {diagnosticTab !== "environment" && (
        <button
          type="button"
          className="recording-follow"
          aria-pressed={followPlayback}
          onClick={() => setFollowPlayback(!followPlayback)}
        >
          {followPlayback ? "Following playback" : "Follow playback"}
        </button>
      )}
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
        {diagnosticTab === "everything" && (
          <div className="recording-everything-wrap">
            <ol className="recording-events recording-everything" ref={eventListRef}>
              {shownEverythingPage === 0 && (
                <li>
                  <button
                    type="button"
                    aria-current={!activeEverythingSeq ? "true" : undefined}
                    onClick={() => {
                      setDiagnosticTab("environment");
                      seek(0);
                    }}
                  >
                    <time>0:00.0</time>
                    <span>
                      <span className="recording-event-tag" data-channel="environment">
                        Environment
                      </span>
                      {environmentSummary(recording.environment)}
                    </span>
                  </button>
                </li>
              )}
              {pageEvents.map((event) => (
                <li key={event.seq}>
                  <button
                    type="button"
                    aria-current={activeEverythingSeq === event.seq ? "true" : undefined}
                    onClick={() => seek(event.atMs)}
                  >
                    <time>{formatRecordingTime(event.atMs)}</time>
                    <span>
                      <span className="recording-event-tag" data-channel={event.type}>
                        {event.type}
                      </span>
                      {eventTitle(event.type, event.data)}
                      {event.type === "activity" && activityDetail(event.data) && (
                        <small className="recording-event-detail">
                          {activityDetail(event.data)}
                        </small>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
            {maxEverythingPage > 0 && (
              <div className="recording-event-pages">
                <button
                  type="button"
                  disabled={shownEverythingPage === 0}
                  onClick={() => {
                    setFollowPlayback(false);
                    setEverythingPage(shownEverythingPage - 1);
                  }}
                >
                  Earlier
                </button>
                <span>
                  {everythingPageStart + 1}–
                  {Math.min(
                    visibleCombinedEvents.length + 1,
                    everythingPageStart + everythingPageSize,
                  )}{" "}
                  of {visibleCombinedEvents.length + 1}
                </span>
                <button
                  type="button"
                  disabled={shownEverythingPage === maxEverythingPage}
                  onClick={() => {
                    setFollowPlayback(false);
                    setEverythingPage(shownEverythingPage + 1);
                  }}
                >
                  Later
                </button>
              </div>
            )}
          </div>
        )}
        {eventType &&
          (visibleEvents.length ? (
            <ol className="recording-events" ref={eventListRef}>
              {visibleEvents.map((event) => (
                <li key={event.seq}>
                  <button
                    type="button"
                    aria-current={activeEventSeq === event.seq ? "true" : undefined}
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
              <ol className="recording-events" ref={eventListRef}>
                {visibleExchanges.map((item) => (
                  <li key={item.key}>
                    <button
                      type="button"
                      aria-expanded={selectedRequest === item.key}
                      aria-current={activeExchangeKey === item.key ? "true" : undefined}
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
