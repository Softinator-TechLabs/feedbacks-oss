# Project administration tabs

Status: local verification complete; release pending. Owner: Feedbacks maintainers. Date: 2026-09-29.

## Outcome and scope

Project Members shows People, Invite, Create user, and Add existing as clear task tabs for owners. Selecting a person stays within People. Project Settings shows Project, Categories & tags, Integrations, and Advanced tabs. Each tab keeps its existing save and permission boundary. Mobile widths keep every tab reachable, and keyboard arrows/Home/End work within a tablist.

## Evidence and approach

The current Members page places three action buttons ahead of the directory and conditionally inserts large forms above it. The current Settings page stacks taxonomy, the project form, website access, GitHub, and advanced controls in one long document. Split presentation at existing component boundaries. Keep panels mounted while hidden so unsaved form drafts and one-time credentials survive tab changes. Preserve the existing `#project-taxonomy` link from feedback.

## Steps and progress

- [x] Inspect both authenticated live routes and the active modular-refactor branch for overlapping file moves.
- [x] Implement accessible tabs and deep links without changing server operations or permissions.
- [x] Verify 320px/660px light/dark layouts, direct links, keyboard controls, and unsaved drafts with synthetic data.
- [x] Run source, browser, and documentation checks; review the diff and coordinate the refactor rebase.
- [ ] Confirm required CI on the pull request and merged main.
- [ ] Deploy the merged revision and verify both live routes.

## Compatibility and recovery

No migration, API, or persistent setting changes are planned. Existing project navigation URLs stay the same. Legacy `#project-taxonomy` selects the Categories & tags tab. A source rollback restores the previous layout without data conversion.

## Decision log

- The directory remains the default Members view. Invite/Create/Add are distinct tasks, not extra fields inside the list.
- Project Settings keeps one form per existing operation boundary. GitHub and Webhooks share Integrations; Scheduled page QA and guest links are under Advanced.
- The in-progress `codex/modular-refactor` branch moved the same web files into feature folders. This change is based on merged `main`, and the refactor must rebase and retain these behaviors before its release.

## Completion receipt

Source revision: pending.
Checks and results: `npm run check` passed (325 tests passed, 20 skipped; sandbox smoke and release checks passed). Synthetic browser checks passed at 320px and 660px in light/dark modes, with direct hashes and tab keyboard controls. Required CI pending.
Artifacts: synthetic browser screenshots retained under ignored `.playwright-cli/`; pull request pending.
Deployment and live verification: pending.
Remaining risks or follow-up: pending.
