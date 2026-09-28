# Context-efficient agent workflow

Status: implemented; local verification complete. Date: 2026-09-28.

## Outcome and scope

A newly connected coding assistant can discover related projects from repository URLs and page origins, shortlist hundreds of Feedbacks threads, inspect one task's complete evidence progressively, and process authorized work with explicit point and thread decisions. The setup prompt installs a reusable, secret-free skill for future chats. Existing HTTP operations, scopes and full MCP clients remain compatible.

## Evidence and approach

The existing plugin contains a short review skill, but the Help setup prompt installs only a connection. MCP exposes the entire business catalog and returns only a completion sentence to clients that ignore structured content. `threads.list` returns full discussions/assets despite its summary description. Project repository/origin metadata, priority ordering, annotations, native image previews, revisions and permissions already exist.

Use an optional compact MCP profile with seven purposeful tools: guide, workspace, queue, thread, asset, describe and execute. A shared adapter also powers CLI `--agent` commands. It delegates every data operation to the existing authorization layer. No new token scopes, dependencies, migrations, auto-mutating hooks or hidden account writes. Full operation discovery remains available at the existing endpoint.

Only matching repository URLs/exact origins establish strong project candidates; names are weak hints and multiple matches require a choice. Queue pages contain bounded previews and counts, never full discussion. Thread sections carry revision, a SHA-256 content version and explicit continuation; changed revisions or independently updated section data reject continued reads. Legacy single-anchor pins remain explicit without invented IDs. Large text is sliced explicitly rather than silently dropped. Screenshot crops use original pixel coordinates and preserve preview/source dimensions. Videos remain authenticated original media; agents must use an available media tool or disclose that playback was not inspected.

The skill distinguishes Feedbacks issues/threads from external tracker issues and pins/points from parent threads. It supports read-only triage, sequential execution, task-size choice, current status checks, in-progress before authorized implementation, evidence, partial point completion, and final readback. Likes remain anonymous aggregates; no voter identities or private notes are exposed.

## Steps and verification

- [x] Add failing compact-adapter tests: no-context matching, ambiguous projects, paginated queue, all thread sections, stale revision, bounded text, permission failure and structured/text parity.
- [x] Implement shared compact adapter, MCP profile/server instructions/resources/prompt, and CLI parity. Preserve full mode.
- [x] Add original-coordinate image crops, native image blocks and crop validation tests.
- [x] Expand portable skill with glossary, media and workflow references; serve the same version over MCP, package deterministic local installation, and update the setup prompt.
- [x] Add SDK transport/setup/package regressions and synthetic high-volume acceptance evidence. Record payload sizes.
- [x] Update canonical guides and generated docs; run full `npm run check`, review and resolve findings.

## Compatibility and recovery

`/mcp` remains full mode; `/mcp?profile=compact` selects compact mode. Stdio uses `FEEDBACKS_MCP_PROFILE=compact`; unset remains full. Existing scoped keys still enforce their original underlying operations. No implicit fallback from denied priority policy to a misleading priority claim. CLI and MCP share workflows, not duplicated authorization. Remove the profile parameter/environment variable to return to full discovery. Installed skill updates refuse unrelated existing content unless replacement is explicitly selected.

## Sources checked

Official guidance checked 2026-09-28: [Codex skills](https://learn.chatgpt.com/docs/build-skills), [OpenAI MCP-backed skills](https://developers.openai.com/plugins/build/skills), [Claude MCP](https://code.claude.com/docs/en/mcp), [Claude skills](https://code.claude.com/docs/en/skills), [Antigravity skills](https://www.antigravity.google/docs/skills?tab=ide). Skills use progressive disclosure; server instructions stay below Claude's documented default truncation boundary. MCP does not automatically install a local skill or grant future business authorization. Client-specific paths and reload behavior must be checked on the actual client.

## Completion receipt

Implemented the compact adapter, both MCP profiles, shared CLI mode, original-pixel image crops, author/date/status/point-text filtering, portable skill and installer, Help setup handoff, documentation and regression coverage.

Node 22.23.3: `npm run check` passed, including typecheck, 147 passing tests, builds, synthetic sandbox smoke and release/source checks. Four tests were skipped: native PostgreSQL concurrency and three opt-in Chromium rendering cases. Independent review found and verified fixes for full-profile image schema compatibility, legacy pin counts and independently changing section continuations; focused re-review passed.

SDK tool catalog measurement: 78 full tools / 298,885 JSON bytes versus 7 compact tools / 9,795 bytes (about 97% reduction). A real synthetic database with 503 threads returned a ten-item queue in 7,529 bytes versus 119,264 for full records (94% reduction), and all 503 IDs were covered without duplication. These are fixture-specific JSON sizes, not measured model-token usage or universal performance claims.

Artifact: `dist/feedbacks-codex-plugin.zip`, including the adapter, five skill files, installer and license notices. CLI, authenticated remote MCP, source stdio and bundled stdio were exercised. Installer verification used an isolated temporary directory, not the user's client settings.

Real small-model success rates, Codex/Claude/Antigravity fresh-chat installation, CI, deployment and live behavior of the new workflow require separate evidence. No production feedback was mutated, and no auto-mutating hooks were installed.

## Context management extension (authorized 2026-09-28)

Add separate revisioned member profiles, collaborative project context and project responsibilities. Members may edit their own profile and their responsibilities in writable projects; project writers may maintain collaborative context. Owners manage profiles; maintainers manage project responsibilities. These advisory texts never alter policy, grants or approved instructions. Preserve existing token scopes. Add a second focused skill and deterministic two-skill installation with opt-in task triggers. Verify authorization, stale writes, provenance, fresh transport/package behavior, CI and deployed MCP. Populate organization-specific content only through authenticated production MCP after deployment; never commit it. Merge and deploy after the required gates.

Extension verification: full local `npm run check` on Node 22.23.3 passed (148 passing tests, four existing optional skips), including migration 19, all builds, packaged skills, isolated smoke and release checks. Independent review found a missing ordinary `auth.me` scope; the explicit allowlist and scoped-key regression were corrected. Focused context/MCP/installer tests (5/5), typecheck and harness checks passed afterward. Both skills remain request-driven. Stable MCP SDK was updated to 1.30.1; modern-only 2026-07-28 protocol support is explicitly not claimed. Deployment and actual per-client fresh-chat activation remain separate gates.
