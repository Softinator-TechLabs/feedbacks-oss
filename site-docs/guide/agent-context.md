---
title: Project context for AI coding agents
description: Give your coding agent the feedback evidence, approved project instructions and team responsibilities through scoped MCP, API and CLI access.
---

# Give your agent the whole picture

The screenshot shows the problem. Your project context explains how the team wants it handled. Feedbacks keeps both available without treating a comment as an instruction to act.

<picture><source media="(max-width: 600px)" srcset="/media/story/context-mobile.svg" /><img src="/media/story/context.svg" width="760" height="320" alt="Captured evidence and approved project instructions stay distinct when handed to the developer and agent." /></picture>

## Prepare the project once

The owner configures exact website origins, project access, published context and approved instructions. Add team profiles and responsibilities where useful. Owner-approved reviewer guidance can describe expertise and subject-specific weights; these help interpretation, not authorization.

Keep instructions specific: repository responsibilities, design constraints, acceptance criteria and what verification the team expects. Private member notes are not automatically included in normal agent context.

## Hand over one clear task

1. Review the feedback and agree on the work.
2. Use **Copy task for agent** from the thread, or ask your connected agent to find the relevant feedback.
3. Have the agent inspect the selected thread and evidence, implement the requested change and record verification.
4. Check the result before resolving the thread or its individual points.

Agents can start with compact project and thread summaries, then read selected screenshots, recordings or event ranges. This keeps unrelated media out of the initial task context. Use [debug bundles](/guide/debug-bundles) when you want portable evidence.

## Bring your own tools

MCP, the HTTP API and JSON CLI share server-side operations and project authorization. Feedbacks does not include an AI-model subscription, and connecting MCP does not start fixes automatically. GitHub is optional: use it when a reviewed task should become a linked Issue.

[Connect an agent](/guide/mcp) · [Set up projects and people](/guide/team-setup) · [GitHub repositories](/guide/github) · [Agent workflow reference](/reference/manual/agents)
