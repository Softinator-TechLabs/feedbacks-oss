# Quiet agent discussion

Status: source complete; local verification passed. Date: 2026-10-01.

## Outcome and scope

Default Feedbacks agent work to quiet discussion. Use claims/status for coordination and a short final outcome/verification note. Discussion replies are for important blockers, decisions or material findings needing human attention, or explicitly requested updates. Omit routine start, test and PR-created/merged announcements.

## Evidence and approach

The copied [task handoff](../../src/shared/task-handoff.ts) explicitly requested progress/result replies, while the skill and setup guides encouraged reporting in discussion. Align the handoff, MCP server/operation descriptions, copied-task UI and canonical skills/guides. Keep detailed receipts in the coding conversation and repeated MCP server guidance below 1,000 characters while preserving authorization, evidence and claim requirements. Token savings come from avoiding unnecessary reply calls and duplicate milestone content; no measured token percentage is claimed.

## Steps and progress

- [x] Reproduce with failing copied-prompt and actual full/compact MCP discovery regressions.
- [x] Update handoff, descriptions, copied-task labels and canonical guidance.
- [x] Regenerate guides/catalog and verify source/bundled clients, builds and required checks.
- [x] Review the diff and record the final receipt.

## Compatibility and recovery

No operation schemas, scopes, permissions or persisted records change. Discussion replies remain available for explicitly requested reporting and important task communication. Guidance cannot force another agent to obey it; existing copied prompts and installed plugin/server versions may retain earlier text. A server deployment and updated plugin distribution/client reload are needed for live adoption. Deployment is outside this request.

## Completion receipt

- 59 focused tests pass, including copied-task regressions and actual full/compact MCP instructions, discovered reply descriptions and guide-resource reads.
- Node 24 `npm run check` passes: formatting, harness/catalog, types, 493 passing tests with 34 optional skips, all builds, disposable sandbox smoke and release checks. The first full run hit a native V8/PGlite teardown failure; both discussion tests passed separately and the complete rerun passed.
- Built Codex and Claude packages contain the updated canonical skill. Synthetic desktop/mobile keyboard copies and manual clipboard fallback preserve quiet policy, outcome-note guidance and team discussion evidence. Review the [desktop copy](../screenshots/quiet-agent-discussion/desktop.png), [mobile copy](../screenshots/quiet-agent-discussion/mobile.png) and [mobile manual fallback](../screenshots/quiet-agent-discussion/mobile-fallback.png) captures. `npm run qa:agent-setup` passes all ten checks with four additional ignored captures.
- No operation schema, scope, authorization or persistence change. No routine reply was posted to a real Feedbacks discussion for this work.
- Required CI remains the merge gate. Deployment, plugin distribution/client reload and live adoption remain pending; no live server or installed client behavior is claimed.
