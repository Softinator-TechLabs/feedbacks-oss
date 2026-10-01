# Human-led, quiet agent handoffs

Status: source complete; local verification passed. Date: 2026-10-01.

## Outcome and scope

Default Feedbacks agent work to quiet discussion. Use claims/status for coordination and a short final outcome/verification note. Discussion replies are for important blockers, decisions or material findings needing human attention, or explicitly requested updates. Omit routine start, test and PR-created/merged announcements.

Default copied intake to review and discussion in the coding chat: separate confirmed bugs from suggestions, give counts/brief plans and ask for accepted scope before edits or work-state writes. Explicit specific-fix, selected-plan and fix-all requests already authorize the corresponding scope without per-item reconfirmation. New unrelated suggestions still need acceptance.

Preserve testing-readiness notes in copied context and compact start/overview/status receipts. Bound notes to 600 characters and 800 JSON characters, label them untrusted and expose an additive revision/content-version-pinned `workNote` read section for full text. Keep queue and unrelated section envelopes small. Guide short final notes and private client continuation state without introducing deployment credentials or client binding state into public prompts.

## Evidence and approach

The copied [task handoff](../../src/shared/task-handoff.ts) explicitly requested progress/result replies, while the skill and setup guides encouraged reporting in discussion. Align the handoff, MCP server/operation descriptions, copied-task UI and canonical skills/guides. Keep detailed receipts in the coding conversation and repeated MCP server guidance below 1,000 characters while preserving authorization, evidence and claim requirements. Token savings come from avoiding unnecessary reply calls and duplicate milestone content; no measured token percentage is claimed.

## Steps and progress

- [x] Reproduce with failing copied-prompt and actual full/compact MCP discovery regressions.
- [x] Update handoff, descriptions, copied-task labels and canonical guidance.
- [x] Regenerate guides/catalog and verify source/bundled clients, builds and required checks.
- [x] Review the diff and record the final receipt.
- [x] Reproduce four dropped/truncated-note regressions and review-first/full/compact guidance failures.
- [x] Implement human selection defaults, accepted-scope bypass, bounded note projections and full-note continuations.
- [x] Verify follow-up builds, required checks and synthetic desktop/mobile copy/fallback.

## Compatibility and recovery

Domain operation schemas, scopes, permissions and persisted records are unchanged. The agent `thread` section enum gains `workNote`; consumers ignoring new response fields remain compatible. Discussion replies remain available for explicitly requested reporting and important task communication. Older copied prompts explicitly requesting implementation remain subject to narrower current instructions. Guidance cannot force another agent to obey it; installed plugin/server versions may retain earlier text. A server deployment and updated plugin distribution/client reload are needed for live adoption. Deployment is outside this request.

## Completion receipt

- 65 focused tests pass, including actual full/compact MCP instructions/schema discovery and generated guide reads, accepted-scope guidance, copied-task preservation, fresh readiness notes and revision/content-version-pinned full-note recovery. Four note-loss regressions failed before implementation.
- Node 24 `npm run check` passes: formatting, harness/catalog, types, 497 passing tests with 34 optional skips, all builds, disposable sandbox smoke and release checks. Test concurrency was limited to two workers locally.
- Built Codex and Claude packages contain the updated canonical skill. Synthetic desktop/mobile keyboard copies and manual clipboard fallback request human scope selection, preserve explicit fix-all bypass, quiet discussion and the latest readiness note. Review the [desktop copy](../screenshots/quiet-agent-discussion/desktop.png), [mobile copy](../screenshots/quiet-agent-discussion/mobile.png) and [mobile manual fallback](../screenshots/quiet-agent-discussion/mobile-fallback.png). `npm run qa:agent-setup` passes all ten checks with four additional ignored captures.
- Queue and unrelated-section envelopes omit the work note; complete small notes need no extra read. Full notes remain available only through authorized bounded reads, without repeating work history or duplicating response envelopes.
- No domain operation schema, scope, permission or persistence change. The agent section enum gains `workNote`. No routine reply was posted to a real Feedbacks discussion for this work.
- Required CI remains the merge gate. Deployment, plugin distribution/client reload and live adoption remain pending; no live server or installed client behavior is claimed.
