# Plan: Compact feedback workspace

Status: in progress. Owner: Feedbacks maintainers. Date: 2026-10-21.

## Outcome and scope

Bring the first feedback into the initial viewport by reducing controls above the list. Move personal email preferences and project email configuration to a dedicated Project settings tab. Preserve access for ordinary project readers, saved filters, assignment browsing and selected archive/delete confirmation.

## Evidence and approach

The list currently stacks an email disclosure, a full-width assignment disclosure and a padded filter card below a crowded action header. Keep capture and new feedback visible, group secondary navigation in More, place routine filters and assignment browsing in one wrapping toolbar, and show bulk actions after selection. Keep counts visible beside the heading.

## Steps and progress

- [x] Inspect current controls, settings access and notification persistence.
- [x] Implement the compact layout and email tab with retained drafts.
- [x] Verify desktop/mobile density, keyboard use, reader access, email persistence, filters and archive behavior.
- [x] Update canonical guides and run required local checks.
- [ ] Merge through required CI and verify the deployed workspace.

## Compatibility and recovery

No API, permission, migration, Chrome extension or dependency change is required. Each member edits their own email subscription; project provider settings retain maintainer/owner restrictions. Existing saved subscription data is unchanged. Reverting the UI restores the former placement.

## Completion receipt

Local verification: `npm run check` passed with 606 tests passing and 56 conditional skips, including builds, isolated smoke and release checks. The two rendered browser suites passed for desktop/mobile layout, keyboard dismissal, reader-owned subscriptions, retained email drafts, saved filters and selected archive behavior. Filter and GitHub settings browser QA also passed. In the synthetic fixture, the first feedback begins at 304px on a 1440px viewport and 469px on a 390px viewport, without horizontal overflow.

Merge and deployment remain pending. Store and installed-extension acceptance are unaffected by this web-only refinement.
