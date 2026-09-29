# Consistent browser select arrows

Status: implemented; required CI is the merge gate. Owner: Feedbacks UI. Date: 2026-09-29.

## Outcome and scope

Give dropdown arrows a consistent inset from the right edge across the Feedbacks web application, extension pages and on-page review controls. Keep native select semantics, keyboard operation, sizing and light/dark contrast. Small controls must show their selected text without clipping.

## Evidence and approach

The supplied screenshot shows native Chromium arrows almost touching the right border in the screenshot editor. The web app's `forms.css` and extension's `appearance.css` style select boxes but leave the arrow to the browser. Several local selectors then reset the background or right padding. Use one chevron treatment per browser styling root and retain each surface's existing colors. Check every local select override against the shared inset.

## Steps and progress

- [x] Trace the common styles and local select overrides from the reported editor state.
- [x] Apply a consistent arrow inset across web, extension pages and injected controls.
- [x] Inspect light/dark and wide/compact controls in rendered browser states; retain disabled styling and the native arrow in forced-colors mode.
- [x] Run focused browser checks and the full repository check. Required exact-revision CI remains the PR merge gate.

## Compatibility and recovery

Presentation only. Select values, permissions, server operations and stored data remain unchanged. Reverting these styles restores browser-native arrows without migration.

## Decision log

- Keep actual `select` elements for keyboard and mobile behavior; only their visual arrow and spacing change.
- Restore native arrows in forced-colors mode so the operating system controls contrast.

## Completion receipt

Source revision: see the associated pull request; based on merged `1d550aa`.
Checks and results: `npm run check`, packaged screenshot editor QA, packaged extension browser QA, synthetic Store capture and web app light/dark desktop/mobile render passed. Computed select styles in the web app, extension page and injected controls showed a 12px chevron inset in light/dark themes and the native arrow in forced-colors mode.
Artifacts: synthetic local browser captures under ignored `.local/select-chevron-qa/` and `dist/store-submission/screenshots/`.
Deployment and live verification: source and package work only; Store submission is separate.
Remaining risks or follow-up: confirm exact PR CI before merge, then rebuild the Store bundle from merged `main`.
