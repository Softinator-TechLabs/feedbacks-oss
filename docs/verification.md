# Verification matrix

Run commands from the repository root after `npm ci`. Use a supported Node version. Each result establishes only the scope described here.

| Change                                     | Required evidence                                                                                                                                                       |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Docs or adapters                           | `npm run check:harness`; review source links and claims; check actual client loading when client compatibility is claimed                                               |
| Shared contracts, operations or transports | Focused regression test, `npm run check`; verify HTTP/MCP/CLI agreement and denied scopes                                                                               |
| Authentication, grants or exports          | Positive and negative tests in `tests/security.test.ts`, `tests/http.test.ts` and the affected service tests; no real credentials                                       |
| Migrations or concurrency                  | `npm run check` plus `npm run test:postgres` with `initdb` and `pg_ctl` available                                                                                       |
| Extension behavior                         | Focused connection/pairing/diagnostics tests, built ZIP inspection, `npm run qa:extension-browser`, and Store-installed Chrome permission/readback checks as applicable |
| App or website UI                          | `npm run check`, synthetic desktop/mobile screenshots and keyboard behavior                                                                                             |
| Container or deployment configuration      | Both Docker builds and `npm run test:containers`; staging/live acceptance when deployment is in scope                                                                   |
| Dependency or packaging                    | Lockfile, `npm audit --audit-level=high`, release/source checks and license/provenance review                                                                           |

[HTTP budget tests](../tests/http-rate.test.ts) verify independent member-session and bearer-credential allowances, their individual limits and the shared IP ingress limit. Bulk synthetic setup in the extension suite honors definite HTTP 429 `Retry-After` responses; it does not replay browser actions or relax assertions.

## Fast feedback

Run one test file with `node --import tsx --test tests/harness.test.ts`, replacing the filename for the change. Run `npm run check:harness` without a build for import/docs feedback. `npm run check` includes the built sandbox smoke check, so contributors and CI exercise the same entry point.

## Isolation and evidence

The sandbox verifies migrations, sign-in, project/thread creation, readback, anonymous denial and readiness using an in-memory database and local assets. It does not prove native PostgreSQL concurrency, Chrome behavior, S3 connectivity, TLS ingress, load capacity or disaster recovery.

After installing Chromium with `npx playwright install chromium`, `npm run qa:extension-browser` loads the built unpacked extension in isolated Chromium against a disposable local sandbox and synthetic page. Its temporary manifest grants host access solely to bypass headless permission prompts; it tests packaged feature behavior, not the production permission flow or Chrome Web Store installation. The command also runs `scripts/session-replay-browser-qa.mjs` and `scripts/session-origins-browser-qa.mjs`: DOM replay, debugger console/network, navigation, reload recovery, secret canaries, the interactive pre-send inspector, and explicitly allowed redirects while preserving the original project. Build the extension first. It writes a full-page sample under ignored `.local/remaining-todos-qa/` for optional visual inspection.

Install `ffmpeg` for the synthetic video fixture used by the saved-frame browser test; CI installs it explicitly. For recording behavior, `npm run qa:recording-browser` runs the Chromium regressions sequentially and is a required step in the extension CI job. It checks source-page controls, native recorder timing with a canvas source, DOM geometry and click alignment, resource isolation, durable storage, replay cutoffs, time-filtered diagnostics, short video trim/seek and saved-frame metadata. It also checks desktop/mobile right-click comments inside native modal previews with same-origin frames. The packaged extension suite verifies modal comment capture/save and stale project access followed by an explicitly approved sandbox reconnect. Native Chrome tab-picker/MediaRecorder pause and trim acceptance is separate from synthetic browser fixtures.

`node scripts/offscreen-recording-browser-qa.mjs` tests the packaged one-click source-page capture, hidden recorder, diagnostics and Stop-to-review handoff with a synthetic tab stream. The extension browser acceptance suite runs that scenario as its recording-controls workflow. A real Chrome toolbar permission grant, microphone permission and installed Web Store package still need native acceptance.

After building the app, `npm run qa:app-filters` checks live category, tag, status, search and device filtering in a disposable sandbox, including badge keyboard activation, search debounce and focus, and desktop/mobile layout. It also verifies body-only manual creation, optional page links, existing/added/pending tags, failed-post retry identity, delayed background list refresh, preserved pagination and list scroll after resolution and browser Back. It writes synthetic screenshots under ignored `output/playwright/`.

