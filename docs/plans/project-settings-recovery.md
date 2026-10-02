# Plan: Clear project drafts and recoverable image review

Status: implementation verified. Date: 2026-10-02.

## Outcome and scope

Show that category and tag changes remain drafts until saved. Recover a failed
GitHub connection read with an explicit retry and truthful loading/error states.
Dismiss screenshot review with a click on the backdrop, preserving normal image
interaction and preventing dismissal during a save.

## Evidence and approach

Use the existing taxonomy save operation and image review dialog. No new API,
dependency, permission or automatic GitHub connection is needed. Extend
[GitHub browser QA](../../scripts/github-apps-browser-qa.mjs) to check maintainer
save/reopen behavior and recovery from a non-JSON response. Extend
[image review tests](../../tests/evidence-viewer-browser.test.ts) for backdrop
gestures, focus return and save protection.

## Steps and progress

- [x] Inspect existing controls and establish acceptance criteria.
- [x] Implement draft guidance, read retry and backdrop dismissal.
- [x] Verify saved values after leaving and reopening settings.
- [x] Verify desktop/mobile and keyboard behavior, then run the full quality gate.

## Compatibility and recovery

Existing category IDs, taxonomy revisions, private image objects and permission
checks stay in place. Reverting the UI changes requires no migration. Drafts stay
local until the existing save action succeeds; failed saves preserve the draft.

## Completion receipt

Verified on Node 24: all stages of `npm run check`, with the test stage run directly
using `--test-concurrency=2`; 8 image review browser tests and the GitHub Apps
browser acceptance script. Browser acceptance proves category save/reopen/filter,
save protection, maintainer access, GitHub error/retry and the no-App state.
Desktop/mobile screenshots were inspected; the UI detector returned no findings.

Required CI, merge and deployment remain delivery gates. Deployment evidence stays
in the operator receipt outside tracked source. These UI recovery changes do not
establish the cause of a historical network interruption.
