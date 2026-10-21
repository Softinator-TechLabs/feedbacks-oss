# Changelog

## 0.3.0 — 2026-10-21

- Add a configurable project Kanban board with shared thread filters, keyboard controls and atomic batch status, assignment and archive changes.
- Add permission-scoped analytics with separate Overview, Trends and Explore tabs. Visual counts and project charts show pending, overdue and high-priority tasks with exact drilldowns; activity charts and completed response/triage/resolution distributions support planning. CSV and print keep aggregate totals.
- Preserve keyboard focus when a reviewer enters a detail control before the panel's deferred navigation finishes.
- Organize project integrations into focused provider tabs, including project-scoped task connections, with preserved drafts, compact forms and optional setup/activity details.
- Keep Mailjet correlation IDs within its provider limit, including worker message IDs on long installation hostnames.
- Add subscribed email for feedback, discussion, mentions, work status and assignment changes. Configure SMTP (including Google), Mailjet or Amazon SES, server defaults, project senders and safe text templates. Delivery history distinguishes accepted and uncertain sends.
- Add explicit tracker connections for Jira, Linear, Asana, ClickUp, Monday, Trello, Productive, Teamwork, Firmao CRM and OpenProject, with reviewed writes, status mappings, encrypted credentials and reconciliation. Jira OAuth uses a separately operated confidential broker.
- Add explicit reviewed GitHub Issue comments with bounded remote discussion readback, durable reservations and uncertain-write reconciliation.
- Add Slack/Teams channels, reviewed FullStory/LogRocket session links, explicit Harvest/Time Doctor time entries and versioned automation webhook tests.
- Add permanent project website intake with exact approved origins, Turnstile, bounded abuse controls and optional contact consent. Existing expiring review links remain available.
- Package Codex/Claude Code plugins 0.3.0 and extension 0.1.64. The extension retains the current server-selection behavior and capture improvements, and includes the updated project-wide dependency notices.

### Upgrade from 0.2.3

Back up PostgreSQL and private object storage together and verify recovery before upgrading. Preserve organization identity, volumes, encryption keys and storage prefixes. Additive migrations create workflow, subscription, queue and integration tables without rewriting applied migrations. Existing installations send no email until configured and members subscribe. Optional email environment values seed only an absent server configuration; saved settings take precedence.

Pin the published image digest and use the existing private environment. Verify sign-in, a synthetic screenshot readback, project access and a subscribed test event after startup. Retain a compatible database/storage backup and previous image; use a forward fix if an older build cannot safely understand the new integration state.

### Provider acceptance and limits

Provider request and failure tests use synthetic transports. Individual provider account permissions, consent, quotas, sender-domain verification, inbox placement, CMS deployment policies and production Turnstile configuration require live acceptance. No marketplace listing or Store update is implied. Local tracker writes use outbound calls and polling; Jira OAuth additionally needs the separately operated broker. Firmao creates reviewed CRM tasks in an explicitly configured project; task comments remain unavailable through the documented API. See [integrations](docs/integrations.md), [email](docs/email-notifications.md), [board](docs/project-board.md) and [analytics](docs/analytics.md).

## 0.2.3 — 2026-10-21

- Refresh the locked MCP server/client SDK and Vite build tooling to patched compatible versions; the current lockfile passes `npm audit`.
- Package the current application with extension 0.1.60 and Claude Code/Codex plugins 0.2.3, including context-efficient task reads and updated review guidance.
- Recover task handoff with a manual-copy dialog when a browser clipboard permission request never completes.
- Repair review controls inside native modal previews and clarify stale project access and General-project fallback.
- Add optional browser sign-in for HTTP MCP clients with own-server OAuth; local stdio plugins and personal project-scoped keys remain supported.
- Keep recording, diagnostic and public-website documentation aligned with the current review workflow. State official plugin-directory review status separately from direct installation.

### Upgrade from 0.2.1 or the unpublished 0.2.2 preparation

Back up PostgreSQL and private object storage, and verify a restore before upgrading. Preserve the database volume, `ORGANIZATION_ID`, storage bucket/prefix and existing encryption secrets. Pin the new application image by its published digest; pull it and run `docker compose up -d --wait` using the existing private environment. Startup applies pending migrations. Verify sign-in, one synthetic screenshot upload/readback and an allowed agent read before handing the server back to the team. Do not use `docker compose down -v`.

OAuth is opt-in (`MCP_OAUTH_ENABLED=true`) and requires your own HTTPS deployment; existing URL/key connections continue to work. Existing personal keys retain their original projects and scopes. The extension retains saved server connections. This application release does not submit or publish an extension to the Chrome Web Store or a plugin to an official directory.

