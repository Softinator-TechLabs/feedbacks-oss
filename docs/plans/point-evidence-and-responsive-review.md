# Point evidence and responsive review

Status: implemented and locally verified. Date: 2026-09-27.

## Intended behavior

Each unsent point retains the original visible screenshot captured before its comment editor opens. Menu state and the original viewport remain reviewable even after scrolling, resizing or closing the menu. These images stay local until explicit Send, alongside optional current-page or full-page screenshots. Point images are separate from the continuous full-page overview and carry matching annotation IDs in asset markings for the web app and MCP.

During review, single-letter M/T/D/W changes viewport, S captures the view, P captures the page, and R stops review. Inputs, contenteditable regions, embedded editors, composition and modified keystrokes never trigger these commands. Chrome's optional shortcut to open the popup retains a modifier because its commands API requires one.

Draft pins follow the original live DOM element while that element remains connected, visible and unobscured. Missing, hidden or offscreen elements are counted in a persistent compact review handle; every point can be opened and edited from its list. Hover/focus opens an actual draft popover with status, text and Edit. No stale coordinate fallback pretends to match a different element.

## Implementation and checks

- [x] Reproduce the hidden draft editor, cross-size anchor and typing behavior in browser/unit tests.
- [x] Repair the drawer and add immediate draft popovers, a compact point list and live element-relative positions.
- [x] Retain local point screenshots in extension storage; carry them into the existing review/redaction/upload flow with correct per-image dimensions and explicit point markings.
- [x] Keep point screenshots out of combined continuous-page images; prevent unrelated markers being projected onto them in the app.
- [x] Update shortcut help and documentation; run focused tests, browser QA and repository checks, then package the extension.

## Failure and compatibility cases

If capture permission or native capture fails, save the text with a visible “No original image” state; never claim a snapshot exists. Cancel/remove/discard must clean up original pixels, including redacted source copies. Upload retry uses the existing idempotent draft flow. Existing annotations without per-point capture metadata continue to render. No migration or new dependency is required; older servers can ignore optional anchor capture metadata, while image markings still link snapshots to point IDs.

## Verification receipt

- `npm run check`: 115 tests passed, 4 explicitly skipped, plus formatting, generated contracts, types, all builds, disposable sandbox smoke and release checks.
- Extension browser acceptance covers original point images, responsive pin positions, draft hover/edit, typing safety, upload retry, separate/combined image markings, per-point decisions on mobile, movable/hidden controls, Options navigation and actual Chrome shortcut settings navigation. Capture fixtures include 44 ordered screenshots.
- A read-only responsive public-site run exercised desktop and mobile menus, retained three original point images after scrolling, uploaded them only to a disposable local server, and captured 19 full-page sections. No production feedback was created.
- Inspected 42 web renders across 1280 px, 1059 px and 390 px widths in both themes. Saved views stay in the filter row, priority precedes the title, website/evidence metadata is visible, member fields fit, and the Help setup action is visible without expanding a disclosure.
- Build 0.1.25 does not add host permissions, dependencies or migrations. Existing extension/API tokens do not gain the new point-status scope; older connections use the web thread until reconnected.

The user's installed Chrome reload, production server deployment and Chrome Web Store publication remain separate release gates.
