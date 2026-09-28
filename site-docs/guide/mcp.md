---
description: Connect your personal Feedbacks key to Codex, Claude Code or Antigravity through MCP, read visual feedback and verify your first UI fix.
---

# Developer guide: connect your agent and resolve feedback

Feedbacks gives your coding agent the context behind a UI request: the comment, original screenshots, page URL, selected element details and approved project guidance. MCP (Model Context Protocol) is the connection that lets your agent read this context and use permitted Feedbacks tools.

## Before connecting

Your team needs a running server, a prepared project and your own member account with access. Ask the owner to finish [project and member setup](/guide/team-setup). Chrome pairing and the agent key are separate connections. Clients and reviewers do not need MCP to submit feedback.

## Create your personal setup prompt

1. Sign in as **yourself** on the team's Feedbacks server. Finish temporary-password replacement if required.
2. Open **Help → Connect your coding agent**. Choose **Create key and copy setup**, or **Choose projects and permissions** to set narrower access in Account.
3. Read the permission notice. For a member, Help creates a personal key for current projects and profile, or profile-only access if there are no projects. For an owner, it creates a broad owner-administration key. Use narrower Account permissions for routine project work.
4. Paste the private setup prompt into your own coding-agent session. It includes the server connection and a secret key; keep it out of Git, screenshots and shared chats.
5. Ask the agent to configure its actual MCP client, reconnect, list tools and read accessible projects as verification. Setup should not change or resolve feedback.

Each member needs their own Feedbacks key, even if the team shares a coding-tool subscription. Adding project access or new scopes may require a new key.

## Choose your coding tool

| Tool        | Setup path                                                                                                                                                                             |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex       | Paste the setup prompt into your Codex session. Have it configure the remote MCP connection using the installed client's supported settings, then reconnect and verify project access. |
| Claude Code | Paste the same personal prompt into Claude Code. Have it configure an authenticated HTTP MCP server using its current client settings, then reconnect and list tools.                  |
| Antigravity | Paste the personal prompt into its agent. Use the client's supported authenticated MCP settings. If its client requires stdio, use the adapter described below.                        |

These clients share the Feedbacks endpoint, not necessarily configuration-file paths or secret syntax. The setup prompt carries the connection details; check the installed client's supported configuration rather than copying another client's settings.

### Manual connection

