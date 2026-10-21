# Project routing from the extension

An owner can create a project in **Projects → New project** in Feedbacks. The Projects index is the connected server's root path (`/`). Add each website's exact origin and grant colleagues reviewer or maintainer access. An origin is the scheme, host and any non-default port, without a page path, query or fragment: for example, `https://example.org` or `http://localhost:4175`.

Opening the extension on a supported website starts or resumes review when Chrome has granted website access. The background selects from writable projects returned for the connected account:

- One exact-origin match: selected automatically, with its name shown.
- Several exact-origin matches: choose from those matches. The choice is remembered for this website and server, and is used only while it remains an allowed match.
- No exact-origin match: an allowed general project with `captureMode: "any"` can receive feedback. The popup explains this fallback and suggests reconnecting if the team recently added the website. A saved general-project preference never overrides an available exact-origin match.
- No exact-origin match or allowed general project: review stays disabled. Ask an owner to add the exact origin and grant review access. **Open Projects** uses the connected Feedbacks server.
- Unsupported browser pages and the Chrome Web Store: review stays disabled; open a supported HTTP(S) website instead.

`http://example.org`, `https://example.org`, `https://www.example.org`, subdomains and non-default ports are separate approvals. Routing never adds wildcard access or infers approval from a similar hostname. Read-only projects are not selectable.

Chrome's toolbar invocation provides access to the current tab; optional persistent website access remains a separate setting. Selecting a project does not capture a screenshot or upload feedback. If the active website or connected server changes while the popup is open, reopen it before reviewing. The background rechecks the current origin and project permission during activation.

Paired connections retain the projects approved when they were created. Adding a project or membership later does not expand an existing device token. If the website exists in Projects but the extension still uses a general project, open **Settings → Connect to server** and approve the new connection on that server. This refreshes the connection's current project access without changing project origins or granting all-site browser access. [The packaged browser check](../scripts/qa/extension/setup/project-routing.mjs) verifies both the stale connection and explicitly approved refresh.

After starting review, right-click an element, write its note and choose **Save point**. The draft stays bound to that review's project and server. Use **Review & send** to inspect its evidence, then explicitly send it. Auto-selection is not auto-capture or auto-upload. **Resume pending draft**, pairing and disconnect remain separate controls.

## Separate projects and move existing feedback

Use separate projects when a public website and its dashboard need different context, instructions or access. A repository association is optional; creating a review project does not require connecting GitHub. MCP already exposes `projects.create`, `projects.context.save`, `instructions.publish` and `members.grant` for explicitly requested setup with appropriate permissions. Collaborative context, approved instructions and access grants are separate operations.

An explicitly requested `threads.move` takes the current `threadId`, `revision` and destination `projectId`. The caller needs maintain permission and, for an agent, the operation scope in both projects. The thread keeps its ID, discussion, assets and work plans; custom categories are matched or copied. Destination permissions apply, guest links are revoked and affected export snapshots are invalidated. Unsafe shared documents, active external synchronization and active assignees/workers missing destination access block the move instead of silently changing access or ownership.

Read back the new project and revision after moving. Existing GitHub links remain with automatic status sync paused for reconciliation. A move never connects GitHub, grants membership or starts work. Reviewed external replay links move with the thread. Pending integration/email sends are cancelled; active sends and uncertain external writes must finish or be reconciled first. Historical tracker/time records keep their original connection permissions, and old tracker polling is paused. Moving feedback never retargets a provider connection. See the [agent move workflow](../plugins/feedbacks/skills/review-feedback/references/workflow.md#requested-project-setup-and-thread-moves) for schema discovery and recovery.
