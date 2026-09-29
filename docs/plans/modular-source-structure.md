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
- [ ] Group project and account settings by feature, and split broad web CSS by the same ownership boundaries without changing cascade order.
- [ ] Divide shared operation schemas into domain modules under `src/shared/contracts/`, preserving the single typed operation registry and generated catalog.
- [ ] Extract extension capture, editing, and session concerns into focused folders while keeping manifest entrypoints, Chrome message behavior, and ZIP contents compatible.
- [ ] Split extension browser QA into a common fixture and independently identifiable workflow scenarios.
- [ ] Reassess server transport and dispatch for focused extraction; preserve transaction and authorization boundaries.
- [ ] Run focused checks after every stage, then the full check, extension browser acceptance, native PostgreSQL checks where server behavior changes, and exact-revision CI. Review the final diff and update architecture and quality guidance.

## Compatibility and recovery

No migration, object-key, token, permission, or public operation name change is intended. Structural moves must update every import, test fixture, build entrypoint, packaging allowlist, and documentation link that names a file. Use small commits so an individual stage can be reverted without reverting the others. A passing unit suite alone does not prove Chrome-installed or deployed behavior; keep those as separate evidence gates.

## Decision log

- 2026-09-29: Work from current `feedbacks-oss/main`, not the private foundation checkout. Preserve browser entrypoint filenames where the manifest, HTML, or packaging refers to them.
- 2026-09-29: Favor feature folders over splitting only by file type; do not add wrapper files solely to make the top level appear smaller.
- 2026-09-29: The first web stage passed the full Node 22 check and three Chromium recording-viewer scenarios. No product behavior was changed.

## Completion receipt

Source revision: pending.
Checks and results: baseline `npm run check` passed on `c7b1e22` with Node 22; refactor checks pending.
Artifacts: pending.
Deployment and live verification: outside scope of this source refactor; no deployment performed.
Remaining risks or follow-up: pending.