The remote endpoint is `https://YOUR-TEAM-SERVER/mcp`; compact clients can use `/mcp?profile=compact`. Configure the personal key as a secret-backed bearer credential through the client's supported settings. For a stdio-only client, build the repository's Node adapter and follow the [agent setup reference](https://github.com/Softinator-TechLabs/feedbacks-oss/blob/main/docs/agent-setup.md). Never use a browser sign-in link as an MCP token.

## Work through your first feedback

Start with a specific request:

> Read the feedback in this project and its approved context. Inspect the original screenshots, explain the requested change and propose what to fix first. After I agree, update this codebase, run the relevant checks and report the evidence in the thread. Resolve only the points we have verified.

The agent should identify the correct project and thread, inspect image evidence, distinguish approved guidance from comments, and work only within your requested scope. Record a real commit, PR or deployed-view link and actual checks. A successful reply, Issue link or MCP connection is not proof the UI was fixed.

## Why connect an agent?

For large backlogs or smaller context windows, connect to `/mcp?profile=compact`. The seven tools separate workspace matching, queue previews, paginated thread evidence, image inspection, workflow guides, schema discovery and exact operation execution. The setup prompt also installs a secret-free reusable skill for future chats; verify that the actual client discovers it after reload.

A request such as “show today's feedback from this reviewer and discuss what to fix first” first resolves project, author and timezone, counts threads and points separately, and proposes a task order. The developer chooses direct fixes or planning before work starts. Explicit priority flags and advisory weights are distinguished from inferred dependencies. The agent marks agreed work in progress, verifies changes and resolves selected points before closing a complete thread. Current revisions protect writes; no feedback is changed during setup.

Images are returned as native MCP image blocks. Full-page details can be cropped in original pixels. Video playback and PDF rendering require appropriate client tools; a text-only model cannot inspect visual evidence unaided. See the [portable workflow](https://github.com/Softinator-TechLabs/feedbacks-oss/blob/main/plugins/feedbacks/skills/review-feedback/SKILL.md).

An agent can inspect the exact page URL, screenshot context, comments, status and approved project guidance before changing code. It can then report a real commit, PR or deployed view back to the thread. A successful MCP connection grants only the scopes on its key; it does not authorize a source change, Issue creation or resolution on its own. Keep external writes separately authorized.

For website reviews, `threads.get` returns ordered `context.annotations`: each note has its own element selector, tag, page position and captured element rectangle/border details when available. Treat a missing selector or rectangle as a page-position note, not as an element match. Each asset includes an ordered filename, the captured page range and normalized `markings` for point pins, pencil strokes, arrows, rectangles and text. Automatic selected-element rectangles have `origin: "element"`; their `annotationId` links them to the corresponding note. Point marks link to the same ID. A `point-001-original.webp` image preserves that point's original viewport or menu state, with `anchor.viewport` and `anchor.capturedAt` on the note. Inspect it with `assets.get`; do not assume a later page screenshot contains the same state. If there is a `full-page-combined.webp`, its `captureSections` maps retained source page ranges into the merged image, including gaps from removed screenshots. Point originals stay separate from this continuous-page overview. Use `assets.get` on individual images for readable visual detail; the combined image may be scaled down.

For exact operation names, limits and recovery behavior, see the [MCP contract](https://github.com/Softinator-TechLabs/feedbacks-oss/blob/main/docs/mcp-contract.md) and [operation catalog](https://github.com/Softinator-TechLabs/feedbacks-oss/blob/main/docs/generated/operations.md).

### Point decisions and page totals

Captured `context.annotations` and attachment markings retain the original evidence. Read `annotationStates[annotationId]` for separately attributed open/resolved/removed decisions. Thread resolution/decline closes active points; a later reopen preserves their individual decisions. Removed points remain historical evidence, including their baked screenshot marks.

`threads.annotationStatus` requires the current thread revision and an explicit token scope. Resolution also requires resolve permission; remove/restore requires maintain permission. Existing tokens do not gain this scope automatically. `threads.list` with `includeSummary: true` returns aggregate thread/point totals for the selected project, page/hostname and device filters, independent of pagination.

### Project and member context on request

The package/setup prompt installs two focused skills: `review-feedback` for requested backlog work and `manage-feedbacks-context` for requested profile, project-background and responsibility edits. Their short descriptions enable natural-language discovery; bodies and references load progressively. No startup hooks or unsolicited polling are installed. Developers retain task choice.

Use `members.profile.get/save`, `members.responsibility.get/save`, and `projects.context.get/save` through exact schema discovery. Reads/writes return bounded text, revision, author/time and advisory provenance. Members edit their own profile; project writers edit collaborative context and their own responsibilities; owner administrators edit profiles and project maintainers edit other existing members' responsibilities. These operations never change grants, priority policy or approved instructions. Read current text, preserve relevant context, write its revision, then read back. New scopes require a newly issued key; existing keys do not expand.

Members can create personal keys from Help/Account using their own sign-in. Personal keys exclude owner-delegated policy visibility and external GitHub issue creation; domain/project permissions still apply. A member without projects can use only `auth.me`, `projects.list`, and `members.profile.get/save`. The profile's optional `currentWork` is a broad one-line focus (300 characters), preserved when omitted.

For authorized work, `assignments.claim` records the current member and agent against a whole thread or selected open points. Atomic overlap checks prevent two active claims on the same work while allowing disjoint points. `assignments.list` is paginated; `assignments.renew` extends a two-hour lease at ordinary work checkpoints; `assignments.release` records completed/paused without resolving feedback. Expiry is advisory, not proof the former worker stopped. Coordinate before takeover. No background polling, model-subscription identity inference or autonomous dispatch to another member is installed.
