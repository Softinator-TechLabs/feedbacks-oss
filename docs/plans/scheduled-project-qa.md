# Plan: scheduled project QA and visual baselines

Status: source complete. Owner: Feedbacks maintainers. Date: 2026-09-25.

## Outcome and scope

Let a project maintainer opt in to a daily, bounded scan of explicitly selected public HTTPS pages on the project's exact approved origins. Keep a recent history of page availability, static missing-alt findings and definite same-origin 404/410 links for human review. Let a maintainer choose an existing private thread screenshot as a baseline and compare another image from that same thread on demand. Do not create threads or automatically approve findings.

## Evidence and approach

The [extension QA scan](optional-page-qa.md) is an explicit browser action. The service has a periodic maintenance worker and private assets but no unattended browser renderer. Reuse the public-address and DNS-pinning pattern from signed webhooks. Fetch only configured pages and a small number of same-origin links, with time and byte limits, no redirects and no credentials. Compare existing WebP image pixels after project and thread authorization.

## Steps and progress

- [x] Trace existing extension, project, worker, asset and operation boundaries.
- [x] Add failing operation and worker tests, including denied and unsafe inputs.
- [x] Implement migration, shared contracts, server operations, bounded worker and UI.
- [x] Update guidance and generated operation catalog.
- [x] Run focused and full checks; review diff and record limits.

## Compatibility and recovery

Migration 15 adds opt-in configuration, run history and baseline references. No existing project is scanned. Disable removes future work; recorded runs and baselines remain available until project deletion. If the worker stops mid-run, its lease expires and the next daily attempt proceeds. Scans cannot inspect authenticated DOM or execute JavaScript; visual comparisons require two existing human-approved attachments.

## Decision log

- Schedule is fixed daily to avoid arbitrary high-frequency traffic.
- A page's public origin must be both explicitly approved on the project and explicitly configured for QA, even when project capture mode permits any website.
- Findings remain suggestions for a human reviewer; the worker never creates or changes feedback.

## Completion receipt

Source revision: this branch's implementation commit.
Checks and results: `npm run check` passed under Node 24, including the disposable HTTP smoke and generated catalog. Five focused QA tests passed. Desktop and 390 px mobile browser layouts were inspected using a synthetic project; opt-in save, baseline selection and image comparison completed. Native PostgreSQL concurrency remains the standard suite's one skip.
Artifacts: typed QA operations, migration 15, project settings, visual baseline controls and this guide.
Deployment and live verification: out of scope for this branch.
Remaining risks: browser-rendered state and authenticated pages are outside the server scan. No unattended screenshot capture or scheduled visual comparison runs; those require a separate browser runtime and page-credential model. Public-site network behavior and deployed worker execution remain unverified.