### Compatibility and known limits

One installation serves one organization; public registration, billing, SSO and shared-database customer tenancy are not included. Recording coverage depends on the explicitly enabled channels and browser support. Keep the previous image digest and a compatible database/storage backup pair for recovery; an older image is not guaranteed to understand a migrated database. See [operations](docs/operations.md), [self-hosting](docs/self-hosting.md) and [release guidance](docs/releasing.md).

## 0.2.1 — 2026-10-01

- Build native Claude Code and Codex plugin packages from the same MCP adapter and skills, with independent platform manifests and versioned release checksums.
- Add a gated Docker Hub publication workflow with native AMD64/ARM64 container tests, SBOM/provenance attestations and registry Compose installation.
- Add an illustrated storage/prerequisites guide with configuration mapping, private bucket provisioning and recovery checks. Correct the application storage policy to include object deletion used by cleanup.

No database migration or extension change is introduced by this release. Preserve the existing database volume, organization ID and private storage when updating.

## 0.2.0 — 2026-09-30

- Capture video and browser sessions with a shared activity, console, network and performance timeline; retain screenshot diagnostics and downloadable debugging evidence.
- Copy task context into coding agents, including discussion, assignments, priority and project/reviewer guidance through MCP.
- Support multiple GitHub Apps through Integrations, and improve thread navigation, image review and annotation editing.
- Refresh visual guides and category-based comparisons. Keep animation inspection local, explicit playback global, and load the hero without waiting for unrelated fonts or deferred scripts.
- Ship Chrome extension 0.1.56, Codex plugin 0.2.0, reviewed source, checksums and a CycloneDX dependency inventory. The Chrome Web Store release is separate.

### Upgrade from 0.1.0

Back up PostgreSQL and object storage first. Preserve `ORGANIZATION_ID`, database configuration, object-storage prefix and encryption secrets. Startup applies pending migrations; validate a restored backup before production upgrade. Use a database/image backup pair for rollback rather than running an older image against upgraded data. See [operations](docs/operations.md) and [release guidance](docs/releasing.md).

### Changes since the initial preparation

- In extension 0.1.55, keep stable recording-event rows during playback so Following playback scrolls smoothly through media updates.
- Use one cursor walkthrough player across the landing page, public guides and app help, with the actual recording inspector and an in-page expanded viewer.

- Prepare an Apache-2.0 source release, contributor/governance/security guidance and generic self-hosting configuration.
- Add filtered next/previous thread navigation, keyboard shortcuts, optional tags and personal saved review views.
- Add attachment comparison and reviewer-selected, opt-in console/resource diagnostics in extension 0.1.8.
- Package the existing MCP adapter and review skill as a standalone Codex plugin with portable and compatibility manifests.
- Replace the public landing with concise visual examples, a pencil interaction, self-hosting links and agent context.
- Add human review rounds and a scoped MCP Issue draft for an agent using separately authorized GitHub access.
- Reduce opt-in diagnostic URLs to origins and clarify that screenshots cover the visible browser area in extension 0.1.12.
- In extension 0.1.19, fit optional combined full-page images to upload limits, repair oversized combined images on Retry Send, and show page-by-page annotation more clearly.
- In extension 0.1.20, preview the full page as one scrollable image before sending, add annotation tool icons, and show confirmed image-upload progress by count and percentage.

## Initial preparation baseline

Application 0.1.0 and Chrome extension 0.1.7 formed the initial preparation baseline; this release packages extension 0.1.56. The Chrome Web Store updates separately.

- Apache-2.0 licensing, contributor and security reporting guidance, and source-only release archives.
- Independent public website with self-hosting documentation and GitHub access.
- User-selected extension server; server permission during pairing and separate optional all-sites access.
- Production configuration validation, bounded connection pools, serialized migrations and graceful shutdown.
- Persistent export request and snapshot budgets, content limits and expiry cleanup. Migration 5 adds accounting for existing snapshots.
- CI for Node.js 22/24, native PostgreSQL concurrency, secret/dependency checks and container builds.

### Upgrade notes

Back up the database before deploying. Keep `ORGANIZATION_ID`, the database and existing object-storage prefix unchanged during upgrades. Set reverse-proxy trust to match the actual ingress. The CLI now requires an explicit server URL. Extension updates retain saved server connections.

Export pages remain valid until their original expiry, subject to current access. Reuse `snapshotId` for pagination and use `context.changes` for projects beyond the documented export limits. Do not roll back to an application version without export accounting; use a compatible forward fix.

Hosted customer organizations require separate deployments and databases. Public registration, billing, SSO and shared-database tenancy are not included in this release.
