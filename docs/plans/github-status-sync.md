# Plan: optional GitHub Issue status sync

Status: merged; mobile layout inspected, live GitHub verification pending. Owner: Feedbacks maintainers. Date: 2026-09-26.

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

## Compatibility and recovery

Migration 17 adds a per-thread sync cursor; it does not rewrite existing threads. Disabled projects do not poll GitHub. Enabling or re-enabling starts a fresh baseline; existing mismatches pause for a human choice. Disconnect preserves historical Issue links and work history. A timed-out PATCH is not retried automatically, because GitHub may have accepted it. A maintainer inspects GitHub and selects the authoritative side in the thread. There is no GitHub webhook or automatic Issue creation.

## Completion receipt

Source revision: PR #44 merged as `1fc1ee1`.
Checks and results: focused GitHub status sync tests passed again on 2026-09-25. The original branch ran native PostgreSQL, build, harness/docs, typecheck and release checks; its unrelated HTTP/MCP timeout passed in isolation. Desktop settings inspection passed. On 2026-09-26, synthetic app captures covered light and dark mobile views; at 390 pixels the sync checkbox was visible and within the viewport, with no horizontal document overflow.
Artifacts: generated operation catalog and local build outputs.
Deployment and live verification: source merged into the deployed app; a real connected GitHub repository has not been exercised.
Remaining risks or follow-up: verify live polling, conflict and external write recovery against an authorized test repository.
