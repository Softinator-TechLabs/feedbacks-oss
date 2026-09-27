# Review defaults and accessible page controls

Status: implemented and locally verified; required CI and deployment pending. Owner: Codex. Date: 2026-09-27.

## Outcome and approach

Keep reusable defaults in Settings while page controls override the current review. Group navigation, highlighting and click indicators compactly; expose pins, resolved points, page threads and local diagnostics. Make Full page and Record video visible in the popup with a short processing-cost note. Add a visible drag grip and movement hint. Refresh public landing and comparison coverage using synthetic examples and source-verified claims. Existing permissions and explicit diagnostic sharing remain unchanged.

## Steps and progress

- [x] Inspect settings, content controls, session activation and diagnostic routing.
- [x] Add validated persistent review/recording defaults and serialized saves.
- [x] Add page diagnostics and prefiltered page threads; simplify popup access.
- [x] Update canonical extension guides and behavioral regression checks.
- [x] Refresh landing content and 36-capability comparison tables; exclude private references.
- [ ] Complete browser and desktop/mobile layout verification, required CI and release.

## Compatibility and recovery

Missing preferences use current defaults. Defaults apply to new reviews, not an already running review. Recording restores previous session controls. No permission, API or database migration changes. Page actions are bound to the sender’s active project session; they cannot select another tab/server. Existing drafts and connections survive an unpacked reload.

## Verification

Unit coverage validates defaults, partial updates and rejected values. Browser checks exercise Settings persistence, current-session preservation, new-review application, simultaneous saves, page diagnostics and page-thread routing. Node 22 full check passed (134 tests, 4 skipped), as did release checks, screenshot editor browser coverage and desktop/mobile layout checks. A focused browser regression verifies project switching during recording; the full extension browser suite and required CI are release gates.
