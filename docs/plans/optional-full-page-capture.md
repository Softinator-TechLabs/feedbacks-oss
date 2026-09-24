# Plan: optional full-page website capture

Status: source complete, Chrome smoke pending. Owner: Feedbacks maintainers. Date: 2026-09-24.

## Outcome and scope

Offer a separate, user-initiated full-page screenshot action in the Chrome extension. Keep visible-area capture as the default. The result stays in the existing local review and redaction flow until the user chooses Send. Do not add a browser permission or change server storage rules.

## Evidence and approach

The current extension calls `captureVisibleTab` once and labels the result as a visible-area screenshot in [extension guidance](../extension.md). Chrome's [Tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs) limits visible-tab captures to two per second. Scroll and stitch a bounded top-level page using the existing active-tab gesture, with one captured tile per page position and a gap over 500 ms between captures. Reject pages that exceed the safe pixel and tile limits or change size while capturing.

## Steps and progress

- [x] Confirm current capture path and Chrome API limit.
- [x] Implement the separate action, scroll restoration, size and stability guards, and a visible-area fallback.
- [x] Add focused geometry, page-change and popup-action tests.
- [ ] Exercise the unpacked extension in Chrome on short, long, sticky and changing pages.
- [x] Update extension guidance and verify the built package.

## Compatibility and recovery

Existing drafts and visible captures continue to work. Failed full-page capture keeps a context-only local draft and offers visible-area retry. The extension returns the page to its previous scroll position even when capture fails. Site-owned sticky elements and lazy-loaded content can cause duplicates or a rejected capture; the reviewer must inspect the image. Publication to Chrome Web Store is a separate release.

## Decision log

- Keep the existing `activeTab` permission and private review flow. Do not request the `debugger` permission for a screenshot convenience feature.
- Bound dimensions before creating an `OffscreenCanvas` and bound encoded bytes before writing the local draft.

## Completion receipt

Source revision: pending.
Checks and results: `npm run check` passed on 2026-09-24; focused geometry and popup-action tests passed. Chrome browser smoke remains pending.
Artifacts: source branch includes extension version 0.1.13; the local build produced a versioned ZIP.
Deployment and live verification, if in scope: not deployed. Store publication is separate.
Remaining risks or follow-up: sticky or lazy content can repeat or shift. Verify in Chrome before a Store submission.
