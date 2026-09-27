# Annotation status and page overview

Status: implemented and locally verified. Date: 2026-09-27.

## Behavior

Published points have independent open/resolved/removed states. Resolving a point leaves its thread open. Resolving or declining a thread hides all its points without overwriting their individual states; reopening restores those states. Maintainers may remove and restore individual points. Removal is reversible and preserves the original note, screenshot and audit record. Draft removal remains local.

The extension popup shows open and closed thread counts, open and resolved point counts, and links to the configured server with the selected project and filters already applied. Scopes are the exact normalized page, its exact hostname, or the page at the current mobile/tablet/desktop capture size. Counts include every matching thread, independent of list pagination. Hidden/removed points are excluded from active counts. Declined threads count as closed, not resolved.

## Implementation

- [x] Add `threads.annotationStatus` with revision checks, resolve permission, maintainer-only removal/restoration, audit events and optional server-owned `annotationStates`. Existing captures and exports remain readable; no database migration. Old tokens gain no scopes automatically.
- [x] Extend `threads.list` with opt-in aggregate `summary`, using the existing project and URL/hostname/device filters; verify counts beyond one page and authorization isolation.
- [x] Add per-point status and controls to the responsive evidence view and published pin popover. Keep completed and removed points available in the thread. Older extension tokens open the thread for point actions.
- [x] Add compact popup scope/count/link controls and matching thread-list summary. Do not expose an arbitrary server or project supplied by a webpage.
- [x] Verify two-member permissions, stale revisions, preserved evidence, thread reopen semantics, pagination, extension deep links and mobile UI. Regenerate operation docs, run repository and browser checks, package the update.

## Validation boundaries

Use synthetic local data for writes. Real responsive website capture is tested read-only in an isolated profile. Source, local browser/package checks, user Chrome reload, server deployment and Store publication are separate gates.

## Additional user feedback included

- Movable, collapsible and hideable review dock with a persistent Exit action. Separate brand and key labels; keep full-page capture secondary.
- Registered Chrome Options page for server/account, permissions, shortcut preference and updates. Open Chrome shortcut settings with the Tabs API and verify actual navigation.
- Compact saved-view control aligned with filters, priority at the start of each thread row, direct website link and evidence counts.
- Styled member search/role controls, tighter project settings spacing, “Context for Coding Agent” wording, and a simple Help page with the setup CTA visible before documentation links.

## Verification receipt

- `npm run check`: 115 tests passed, 4 explicitly skipped, plus formatting, generated contracts, types, all builds, disposable sandbox smoke and release checks.
- Extension browser acceptance covers original point images, responsive pin positions, draft hover/edit, typing safety, upload retry, separate/combined image markings, per-point decisions on mobile, movable/hidden controls, Options navigation and actual Chrome shortcut settings navigation. Capture fixtures include 44 ordered screenshots.
- A read-only responsive public-site run exercised desktop and mobile menus, retained three original point images after scrolling, uploaded them only to a disposable local server, and captured 19 full-page sections. No production feedback was created.
- Inspected 42 web renders across 1280 px, 1059 px and 390 px widths in both themes. Saved views stay in the filter row, priority precedes the title, website/evidence metadata is visible, member fields fit, and the Help setup action is visible without expanding a disclosure.
- Build 0.1.25 does not add host permissions, dependencies or migrations. Existing extension/API tokens do not gain the new point-status scope; older connections use the web thread until reconnected.

The user's installed Chrome reload, production server deployment and Chrome Web Store publication remain separate release gates.
