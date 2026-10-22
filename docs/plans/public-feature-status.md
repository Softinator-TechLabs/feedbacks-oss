# Current features and upcoming clients on the public website

Status: in progress. Date: 2026-10-22.

## Outcome and scope

Make the landing page, comparison pages and public guides describe the released Kanban board, project analytics, subscribed email with configurable templates, and guided task integrations. Keep available MCP/direct plugin connections for Codex and Claude Code distinct from pending official directory listings and upcoming native companions.

## Evidence and approach

Use the released application, shared contracts and canonical guides as feature evidence. Preserve dated competitor research and its scope; new Feedbacks features do not establish new competitor verdicts. Label native Windows, Ubuntu and macOS companions and Android/iOS sharing as coming soon without delivery dates or released-app claims. Preserve the existing landing visual identity and concise copy.

## Steps and progress

- [x] Inspect released feature source, existing public copy and deployment routes.
- [x] Update landing, generated comparisons and canonical/public guides.
- [x] Review claims and inspect desktop/mobile and keyboard behavior.
- [ ] Run required checks and merge through normal CI.
- [ ] Publish and verify public website/docs, release artifacts and image/extension status.

## Compatibility and recovery

This is public content and presentation work. Existing application APIs, credentials, data, extension permissions and installation image pins retain their contracts. A public-site rollback uses an earlier reviewed revision. Released tags and assets must remain immutable; any new distribution uses a new version.

## Decision log

- Existing Codex/Claude Code connections are available; directory approval is a separate milestone.
- Native mobile SDK source and the web screenshot pilot are separate from standalone native applications and real-device acceptance.

## Completion receipt

Source revision: pending merge.
Checks and results: local `npm run check` passed (627 tests passed, 57 conditional skips); public-site browser/performance QA passed on 23 desktop/mobile routes. The new landing sections and comparison summary were visually reviewed at desktop/mobile widths, with keyboard roadmap navigation and no horizontal overflow. Required exact-revision CI remains the merge and release gate.
Artifacts: pending release decision and verification.
Deployment and live verification: pending.
Remaining follow-up: real-account acceptance for additional providers and native-client/catalog acceptance remain separate from this public-content update.
