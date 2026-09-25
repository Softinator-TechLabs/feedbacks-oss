# Plan: compact saved views and explicit top priority

Status: complete. Owner: Feedbacks maintainers. Date: 2026-09-25.

## Outcome and scope

The project feedback list keeps saved views in one compact control below the filters. A maintainer can mark or unmark a thread as top priority from its row with one action. The existing Top priority sort shows marked active threads first, then uses the existing reviewer-importance and view-support score. The same order applies to list pagination and thread navigation.

## Evidence and approach

The current list gives saved views a full-width row and offers a priority sort without a way to prioritize an individual thread. The saved-view form already has its own operations. Thread state, permissions and revision checks live in shared contracts and server operations; the list and MCP clients consume the same domain data.

## Steps and progress

- [x] Identify the two browser annotations and inspect the existing list, saved-view and priority paths.
- [x] Move saved views into an accessible compact popover without losing apply, save or remove actions.
- [x] Persist an explicit thread priority flag with authorization, revision handling and audit evidence.
- [x] Put a one-click priority control on each maintainer row and keep the priority sort consistent with navigation.
- [x] Run focused and full checks and inspect desktop/mobile states.
- [x] Merge with required CI and verify the deployed application.

## Compatibility and recovery

Older threads without the flag remain ordinary priority. No database migration is required for JSON thread data. Reversing the flag must preserve the thread and its other fields. Deployment and rollback must keep the existing data readable.

## Decision log

- Use one explicit per-thread flag rather than changing the computed score. This gives the team an understandable override while retaining the existing order for unmarked threads.
- Keep saved views as personal filters; the compact control does not change their scope or data model.

## Completion receipt

Source revisions: PR #57 merged as `5c21cd7`; the dark-theme icon refinement in PR #58 merged as `cf0da7b`.
Checks and results: Node 24 `npm run check` passed (92 tests, 4 skipped); native PostgreSQL cursor test passed. Synthetic browser checks at 1440px and 390px showed stable saved-view menu layout and a persistent priority star, with no horizontal overflow. PR #58 passed Node 22/24, container and secret CI checks; its focused format, type and web-build checks passed locally.
Artifacts: compact saved-view control, row-level priority operation and icon refinement.
Deployment and live verification: `.org/healthz` returned 200. The served `index-C4KHZZkc.js` and `index-A1LqIRh0.css` matched the local merged build byte-for-byte. A refreshed signed-in Journals Press list at `?sort=priority` showed the bookmark below the filters, one priority star per row and the borderless dark-theme icon state.
Remaining risks or follow-up: Chrome Web Store review/publication is separate from this app-only change and does not require a new extension payload. The public listing still served 0.1.11 during this check; uploaded 0.1.15 is not yet proven published.
