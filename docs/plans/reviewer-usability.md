# Plan: Review capture and source navigation

Status: in progress. Owner: Feedbacks maintainers. Date: 2026-10-21.

## Outcome and scope

Keep app screenshots usable at desktop and mobile sizes, allow reviewers to move or remove an unsent point beside the image, and edit survey choices as individual fields. Keep list selection readable in both themes and expose a clear document or website source link on the list and thread. Prevent hover-open page controls from covering an active comment editor. Investigate reported archive persistence before changing its behavior.

## Evidence and approach

The capture preview currently expands to the form width regardless of image height; its point markers are noninteractive. Source links in the thread are icon-only and the list labels document links as websites. The light list focus background lacks a dark counterpart. Survey creation accepts newline-separated choices. Reproduce these with synthetic content in the existing app capture and browser acceptance harnesses.

## Steps and progress

- [x] Read the selected evidence, check assignments and agree on enhancement scope.
- [x] Reproduce compact capture, selection, source links, survey choices and archive navigation.
- [x] Implement regression coverage and focused UI fixes.
- [ ] Verify page-control hover behavior and package the extension change.
- [ ] Update canonical guides; review the diff and run required checks.
- [ ] Merge through CI, verify deployment and release artifacts, and record remaining client gates.

## Compatibility and recovery

Keep existing API contracts, point identifiers, normalized image coordinates, redaction/export resolution and approved draft retry identity. No dependency, database migration, authorization or Chrome permission changes are planned. Existing published survey links remain immutable. Archive and permanent deletion remain separate actions.

## Decision log

- Preserve the existing product and theme system. Use visible source text rather than requiring discovery of an icon.
- Investigate archive persistence independently; an empty archive view is not proof that a saved thread was unarchived.
- Clarified archive behavior: the list's Archive control currently switches views. Label it **View archive** and add **Archive selected** beside selection controls. Preserve per-thread server authorization and revisions; report confirmed partial completion if an operation fails.
- Installed extension and Chrome Web Store acceptance remain separate from hosted web deployment and a published ZIP.

## Completion receipt

Source revision: pending.
Checks and results: targeted app capture, modal comment and reviewer workflow browser tests passed. Full checks and packaged extension acceptance pending.
Artifacts: pending.
Deployment and live verification: pending.
Remaining risks or follow-up: archive reproduction and installed extension acceptance.
