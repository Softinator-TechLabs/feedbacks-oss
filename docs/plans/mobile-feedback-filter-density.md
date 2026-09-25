# Mobile feedback filter density

Status: implementation complete; integration pending. Owner: Feedbacks maintainers. Date: 2026-09-25.

## Outcome and scope

On a narrow feedback queue, the first thread and its thumbnail appear before the fold. Search, status, sort, advanced filters and personal saved views remain available. Desktop retains its visible filter form.

## Evidence and approach

At 390px on the deployed Journals Press queue, the existing filter panel was about 308px tall and the first row began around 653px. The thread detail already brought its screenshot up to about 268px. Collapse only the queue filter form on mobile; keep one 44px labeled disclosure and the existing saved-view icon in the same row. An active-filter count keeps a non-default query visible without making users open the form.

## Steps and progress

- [x] Measure the signed-in mobile list and inspect the existing filter and view contracts.
- [x] Add an accessible mobile disclosure without changing filter serialization or desktop behavior.
- [x] Verify collapsed, expanded and applied states at 390px and 320px, including dark theme and horizontal overflow.
- [ ] Pass repository checks, required CI and deployed mobile readback.

## Compatibility and recovery

This is a web presentation change only. Existing filter URLs, saved views, priority ordering and server operations are unchanged. The full form remains visible at desktop width. Removing the disclosure CSS and button restores the former layout.

## Completion receipt

Local disposable-browser check: at 390px, the collapsed filter panel was 74px tall and the first row began around 409px; opening the form moved that row to about 634px. Applying Top priority collapsed the form and displayed `1 active`. At 320px, the row began around 409px. No horizontal overflow was measured at 320px, 390px or 1280px. Source revision, CI and live readback are pending integration.
