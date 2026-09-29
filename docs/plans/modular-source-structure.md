# Modular source structure

Status: in progress. Owner: Feedbacks maintainers. Date: 2026-09-29.

## Outcome and scope

Make large, frequently edited Feedbacks source files easier to understand and change. Place related implementation in feature folders and divide files by responsibility. Preserve HTTP/MCP/CLI operations, browser extension behavior and permissions, persisted data, generated output, and user-visible UI.

The public `feedbacks-oss` repository is the source of this work. The older private `feedbacks` checkout is outside scope. Generated comparison HTML, lockfiles, and build output are not refactor targets.

## Evidence and approach

The 2026-09-29 audit of `c7b1e22` found 2,771-line extension worker and 2,710-line content entrypoint, 2,039-line thread UI, 1,820-line shared contracts registry with 137 operations, and a 3,113-line extension browser QA script. `src/web/` and `extension/` each have several files over 1,000 lines. `npm run check` passed on the starting revision with Node 22.

Use incremental feature folders and extraction. Keep browser and server entrypoints stable where packaging or external consumers refer to them. Make each change independently verifiable; avoid a single bulk path rewrite. Existing behavior tests protect refactors. Add focused tests only when extracting behavior whose boundary is otherwise untested.

## Steps and progress

- [x] Establish the source revision, clean isolated worktree, Node 22 dependencies, and full baseline check.
- [x] Split thread list, composer, detail, and related UI into `src/web/threads/`; keep imports and CSS working. Move assignment and recording helpers into their own feature folders.
- [x] Group project, member, and account settings by feature.
- [x] Split broad web CSS by ownership boundaries without changing cascade order.
- [x] Divide shared operation schemas into domain modules under `src/shared/contracts/`, preserving the single typed operation registry and generated catalog.
- [x] Extract extension capture, editing, and session concerns into focused folders while keeping manifest entrypoints, Chrome message behavior, and ZIP contents compatible.
- [x] Split extension browser QA setup and shared page fixture into focused modules.
- [ ] Split the remaining sequential acceptance scenario runner into independent workflows.
- [x] Reassess server transport and dispatch for focused extraction; preserve transaction and authorization boundaries.
- [ ] Run focused checks after every stage, then the full check, extension browser acceptance, native PostgreSQL checks where server behavior changes, and exact-revision CI. Review the final diff and update architecture and quality guidance.

## Compatibility and recovery

No migration, object-key, token, permission, or public operation name change is intended. Structural moves must update every import, test fixture, build entrypoint, packaging allowlist, and documentation link that names a file. Use small commits so an individual stage can be reverted without reverting the others. A passing unit suite alone does not prove Chrome-installed or deployed behavior; keep those as separate evidence gates.

## Decision log

