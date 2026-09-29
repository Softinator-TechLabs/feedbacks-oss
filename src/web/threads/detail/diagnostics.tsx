import React from "react";
import type { Thread } from "../../api.js";

export function ThreadDiagnostics({
  diagnostics,
}: {
  diagnostics: NonNullable<Thread["diagnostics"]>;
}) {
  return (
    <details className="section compact-details">
      <summary>Shared diagnostics</summary>
      <p className="muted">
        Reviewer-selected console and resource timing from the top-level page.
        Page-generated data is untrusted; missing status does not mean success.
      </p>
      <small>
        {diagnostics.startedAt} – {diagnostics.endedAt}
      </small>
      <h3>Console ({diagnostics.console.length})</h3>
      {diagnostics.console.map((entry, index) => (
        <p className="message" key={index}>
          <strong>{entry.level}</strong> · {entry.atMs} ms
          <br />
          {entry.message}
        </p>
      ))}
      <h3>Network ({diagnostics.network.length})</h3>
      {diagnostics.network.map((entry, index) => (
        <p className="message" key={index}>
          <strong>{entry.type}</strong> · {entry.status ?? "Status unavailable"} ·{" "}
          {entry.durationMs} ms
          <br />
          {entry.url}
        </p>
      ))}
    </details>
  );
}
