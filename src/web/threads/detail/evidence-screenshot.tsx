import React, { useEffect, useId, useRef, useState } from "react";
import type { Thread } from "../../api.js";
import { Icon } from "../../icons.js";
import { ScreenshotMarkup } from "../../screenshot-markup.js";

type Asset = Thread["assets"][number];
export type EvidenceLayer = "points" | "element" | "text";
const layerLabels: Record<EvidenceLayer, string> = {
  points: "points",
  element: "element outline",
  text: "text selection",
};

function imageLabel(asset: Asset) {
  const point = /^point-(\d+)-original\.webp$/.exec(asset.filename || "");
  if (point) return `Point ${Number(point[1])} · original view`;
  if (asset.filename === "page-visible.webp") return "Page · visible area";
  if (asset.filename === "full-page-combined.webp") return "Full page · combined";
  return asset.filename || "Attached screenshot";
}

export function EvidenceScreenshot({
  asset,
  className,
  id,
  loading,
  hiddenLayers,
  onToggleLayer,
  captureMarker,
  thread,
  onSaved,
}: {
  asset: Asset;
  className?: string;
  id?: string;
  loading: "eager" | "lazy";
  hiddenLayers: Record<EvidenceLayer, boolean>;
  onToggleLayer: (assetId: string, layer: EvidenceLayer) => void;
  captureMarker?: Thread["context"]["captureMarker"];
  thread: Thread;
  onSaved?: (thread: Thread) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const backdropPointer = useRef<number | null>(null);
  const titleId = useId();
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const identity = asset.baseAssetId ?? asset.id;
  const [zoom, setZoom] = useState(0);
  useEffect(() => {
    if (expanded) dialog.current?.showModal();
    else dialog.current?.close();
  }, [expanded]);
  useEffect(() => {
    setExpanded(false);
    setZoom(0);
  }, [identity]);
  const points =
    asset.rendition === "screenshot"
      ? (asset.markings || []).filter(
          (mark) => mark.tool === "point" && mark.endpoints[0],
        )
      : [];
  const overlays =
    asset.rendition === "screenshot"
      ? (asset.markings || []).filter((mark) =>
          ["element", "text-selection"].includes(mark.origin || ""),
        )
      : [];
  const layers: EvidenceLayer[] = [];
  const pointOriginal = /^point-\d+-original\.webp$/.test(asset.filename || "");
  const markerStyle = captureMarker?.style || (pointOriginal ? "ring" : "pin");
  const markerSize = captureMarker?.size || "small";
  // Keep the entire marker in image pixels, as in the capture renderer. A fixed
  // CSS-sized pin covers a different area when the screenshot is resized.
  const imageWidth = asset.width || 1200;
  const imageHeight = asset.height || 800;
  const markerScale = { small: 1, medium: 1.35, large: 1.8 }[markerSize];
  const markerRadius = Math.max(8, imageWidth / 190) * markerScale;
  const visibleMarkers = markerStyle !== "none" && points.length > 0;
  if (visibleMarkers) layers.push("points");
  if (overlays.some((mark) => mark.origin === "element")) layers.push("element");
  if (overlays.some((mark) => mark.origin === "text-selection")) layers.push("text");
  const embeddedPins =
    asset.rendition === "annotated" &&
    asset.markings?.some((mark) => mark.tool === "point");
  const maxHeight =
    className === "review-main-capture"
      ? 520
      : className === "review-point-figure"
        ? undefined
        : 320;
  const layerControls = layers.length > 0 && (
    <span
      className="review-layer-controls"
      role="group"
      aria-label="Screenshot evidence visibility"
    >
      {layers.map((layer) => (
        <button
          type="button"
          className="review-pin-toggle"
          key={layer}
          aria-pressed={!hiddenLayers[layer]}
          onClick={() => onToggleLayer(identity, layer)}
        >
          {hiddenLayers[layer] ? "Show" : "Hide"} {layerLabels[layer]}
        </button>
      ))}
    </span>
  );
  const evidenceOverlays = (
    <svg
      className="review-image-evidence"
      viewBox={`0 0 ${imageWidth} ${imageHeight}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {overlays
        .filter((mark) => !hiddenLayers[mark.origin === "element" ? "element" : "text"])
        .map((mark, index) => (
          <rect
            key={`${mark.origin}-${index}`}
            className={`review-image-overlay ${mark.origin === "element" ? "review-element-outline" : "review-text-selection"}`}
            x={mark.bounds.x * imageWidth}
            y={mark.bounds.y * imageHeight}
            width={mark.bounds.width * imageWidth}
            height={mark.bounds.height * imageHeight}
            fill={mark.origin === "element" ? "none" : "rgba(245, 197, 61, 0.3)"}
            stroke={mark.origin === "element" ? "#2370b5" : "none"}
            strokeWidth={Math.max(2, imageWidth / 700)}
          />
        ))}
      {!hiddenLayers.points && visibleMarkers && (
        <g className="review-image-pins">
          {points.map((mark, index) => (
            <g
              className="review-image-pin"
              data-style={markerStyle}
              data-size={markerSize}
              key={`${mark.annotationId || "point"}-${index}`}
              transform={`translate(${mark.endpoints[0].x * imageWidth} ${mark.endpoints[0].y * imageHeight})`}
            >
              {markerStyle === "arrow" ? (
                <path
                  d={`M ${-markerRadius * 1.4} ${-markerRadius * 1.4} L 0 0 M ${-markerRadius * 0.85} 0 L 0 0 L 0 ${-markerRadius * 0.85}`}
                  fill="none"
                  stroke="#c73732"
                  strokeWidth={Math.max(2, imageWidth / 700) * markerScale}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ) : (
                <>
                  <circle
                    r={markerRadius}
                    fill={
                      markerStyle === "ring"
                        ? "none"
                        : markerStyle === "dot"
                          ? "rgba(199, 55, 50, 0.72)"
                          : "rgba(23, 50, 77, 0.78)"
                    }
                    stroke={
                      markerStyle === "pin"
                        ? "#fff"
                        : markerStyle === "ring"
                          ? "#c73732"
                          : "none"
                    }
                    strokeWidth={Math.max(2, imageWidth / 750)}
                  />
                  {markerStyle === "pin" && (
                    <text
                      textAnchor="middle"
                      dominantBaseline="central"
                      fill="#fff"
                      fontSize={markerRadius * 1.2}
                      fontWeight={600}
                    >
                      {mark.number || index + 1}
                    </text>
                  )}
                </>
              )}
            </g>
          ))}
        </g>
      )}
    </svg>
  );
  const image = (
    <>
      <img
        src={asset.url}
        alt={asset.filename || "Page capture"}
        width={asset.width}
        height={asset.height}
        loading={loading}
      />
      {evidenceOverlays}
    </>
  );
  return (
    <figure id={id} className={className}>
      <figcaption className="review-image-caption">
        <span>{imageLabel(asset)}</span>
        {embeddedPins && <span className="review-legacy-pins">Pins saved in image</span>}
      </figcaption>
      <div className="review-image-actions">
        {layerControls}
        <button
          type="button"
          className="review-pin-toggle"
          onClick={() => setExpanded(true)}
        >
          <Icon name="image" /> Review image
        </button>
      </div>
      <button
        type="button"
        className="review-image-open"
        aria-label={`Review image: ${imageLabel(asset)}`}
        onClick={() => setExpanded(true)}
        style={
          maxHeight && asset.width && asset.height
            ? { maxWidth: `${Math.round((maxHeight * asset.width) / asset.height)}px` }
            : undefined
        }
      >
        <span className="review-image-frame">{image}</span>
      </button>
      <dialog
        ref={dialog}
        className="evidence-image-dialog"
        aria-labelledby={titleId}
        onClose={() => setExpanded(false)}
        onPointerDown={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          backdropPointer.current =
            event.target === event.currentTarget &&
            (event.clientX < bounds.left ||
              event.clientX > bounds.right ||
              event.clientY < bounds.top ||
              event.clientY > bounds.bottom)
              ? event.pointerId
              : null;
        }}
        onPointerUp={(event) => {
          const startedOutside = backdropPointer.current === event.pointerId;
          backdropPointer.current = null;
          const bounds = event.currentTarget.getBoundingClientRect();
          if (
            !saving &&
            startedOutside &&
            event.target === event.currentTarget &&
            (event.clientX < bounds.left ||
              event.clientX > bounds.right ||
              event.clientY < bounds.top ||
              event.clientY > bounds.bottom)
          )
            setExpanded(false);
        }}
        onPointerCancel={() => {
          backdropPointer.current = null;
        }}
        onCancel={(event) => {
          if (saving) event.preventDefault();
          else setExpanded(false);
        }}
      >
        {expanded && (
          <>
            <header className="evidence-image-toolbar">
              <h2 id={titleId}>{imageLabel(asset)}</h2>
              <button
                type="button"
                autoFocus
                disabled={saving}
                onClick={() => setExpanded(false)}
              >
                Close
              </button>
            </header>
            <div className="evidence-image-controls">
              {layerControls}
              <label>
                Zoom
                <select
                  aria-label="Image zoom"
                  value={zoom}
                  onChange={(event) => setZoom(Number(event.target.value))}
                >
                  <option value={0}>Fit width</option>
                  <option value={1}>100%</option>
                  <option value={2}>200%</option>
                </select>
              </label>
              <a href={asset.url} target="_blank" rel="noopener noreferrer">
                Open original file
              </a>
            </div>
            {embeddedPins && (
              <p className="review-legacy-pins">Points are saved in this image.</p>
            )}
            {onSaved ? (
              <ScreenshotMarkup
                thread={thread}
                target={{ kind: "asset", asset }}
                onSaved={onSaved}
                onClose={() => setExpanded(false)}
                embedded={{
                  zoom,
                  hiddenLayers,
                  evidenceOverlays,
                  onBusyChange: setSaving,
                }}
              />
            ) : (
              <div
                className="evidence-image-viewport"
                tabIndex={0}
                role="region"
                aria-label="Expanded screenshot"
              >
                <div
                  className="review-image-frame"
                  style={{
                    width: asset.width ? `${asset.width * (zoom || 1)}px` : "100%",
                    maxWidth: zoom ? "none" : "100%",
                  }}
                >
                  {image}
                </div>
              </div>
            )}
          </>
        )}
      </dialog>
    </figure>
  );
}