- 2026-09-29: Work from current `feedbacks-oss/main`, not the private foundation checkout. Preserve browser entrypoint filenames where the manifest, HTML, or packaging refers to them.
- 2026-09-29: Favor feature folders over splitting only by file type; do not add wrapper files solely to make the top level appear smaller.
- 2026-09-29: The first web stage passed the full Node 22 check and three Chromium recording-viewer scenarios. No product behavior was changed.
- 2026-09-29: Project, member, and account views now have feature folders. The full Node 22 check and filter UI browser QA pass; a Node test caught and resolved the split JSX runtime import requirement.
- 2026-09-29: Split the global stylesheet into ordered feature files and the thread detail stylesheet into core, header, evidence, and assignment files. The production CSS asset remained byte-identical after formatting.
- 2026-09-29: Split all 137 input and output schemas across ten domain modules. Kept the original `contracts.ts` import path, every public export, both operation key orders, scopes, and registry composition. The full Node 22 check passed.
- 2026-09-29: Moved screenshot, page storage, redaction, export, and full-page helpers into `extension/capture/`. Kept manifest entrypoints and allowed only that explicit nested directory in packaging and synthetic browser serving. Nine focused tests and the extension Chromium QA scenarios passed.
- 2026-09-29: Extracted worker point-evidence and marking projection into `extension/capture/markings.js`. The full Node 22 check and Chromium capture workflow pass; `background.js` is 187 lines shorter.
- 2026-09-29: Grouped internal extension session, recording, video, review, connection, and diagnostic modules by responsibility. Kept all manifest, HTML, and script-injection entrypoint filenames stable. Updated test fixtures and the explicit ZIP allowlist. The full Node 22 check and all extension Chromium QA scenarios pass.
- 2026-09-29: Extracted recording diagnostics rendering and event selection into a focused web component; the recording viewer fell from 1,104 to 813 lines. Three Chromium viewer scenarios, filter UI QA, and the full Node 22 check pass.
- 2026-09-29: Extracted thread attachments and linked issue, Figma, and delivery forms into focused components. The detail view fell from 1,075 to 841 lines; the full Node 22 check passes.
- 2026-09-29: Separated feedback thread read-model assembly from write operations. Kept `feedback.js` exports stable and moved no authorization or transaction decision. The full Node 22 check passes; other transport and GitHub transaction code remains a focused follow-up due its external side effects.
- 2026-09-29: Extracted the extension browser setup scenario and mutable synthetic page fixture under `scripts/qa/extension/`. The full packaged Chromium QA sequence and Node 22 check pass. The remaining long sequential runner is a follow-up for smaller independent scenarios.
- 2026-09-29: Moved the worker capture workflow and its in-progress guard into `extension/capture/workflow.js`. Kept the manifest worker entrypoint and Chrome calls in the same order. The Chromium capture acceptance and full Node 22 check pass.
- 2026-09-29: Moved the worker submission, combined-image repair, progress, and busy guard into `extension/submission/workflow.js`. The worker fell from 2,587 to 1,651 lines across capture and submission extractions. The Chromium submit acceptance and full Node 22 check pass.
- 2026-09-29: Rebasing onto Account UX PR #114 kept the new tabs, mobile Menu CSS, and token suffix contract in their feature modules. The full Node 22 check and native PostgreSQL checks pass on the rebased branch.
- 2026-09-29: Reconstructed the web stylesheet from its ordered feature imports and compared every nonblank CSS line with the merged `origin/main` stylesheet: 2,280 lines matched in the same order. The Account component body also matches the merged source exactly.
- 2026-09-29: Moved screenshot export rendering and PDF/raster assembly from the editor entrypoint into `extension/capture/editor-export.js`. Moved the point-view freeze helper from the content entrypoint into the already injected `frame-dom.js`. The ZIP still uses the same entrypoints and the packaged browser QA sequence passes.
- 2026-09-29: Split the browser acceptance runner's popup/options, optional public capture, and recording-control workflows into `scripts/qa/extension/` modules. The complete packaged Chromium sequence passed after this split.
- 2026-09-29: Rebasing onto recording PR #115 preserved frame annotation, timeline marks, superseded asset filtering, and the new image markup/upload contracts across moved modules. The recording and extension browser suites passed on the rebased branch.
- 2026-09-29: Independent diff review found one omitted Account link `secretSuffix` output field. Restored it, added a parse-boundary assertion, and compared every input/output contract JSON schema and operation key order against merged `origin/main`: 0 differences.
- 2026-09-29: Rebasing onto Project administration tabs PR #116 preserved the new `SectionTabs` component, hash selection, panel markup, and dark/mobile styles. The moved Members body matches `main` exactly; Project Settings differs only by a trailing blank line. The reassembled web CSS matches all 2,300 nonblank lines of merged `main` in order. Full Node 22 check passed on the rebased branch.
- 2026-09-29: The synthetic app visual QA exposed two stale Help selectors already present on `main`. Updated them to the current heading and button text; the browser then captured 56 route/viewport/theme screenshots with zero blocked requests. The filter UI browser check also passed.
- 2026-09-29: PR #117 CI exposed a race in the extracted extension setup acceptance flow: the page status could update before Playwright observed the newly opened Options tab. The test now awaits the page event and Options URL. Its full local capture/review scenario and all six CI checks passed on `fc5f174`. A concurrent local video export test failed once under browser load, then passed in isolation; the complete recording browser suite passed 22/22 in CI.
- 2026-09-29: Follow-up QA runner work groups thread review, project-switch defaults, ordered capture and upload retry, page review and combined upload, changing-page retry, and diagnostics masking under `scripts/qa/extension/`. The entry runner fell from 2,394 to about 1,685 lines while preserving scenario order and results. The extraction exposed a fixed-delay point-capture test race and a teammate hover assertion race; both now wait for their expected state with a bounded timeout. The full Chromium capture/review script passed after the latest extraction. Additional inline review scenarios remain in the runner.

## Completion receipt

Source revision: PR #117 on `codex/modular-refactor`, based on `7e6a4ad` (PR #116); merge revision is recorded by GitHub after integration.
Checks and results: Node 22 `npm run check` passed after the latest rebase (328 pass, 22 skipped, 0 fail; builds, harness smoke, and release package checks included). Current-base synthetic app visual QA captured 56 screenshots with zero blocked requests; `npm run qa:app-filters` and native `npm run test:postgres` (2 pass) passed. The packaged extension capture/review scenario passed after the setup race fix. All six PR CI jobs, including Node 22/24, containers, Android, secrets, and extension/recording browser acceptance, passed on `fc5f174`; required CI remains the merge gate for the final revision.
Artifacts: draft source PR #117; no extension Store package or deployed service produced.
Deployment and live verification: outside scope of this source refactor; no deployment performed.
Remaining risks or follow-up: `extension/content.js` retains a large shared state closure; `scripts/extension-browser-qa.mjs` still contains coupled sequential scenarios. Extract these with explicit state boundaries and browser receipts in the next reviewable stage. External GitHub transaction behavior and native browser permission prompts need separate targeted evidence before deeper restructuring.

## Follow-up QA runner stage

Branch: `codex/modular-qa-runner`, based on merged PR #117. This stage changes QA harness organization only; the application and extension source are unchanged. Node 22 `npm run check` passed (328 pass, 22 skipped, 0 fail; build, sandbox smoke, release package included). The complete packaged extension browser command passed: capture/review, screenshot editor, session replay, session origins, and recording navigation. Exact-revision CI is pending at this point. The inline review and capture setup portion of the runner still needs a later focused split.
