import React from "react";
import type { Thread } from "./api.js";
import { pointProgress, pointProgressLabel } from "./point-progress.js";
import "./point-progress.css";

export function PointProgressRing({
  thread,
  compact = false,
}: {
  thread: Thread;
  compact?: boolean;
}) {
  const progress = pointProgress(thread);
  if (!progress.total) return null;
  const radius = 15;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  const segments = (
    ["resolved", "urgent", "later", "unscheduled", "closed"] as const
  ).flatMap((kind) => {
    const count = progress[kind];
    if (!count) return [];
    const length = (count / progress.total) * circumference;
    const segment = (
      <circle
        key={kind}
        className={`point-progress-${kind}`}
        cx="18"
        cy="18"
        r={radius}
        strokeDasharray={`${length} ${circumference - length}`}
        strokeDashoffset={-offset}
      />
    );
    offset += length;
    return [segment];
  });
  const label = pointProgressLabel(progress);
  return (
    <span
      className={`point-progress-ring${compact ? " point-progress-ring--compact" : ""}`}
      role="img"
      aria-label={label}
      title={label}
      tabIndex={compact ? undefined : 0}
    >
      <svg viewBox="0 0 36 36" aria-hidden="true">
        {segments}
      </svg>
      <span className="point-progress-fraction" aria-hidden="true">
        {progress.resolved}/{progress.total}
      </span>
    </span>
  );
}
