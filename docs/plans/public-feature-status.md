# Current features and upcoming clients on the public website

Status: complete. Date: 2026-10-22.

## Outcome and scope

Make the landing page, comparison pages and public guides describe the released Kanban board, project analytics, subscribed email with configurable templates, and guided task integrations. Keep available MCP/direct plugin connections for Codex and Claude Code distinct from pending official directory listings and upcoming native companions.

## Evidence and approach

Use the released application, shared contracts and canonical guides as feature evidence. Preserve dated competitor research and its scope; new Feedbacks features do not establish new competitor verdicts. Label native Windows, Ubuntu and macOS companions and Android/iOS sharing as coming soon without delivery dates or released-app claims. Preserve the existing landing visual identity and concise copy.

## Steps and progress

- [x] Inspect released feature source, existing public copy and deployment routes.
- [x] Update landing, generated comparisons and canonical/public guides.
- [x] Review claims and inspect desktop/mobile and keyboard behavior.
- [x] Run required checks and merge through normal CI.
- [x] Publish and verify public website/docs, release artifacts and image/extension status.

## Compatibility and recovery

This is public content and presentation work. Existing application APIs, credentials, data, extension permissions and installation image pins retain their contracts. A public-site rollback uses an earlier reviewed revision. Released tags and assets must remain immutable; any new distribution uses a new version.

## Decision log

- Existing Codex/Claude Code connections are available; directory approval is a separate milestone.
- Native mobile SDK source and the web screenshot pilot are separate from standalone native applications and real-device acceptance.

## Completion receipt

Source: `97e3422edd3373f61d65b768afe2a2b70d12626a`, merged through [PR #241](https://github.com/Softinator-TechLabs/feedbacks-oss/pull/241). Local `npm run check` passed (627 tests passed, 57 conditional skips); public-site browser/performance QA covered 23 desktop/mobile routes. Desktop/mobile visual review, keyboard roadmap navigation and overflow checks passed. [Exact-main CI](https://github.com/Softinator-TechLabs/feedbacks-oss/actions/runs/39717210572), attempt 1, passed all six jobs.

The public [0.3.2 release](https://github.com/Softinator-TechLabs/feedbacks-oss/releases/tag/v0.3.2) was downloaded after publication: all seven checksums and 1,129 source-file hashes passed. Tracked source bytes matched the immutable release revision; generated manuals/media retained verified canonical inputs. [Image publication](https://github.com/Softinator-TechLabs/feedbacks-oss/actions/runs/39718589357) passed native AMD64/ARM64 checks. Public image source/version labels, parsed SBOM/provenance and actual anonymous pulls passed. The published app also passed twelve isolated real-S3, authentication, permission, board and analytics checks, with successful synthetic-data cleanup.

The extension remains 0.1.64 and direct plugins remain 0.3.1: their public release ZIPs match the previous release byte for byte. The public Chrome Web Store listing showed 0.1.64 on 2026-10-22; installed-client acceptance remains separate. The [direct plugin marketplace](https://github.com/Softinator-TechLabs/feedbacks-plugins/releases/tag/v0.3.1) was updated through its own checked release, with fresh public downloads matching the canonical bundles.

[Public-site deployment](https://github.com/Softinator-TechLabs/feedbacks-oss/actions/runs/39718455174) succeeded at the application source above. The live deployment receipt and 37 public routes passed, covering all sixteen comparison pages and HTML/Markdown guides. Browser readback confirmed the new feature links and Coming soon navigation. Later [stable-installer promotion](guided-docker-install.md) has its own reviewed metadata and publication checks.

The site describes released Kanban, project analytics, subscribed email/templates and ten task adapters. Codex/Claude Code MCP and direct plugins are available. Standalone native Windows, Ubuntu, macOS, Android and iOS clients remain Coming soon without delivery dates. Official directory approval, additional real-provider-account acceptance and native-device acceptance remain separate.
