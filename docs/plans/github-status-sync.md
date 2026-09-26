# Plan: optional GitHub Issue status sync

Status: merged; mobile layout and live sync/conflict verified; controlled uncertain-write recovery tested. Owner: Feedbacks maintainers. Date: 2026-09-26.

## Outcome and scope

A project maintainer opts into two-way open/closed status sync for verified Issues in the connected repository. Existing manual Issue links, review decisions, discussion response state and Issue creation rules stay separate. Conflicts and uncertain external writes are visible and need a maintainer's choice.

## Evidence and approach

The existing GitHub App creates and verifies Issues and reads their state; `threads.status` owns Feedbacks work history. The new worker reads at most ten eligible threads per pass, uses the previous agreed states to identify which side changed, and pauses when both changed. It requests Issues read tokens for polling and Issues write tokens only for a needed PATCH. A separate project switch defaults off. Human maintainers can explicitly reconcile a paused link from either side. Focused PGlite coverage: `tests/github-status-sync.test.ts`.

## Steps and progress

- [x] Confirm project, verified-link and human permission boundaries.
- [x] Add opt-in state, periodic worker, manual reconciliation and fail-closed external write handling.
- [x] Add focused tests for pull, push, conflict, uncertainty, idempotence and disconnect.
- [x] Expose controls and error state in project settings and thread details.
- [x] Regenerate operation catalog, run local checks and inspect desktop controls.
- [x] Inspect mobile controls in the disposable signed-in app at 390 pixels, in light and dark themes.
- [x] Verify scheduled close and reopen on a synthetic Issue in the connected production repository, then disable sync again.
- [x] Exercise a live two-sided conflict and manual reconciliation on the synthetic case.
- [x] Exercise uncertain external write recovery with controlled fault injection outside production.

## Compatibility and recovery

Migration 17 adds a per-thread sync cursor; it does not rewrite existing threads. Disabled projects do not poll GitHub. Enabling or re-enabling starts a fresh baseline; existing mismatches pause for a human choice. Disconnect preserves historical Issue links and work history. A timed-out PATCH is not retried automatically, because GitHub may have accepted it. A maintainer inspects GitHub and selects the authoritative side in the thread. There is no GitHub webhook or automatic Issue creation.

## Completion receipt

Source revision: PR #44 merged as `1fc1ee1`.
Checks and results: focused GitHub status sync tests passed again on 2026-09-26. The controlled GitHub mock loses a PATCH response, leaves the cursor uncertain, rejects automatic retries, then lets a maintainer read GitHub and restore ready state without issuing another PATCH. The original branch ran native PostgreSQL, build, harness/docs, typecheck and release checks; its unrelated HTTP/MCP timeout passed in isolation. Desktop settings inspection passed. Synthetic app captures covered light and dark mobile views; at 390 pixels the sync checkbox was visible and within the viewport, with no horizontal document overflow.
Artifacts: generated operation catalog and local build outputs.
Deployment and live verification: in the connected production Feedbacks project, a previously linked synthetic Issue and thread began open/open. With project sync temporarily enabled, closing the Issue caused the scheduled worker to resolve the thread; reopening the thread caused the worker to reopen the Issue. Both settled at open/open with the panel reporting Up to date. A second synthetic pass changed both sides from open/open to closed/resolved after the agreed baseline; the worker paused with Needs attention. Selecting GitHub status cleared the conflict. The thread and Issue were restored to open/open, the project switch was turned off, and its disabled state survived a reload. No customer thread or attachment was used.
Remaining risks or follow-up: real network loss cannot be triggered safely on demand in production; the controlled fault-injection test covers the recovery choice. The project continues with automatic status sync off.
