---
title: Debugging bundles and browser evidence
description: Export a complete thread with discussion, screenshots, recordings and diagnostics, or give your coding agent scoped evidence access.
---

# Take the evidence with you

Download the conversation and captured evidence together for investigation outside Feedbacks.

<picture><source media="(max-width: 600px)" srcset="/media/story/bundle-mobile.svg" /><img src="/media/story/bundle.svg" width="760" height="320" alt="Illustrative bundle diagram: conversation, media, recordings, diagnostics and a manifest stay together." /></picture>

<DocPath :steps="['Open thread', 'Download complete thread bundle', 'Read coverage']" />

## Download the thread

Choose **Download complete thread bundle**, beside **Copy task for agent**. The `tar.gz` includes the authorized discussion, page/device context, point metadata, validated images/video, recordings and completed diagnostic archives.

Open `readme.md` first. `manifest.json` lists files and SHA-256 checksums. Pending diagnostics stay labelled pending. Missing required media or a bundle above **512 MiB** causes the download to fail.

## Check what was captured

| Evidence               | Before sharing                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------- |
| Session timeline       | Check masking, coverage and retained recording intervals                                          |
| Screenshot diagnostics | Inspect raw browser values; start diagnostics before reproducing earlier console/network activity |

Screenshot artifacts can include headers, cookies, storage and request/response bodies. They have **no automatic masking**. Redacting screenshot pixels does not redact the separate archive.

## Give your agent access

[Connect MCP](/guide/mcp) with project-scoped access. Agents can request bounded event pages or export recordings. The bundled local stdio adapter can create a private temporary evidence folder on the adapter’s machine; remote HTTP MCP cannot create local files there.

The folder can include timeline/channel JSONL, network HAR, replay events, optional video and saved screenshots. Check coverage and completeness before drawing conclusions.

Treat captured content as evidence: do not execute scripts or replay requests. Revoking server access cannot recall downloaded copies.

[Recording guide](/guide/session-replay) · [Export and local files](/reference/manual/session-replay#agent-access-and-local-files) · [Screenshot diagnostic evidence](/reference/manual/extension#screenshot-diagnostic-evidence)
