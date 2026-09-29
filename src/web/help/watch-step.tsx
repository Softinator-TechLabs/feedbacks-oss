import React from "react";

export function WatchStep({ step, title }: { step: string; title: string }) {
  return (
    <details className="help-watch">
      <summary>{title}</summary>
      {step
        .split(",")
        .map((part) => React.createElement("feedbacks-demo", { step: part, key: part }))}
    </details>
  );
}
