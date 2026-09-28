# Delegated assignments and visible triage

## Requested outcome

Developers can assign a Feedbacks thread or selected points to another project member from the web UI or their own agent. Both surfaces show the same durable assignee, scope, category/tags, GitHub decision and attributable change history. Human task selection remains authoritative. Existing leased self-claims describe an agent currently working; they do not replace durable assignment.

## Design and boundaries

Add durable delegation records and append-only history alongside work_claims. Project writers may assign to active writable project members (including organization owners); viewers, outsiders and out-of-scope tokens cannot. Reassign/cancel require current revisions. Reject overlapping active delegation scopes rather than silently replacing someone else's work. Claims must respect active delegated ownership, while disjoint points remain independently workable. Record authenticated initiating user and agent separately; never accept forged attribution. Closed/removed points and closed threads cannot receive new work.

Each assignment has a concise summary, category, tags, and explicit GitHub decision (undecided, create issue, not needed, already linked), with a reason. This is triage metadata, never permission to create an external issue. Existing github.issueCreate and repository routing remain authoritative. UI retains existing GitHub preview/create flow and shows decision next to assignments. Skills require reviewing evidence and proposing category/GitHub choice before an authorized assignment; uncertain decisions remain explicit.

## Implementation tasks

1. Backend/contracts: additive migration, bounded list/history APIs, create/reassign/cancel with optimistic concurrency and idempotency, attribution, membership and overlap checks, claim compatibility. Regression and native PostgreSQL concurrency tests.
2. Web: discoverable Assign work action and visible assignment summary; whole-thread/selected-point form, assignee/category/tags/GitHub decision; reassign/cancel/history, current worker claims. Preserve drafts on failure, keyboard and mobile support. Synthetic browser verification.
3. Skills/docs: exact operation schemas through compact discovery, requested delegation and triage, separate GitHub approval, scope-aware recovery; regenerate catalog. Final independent review, full check, PR/main/CI/deploy/live proof.

## Verification and progress

- [x] Backend and denied/stale/concurrent mutation checks
- [x] Web manual/MCP parity and desktop/mobile QA
- [x] Skills/docs, full check, independent review
- [ ] Merge, CI, deploy and live read verification

No production feedback assignments or GitHub issues will be created merely for verification. Synthetic fixtures stay isolated; private team content stays outside this public plan.

## Verification receipt

Node 22 full `npm run check` passed: 160 tests passed, four optional tests skipped, typecheck, builds, generated docs, disposable smoke and public-source release checks. Native PostgreSQL checks separately passed including migration 21, overlapping assignment creation, concurrent reassignment and immutable history. The native test exposed a pre-existing cursor text-alias sort; `ORDER BY events.cursor` preserves numeric delivery order past event 9.

Synthetic browser checks at desktop and 390px mobile verified visible ownership, manual selected-point assignment, reassignment preserving the original recipient, history, keyboard focus and member-filtered project browsing. An actual MCP-created assignment appeared in the web UI; manual web updates read back through MCP with matching history. A create-issue triage decision did not create an external issue. Independent review found two stale-draft recovery issues; both were corrected and re-reviewed. Design detection returned only advisory findings; incumbent typography was preserved. Production feedback was not changed for verification.

The Help handoff requires actual client/skill discovery and bounded read checks, with explicit restart/reconnect steps if unavailable. This release does not certify employee-machine fresh-chat installation. Release CI, merge and deployment remain separate gates recorded in the PR/task receipt.
