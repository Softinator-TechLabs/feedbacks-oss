import type { Thread } from "../api.js";
import { ExternalLink } from "../ui.js";

export function ThreadSourceLink({
  thread,
  detailed = false,
}: {
  thread: Pick<Thread, "projectId" | "context">;
  detailed?: boolean;
}) {
  const document = thread.context.document;
  if (document)
    return (
      <a
        href={`/projects/${thread.projectId}/documents/${encodeURIComponent(document.id)}?page=${document.page}`}
      >
        Open document{detailed ? ` · ${document.name} · Page ${document.page}` : ""}
      </a>
    );
  return thread.context.url ? (
    <ExternalLink href={thread.context.url}>
      Open website ↗
      {detailed && thread.context.title ? ` · ${thread.context.title}` : ""}
    </ExternalLink>
  ) : null;
}
