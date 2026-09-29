# Plan: reliable agent task intake and completion

Status: in progress. Date: 2026-09-29.

## Outcome and scope

A developer can copy a specific task and an agent can identify the current member, inspect the correct evidence, discover credential limits, coordinate work and report progress without guessing tool names or confusing a report with the page it reviews. Preserve original operation authorization, current credentials and unrelated work.

## Evidence and approach

The full MCP profile lacks the compact tools named in copied tasks. Server instructions are long enough to multiply discovery cost when clients prefix them to every tool. `auth.me` reports project roles without credential scopes or the member name behind an agent. Permission failures omit the denied operation and recovery. Handoffs include recording instructions even when no recording exists and do not distinguish a reviewed Feedbacks thread from the task being worked. Status alone does not record a claim or a discussion response.

Use existing operations and progressive evidence reads. Add an additive read-only start tool in both profiles, current credential information, actionable structured errors, a scoped activity read and short conditional handoffs. Preserve direct full-profile tool names. Provide explicit opt-in access to captured evidence for newly issued owner keys; never upgrade existing credentials. Clarify reply labels and visible setup copy.

## Steps and progress

- [x] Credential identity/capabilities and error recovery: contracts, server and CLI; real scoped-token tests, including old/revoked keys and owner versus operation scope.
- [x] Consistent MCP discovery and start receipt: compact tools in both profiles, short instructions, bounded same-server reviewed-thread identity, approved instructions and coordination receipts; transport tests.
- [x] Evidence and handoff: scoped activity metadata with pagination, precise report/page/point/reply labels, conditional media instructions and authorized progress reporting; handoff and operation tests.
- [x] Setup/UX/docs: explicit captured-evidence opt-in for new owner keys, reply labels, canonical skill and setup documentation, generated catalogs.
- [ ] Verify focused regressions, required checks, browser states, review diff and deliver through required CI; record deployment and installed-client limits separately.

## Compatibility and recovery

Additive API fields and tools; direct operations remain. No migrations, object-key changes or automatic scope expansion. Existing keys remain restricted and return exact missing scopes. Rollback is a code deployment; no persisted content transformation is required. Thread activity is selected metadata only, never raw diagnostic values, private member notes or historical discussion content. No external issue/message is sent without the user's applicable authorization.

## Verification and review focus

Exercise compact and full MCP clients; denied optional reads must not look like empty data; missing auth.me on old keys must degrade visibly; revoked identity must fail closed. Distinguish same-server thread references from external/lookalike URLs. Test ordinary body-only feedback, no media, unknown recordings and a report about another thread. Do not infer successful uploads or loss from revision counts or absent activity alone. Preserve explicit task authorization while asking only material unanswered questions.

## Completion receipt

Implementation complete; final gates in progress. Focused original regressions: 34/34 passed. HTTP/MCP/handoff compatibility: 19/19 passed after preserving legacy success-schema validation for errors. Full initial suite: 412 passed, 24 skipped, one legacy transport error found and corrected. Browser issuance exposed the old 100-scope cap; the complete evidence preset now has an integration regression. Local baseline: clean worktree at 99a9198; Node 24, committed npm lockfile installed.

## Decisions and verification findings

- Ruling: expose MCP error details as JSON text and metadata, not success structuredContent. The legacy SDK validates structuredContent even for failed calls; preserving the existing success schemas keeps older clients functional. Cost: consumers read the error envelope from content/metadata.
- Ruling: allow up to 256 bounded scope names when issuing keys. The owner preset plus optional evidence reads exceeds the former 100-entry cap; the server still validates every requested scope against its allowlist. Cost: a slightly larger bounded issuance payload, with no extra grant.
- Ruling: optional handoff inventories may be unavailable without blocking task copying. Authentication and unexpected errors still fail; missing inventories are explicitly unknown. Cost: coordination/evidence must be checked later when access is available.
