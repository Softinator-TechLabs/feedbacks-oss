# Status filters and recovery

Status: completed locally; required CI remains the PR gate. Date: 2026-10-01.

## Outcome and scope

Make closed feedback discoverable and preserve a recovery path when a row's status change removes it from the current list. Keep resolution authorization in the server.

## Evidence and approach

The existing list offers exact terminal status filters but lacks combined Closed filtering. Its immediate row update checks only the default active view and offers no link or undo after removal. Use the shared review contract for a derived Closed filter and retain the saved thread revision for undo.

## Steps and progress

- [x] Inspect the status selectors, list predicate and current filter behavior.
- [x] Add combined Closed filtering, explicit permission labels and recovery actions.
- [x] Verify exact filters, navigation, saved views, stale undo, keyboard and desktop/mobile layout with synthetic data.
- [x] Update canonical documentation and generated contracts; run the full check.

## Compatibility and recovery

`workState=closed` is an additive read filter for Resolved and Declined; it is not a writable thread state. Existing filters, stored states and permissions retain their meaning. No migration or new dependency is required. Undo records a normal authorized status update and uses optimistic concurrency. Deployment is outside this task's scope.

## Completion receipt

Source: `codex/feedback-status-recovery`, based on `43585bc`.

Verification: the Closed regression fails against the original contract and passes with the change. `npm run check` passed with 496 tests passed, 34 skipped and zero failures; test workers were capped at two. `npm run qa:app-filters` covers five exact statuses, Closed filtering and reload, keeping rows within Closed, recovery in exact/default views, keyboard undo, earlier note/duplicate restoration, stale undo rejection, and reviewer permission controls. Synthetic desktop/mobile captures are written under ignored `output/playwright/`; both layouts were visually inspected. The Impeccable detector reported no findings.

No deployment or authenticated production acceptance was performed. The historical missing thread has not been identified or recovered.