Keep source, local checks, exact-revision CI, package integrity, deployment and live verification as separate receipt fields. A skipped native database test must be reported as skipped. CI runs it separately; a local PGlite pass does not replace it. Never report an automated check as visual review.

## CI behavior

[CI](../.github/workflows/ci.yml) runs Node 22/24 checks, native PostgreSQL checks, isolated Chromium extension acceptance, dependency audit, container smoke, source export, SBOM generation and history secret scanning. Workflow tokens have read-only contents permissions; pull requests do not receive deployment secrets. Deployment credentials and operator acceptance records remain private.

Agent setup handoff changes also run `npm run qa:agent-setup` after building. This disposable browser check covers secret-free/default and explicit quick copies, evidence-read scopes, retry/recovery, mobile layout and keyboard controls. It never uses the developer’s clipboard or production credentials.

## Public website story

Public-site QA also runs `scripts/public-site-performance-qa.mjs`: a cold-load regression with deliberately delayed shadow CSS/runtime delivery at desktop, laptop and mobile sizes. It keeps accumulated layout shifts below 0.1, checks compressed font transfer and verifies the readable static fallback on stylesheet failure. These are controlled local checks, not a Lighthouse score or real-user Core Web Vitals certification.

After `npm run build:site`, run `npm run qa:public-site` to check the landing, feature guides and comparisons under production-style CSP. It checks desktop/mobile layout, same-origin links and assets, interactive timeline controls, paused/reduced-motion behavior, no-JavaScript content and scrollable comparison tables. Captures use synthetic examples and remain under ignored `.impeccable/review/`. Reproduce the current inspector and sharing artwork with `node scripts/capture-public-recording.mjs` and `node scripts/capture-site-social.mjs`; provenance is in [website assets](website-assets.md).
`npm run qa:github-apps` exercises owner-page registration in isolated Chromium
with synthetic GitHub responses: an actual cross-site return with Strict session
cookies, normal CSRF completion, both credential storage choices, project/repo
selection, management/reconnect, the common owner-only Integrations hub, direct walkthrough loading, keyboard flow and
desktop/mobile light/dark bounds. Build server/web first. It creates no real
GitHub App and does not replace acceptance of the actual GitHub approval UI.
Focused encrypted-catalog, recovery/race and worker checks live in
`tests/github-managed-apps.test.ts`; provider/server/connection isolation is checked in
`tests/integration-vault.test.ts`. Native tests verify migration 28.

## Extension-free capture and website widget

`FEEDBACKS_APP_CAPTURE_BROWSER=1 node --import tsx --test tests/app-capture-browser.test.ts` runs after the build in the required browser CI job. It uses a real disposable local API and a fresh browser context without an extension. The fixture verifies image import, coordinate notes and masking, private uploaded pixels, recovery after a committed upload loses its response, reload/retry without duplicate threads/assets, permission denial, synthetic window-frame capture and media-track cleanup. It also generates an installation snippet in Settings and submits widget feedback from a separate approved host origin with a mocked Turnstile challenge.

These tests do not establish native Windows/macOS/Ubuntu picker behavior, physical mobile-device acceptance, production Turnstile/CSP or Store distribution. The synthetic screenshots under ignored `.impeccable/review/` are local review artifacts. See [app screenshots](app-capture.md) and the [widget installation guide](../site-docs/guide/website-widget.md).

## Project workflows and subscribed delivery

After building, `FEEDBACKS_BOARD_BROWSER_SMOKE=1 FEEDBACKS_RECORDING_BROWSER_SMOKE=1 node --import tsx --test --test-concurrency=1 tests/board-browser.test.ts tests/analytics-browser.test.ts tests/public-intake-browser.test.ts tests/notifications-browser.test.ts tests/integrations-browser.test.ts tests/github-comments-browser.test.ts` exercises the real local HTTP app at desktop/mobile sizes, including keyboard actions, scoped metrics/export/print, consent, settings and unsubscribe. Required browser CI runs this group. Provider verification is synthetic in these fixtures; account consent, delivery and external changes remain live acceptance gates.
