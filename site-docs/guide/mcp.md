# AI agents and MCP

MCP (Model Context Protocol) is a standard way for an assistant to discover tools from a service. Feedbacks exposes project lists, threads, approved instructions and other authorized operations through one remote MCP endpoint. It does **not** make a discussion comment an instruction for the agent: comments and screenshots remain untrusted evidence.

## Quick setup from Help

1. Sign in to your Feedbacks server and open **Help → Connect a coding agent**.
2. For ordinary project work choose **limited access** in **Account → Connect internal agents** and select project IDs, scopes and expiry. The Help page's **Advanced: owner-level agent access** disclosure can create a full owner-administration key; use that only when the agent truly needs it.
3. Paste the copied setup prompt into the coding agent you trust. It contains a one-time secret; never paste it into a repository, public chat or screenshot.
4. The agent configures its actual MCP client, installs both reusable skills, verifies discovery and lists accessible projects. For a selected or unambiguously matched project, it shows at most 10 task previews plus separate thread/point summary counts when read scopes allow. Zero accessible projects is valid; it never assigns or changes feedback during setup.
5. If new tools or skills are missing in the running Codex or Antigravity session, the agent names the exact app or connection you need to restart/reload/reconnect and gives a secret-free handoff for verification in a fresh chat. It does not quit apps automatically or claim ready merely because files were saved. Connection discovery, skill discovery and the first preview (or pending scope/project choice) are reported separately.

Help also shows a non-secret Codex command. Replace the example origin below with your server's exact origin, and supply `FEEDBACKS_TOKEN` privately to the **Codex process**:

```sh
codex mcp add feedbacks \
  --url https://feedback.example.com/mcp \
  --bearer-token-env-var FEEDBACKS_TOKEN
```

`FEEDBACKS_TOKEN` is the scoped key from Account. Do not put its value in this command or shell history. A desktop app launched outside your terminal does not inherit an export from that terminal; use the client's supported secret-backed settings or private launcher. Check your installed client's `codex mcp add --help` before using the command.

Other clients can use authenticated Streamable HTTP at `https://feedback.example.com/mcp` when supported. For a stdio-only client, build the repository's Node adapter and follow the [agent setup guide](https://github.com/Softinator-TechLabs/feedbacks-oss/blob/main/docs/agent-setup.md) for the process environment. Do not assume one client's configuration syntax works in another.

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

Members can create personal keys from Help/Account using their own sign-in. Personal keys exclude owner-delegated policy visibility. Project maintainers can separately opt into `github.issueCreate` in Account when they maintain every selected project; Help defaults omit it, and existing keys never expand. Current project permissions still apply. A member without projects can use only `auth.me`, `projects.list`, and `members.profile.get/save`. The profile's optional `currentWork` is a broad one-line focus (300 characters), preserved when omitted.

For authorized work, `assignments.claim` records the current member and agent against a whole thread or selected open points. Atomic overlap checks prevent two active claims on the same work while allowing disjoint points. `assignments.list` is paginated; `assignments.renew` extends a two-hour lease at ordinary work checkpoints; `assignments.release` records completed/paused without resolving feedback. Expiry is advisory, not proof the former worker stopped. Coordinate before takeover. These current-worker claims are separate from durable assignments to a project member. No background polling, model-subscription identity inference or autonomous dispatch to another member is installed.

### Assign a thread or selected points

Choose a member from the dropdown beside the thread status to assign immediately; choose another member to reassign or **Unassigned** to remove it. No additional fields are required. **Points & assignment history…** opens point assignments, optional details and history. You can also explicitly ask your agent to assign the thread or selected points to an existing project member. The durable record shows the assignee, scope, summary, category/tags, GitHub decision and the human/agent attribution in history. Agents inspect evidence and relevant team context, suggest classification and GitHub treatment, and discuss uncertain choices before an authorized assignment. Selected points can have a different category from the parent thread.

The assignment remains separate from the current worker's renewable claim. It does not launch another agent, send a message or resolve feedback. Reassign/cancel uses current revisions and preserves history. A GitHub decision does not create an issue or grant permission: actual creation needs explicit user intent, a separately scoped key and current project-maintainer access. Existing keys and Help defaults gain no GitHub scope. See the [agent assignment workflow](https://github.com/Softinator-TechLabs/feedbacks-oss/blob/main/docs/agents.md#requested-delegation-and-triage) for exact operations and recovery.
