# Optional public website analytics

Status: in progress. Date: 2026-10-22.

## Outcome and scope

Allow the public website and documentation operator to enable GA4 at build time for one exact HTTPS hostname. Keep unconfigured builds, the team application and the extension free of this integration. Show compact opt-in controls before loading Google, with persistent Cookie preferences for withdrawal. Add the requested Product Hunt badge only to the repository README.

## Approach and boundaries

Post-process only `dist/site` after documentation export. Validate the measurement ID and hostname together; inject a same-origin loader and stylesheet into public HTML and extend only its existing CSP script/image/connection directives. Store the visitor's choice locally, load GA4 only after Allow, and disable collection and clear its host-only cookies on withdrawal. Disable Google Signals and advertising personalization. Use automatic GA4 pageviews and its single Enhanced Measurement history option, without a second SPA/router hook. Runtime and remote property acceptance remain separate.

## Progress

- [x] Inspect build, CSP, privacy policy and official Google tag/consent guidance.
- [x] Implement optional build configuration, consent controls and deployment variables.
- [x] Verify off/default, invalid configuration, host isolation, consent/withdrawal and public build output.
- [x] Run repository checks and review the bounded implementation.
- [x] Merge the initial implementation through required PR CI.
- [ ] Verify the configured public deployment and GA4 collection separately.

## Compatibility and recovery

No application routes, extension permissions, dependencies, accounts or persistent server data change. Remove both public build variables and rebuild to remove the integration; do not merely delete the privacy notice. Existing site and docs CSP restrictions remain in place apart from the enabled tag/collection origins. The Product Hunt embed is a README image/link and does not add a third-party widget to the website.

## Evidence

The current public privacy policy promises no analytics, so its website section must change with this implementation. Google's [EU user consent policy](https://www.google.com/about/company/user-consent-policy/) requires applicable storage consent and revocation instructions. This implementation uses basic opt-in globally, without Google requests or cookieless pings before acceptance. Google's [GA4 configuration](https://developers.google.com/analytics/devguides/collection/ga4/reference/config), [pageview guidance](https://developers.google.com/analytics/devguides/collection/ga4/views) and [CSP guidance](https://developers.google.com/tag-platform/security/guides/csp) were reviewed on 2026-10-22. Advertising hosts and preview tooling are outside scope.

## Verification and remaining work

Local `npm run check` passed: 633 tests passed, 57 conditional skips, complete builds, isolated application smoke and release checks. Six regression tests cover paired configuration, off-by-default output, exact-host isolation, public-only injection/CSP, consent, expiry, withdrawal and cross-tab changes. An isolated browser check at desktop/mobile widths verified the built public pages with a synthetic measurement ID and all requests intercepted: no Google request before acceptance or after stored decline, one initializer per document, persistent docs controls, no duplicate initializer across VitePress navigation, cookie removal and cross-tab withdrawal, keyboard access and no overflow. Google code was stubbed; this does not establish live GA4 collection. Screenshots and raw receipts remain private.

Required exact-source CI and separate configured public deployment/property acceptance remain pending. No measurement ID, account details or operational receipts belong in source.

The current Google CSP guide was checked directly on 2026-10-22: its table for Analytics without Ads also requires Google connections. The enabled policy therefore allows `https://www.google.com` only in `connect-src`, alongside the existing Analytics and Tagmanager connections. This permits the observed basic collection endpoint without adding Google script/image/frame sources or advertising domains. Unconfigured builds retain their original policy.
