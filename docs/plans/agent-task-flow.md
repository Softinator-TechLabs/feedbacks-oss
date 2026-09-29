# Plan: reliable agent task intake and completion

Status: implemented; delivery gates tracked in [PR #150](https://github.com/Softinator-TechLabs/feedbacks-oss/pull/150). Date: 2026-09-29.

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

## Independent review

One Important finding: the final JSON CLI serializer discarded HTTP scope details. A real CLI subprocess regression failed with missing details before the fix; the serializer now retains them. The CLI help entry is updated with the supported start command as part of the same CLI integration repair. No authorization or data-access blockers were found. Production/client installation and ongoing CI were explicitly outside the read-only review; deployment and client limitations remain separate gates. A mobile screenshot exposed a clipped copied-task tooltip; a scoped positioning correction passed the final desktop/mobile browser run.

## Final local receipt

Node 24 check matrix passed: formatting, harness/docs generation, type checks, 414 tests passed with 24 opt-in browser/native skips, all builds, isolated smoke and release validation. The test phase used concurrency 4 after an unbounded local run encountered an ECONNRESET; required CI retains the standard commands and native PostgreSQL/browser jobs. The independent-review CLI regression passed red-to-green. Synthetic browser checks passed for desktop/mobile, keyboard evidence selection, actual issued scopes, disabled issued state, optional-read failure and copied intent; screenshots were inspected and the tooltip correction confirmed. The latest concurrent main UI changes were merged without conflict and the integration receives another browser/type check. Exact-revision CI, deployment and live receipts belong to the linked PR rather than being inferred from this source receipt.

## Setup follow-up: separate credential handoff

Supersedes the earlier easy-setup evidence opt-in: newly issued easy-setup owner keys include the evidence-read preset. Detailed scope choices remain in Account's Advanced setup; existing keys are not upgraded. Help and Account now share two handoffs: recommended prompt without the key plus a later local clipboard import, and an explicitly warned one-click prompt with the key. Both reuse the immutable issuance, including after clipboard denial. Secret textareas are mounted only on deliberate reveal. The prompt prefers supported native private client configuration, verifies OS-specific clipboard access and prohibits echoing imported credentials. Training opt-out is not represented as a no-storage guarantee.

Verification: synthetic browser acceptance covers default evidence scopes, both initial creation paths, retry without duplicate keys, hidden-secret controls, Account instruction-load failure/retry, mobile layout and keyboard activation. The prompt regression failed with the old secret-bearing default and passes with explicit quick mode. Run `npm run qa:agent-setup` after building; screenshots use the disposable harness only.

## Setup follow-up: minimal visual flow

Replace default-view paragraphs with prompt/key illustrations, short scope labels and direct copy actions. Keep the Recommended badge on local key handoff and highlight the Quick setup button. Move explanations and manual recovery into collapsed help; clipboard failure opens it automatically. Simplify extension and project readiness copy without changing permissions or connection behavior. Verification uses the existing synthetic desktop/mobile acceptance, build/type checks and required CI.

## Compact task intake follow-up

Reduce copied tasks to bounded text previews and current IDs/revision. Remove eager assignment/recording inventory reads during copying. Keep fresh MCP identity, guidance and coordination, while routing diagnostic/recording bundles and member-context reads to actual task questions. The reusable skill entrypoint routes specialized details to existing references. Verify prompt size with large/control-character fixtures, preserve closed/removed point states and quoted evidence, and confirm start does not fetch diagnostic/media content even when all scopes are allowed.

Local verification: Node 24 check matrix passed (412 tests, 24 opt-in skips), including compact/full MCP discovery with the existing sub-1,000-character instruction gate. Six handoff regressions cover compact size, incomplete text, quoting, escaping and effective states; four failed against the old implementation. Synthetic Setup acceptance passed all ten checks, with desktop/mobile whole-page and handoff screenshots inspected. The example handoff shrank from 5,395 to 1,548 characters; the skill entrypoint from 1,802 to 684 words. A narrow independent scenario check confirmed a label fix skips unrelated evidence and profiles, while a save failure uses bounded diagnostic reads. Required CI and deployment remain separate delivery gates.
