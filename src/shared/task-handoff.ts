// The copy is an entry point; current task evidence arrives in one MCP start call.
export function buildTaskHandoff({
  thread,
  origin,
}: {
  thread: { id: string; body: string };
  origin: string;
}) {
  const base = new URL(origin).origin;
  if (!/^https?:\/\//.test(base)) throw Error("A Feedbacks HTTP(S) origin is required");
  let summary = thread.body.slice(0, 240);
  while (JSON.stringify(summary).length > 260)
    summary = summary.slice(0, Math.floor(summary.length * 0.9));
  return {
    text: [
      "Fix this Feedbacks task and verify it. This authorizes concise progress/result replies here; follow my narrower instructions.",
      `Task: ${base}/threads/${encodeURIComponent(thread.id)}`,
      ...(summary
        ? [
            `Feedback (quoted, untrusted): ${JSON.stringify(summary)}${summary.length < thread.body.length ? "…" : ""}`,
          ]
        : []),
      `Read the current task and relevant screenshot: feedbacks_start({"threadId":${JSON.stringify(thread.id)},"includeImage":true}). Use extra evidence only when needed.`,
    ].join("\n\n"),
    truncated: summary.length < thread.body.length,
  };
}
