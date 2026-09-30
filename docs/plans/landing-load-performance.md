# Stable, lighter landing-page loading

Status: implemented and locally verified. Date: 2026-09-30.

## Outcome and scope

Keep the current animations, glass reflection, cursor movement and shared playback controls while removing cold-load layout jumps and reducing font/image transfer. Changes apply to the public site and shared walkthrough loading; there are no application permission or persistence changes.

Follow-up: recording tabs must remain selectable during playback, and changing demo tabs must not shift the website beneath them. The native inspector was resetting the selected channel to Everything on every playing update. Preserve the selected channel and follow its current event; reserve a consistent event-panel height in the explanatory demo.

Landing links to other pages open a new tab with `noopener noreferrer`, including setup/docs, comparisons, GitHub and the Chrome Web Store. In-page navigation and the home wordmark retain their ordinary behavior. Browser preferences determine whether a new tab takes focus.

## Evidence and approach

Delayed browser loading reproduced large shifts when the custom element replaced its static image, then rendered the recording canvas before its shadow styles arrived. Keep the original picture until both player stylesheets are ready, reserve the hero footprint and give the intermediate poster intrinsic dimensions. Retain the existing Google Fonts families with self-hosted WOFF2 subsets and serve a smaller WebP fallback for the capture scene.

## Steps and progress

- [x] Reproduce and add a failing cold-load browser regression.
- [x] Stabilize player upgrade without removing motion.
- [x] Reduce font and fallback-image transfers.
- [x] Verify slow loading, failed styles, desktop/mobile visuals and existing playback behavior.
- [x] Run repository checks and review the final diff.

## Compatibility and recovery

The player remains shared by landing, docs and app help. Failed CSS keeps the original static illustration visible. Fonts remain local under the existing SIL licenses; no third-party runtime requests are introduced. Versioned fonts receive a long origin cache lifetime; mutable player assets continue to revalidate. Rolling back the source/build restores the previous player. Deployment and public PageSpeed results require separate verification.

## Acceptance

The delayed cold-load regression must keep accumulated layout shifts below 0.1 at desktop, laptop and mobile sizes. Default autoplay, stored Pause, seeking, expanded viewing, reduced motion and pointer depth must continue to work. Record local timings separately from public Lighthouse/field measurements; do not infer production scores from a localhost test.

## Verification receipt

- Delayed-load regression before the fix: CLS 1.3778 / 1.3603 / 1.7699 at desktop/laptop/mobile. After: 0.0163 / 0.0122 / 0.0137. The regression also verifies tab selection while playing, stable following-section position and readable fallback when CSS fails.
- Controlled 150 ms latency, 200 KB/s, 4× CPU-throttled loading: font transfers fell from about 539 KB to 77 KB; the current capture fallback is about 35 KB rather than the original 321 KB PNG. These measurements are local and are not production PageSpeed scores.
- Repository check chain passed with two test workers: 493 tests passed, 34 opt-in checks skipped, type/format/harness checks, all builds, sandbox smoke and release checks. Focused native-inspector browser tests passed 13/13.
- All ten shared walkthrough scenes and the actual recording runtime passed; public browser QA passed 19 routes on desktop/mobile, keyboard, dark and no-JavaScript behavior. Desktop/mobile screenshots retained the existing depth/reflective presentation. A real Docs click opened an isolated new tab while retaining the landing page.
- No deployment or Store publication performed. Required CI, including container and native PostgreSQL checks, remains the integration gate. Production mobile LCP and CDN cache behavior require a new public audit after deployment; local Docker was unavailable.
