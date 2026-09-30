---
title: Debugging bundles and browser evidence
description: Download a complete bug-report bundle with discussion, screenshots, video, session timelines and browser diagnostics, or give your coding agent scoped evidence access.
---

# Take the evidence with you

A useful bug report preserves more than a screenshot. Feedbacks can keep the conversation, captured page state, recordings and diagnostics together, then export them for investigation.

<picture><source media="(max-width: 600px)" srcset="/media/story/bundle-mobile.svg" /><img src="/media/story/bundle.svg" width="760" height="320" alt="A thread bundle contains conversation, media, recordings, diagnostics and a manifest." /></picture>

## Download the complete thread

Open the thread and choose **Download complete thread bundle**, beside **Copy task for agent**. The `tar.gz` archive includes the authorized thread and discussion, page/device context, point metadata, validated image and video assets, session recordings and completed browser diagnostic archives.

Open `readme.md` first. `manifest.json` lists the files and SHA-256 checksums. Pending diagnostics remain identified as pending. The download fails if required media is unavailable or the 512 MiB bundle limit is exceeded; it does not silently claim an incomplete archive is complete.

## Understand the two kinds of diagnostics

| Evidence                       | How it is captured                                                                                                 | What to check                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| Session timeline               | Start a session recording; activity, console and network share its clock                                           | Masking options, channel coverage and retained time intervals |
| Screenshot diagnostic artifact | Point-in-time browser evidence; start diagnostics before reproducing when you need earlier console/network history | Captured content and coverage before sharing                  |

New screenshot artifacts can contain raw browser values, including headers, cookies, storage and request/response bodies. They do **not** inherit session masking. Removing pixels with the screenshot editor does not redact a separate diagnostic archive. Review the evidence controls before sending.

## Work with your own coding agent

Use [MCP setup](/guide/mcp) for project-scoped access. Agents can read recording summaries, request bounded event pages or export the recording. The bundled local stdio adapter can materialize authorized evidence into a private temporary directory on the agent’s machine.

That folder can contain an ordered timeline, console/activity/performance JSONL, network HAR, replay events, optional video and saved screenshots. Coverage and completeness information explain missing files. The remote HTTP MCP endpoint does not create files on your computer.

Captured pages and diagnostics are evidence, not instructions. Read them without executing captured scripts or replaying recorded requests. Downloaded files remain on the recipient’s machine after server access is revoked.

[Recording guide](/guide/session-replay) · [Exact export and materializer contract](/reference/manual/session-replay#agent-access-and-local-files) · [Screenshot diagnostic evidence](/reference/manual/extension#screenshot-diagnostic-evidence)
