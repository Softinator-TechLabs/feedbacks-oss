# Plan: current product story across the public website

Status: implemented; integration verification pending. Date: 2026-09-30.

## Outcome and scope

Make the free Apache-2.0 product understandable in one short visit. Preserve the established Manrope, white-paper and pencil-red identity. Lead with visual feedback, video and session replay; show the shared diagnostic timeline, portable debug evidence, precise text suggestions and agent context. Keep the existing capture walkthrough. Give every feature a useful guide and connect comparison claims to current source.

## Evidence and approach

The landing currently explains only screenshot-to-agent handoff. The comparison generator incorrectly says Feedbacks has no session replay. Current behavior is documented in [session replay](../session-replay.md), [extension](../extension.md) and [API](../api.md), backed by recording, diagnostic and text-evidence tests. The initial GitHub scope was one configured App. Merged PR #160 supersedes that boundary: the server supports multiple configured Apps, the owner selects one per project, and repositories use that App's permitted installations.

Extend the existing static Vite site, shared local educational assets and VitePress documentation. Avoid a new framework or dependencies. Use concise, crawlable HTML and accessible diagrams; label synthetic examples and preserve real screenshot provenance. Keep hosting costs distinct from the free software license. Competitor evidence retains its actual review dates; new unverified capabilities remain unknown.

## Steps and progress

- [x] Inspect latest main and verify current capability boundaries.
- [x] Refresh landing story and shared interactive evidence illustrations.
- [x] Add task-oriented recording, diagnostics, text and context guides; surface existing features.
- [x] Correct generated comparisons and source dates; add meaningful regression coverage.
- [x] Improve metadata, social preview, canonical links and internal discovery.
- [x] Verify build, links, desktop/mobile, keyboard, reduced motion and no-JavaScript content.
- [x] Review diff and complete local repository checks and delivery receipt.

## Acceptance criteria

Visitors see free Apache-2.0 positioning, what gets captured, and the server-first setup action without reading a long introduction. A user-started walkthrough of actual recording-review captures demonstrates the relationship between a click, failed request and console error, with manual controls and reduced-motion behavior. All new public guides appear in navigation, search, sitemap and Markdown exports. Generated comparisons confirm replay with evidence and never equate missing vendor evidence with missing features. No invented customer metrics or automatic-fix promises.

## Compatibility and recovery

Static website and documentation only. No migrations, application permissions or extension changes. The static website image can be rebuilt from the previous source revision for rollback. The site remains useful without animation or JavaScript.

## Decision log

- Present each selling point once per page. Licensing belongs in the landing hero; remove duplicate license banners, repeated feature-paywall copy and redundant role links. Each later section must explain a distinct capability or next step.

- Use the actual extension renderer for the hero: desktop/mobile Activity, Network and Console captures, with a full-size view. Synthetic events are identified as sample data; do not invent a substitute product interface.
- Preserve the existing visual identity and actual capture walkthrough; add product-specific diagrams instead of decorative imagery.
- Separate guided session capture from always-on visitor analytics, and full thread archives from agent-local recording exports.
- Self-hosting infrastructure is operator-provided. The software has no license fee.
- SEO follows crawlable text, canonical routes and accurate software metadata; no ranking or traffic guarantee. Reference: [Google Search Central](https://developers.google.com/search/docs/appearance/structured-data/software-app), reviewed 30 September 2026.

## Completion receipt

Local evidence: `npm run check` passed (430 tests passed, 24 environment-gated tests skipped, typechecks, builds, isolated smoke and release checks). Four focused comparison tests pass, including a regression for CSP-safe table widths. `npm run qa:public-site` passes ten routes at desktop/mobile sizes, local links/assets, timeline mouse/keyboard/playback controls, offscreen pause, reduced-motion initial state, no-JavaScript fallback and mobile comparison navigation. The browser check is included in CI. The existing nine-scene walkthrough check also passes at six viewport sizes, including a complete 1280×640 product hero and the relocated capture walkthrough with its controls.

Rendered landing evidence: [previous public page](../screenshots/public-product-story/before-desktop.png), [desktop](../screenshots/public-product-story/desktop.png) and [mobile](../screenshots/public-product-story/mobile.png).

Independent review identified blocked inline comparison widths under production CSP; external CSS classes fix the issue and mobile arrow behavior is now asserted. Shared example rendering uses a shadow root so documentation hydration preserves its controls. Mobile diagrams use separate readable compositions.

Source base: `28ff478`. New source commit, required CI, deployment and live verification are tracked in the pull request. Public search indexing and traffic effects remain unverified.
