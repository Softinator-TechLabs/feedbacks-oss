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
  attachments: { id: string; contentType: string; directUrl: string | null }[],
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
  let body = `## Feedback\n\n${excerpt}\n\n## Source\n\n${source}`;
  if (attachments.length) {
    body += "\n\n## Images and videos\n\n";
    for (const [index, attachment] of attachments.entries()) {
      const kind = attachment.contentType === "video/webm" ? "Video" : "Image";
      const authenticated = `${origin}/api/assets/${attachment.id}`;
      const links = [`[Open in Feedbacks](${authenticated})`];
      if (attachment.directUrl)
        links.push(`[Direct Wasabi link, valid 7 days](${attachment.directUrl})`);
      const line = `- ${kind} ${index + 1}: ${links.join(" · ")}\n`;
      if (body.length + line.length + 90 > 8000) {
        body += "\nMore attachments are available on the Feedbacks thread.\n";
        break;
      }
      body += line;
    }
    if (attachments.some((item) => item.directUrl))
      body +=
        "\nDirect storage links expire after 7 days. Feedbacks links require project access and remain available.\n";
    else body += "\nFeedbacks links require project access.\n";
  }
  return { title, body: body.slice(0, 8000) };
}
