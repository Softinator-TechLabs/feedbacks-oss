function textEditSections(thread: any, quote: (value: string) => string) {
  return (thread.context?.annotations || []).flatMap((point: any, index: number) =>
    point.textEdit
      ? [
          `## Point ${index + 1}: Suggested text edit`,
          `Original text:\n\n${quote(point.textEdit.original)}`,
          point.textEdit.replacement
            ? `Suggested replacement:\n\n${quote(point.textEdit.replacement)}`
            : "Suggested replacement: Remove selected text",
        ]
      : [],
  );
}

// An Issue draft is only a transcription aid. It never authorizes an external
// write, and deliberately excludes attachments, diagnostics and reviewer policy.
export function issueDraft(thread: any, repositoryUrl: string | null) {
  const safe = (value: string) =>
    value
      .replace(/\r\n?/g, "\n")
      .replace(/@/g, "＠")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .trim();
  const quote = (value: string) =>
    safe(value)
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
  const firstLine = safe(thread.body).split("\n")[0].replace(/\s+/g, " ");
  const title = `Feedback: ${firstLine}`.slice(0, 120);
  const sections = ["## Request", quote(thread.body)];
  sections.push(...textEditSections(thread, quote));
  for (const reply of thread.replies ?? []) {
    if (sections.join("\n\n").length > 7000) break;
    sections.push(
      `## ${safe(reply.author.name).slice(0, 80)} replied`,
      quote(reply.body),
    );
  }
  const body = sections.join("\n\n").slice(0, 8000);
  return {
    projectId: thread.projectId,
    threadId: thread.id,
    revision: thread.revision,
    repositoryUrl,
    sourcePath: `/threads/${thread.id}`,
    title,
    body,
    trust: "untrusted_discussion" as const,
    requiresReview: true as const,
    warnings: [
      "Check the draft for private information and accuracy before creating an Issue.",
      "Screenshot assets and private reviewer notes are not copied into this draft.",
      "Create the Issue in your chosen issue tracker, then register its URL in Feedbacks. Jira and Linear links are reported, not remotely verified.",
    ],
  };
}

export function quickIssueDraft(
  thread: any,
  origin: string,
  attachments: {
    id: string;
    contentType: string;
    filename?: string;
  }[],
) {
  const safe = (value: string) =>
    value
      .replace(/\r\n?/g, "\n")
      .replace(/@/g, "＠")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .trim();
  const firstLine = safe(thread.body).split("\n")[0].replace(/\s+/g, " ");
  const title = `Feedback: ${firstLine}`.slice(0, 120);
  const quote = safe(thread.body)
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  const excerpt = quote.length > 6000 ? `${quote.slice(0, 5999)}…` : quote;
  const source = `${origin}/threads/${thread.id}`;
  const suggestions = textEditSections(thread, (value) =>
    safe(value)
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n"),
  ).join("\n\n");
  let body = `## Feedback\n\n${excerpt}${suggestions ? `\n\n${suggestions.slice(0, Math.max(0, 7400 - excerpt.length))}` : ""}\n\n## Source\n\n${source}`;
  const capturePages = attachments.filter((item) =>
    /^full-page-\d+-of-\d+\.webp$/.test(item.filename || ""),
  );
  if (capturePages.length > 1)
    body += `\n\nFull-page capture: ${capturePages.length} numbered images. Review them one at a time in filename order on the Feedbacks thread.`;
  if (attachments.length) {
    body += "\n\n## Images and videos\n\n";
    for (const [index, attachment] of attachments.entries()) {
      const kind = attachment.contentType === "video/webm" ? "Video" : "Image";
      const threadImage = `${source}#asset-${attachment.id}`;
      const name = attachment.filename
        ? safe(attachment.filename)
        : `${kind} ${index + 1}`;
      const line = `- ${name}: [Open in Feedbacks](${threadImage})\n`;
      if (body.length + line.length + 90 > 8000) {
        body += "\nMore attachments are available on the Feedbacks thread.\n";
        break;
      }
      body += line;
    }
    body +=
      "\nThese links do not expire. Open with your existing Feedbacks project access.\n";
  }
  return { title, body: body.slice(0, 8000) };
}
