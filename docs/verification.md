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

## Fast feedback

Run one test file with `node --import tsx --test tests/harness.test.ts`, replacing the filename for the change. Run `npm run check:harness` without a build for import/docs feedback. `npm run check` includes the built sandbox smoke check, so contributors and CI exercise the same entry point.

## Isolation and evidence

The sandbox verifies migrations, sign-in, project/thread creation, readback, anonymous denial and readiness using an in-memory database and local assets. It does not prove native PostgreSQL concurrency, Chrome behavior, S3 connectivity, TLS ingress, load capacity or disaster recovery.

After installing Chromium with `npx playwright install chromium`, `npm run qa:extension-browser` loads the built unpacked extension in isolated Chromium against a disposable local sandbox and synthetic page. Its temporary manifest grants host access solely to bypass headless permission prompts; it tests packaged feature behavior, not the production permission flow or Chrome Web Store installation. The command also runs `scripts/session-replay-browser-qa.mjs` and `scripts/session-origins-browser-qa.mjs`: DOM replay, debugger console/network, navigation, reload recovery, secret canaries, the interactive pre-send inspector, and explicitly allowed redirects while preserving the original project. Build the extension first. It writes a full-page sample under ignored `.local/remaining-todos-qa/` for optional visual inspection.

For recording playback, `FEEDBACKS_RECORDING_BROWSER_SMOKE=1 node --import tsx --test tests/recording-replay-browser.test.ts tests/recording-viewer-browser.test.ts` checks resource isolation, replay with time-filtered diagnostics, video seek and saved-frame metadata in Chromium. Native Chrome tab-picker/MediaRecorder pause and trim acceptance is separate from synthetic browser fixtures.

After building the app, `npm run qa:app-filters` checks live category, tag, status, search and device filtering in a disposable sandbox, including badge keyboard activation, search debounce and focus, and desktop/mobile layout. It writes synthetic screenshots under ignored `output/playwright/`.

Keep source, local checks, exact-revision CI, package integrity, deployment and live verification as separate receipt fields. A skipped native database test must be reported as skipped. CI runs it separately; a local PGlite pass does not replace it. Never report an automated check as visual review.

## CI behavior

[CI](../.github/workflows/ci.yml) runs Node 22/24 checks, native PostgreSQL checks, isolated Chromium extension acceptance, dependency audit, container smoke, source export, SBOM generation and history secret scanning. Workflow tokens have read-only contents permissions; pull requests do not receive deployment secrets. Deployment credentials and operator acceptance records remain private.
