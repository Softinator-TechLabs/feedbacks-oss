# Plan: optional GitHub Issue status sync

Status: implemented locally; mobile and live GitHub verification pending. Owner: Feedbacks maintainers. Date: 2026-09-24.

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
- [ ] Inspect mobile controls; browser viewport emulation was blocked by the browser's security check.

## Compatibility and recovery

Migration 17 adds a per-thread sync cursor; it does not rewrite existing threads. Disabled projects do not poll GitHub. Enabling or re-enabling starts a fresh baseline; existing mismatches pause for a human choice. Disconnect preserves historical Issue links and work history. A timed-out PATCH is not retried automatically, because GitHub may have accepted it. A maintainer inspects GitHub and selects the authoritative side in the thread. There is no GitHub webhook or automatic Issue creation.

## Completion receipt

Source revision: branch commit in the task receipt.
Checks and results: focused GitHub tests, native PostgreSQL test, build, harness/docs check, typecheck, release check and isolated smoke pass. The escalated full suite had 67 pass, one unrelated HTTP/MCP timeout and one opt-in skip; the HTTP/MCP test passed in isolation. Desktop settings inspection and Impeccable detector passed. Mobile viewport inspection remains pending.
Artifacts: generated operation catalog and local build outputs.
Deployment and live verification: not in scope for this branch.
Remaining risks or follow-up: mobile viewport, live GitHub installation credentials, exact-revision CI and deployment are pending.
