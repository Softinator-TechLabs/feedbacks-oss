# Plan: modal review and clear project access recovery

Status: in progress. Owner: Feedbacks contributors. Date: 2026-10-14.

## Outcome and scope

Keep right-click comments usable in native modal previews and accessible same-origin frames. Explain general-project fallback when the current connection has no exact-origin project. Reconnection continues to require explicit approval; existing device grants do not expand automatically.

## Evidence and approach

The [browser regression](../../tests/review-modal-browser.test.ts) reproduced an unfocusable comment field when the review root was outside a native modal. Keep the root in the active modal subtree and promote it with a manual popover to preserve viewport geometry through transformed/clipped previews. Follow opening, closing and capture restoration without changing the site's dialog state.

The [project routing check](../../scripts/qa/extension/setup/project-routing.mjs) adds a project after pairing and verifies that the original connection cannot select it. A newly approved connection matches the exact origin and hides the recovery hint. Server authorization and token issuance remain unchanged.

## Steps and progress

- [x] Reproduce native modal inertness before editing.
- [x] Implement overlay placement and general-project recovery guidance.
- [x] Add source and packaged regressions; update canonical guides.
- [ ] Run the complete verification matrix, review and merge with required CI.
- [ ] Publish and verify the versioned extension artifact.

## Compatibility and recovery

Extension version 0.1.60; no new dependency, browser permission, API contract or migration. Existing project snapshots remain valid until explicitly replaced. GitHub ZIP delivery, Store publication and installed Chrome acceptance are separate gates. Retain the previous package; a Store rollback requires a newer version number.

## Decision log

- Use existing popover and dialog browser primitives; do not add another modal or change website dialog state.
- Reconnect through the existing approved pairing flow rather than silently widening device access.

## Completion receipt

Source revision and checks: pending.
Artifacts: pending.
Store publication and reporter-installed Chrome proof: pending.
