# Project categories and tags

Status: implemented for review. Owner: Feedbacks maintainers. Date: 2026-09-28.

## Outcome and scope

Project maintainers can create, rename and archive custom categories, maintain a reusable tag vocabulary, and change each tag's subtle color. Reviewers can select existing tags or add a new tag while organizing feedback. Category and colored tags are visible in project feedback rows and thread detail. Default categories and historical feedback remain readable.

## Evidence and approach

The current thread detail hides organization under Details; the project list shows tags only when set and omits General. Categories are a fixed enum, while tags are free text. Store project taxonomy in the existing project JSON record and expose it through revisioned operations. Derive legacy tags from existing project threads so old labels appear without rewriting customer records. Use a small named palette for predictable light and dark contrast.

## Steps and progress

- [x] Inspect the current source and establish typecheck and review-tool test baseline.
- [x] Add shared taxonomy contracts and authorized server operations with tests for project isolation, stale revisions and archived categories.
- [x] Add project management controls and thread selectors; show category and colored tags in feedback rows and detail.
- [x] Add consistent gaps to shared form action rows where adjacent buttons touched.
- [x] Update canonical docs and generated operation catalog; run focused and full checks plus desktop/mobile UI inspection.

## Compatibility and recovery

Project taxonomy is an additive JSON field; no database migration or thread rewrite is required. Built-in category IDs and stored tag strings stay valid. If the new UI is rolled back, existing thread category/tag data remains readable by the older client, except custom categories appear by ID until the new client is restored. Keep category IDs stable across rename; archive removes them from new selection while preserving history.

## Decision log

- User chose custom project categories on 2026-09-28.
- Muted colors use a bounded named palette. New tags receive a stable initial color and maintainers can change it later.
- Read discovered historical tags without copying the entire vocabulary into project settings; save only new or changed colors so large projects remain editable.

## Completion receipt

Source revision: `codex/project-taxonomy` (commit recorded in Git).
Checks and results: full `npm run check` passed on Node 22 after the final server and UI changes; focused taxonomy test covers 200+ historical tags; extension browser QA and synthetic desktop/mobile category, color, save-order and concurrent-edit flows passed. Code review found no remaining Critical or Important issues.
Artifacts: `output/playwright/project-taxonomy-*.png` are local, ignored screenshots from a disposable sandbox. The feature remains reviewable in this branch.
Deployment and live verification: not performed.
Remaining risks or follow-up: the general app visual QA script currently expects an old Help heading and fails outside this change. Targeted category/tag visual QA passed.
