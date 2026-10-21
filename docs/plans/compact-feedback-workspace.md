# Plan: Compact feedback workspace

Status: complete. Owner: Feedbacks maintainers. Date: 2026-10-21.

## Outcome and scope

Bring the first feedback into the initial viewport by reducing controls above the list. Move personal email preferences and project email configuration to a dedicated Project settings tab. Preserve access for ordinary project readers, saved filters, assignment browsing and selected archive/delete confirmation.

## Evidence and approach

The list currently stacks an email disclosure, a full-width assignment disclosure and a padded filter card below a crowded action header. Keep capture and new feedback visible, group secondary navigation in More, place routine filters and assignment browsing in one wrapping toolbar, and show bulk actions after selection. Keep counts visible beside the heading.

## Steps and progress

- [x] Inspect current controls, settings access and notification persistence.
- [x] Implement the compact layout and email tab with retained drafts.
- [x] Verify desktop/mobile density, keyboard use, reader access, email persistence, filters and archive behavior.
- [x] Update canonical guides and run required local checks.
- [x] Merge through required CI and verify the deployed workspace.

## Compatibility and recovery

No API, permission, migration, Chrome extension or dependency change is required. Each member edits their own email subscription; project provider settings retain maintainer/owner restrictions. Existing saved subscription data is unchanged. Preserve the separate integration provider tabs and their retained drafts; existing `#integrations-email` links open the dedicated Email notifications tab. Reverting the UI restores the former placement.

## Completion receipt

Local verification: `npm run check` passed with 606 tests passing and 56 conditional skips, including builds, isolated smoke and release checks. The two rendered browser suites passed for desktop/mobile layout, keyboard dismissal, reader-owned subscriptions, retained email drafts, saved filters and selected archive behavior. Filter and GitHub settings browser QA also passed. In the synthetic fixture, the first feedback begins at 304px on a 1440px viewport and 469px on a 390px viewport, without horizontal overflow.

Release source: `4a8982e2485faed2937bd866cdbc4da358217475`. [Exact-main CI, attempt 2](https://github.com/Softinator-TechLabs/feedbacks-oss/actions/runs/39629366205/attempts/2) passed all six jobs. The [0.3.0 release](https://github.com/Softinator-TechLabs/feedbacks-oss/releases/tag/v0.3.0) image is deployed; authenticated live readback confirmed the compact feedback list, separate Email notifications tab with its saved project sender, and project Tasks settings. The Pending drilldown returned exactly the displayed count. Existing owner access and configuration were preserved; detailed operational receipts stay private. Store and installed-extension acceptance remain separate from this web-only refinement.
