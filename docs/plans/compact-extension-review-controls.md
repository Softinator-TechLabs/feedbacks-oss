# Compact extension review controls

Status: implemented locally; CI pending. Owner: Feedbacks extension. Date: 2026-09-29.

## Outcome and scope

Make the connected Chrome popup and on-page Page Controls calm and quick to scan. Keep screenshot capture and a single video-plus-session action clear. Move team counts, shortcut guidance and less common review settings behind labeled disclosures. Replace cryptic viewport letters with labeled icons, and omit raw screen dimensions from the panel. Preserve every existing review capability, recording mode and keyboard route.

## Evidence and approach

The supplied 0.1.40 screenshots show repeated headings, three capture buttons wrapping in the popup, a full row of width controls, oversized team and shortcut sections, and a Page Controls panel dominated by settings. Source confirms the popup exposes separate `record-video` and `record-session` actions while the panel's video action already records session context. Keep the existing backend routes; simplify the controls and maintain accessible names, tooltips and focus states for icon buttons.

## Steps and progress

- [x] Inspect supplied screenshots, current source and extension guidance; define acceptance criteria.
- [x] Add focused regression checks for the single popup recording action, compact disclosure structure and panel metadata.
- [x] Implement the two compact surfaces with consistent icons and state labels.
- [x] Update the canonical extension guide, inspect light/dark and compact browser captures, and run appropriate checks.

## Compatibility and recovery

No schema, permission or server API change. Session-only recording remains available through Page Controls → Recording options. Existing review defaults and recording choices stay stored as before. Reverting the extension package restores the old layout without data migration.

## Decision log

- One popup recording action starts the existing video route, which includes session context; the separate session-only route stays available on the page.
- Scope and count filters remain available under Team feedback, with the thread count visible in the summary.
- Icon-only actions keep an accessible name and tooltip; primary actions keep visible text.

## Completion receipt

Source revision: `codex/simplify-review-controls`, based on `0a363068`.
Checks and results: `npm run check` passed; `npm run qa:extension-browser` passed; focused popup tests passed 13/13 and Page Controls browser tests passed 2/2. Light and dark screenshots were inspected for both surfaces.
Artifacts: local extension 0.1.40 ZIP, SHA-256 `52d02589fc69dbdf362619ba2237d1c8768adf5bd2ed899a5d5eca40ad95436e`; ignored synthetic screenshots under `.local/remaining-todos-qa/` and `.local/review-controls-qa/`.
Deployment and live verification: not requested; not performed.
Remaining risks or follow-up: required CI and native installed Chrome/Store acceptance remain unverified.
