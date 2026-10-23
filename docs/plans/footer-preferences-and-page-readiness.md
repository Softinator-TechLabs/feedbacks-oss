# Public page readiness and Cloudflare analytics

Status: implementation and collection verified; processed reporting pending. Date: 2026-10-23.

## Outcome

Remove Google Analytics, its build configuration and all consent controls from the public website and documentation. Retain the hosted zone's existing Cloudflare Web Analytics automatic injection and EU exclusion. Use separate hostname filters for feedbacks.softinator.ai and softinator.ai to read visits and country breakdowns. Visits are not unique people; blocked requests and excluded regions limit counts. No new beacon, credential, cookie, local storage or fingerprint is added by this change.

Show a thin bottom signal and “Thinking…” during real page preparation and documentation navigation. The page stays usable throughout. Readiness covers critical visible images, fonts, the first visible walkthrough frame and finite entrance animations; it excludes offscreen media, endless playback and analytics requests. Fast pages have no minimum display duration. Failed resources settle to the existing fallback; a 20-second deadline handles a request or navigation that never settles.

## Approach

Post-process the complete public artifact with a small same-origin stylesheet/runtime. Use VitePress router lifecycle notifications for documentation, native navigation intent elsewhere, and page lifecycle cleanup. Permit Cloudflare's beacon script origin and same-origin collection in the public CSP. Preserve application/extension behavior, dependencies, other zone hostnames and persistent data.

Cloudflare's [metrics](https://developers.cloudflare.com/web-analytics/data-metrics/high-level-metrics/), [dimensions](https://developers.cloudflare.com/web-analytics/data-metrics/dimensions/) and [automatic setup](https://developers.cloudflare.com/web-analytics/get-started/) documentation were checked on 2026-10-23. Existing Google properties and historical data remain untouched; only these websites' runtime integration is retired.

## Progress

- [x] Inspect current public surfaces, design, analytics and renderer readiness.
- [x] Remove Google configuration and implement actual readiness feedback.
- [x] Verify no Google/consent UI, slow/failed assets, route changes, cancellation, reduced motion, desktop/mobile and no-JavaScript behavior.
- [x] Run required checks, review and merge through CI.
- [x] Verify production source, public routes and actual collection on both public hostnames.
- [ ] Confirm processed analytics with separate hostname and country reports.

## Recovery

Revert the public source/build to restore the prior presentation. The readiness runtime must never hide content or depend on analytics loading. Existing Google properties and historical data are retained. Keep operational receipts, account details and screenshots outside tracked source.

## Local verification

The full repository check passed with 636 tests and 57 conditional skips, builds, isolated application smoke and release checks. After the final readiness refinements, the focused suite passed 10 tests on Node 22 and 24; the standalone browser suite passed 10 checks, including actual shadow-frame decoding, Back/Forward, anchors and native Privacy navigation. All 80 public HTML pages exclude Google and consent assets. Existing public-site QA passed 23 routes at desktop/mobile sizes; cold-load layout shifts remained below 0.1 at all three tested widths. These are local checks; CI, deployed source and Cloudflare collection remain separate gates.

## Integration and live verification

[PR #246](https://github.com/Softinator-TechLabs/feedbacks-oss/pull/246) merged as `81b905c925d895324fd1550261ed99ac53b016fe`. Exact-main [CI run 39895951640](https://github.com/Softinator-TechLabs/feedbacks-oss/actions/runs/39895951640) passed all six jobs on attempt 2 after retrying only two Node jobs that timed out during Ubuntu package downloads before tests. The normal [public-site deployment 39898125644](https://github.com/Softinator-TechLabs/feedbacks-oss/actions/runs/39898125644) succeeded. Live deployment metadata matches that source; landing, docs, privacy and comparison routes return HTTP 200, and served readiness JavaScript/CSS match the built artifact byte for byte.

The hostname-scoped Cloudflare Configuration Rule retains Rocket Loader off. Its legacy Disable RUM setting was removed so automatic analytics can run; Configuration Rules take precedence over Web Analytics rules. Fresh browser checks on both public hostnames confirmed one automatic beacon script loading with HTTP 200 and an actual vendor collection request to `/cdn-cgi/rum` returning HTTP 204. Google tags and consent controls are absent, and the loading signal was verified during controlled slow loading. Operational receipts and screenshots remain private. Separate hostname/country reports await Cloudflare processing.
