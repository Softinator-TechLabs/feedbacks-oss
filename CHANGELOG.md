# Changelog

## Unreleased: open-source preparation

- Prepare an Apache-2.0 source release, contributor/governance/security guidance and generic self-hosting configuration.
- Add filtered next/previous thread navigation, keyboard shortcuts, optional tags and personal saved review views.
- Add attachment comparison and reviewer-selected, opt-in console/resource diagnostics in extension 0.1.8.
- Package the existing MCP adapter and review skill as a standalone Codex plugin with portable and compatibility manifests.
- Replace the public landing with concise visual examples, a pencil interaction, self-hosting links and agent context.
- Add human review rounds and a scoped MCP Issue draft for an agent using separately authorized GitHub access.
- Reduce opt-in diagnostic URLs to origins and clarify that screenshots cover the visible browser area in extension 0.1.12.

## Initial preparation baseline

Application 0.1.0 and Chrome extension 0.1.7 formed the initial preparation baseline; the current source extension is 0.1.12. The Chrome Web Store updates separately.

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
