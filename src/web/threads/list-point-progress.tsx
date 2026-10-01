import React from "react";
import type { Thread } from "../api.js";
import { pointProgress, pointWorkState } from "../point-progress.js";

export function ThreadListPointProgress({
  thread,
  href,
}: {
  thread: Thread;
  href: string;
}) {
  const points = (thread.context.annotations ?? [])
    .map((point, index) => ({
      ...point,
      number: index + 1,
      state: pointWorkState(thread, point.id),
    }))
    .filter((point) => point.state !== "removed");
  if (!points.length) return null;
  const progress = pointProgress(thread);
  const rows = (items: typeof points) => (
    <ul className="thread-point-status-list">
      {items.map((point) => (
        <li key={point.id}>
          <a href={`${href}#point-${point.id}`}>
            <span className="thread-point-number">#{point.number}</span>
            <span className="thread-point-text">{point.body || "Untitled point"}</span>
          </a>
          <span
            className={`badge ${point.state === "closed" ? "declined" : point.state}`}
          >
            {point.state === "resolved"
              ? "Resolved"
              : point.state === "closed"
                ? "Closed"
                : "Open"}
          </span>
        </li>
      ))}
    </ul>
  );
  return (
    <div className="thread-point-progress" aria-label="Point progress">
      <p className="thread-point-progress-summary">
        {progress.resolved} of {progress.total} points resolved
        {progress.remaining > 0 && ` · ${progress.remaining} open`}
        {progress.closed > 0 && ` · ${progress.closed} closed`}
      </p>
      {rows(points.slice(0, 3))}
      {points.length > 3 && (
        <details>
          <summary>
            Show {points.length - 3} more {points.length === 4 ? "point" : "points"}
          </summary>
          {rows(points.slice(3))}
        </details>
      )}
    </div>
  );
}
