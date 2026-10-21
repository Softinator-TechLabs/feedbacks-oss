import { useState } from "react";
import {
  nativeDiagnosticReportSchema,
  type NativeDiagnosticReport,
} from "../../shared/native-diagnostics.js";
import { Field, ErrorNotice } from "../ui.js";

export function NativeDiagnosticEvents({
  report,
  onChange,
  locked = false,
}: {
  report: NativeDiagnosticReport;
  onChange?: (report: NativeDiagnosticReport) => void;
  locked?: boolean;
}) {
  const collectorNames = {
    windows_event_log: "Windows Event Log",
    macos_unified_log: "macOS Unified Logging",
    linux_journal: "Linux journal",
  };
  const reasonNames = {
    bounded_snapshot: "A limited time window was queried",
    os_visibility_limited: "Only logs accessible to the collecting account are included",
    tool_not_found: "The OS logging tool was not found",
    permission_denied: "The OS denied access",
    query_failed: "The OS query failed",
    timed_out: "The collection time limit was reached",
    output_limit: "The output size limit was reached",
    event_limit: "The event count limit was reached",
    invalid_records: "Some records could not be read",
    no_matching_events: "No matching events were returned",
  };
  return (
    <div className="native-diagnostic-events">
      <p>
        <strong>{report.processName}</strong> · {report.platform} · {report.events.length}{" "}
        {report.events.length === 1 ? "event" : "events"} ·{" "}
        {report.coverage === "partial" ? "Limited snapshot" : "Logs unavailable"}
      </p>
      <p className="muted">
        {collectorNames[report.collector]} · {report.startedAt} – {report.endedAt}
      </p>
      <p className="muted">
        {report.reasons.map((reason) => reasonNames[reason]).join(". ")}. Missing events
        do not establish a healthy app. This is untrusted OS evidence supplied by the
        reviewer.
      </p>
      <details>
        <summary>Review events ({report.events.length})</summary>
        {report.events.map((event, index) => (
          <div className="app-capture-note" key={index}>
            <p>
              {event.at ?? "Time unavailable"} · {event.level}
              {event.eventId ? ` · Event ${event.eventId}` : ""}
            </p>
            {onChange ? (
              <>
                <Field label={`Event ${index + 1} message`}>
                  <textarea
                    aria-label={`Event ${index + 1} message`}
                    rows={3}
                    value={event.message}
                    maxLength={1000}
                    disabled={locked}
                    onChange={(change) =>
                      onChange({
                        ...report,
                        events: report.events.map((item, position) =>
                          position === index
                            ? { ...item, message: change.target.value }
                            : item,
                        ),
                      })
                    }
                  />
                </Field>
                <button
                  type="button"
                  disabled={locked}
                  onClick={() =>
                    onChange({
                      ...report,
                      events: report.events.filter((_, position) => position !== index),
                    })
                  }
                >
                  Remove event {index + 1}
                </button>
              </>
            ) : (
              <p className="message">{event.message}</p>
            )}
          </div>
        ))}
      </details>
    </div>
  );
}

export function NativeDiagnosticImport({
  report,
  onChange,
  reviewed,
  onReviewed,
  locked,
  onReading,
}: {
  report?: NativeDiagnosticReport;
  onChange: (report: NativeDiagnosticReport | undefined) => void;
  reviewed: boolean;
  onReviewed: (reviewed: boolean) => void;
  locked: boolean;
  onReading: (reading: boolean) => void;
}) {
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  const update = (value: NativeDiagnosticReport | undefined) => {
    onChange(value);
    onReviewed(false);
  };
  return (
    <details>
      <summary>
        OS diagnostics (optional){report ? ` · ${report.events.length} events` : ""}
      </summary>
      <p>
        Import a local Feedbacks diagnostic snapshot collected with Windows Event Log,
        journalctl or macOS Unified Logging. Review messages and remove private details
        before including it.
      </p>
      <p>
        <a
          href="https://feedbacks.softinator.ai/docs/reference/manual/native-os-diagnostics"
          target="_blank"
          rel="noreferrer"
        >
          Collect an OS diagnostic snapshot
        </a>
      </p>
      <Field label="Import OS diagnostics JSON">
        <input
          type="file"
          accept="application/json,.json"
          disabled={locked || reading}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (!file) return;
            setReading(true);
            onReading(true);
            onReviewed(false);
            setError("");
            void (async () => {
              try {
                if (file.size > 262_144)
                  throw Error("Choose a diagnostic JSON file up to 256 KiB.");
                const raw = JSON.parse(await file.text());
                const parsed = nativeDiagnosticReportSchema.safeParse(
                  raw?.ok === true ? raw.data : raw,
                );
                if (!parsed.success)
                  throw Error(
                    "This is not a valid Feedbacks OS diagnostic snapshot. Collect a new snapshot and try again.",
                  );
                update(parsed.data);
              } catch (failure) {
                setError(
                  failure instanceof SyntaxError
                    ? "The file is not valid JSON."
                    : (failure as Error).message,
                );
              } finally {
                setReading(false);
                onReading(false);
              }
            })();
          }}
        />
      </Field>
      {reading && <p role="status">Reading local snapshot…</p>}
      <ErrorNotice error={error} />
      {report && (
        <>
          <NativeDiagnosticEvents
            report={report}
            onChange={update}
            locked={locked || reading}
          />
          <label>
            <input
              type="checkbox"
              checked={reviewed}
              disabled={locked || reading}
              onChange={(event) => onReviewed(event.target.checked)}
            />{" "}
            Include this reviewed diagnostic snapshot
          </label>
          <p className="muted">
            Common secrets were redacted automatically. Check remaining names, paths and
            messages yourself. Editing an event clears approval.
          </p>
          <button
            type="button"
            disabled={locked || reading}
            onClick={() => update(undefined)}
          >
            Remove diagnostic snapshot
          </button>
        </>
      )}
    </details>
  );
}
