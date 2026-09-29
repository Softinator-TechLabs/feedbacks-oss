import React, { useEffect, useState } from "react";
import { api, type Thread } from "../../api.js";
import { ActionState, ErrorNotice, Field, useAction, useLoad } from "../../ui.js";

export function ScreenshotComparison({
  assets,
  threadId,
  canMaintain,
}: {
  assets: Thread["assets"];
  threadId: string;
  canMaintain: boolean;
}) {
  const [leftId, setLeft] = useState(assets[0].id),
    [rightId, setRight] = useState(assets.at(-1)!.id),
    [mode, setMode] = useState("side"),
    [split, setSplit] = useState(50),
    [failed, setFailed] = useState(false),
    [baselineVersion, setBaselineVersion] = useState(0),
    [metric, setMetric] = useState<{
      changedPercent: number;
      baselineAssetId: string;
      candidateAssetId: string;
    }>();
  const qaAction = useAction();
  const baseline = useLoad<{ assetId: string | null; setAt: string | null }>(
    () => api("qa.baselineGet", { threadId }),
    [threadId, baselineVersion],
  );
  const left = assets.find((a) => a.id === leftId) ?? assets[0],
    right = assets.find((a) => a.id === rightId) ?? assets.at(-1)!;
  const baselineAsset = assets.find((asset) => asset.id === baseline.data?.assetId);
  const matched = left.width === right.width && left.height === right.height;
  const overlay = mode === "overlay" && matched && left.id !== right.id;
  useEffect(() => {
    setFailed(false);
    setMetric(undefined);
  }, [left.id, right.id]);
  const image = (asset: typeof left, label: string) => (
    <img
      src={asset.url}
      width={asset.width}
      height={asset.height}
      alt={`${label}: ${asset.rendition}`}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
  return (
    <details className="section screenshot-comparison">
      <summary>Visual baseline and comparison</summary>
      <div className="review-controls">
        {(assets.length === 1
          ? [["First image", left.id, setLeft]]
          : [
              ["First image", left.id, setLeft],
              ["Second image", right.id, setRight],
            ]
        ).map(([label, value, set]) => (
          <Field key={String(label)} label={String(label)}>
            <select
              value={String(value)}
              onChange={(e) => (set as typeof setLeft)(e.target.value)}
            >
              {assets.map((asset, index) => (
                <option key={asset.id} value={asset.id}>
                  {asset.filename || `Image ${index + 1}`} · {asset.rendition} ·{" "}
                  {asset.width} × {asset.height}
                </option>
              ))}
            </select>
          </Field>
        ))}
      </div>
      {assets.length > 1 && (
        <div className="review-controls" role="group" aria-label="Comparison mode">
          <button aria-pressed={!overlay} onClick={() => setMode("side")}>
            Side by side
          </button>
          <button
            disabled={!matched || left.id === right.id}
            aria-pressed={overlay}
            onClick={() => setMode("overlay")}
          >
            Overlay
          </button>
        </div>
      )}
      <div className="review-controls">
        {canMaintain && (
          <button
            type="button"
            disabled={qaAction.busy}
            onClick={() =>
              void qaAction.run(async () => {
                await api("qa.baselineSet", { threadId, assetId: left.id });
                setBaselineVersion((value) => value + 1);
                setMetric(undefined);
              }, "First image saved as this thread's baseline.")
            }
          >
            Set first image as baseline
          </button>
        )}
        {assets.length > 1 && (
          <button
            type="button"
            disabled={
              qaAction.busy ||
              !baselineAsset ||
              baselineAsset.width !== right.width ||
              baselineAsset.height !== right.height ||
              baselineAsset.id === right.id
            }
            onClick={() =>
              void qaAction.run(async () => {
                const result = await api<{
                  changedPercent: number;
                  baselineAssetId: string;
                  candidateAssetId: string;
                }>("qa.compare", { threadId, assetId: right.id });
                setMetric(result);
              })
            }
          >
            Compare second image with baseline
          </button>
        )}
      </div>
      {baselineAsset && (
        <p className="muted">Baseline: image {assets.indexOf(baselineAsset) + 1}</p>
      )}
      {metric && (
        <p role="status">
          {metric.changedPercent}% of pixels differ by more than 20 channel values. Review
          alignment and content before treating this as a regression.
        </p>
      )}
      <ActionState action={qaAction} />
      <ErrorNotice error={baseline.error} />
      {!matched && (
        <p className="muted">
          Different image sizes. Compare side by side to preserve each image’s
          proportions.
        </p>
      )}
      {left.id === right.id && (
        <p className="muted">
          {assets.length === 1
            ? "Set this image as a baseline; attach another image later to compare."
            : "Choose two different images to compare."}
        </p>
      )}
      <ErrorNotice
        error={
          failed
            ? "An image could not load. Open the attachment below or reload this page to retry."
            : ""
        }
      />
      {assets.length === 1 ? null : overlay ? (
        <>
          <div className="comparison-overlay">
            {image(right, "Second image")}
            <div
              className="comparison-front"
              style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}
            >
              {image(left, "First image")}
            </div>
            <div className="comparison-divider" style={{ left: `${split}%` }} />
          </div>
          <Field label={`Reveal first image: ${split}%`}>
            <input
              type="range"
              min={0}
              max={100}
              value={split}
              onChange={(e) => setSplit(Number(e.target.value))}
            />
          </Field>
        </>
      ) : (
        <div className="comparison-side">
          <figure>
            {image(left, "First image")}
            <figcaption>First image</figcaption>
          </figure>
          <figure>
            {image(right, "Second image")}
            <figcaption>Second image</figcaption>
          </figure>
        </div>
      )}
      <small className="muted">
        Visual comparison of attachments; matching dimensions do not guarantee matching
        page positions.
      </small>
    </details>
  );
}
