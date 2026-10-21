import React, { useEffect } from "react";
import { type Context } from "../api.js";
import { HumanTime } from "../human-time.js";
import { ActionState, ExternalLink, useAction } from "../ui.js";

export function ContextPanel({ context: c }: { context: Context }) {
  const a = useAction();
  const viewport = c.viewport;
  useEffect(() => {
    if (location.hash === "#recorded-context")
      document.getElementById("recorded-context")?.scrollIntoView();
  }, [c.url, c.viewport?.width, c.viewport?.height]);
  if (c.appCapture)
    return (
      <section id="recorded-context" tabIndex={-1}>
        <h2>App screenshot</h2>
        <dl>
          <dt>App</dt>
          <dd>{c.appCapture.appName}</dd>
          <dt>Platform</dt>
          <dd>
            {
              {
                windows: "Windows",
                macos: "macOS",
                linux: "Ubuntu / Linux",
                android: "Android",
                ios: "iOS / iPadOS",
                other: "Other / unknown",
              }[c.appCapture.platform]
            }
          </dd>
          {c.appCapture.appVersion && (
            <>
              <dt>App version</dt>
              <dd>{c.appCapture.appVersion}</dd>
            </>
          )}
          <dt>Source</dt>
          <dd>
            {c.appCapture.method === "image_import"
              ? "Imported image"
              : `Browser capture (${c.appCapture.surface ?? "unknown surface"})`}
          </dd>
          <dt>Image size</dt>
          <dd>
            {c.appCapture.width} × {c.appCapture.height} pixels
          </dd>
          {c.appCapture.capturedAt && (
            <>
              <dt>Captured</dt>
              <dd>
                <HumanTime at={c.appCapture.capturedAt} />
              </dd>
            </>
          )}
        </dl>
        <p className="muted">
          App details are supplied by the reviewer. No internal logs, DOM or network
          traffic were collected.
        </p>
      </section>
    );
  if (!c.url)
    return (
      <section id="recorded-context" tabIndex={-1}>
        <h2>Feedback context</h2>
        <p className="muted">No page URL supplied.</p>
      </section>
    );
  if (c.document)
    return (
      <section id="recorded-context" tabIndex={-1}>
        <h2>Document position</h2>
        <a href={c.url}>
          {c.document.name}, page {c.document.page}
        </a>
        <dl>
          <dt>Across</dt>
          <dd>{Math.round(c.document.x * 100)}%</dd>
          <dt>Down</dt>
          <dd>{Math.round(c.document.y * 100)}%</dd>
        </dl>
        <p className="muted">
          Open the document to see this point with the other feedback.
        </p>
      </section>
    );
  return (
    <section id="recorded-context" tabIndex={-1}>
      <h2>Page & device</h2>
      <ExternalLink href={c.url}>{c.title || c.url}</ExternalLink>
      {viewport && (
        <>
          <dl>
            <dt>Viewport</dt>
            <dd>
              {viewport.width} × {viewport.height} px
            </dd>
            <dt>Device</dt>
            <dd>
              {c.deviceClass ?? "Recorded viewport"}
              {c.preset ? ` · ${c.preset}` : ""}
            </dd>
            {c.capturedAt && (
              <>
                <dt>Captured</dt>
                <dd>
                  <HumanTime at={c.capturedAt} />
                </dd>
              </>
            )}
          </dl>
          <button
            onClick={() =>
              a.run(async () => {
                window.open(
                  c.url,
                  "_blank",
                  `popup,width=${viewport.width},height=${viewport.height},noopener,noreferrer`,
                );
              }, "Review window opened. Browser limits may affect its size.")
            }
          >
            Open at recorded size
          </button>
          <ActionState action={a} />
        </>
      )}
      <details className="technical-details">
        <summary>Technical details</summary>
        <dl>
          {c.devicePixelRatio !== undefined && (
            <>
              <dt>Pixel ratio</dt>
              <dd>{Number(c.devicePixelRatio.toFixed(2))}</dd>
            </>
          )}
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
