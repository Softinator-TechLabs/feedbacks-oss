import React from "react";
import type { Thread } from "../api.js";

export function ThreadAttachments({
  thread,
  onAnnotate,
}: {
  thread: Thread;
  onAnnotate?: (asset: Thread["assets"][number]) => void;
}) {
  const capturePages = thread.assets.filter((asset) =>
    /^full-page-\d+-of-\d+\.webp$/.test(asset.filename || ""),
  );
  const recordingFrames = thread.assets.filter((asset) => asset.recordingFrame);
  const otherAssets = thread.assets.filter(
    (asset) =>
      !capturePages.includes(asset) &&
      !recordingFrames.includes(asset) &&
      !asset.contentType.startsWith("video/"),
  );
  return (
    <>
      {(otherAssets.length > 0 || capturePages.length > 0) &&
        !thread.context.annotations?.length && (
          <section className="attachments">
            <h2 className="sr-only">Attachments</h2>
            {otherAssets.map((asset, index) => (
              <figure id={`asset-${asset.id}`} key={asset.id}>
                {asset.contentType === "video/webm" ? (
                  <video
                    controls
                    preload="metadata"
                    src={asset.url}
                    aria-label="Tab video feedback"
                  />
                ) : (
                  <a href={asset.url} target="_blank" rel="noopener noreferrer">
                    <img
                      src={asset.url}
                      alt={asset.filename || `${asset.rendition} attached to feedback`}
                      width={asset.width}
                      height={asset.height}
                      loading={index === 0 ? "eager" : "lazy"}
                    />
                  </a>
                )}
                <figcaption>
                  {asset.contentType === "video/webm"
                    ? `Tab video · ${Math.ceil((asset.durationMs || 0) / 1000)} seconds`
                    : `${asset.filename ? `${asset.filename} · ` : ""}${asset.width} × ${asset.height} · Open full image`}
                  {asset.contentType.startsWith("image/") && onAnnotate && (
                    <button type="button" onClick={() => onAnnotate(asset)}>
                      Add or revise marks
                    </button>
                  )}
                </figcaption>
              </figure>
            ))}
            {capturePages.length > 0 && (
              <details className="capture-page-set" open={capturePages.length <= 4}>
                <summary>
                  Full-page capture · {capturePages.length} numbered
                  {capturePages.length === 1 ? " image" : " images"}
                </summary>
                <div className="capture-page-grid">
                  {capturePages.map((asset) => (
                    <figure id={`asset-${asset.id}`} key={asset.id}>
                      <a
                        href={asset.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Open ${asset.filename}`}
                      >
                        <img
                          src={asset.url}
                          alt={asset.filename}
                          width={asset.width}
                          height={asset.height}
                          loading="lazy"
                        />
                      </a>
                      <figcaption>{asset.filename}</figcaption>
                      {onAnnotate && (
                        <button type="button" onClick={() => onAnnotate(asset)}>
                          Add or revise marks
                        </button>
                      )}
                    </figure>
                  ))}
                </div>
              </details>
            )}
          </section>
        )}
    </>
  );
}

export function RecordingFrames({
  thread,
  onAnnotate,
}: {
  thread: Thread;
  onAnnotate?: (asset: Thread["assets"][number]) => void;
}) {
  const recordingFrames = thread.assets.filter((asset) => asset.recordingFrame);
  return (
    <>
      {recordingFrames.length > 0 && (
        <details className="capture-page-set recording-frame-gallery">
          <summary>Saved video frames · {recordingFrames.length}</summary>
          <div className="capture-page-grid">
            {recordingFrames.map((asset) => (
              <figure id={`asset-${asset.id}`} key={asset.id}>
                <a href={asset.url} target="_blank" rel="noopener noreferrer">
                  <img
                    src={asset.url}
                    alt={`Video frame at ${(asset.recordingFrame!.atMs / 1000).toFixed(1)} seconds`}
                    loading="lazy"
                  />
                </a>
                <figcaption>
                  {(asset.recordingFrame!.atMs / 1000).toFixed(1)}s in recording
                </figcaption>
                {onAnnotate && (
                  <button type="button" onClick={() => onAnnotate(asset)}>
                    Add or revise marks
                  </button>
                )}
              </figure>
            ))}
          </div>
        </details>
      )}
    </>
  );
}
