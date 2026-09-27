import React from "react";
import Markdown from "react-markdown";

const allowed = [
  "p",
  "br",
  "strong",
  "em",
  "del",
  "a",
  "ul",
  "ol",
  "li",
  "blockquote",
  "code",
  "pre",
];

export function MarkdownText({
  body,
  className = "",
}: {
  body: string;
  className?: string;
}) {
  return (
    <div className={`markdown-text ${className}`}>
      <Markdown
        allowedElements={allowed}
        skipHtml
        components={{
          a: ({ href, children }) => {
            if (!href || !/^https?:\/\//i.test(href)) return <>{children}</>;
            return (
              <a href={href} target="_blank" rel="noopener noreferrer nofollow">
                {children}
              </a>
            );
          },
        }}
      >
        {body}
      </Markdown>
    </div>
  );
}
