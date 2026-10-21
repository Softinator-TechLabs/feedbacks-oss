# Plan: static website hosting on Cloudflare

Status: implementation complete. Date: 2026-10-21.

## Outcome and scope

Provide a reproducible deployment of the public website and documentation together as Cloudflare Workers static assets. Preserve existing URLs, browser behavior, content security policies and agent-readable Markdown. Application hosting and persistent data are outside this change. Installation-specific hostname changes, release acceptance and rollback evidence are private operator work.

## Evidence and approach

The [deployment model](../architecture.md#deployment-model) already separates the public static artifact from the application. Reuse `npm run build:site` and `dist/site`; no Worker script, new application dependency, database or storage binding is necessary. Keep deployment accounts, domain inventory and rollback receipts private.

## Steps and progress

- [x] Confirm the independent website/docs build and existing server policies.
- [x] Add assets-only configuration, response headers and operator commands.
- [x] Document preview, deployment and routing recovery.
- [x] Verify the local Worker engine, full repository checks and website browser acceptance.
- [x] Upload a preview artifact; retain per-release acceptance and routing recovery outside public source.
- [x] Add main-only GitHub Actions deployment after all exact-revision CI jobs pass, with a scoped environment secret and live source receipt.

## Compatibility and recovery

Cloudflare canonicalizes `.html` links to extensionless paths while preserving their content. VitePress remains under `/docs/`. Missing routes retain a 404 status. The Docker website remains available; restoring prior DNS/route settings recovers the previous host. No migrations, application credentials or customer data change.

## Decision log

- Serve static assets directly, with no runtime Worker script, to avoid dynamic request consumption for public pages.
- Keep automatic production deployment gated on required CI. Account configuration and launch operations remain private.
- Use the repository's CI completion event for automatic deployment, retaining the current main revision and all six CI jobs as gates. Keep the Cloudflare token out of dependency installation and build steps.

## Completion receipt

Source revision: the commit containing this plan and `wrangler.site.jsonc`.
Checks and results: `npm run check` passed (542 tests passed, 45 conditional skips), plus `npm run qa:public-site` passed on 21 desktop/mobile routes with cold-load layout checks. Required CI remains the integration gate.
Artifacts: `dist/site`, generated from the reviewed source revision.
Deployment and live verification: preview artifact uploaded; installation-specific acceptance and routing receipts stay private.
Remaining risks or follow-up: each release must validate HTML redirects, docs search, Markdown MIME type and inherited security headers on the actual Worker before changing routing.
