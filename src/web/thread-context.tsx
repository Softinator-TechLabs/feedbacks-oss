import React, { useEffect } from "react";
import { date, type Context } from "./api.js";
import { ActionState, ExternalLink, useAction } from "./ui.js";

export function ContextPanel({ context: c }: { context: Context }) {
  const a = useAction();
  useEffect(() => {
    if (location.hash === "#recorded-context")
      document.getElementById("recorded-context")?.scrollIntoView();
  }, [c.url, c.viewport.width, c.viewport.height]);
  return (
    <section id="recorded-context" tabIndex={-1}>
      <h2>Page & device</h2>
      <ExternalLink href={c.url}>{c.title || c.url}</ExternalLink>
      <dl>
        <dt>Viewport</dt>
        <dd>
          {c.viewport.width} × {c.viewport.height} px
        </dd>
        <dt>Device</dt>
        <dd>
          {c.deviceClass ?? "Recorded viewport"}
          {c.preset ? ` · ${c.preset}` : ""}
        </dd>
        {c.capturedAt && (
          <>
            <dt>Captured</dt>
            <dd>{date(c.capturedAt)}</dd>
          </>
        )}
      </dl>
      <button
        onClick={() =>
          a.run(async () => {
            window.open(
              c.url,
              "_blank",
              `popup,width=${c.viewport.width},height=${c.viewport.height},noopener,noreferrer`,
            );
          }, "Review window opened. Browser limits may affect its size.")
        }
      >
        Open at recorded size
      </button>
      <ActionState action={a} />
      <details className="technical-details">
        <summary>Technical details</summary>
        <dl>
          <dt>Pixel ratio</dt>
          <dd>{Number((c.devicePixelRatio ?? 1).toFixed(2))}</dd>
          {c.requestedSize && (
            <>
              <dt>Requested size</dt>
              <dd>
                {c.requestedSize.width} × {c.requestedSize.height}
              </dd>
            </>
          )}
          {c.scroll && (
            <>
              <dt>Scroll position</dt>
              <dd>
                {Math.round(c.scroll.x)}, {Math.round(c.scroll.y)} px
              </dd>
            </>
          )}
          {c.anchor && (
            <>
              <dt>Pin match</dt>
              <dd>{c.anchor.confidence ?? "Not supplied"}</dd>
              <dt>Element selector</dt>
              <dd>
                <code>{c.anchor.selector ?? "Coordinate only"}</code>
              </dd>
              {c.anchor.recordIdentity && (
                <>
                  <dt>Record</dt>
                  <dd>{c.anchor.recordIdentity}</dd>
                </>
              )}
            </>
          )}
        </dl>
        <details>
          <summary>Raw capture data</summary>
          <pre className="context-data">{JSON.stringify(c, null, 2)}</pre>
        </details>
      </details>
    </section>
  );
}
