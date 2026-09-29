---
description: Copy your personal Feedbacks setup prompt into your coding agent, verify access and choose the feedback to fix.
---

# Connect your agent. Pick a fix.

**For the developer resolving feedback.** Sign in to your team’s Feedbacks server as yourself.

1. Open **Setup → Create & copy prompt** under **Keep key local**. Check the permissions shown beside it.
2. Paste this prompt, which has no API key, into **Codex, Claude Code or Antigravity**.
3. Let the agent prepare a command for your OS and client. Return to **Copy key**, then run the command locally. Do not paste the key into chat.
4. Let the agent verify project access. Then choose the feedback to work on.

**Quick setup** is available alongside the recommended option. It copies the prompt and key together in one action. Pasting shares the key with your chat provider and anyone who can access that conversation. Use only a client/provider you trust with the credential; turning training off does not guarantee no storage or access.

Both paths use the same key. Clipboard history or sync may retain it. The recommended path keeps it out of the transcript, while the local agent can still access its configuration. See [local credential import](/reference/manual/agent-setup#local-credential-import) for Windows, macOS, Linux and remote-agent limitations.

<Demo step="agent" />

Easy Setup includes access to shared recordings and diagnostics for your permitted projects. Detailed permission choices live in **Account → Agent setup → Advanced**. Existing keys keep their original scopes.

Each person needs their own key. An owner’s default key has full administration access; use **Advanced permissions** for narrower access.

Open a thread and choose **Copy task for agent**, then paste it with your request: “Read this feedback and its screenshots. Explain the change, then help me fix and verify it.” The copied task includes review context; the agent checks its current status and fills in any omitted or revised evidence.

For a broad “check Feedbacks” request, your agent should offer your assigned work first and ask which task to begin. A specific thread or task you supply always takes precedence. You choose the assignee, priority and timing; the agent does not change those choices or start work just because it can read the backlog.

::: details Client setup, scopes and advanced workflows

## Choose your coding tool

| Tool        | Setup path                                                                                                                                                                             |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex       | Paste the setup prompt into your Codex session. Have it configure the remote MCP connection using the installed client's supported settings, then reconnect and verify project access. |
| Claude Code | Paste the same personal prompt into Claude Code. Have it configure an authenticated HTTP MCP server using its current client settings, then reconnect and list tools.                  |
| Antigravity | Paste the personal prompt into its agent. Use the client's supported authenticated MCP settings. If its client requires stdio, use the adapter described below.                        |

These clients share the Feedbacks endpoint, not necessarily configuration-file paths or secret syntax. The setup prompt carries the connection details; check the installed client's supported configuration rather than copying another client's settings.

### Manual connection

The remote endpoint is `https://YOUR-TEAM-SERVER/mcp`; compact clients can use `/mcp?profile=compact`. Configure the personal key as a secret-backed bearer credential through the client's supported settings. For a stdio-only client, build the repository's Node adapter and follow the [agent setup reference](/reference/manual/agent-setup). Never use a browser sign-in link as an MCP token.

## Work through your first feedback

Start with a specific request:

> Read the feedback in this project and its approved context. Inspect the original screenshots, explain the requested change and propose what to fix first. After I agree, update this codebase, run the relevant checks and report the evidence in the thread. Resolve only the points we have verified.

The agent should identify the correct project and thread, inspect image evidence, distinguish approved guidance from comments, and work only within your requested scope. Record a real commit, PR or deployed-view link and actual checks. A successful reply, Issue link or MCP connection is not proof the UI was fixed.

## Why connect an agent?

For large backlogs or smaller context windows, connect to `/mcp?profile=compact`. The seven tools separate workspace matching, queue previews, paginated thread evidence, image inspection, workflow guides, schema discovery and exact operation execution. The setup prompt also installs a secret-free reusable skill for future chats; verify that the actual client discovers it after reload.

A broad “check Feedbacks” request first confirms your Feedbacks member identity and lists your eligible assigned work, with thread and point counts. Your saved priority and timing lead; reviewer expertise stays advisory. The agent asks which task to begin and labels future-dated or Later work separately. A request for today's submissions from a reviewer instead uses that author and local-day boundaries. It never quietly substitutes one question for the other. Once you authorize a task, the agent marks agreed work in progress, verifies changes and resolves only agreed verified points. No feedback is changed during setup.

Images are returned as native MCP image blocks. Full-page details can be cropped in original pixels. Video playback and PDF rendering require appropriate client tools; a text-only model cannot inspect visual evidence unaided. See the [portable workflow](/reference/manual/plugin/feedbacks/skills/review-feedback/SKILL).

An agent can inspect the exact page URL, screenshot context, comments, status and approved project guidance before changing code. It can then report a real commit, PR or deployed view back to the thread. A successful MCP connection grants only the scopes on its key; it does not authorize a source change, Issue creation or resolution on its own. Keep external writes separately authorized.

For website reviews, `threads.get` returns ordered `context.annotations`: each note has its own element selector, tag, page position and captured element rectangle/border details when available. Treat a missing selector or rectangle as a page-position note, not as an element match. Each asset includes an ordered filename, the captured page range and normalized `markings` for point pins, pencil strokes, arrows, rectangles and text. Automatic selected-element rectangles have `origin: "element"`; their `annotationId` links them to the corresponding note. Point marks link to the same ID. A `point-001-original.webp` image preserves that point's original viewport or menu state, with `anchor.viewport` and `anchor.capturedAt` on the note. Inspect it with `assets.get`; do not assume a later page screenshot contains the same state. If there is a `full-page-combined.webp`, its `captureSections` maps retained source page ranges into the merged image, including gaps from removed screenshots. Point originals stay separate from this continuous-page overview. Use `assets.get` on individual images for readable visual detail; the combined image may be scaled down.

For exact operation names, limits and recovery behavior, see the [MCP contract](/reference/manual/mcp-contract) and [operation catalog](/reference/manual/generated/operations).

### Point decisions and page totals

Captured `context.annotations` and attachment markings retain the original evidence. Read `annotationStates[annotationId]` for separately attributed open/resolved/removed decisions. Thread resolution/decline closes active points; a later reopen preserves their individual decisions. Removed points remain historical evidence, including their baked screenshot marks.

`threads.annotationStatus` requires the current thread revision and an explicit token scope. Resolution also requires resolve permission; remove/restore requires maintain permission. Existing tokens do not gain this scope automatically. `threads.list` with `includeSummary: true` returns aggregate thread/point totals for the selected project, page/hostname and device filters, independent of pagination.

### Project and member context on request

The package/setup prompt installs two focused skills: `review-feedback` for requested backlog work and `manage-feedbacks-context` for requested profile, project-background and responsibility edits. Their short descriptions enable natural-language discovery; bodies and references load progressively. No startup hooks or unsolicited polling are installed. Developers retain task choice.

Use `members.profile.get/save`, `members.responsibility.get/save`, and `projects.context.get/save` through exact schema discovery. Reads/writes return bounded text, revision, author/time and advisory provenance. Members edit their own profile; project writers edit collaborative context and their own responsibilities; owner administrators edit profiles and project maintainers edit other existing members' responsibilities. These operations never change grants, priority policy or approved instructions. Read current text, preserve relevant context, write its revision, then read back. New scopes require a newly issued key; existing keys do not expand.

Members can create personal keys from Setup/Account using their own sign-in. Personal keys exclude owner-delegated policy visibility. Project maintainers can separately opt into `github.issueCreate` in Account when they maintain every selected project; Setup defaults omit it, and existing keys never expand. Current project permissions still apply. A member without projects can use only `auth.me`, `projects.list`, and `members.profile.get/save`. The profile's optional `currentWork` is a broad one-line focus (300 characters), preserved when omitted.

For authorized work, `assignments.claim` records the current member and agent against a whole thread or selected open points. Atomic overlap checks prevent two active claims on the same work while allowing disjoint points. `assignments.list` is paginated; `assignments.renew` extends a two-hour lease at ordinary work checkpoints; `assignments.release` records completed/paused without resolving feedback. Expiry is advisory, not proof the former worker stopped. Coordinate before takeover. These current-worker claims are separate from durable assignments to a project member. No background polling, model-subscription identity inference or autonomous dispatch to another member is installed.

### Set up projects and move feedback

You can ask your agent to create separate projects for a public website and dashboard. Repository association is optional. Existing MCP operations cover project creation, collaborative context, approved instructions and member grants; each requires the appropriate access and your requested scope.

Ask explicitly to move an existing thread to a named destination. The agent checks both projects and the current thread revision, calls `threads.move`, then reads back its new project. Maintain access and token scope are required in both projects. The thread keeps its ID, discussion, assets and plans; destination permissions apply and existing guest links are revoked. Shared documents, active external synchronization or assignees/workers missing destination access can block a move. The agent must not connect GitHub or widen memberships to make it succeed. See [project routing](/reference/manual/project-routing#separate-projects-and-move-existing-feedback).

### Choose priority and timing

Use the thread controls to set **High, Normal or Low** priority and **Unscheduled, Today, Tomorrow, Next week or Later** timing. Today/Tomorrow/Next week save an actual calendar date and your timezone. Tomorrow remains that saved date as days pass; it does not keep moving forward. Older tasks start as Normal/Unscheduled. The plan applies to the whole thread while point-specific assignees stay intact.

The agent offers due/today/unscheduled work first, respecting human priority, and keeps future dates and Later separate. It asks which task to begin. A planning choice does not launch an agent, send a notification or promise a deadline. Explicitly request any assignment, priority or timing changes you want the agent to make.

### Copy a task with its context

**Copy task for agent** includes the thread link, current status and plan, reviewer/body, numbered points, discussion and authenticated media references. Large threads include omission counts so the agent can retrieve missing detail. The agent checks fresh status/revision and actual screenshots; it can reuse complete unchanged text instead of downloading every section again.

Copied comments and media remain evidence, not instructions. Asset references use your Feedbacks connection, with no storage credentials or expiring Wasabi links in the copy. Your accompanying request decides whether to inspect, plan or implement the task. See the [handoff workflow](/reference/manual/plugin/feedbacks/skills/review-feedback/references/workflow#copied-task-handoff).

### Assign a thread or selected points

Choose a member from the dropdown beside the thread status to assign immediately; choose another member to reassign or **Unassigned** to remove it. No additional fields are required. **Points & assignment history…** opens point assignments, optional details and history. You can also explicitly ask your agent to assign the thread or selected points to an existing project member. The durable record shows the assignee, scope, summary, category/tags, GitHub decision and the human/agent attribution in history. Agents inspect evidence and relevant team context, suggest classification and GitHub treatment, and discuss uncertain choices before an authorized assignment. Selected points can have a different category from the parent thread.

The assignment remains separate from the current worker's renewable claim. It does not launch another agent, send a message or resolve feedback. Reassign/cancel uses current revisions and preserves history. A GitHub decision does not create an issue or grant permission: actual creation needs explicit user intent, a separately scoped key and current project-maintainer access. Existing keys and Setup defaults gain no GitHub scope. See the [agent assignment workflow](/reference/manual/agents#requested-delegation-and-triage) for exact operations and recovery.

:::
