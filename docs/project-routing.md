# Project routing from the extension

An owner can create a project in **Projects → New project** in Feedbacks. The Projects index is the connected server's root path (`/`). Add each website's exact origin and grant colleagues reviewer or maintainer access. An origin is the scheme, host and any non-default port, without a page path, query or fragment: for example, `https://example.org` or `http://localhost:4175`.

The extension popup lists only projects returned for the connected account that grant write access and explicitly include the current tab's exact origin:

- One matching project: selected automatically, with its name and website shown. Click **Start review**.
- Several matching projects: choose explicitly from those matches, then click **Start review**. This choice is not remembered between popup openings; a global last-used project never selects a different website's destination.
- No matching project: review stays disabled. Ask an owner to add this exact origin in Projects and grant review access. **Open Projects** uses the currently connected Feedbacks server.
- Unsupported browser pages and the Chrome Web Store: review stays disabled; open a supported HTTP(S) website instead.

`http://example.org`, `https://example.org`, `https://www.example.org`, subdomains and non-default ports are separate approvals. Routing never adds wildcard access or infers approval from a similar hostname. Read-only projects are not selectable.

Only the explicit **Start review** click requests website permission; Chrome may show a one-time permission prompt. Opening the popup or selecting a project does not request website permission, capture a screenshot or upload feedback. If the active website or connected server changes while the popup is open, reopen it before reviewing. The background still rechecks the current origin and project permission during activation.

After starting review, choose an element and use **Capture & annotate**. The captured draft stays bound to that review's project and server. Inspect the image, annotate and write your comment, then explicitly **Send feedback**. Auto-selection is not auto-capture or auto-upload. **Resume pending draft**, pairing and disconnect remain separate controls.

## Separate projects and move existing feedback

Use separate projects when a public website and its dashboard need different context, instructions or access. A repository association is optional; creating a review project does not require connecting GitHub. MCP already exposes `projects.create`, `projects.context.save`, `instructions.publish` and `members.grant` for explicitly requested setup with appropriate permissions. Collaborative context, approved instructions and access grants are separate operations.

An explicitly requested `threads.move` takes the current `threadId`, `revision` and destination `projectId`. The caller needs maintain permission and, for an agent, the operation scope in both projects. The thread keeps its ID, discussion, assets and work plans; custom categories are matched or copied. Destination permissions apply, guest links are revoked and affected export snapshots are invalidated. Unsafe shared documents, active external synchronization and active assignees/workers missing destination access block the move instead of silently changing access or ownership.

Read back the new project and revision after moving. Existing GitHub links remain with automatic status sync paused for reconciliation. A move never connects GitHub, grants membership or starts work. See the [agent move workflow](../plugins/feedbacks/skills/review-feedback/references/workflow.md#requested-project-setup-and-thread-moves) for schema discovery and recovery.
