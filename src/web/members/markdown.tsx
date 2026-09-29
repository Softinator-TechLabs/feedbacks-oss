import React from "react";
import { ExternalLink } from "../ui.js";

// React escapes all text. This deliberately small Markdown subset never loads
// remote images or accepts HTML; unsupported syntax stays visible as text.
export function SafeMarkdown({ body }: { body: string }) {
  const inline = (text: string) =>
    text
      .split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g)
      .map((part, n) => {
        if (part.startsWith("`")) return <code key={n}>{part.slice(1, -1)}</code>;
        if (part.startsWith("**")) return <strong key={n}>{part.slice(2, -2)}</strong>;
        const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
        return link ? (
          <ExternalLink key={n} href={link[2]}>
            {link[1]}
          </ExternalLink>
        ) : (
          part
        );
      });
  return (
    <div className="message">
      {body
        .split("\n")
        .map((line, n) =>
          line.startsWith("## ") ? (
            <h3 key={n}>{inline(line.slice(3))}</h3>
          ) : line.startsWith("# ") ? (
            <h2 key={n}>{inline(line.slice(2))}</h2>
          ) : (
            <p key={n}>{inline(line) || "\u00a0"}</p>
          ),
        )}
    </div>
  );
}
