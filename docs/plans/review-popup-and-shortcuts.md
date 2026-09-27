# Review controls and draft points

Status: implemented and locally verified. Date: 2026-09-27.

The 0.1.24 shortcut design below is superseded by [point evidence and responsive review](point-evidence-and-responsive-review.md), which restores single-letter shortcuts during review and preserves per-point original views.

## Outcome

The popup presents review state, a visible stop control, capture actions, and discoverable shortcuts without scrolling for the main actions. Typing in any webpage editor cannot trigger viewport shortcuts. Unsent points visibly differ from published points and can be edited from their marker. Hovering a page element during review highlights it before selection.

## Work

- [x] Reproduce shortcut capture and draft marker/popup behavior in focused tests.
- [x] Replace bare-letter viewport shortcuts with modified keys; add Chrome commands for review and capture.
- [x] Make draft pins interactive with local-state tooltip and edit action; add live element hover highlight.
- [x] Reorganize the popup around review on/off, capture, viewport size, and shortcut discovery.
- [x] Verify keyboard, popup, review, capture, and draft flows in the browser; package a development build.

## Boundaries

Draft comments stay local until the user reviews and sends a screenshot. The extension never uploads page data merely because site permission was granted. Published point styling and its thread link stay distinct from local draft points.

## Verification

`npm run check` passed with 111 tests passing and 4 skipped; server, web, documentation and extension builds, sandbox smoke and release checks passed. `npm run qa:extension-browser` passed after the final review-state changes, covering live hover, pin editing, typing `t` in a comment, review off/on draft restoration, optional all-site access without automatic review, upload retry and full-page captures. The popup render was checked at 368 px width with its primary actions visible without scrolling. Chrome Web Store publication and the user's Chrome install are separate steps.

Extension 0.1.24 was copied to an unpacked Downloads folder and ZIP. The unpacked folder matches source, the ZIP passes its integrity check, and its SHA-256 is `e1b3f447edc1edfd3a7ff4a339b05c790a3d94945bd61ab1fa28bb75a5e4deab`.
