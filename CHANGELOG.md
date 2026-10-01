# Changelog

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
