# Discussion comment edit and delete

Status: local verification passed; CI and deployment pending. Owner: Feedbacks contributors. Date: 2026-09-29.

## Outcome and scope

Signed-in project members can edit or delete their own earlier discussion replies in a thread. Editing keeps the original posting time and shows an **Edited on** timestamp. Deleting removes the reply and its likes from current reads. The original feedback body, guest replies and agent replies are outside this change.

## Evidence and approach

`threads.reply` currently inserts into `replies`; `fullThread` only reads them, and `ThreadDetail` renders replies without management actions. Add two shared operations with server-side project and author checks. Keep reply bodies in the existing JSON column, so no migration is needed. Recalculate the thread's response summary after deletion and advance its revision/event cursor for both mutations. Use direct inline controls in the existing discussion layout.

## Steps and progress

- [x] Inspect the current reply contract, storage, permissions, UI and tests.
- [x] Add failing service tests for author edit/delete, denial, stale revision, readback and response recalculation.
- [x] Implement the shared operations and server behavior; generate the operation catalog.
- [x] Add the inline edit/delete UI with draft preservation and visible edit time.
- [x] Update the review/API guides, review the diff and run focused plus full checks, including desktop/mobile keyboard evidence.

## Compatibility and recovery

Existing replies have no `editedAt` and display normally. Existing agent keys receive no new scope. No persistent schema or object key changes are required. Deletion cannot restore a reply from current storage; existing immutable export snapshots may still contain earlier content until expiry, while new reads reflect the deletion.

## Decision log

- Keep management author-only for signed-in human accounts. An extension reply attributed to that account is eligible; guest and agent replies are not.
- Confirm deletion in the browser because it is irreversible.
- Keep original `createdAt`; set `editedAt` only after a successful edit.

## Completion receipt

Source revision: recorded on the associated pull request from `codex/discussion-edit-delete`.
Checks and results: Node 24 `npm run check` passed; focused service tests passed; synthetic browser edit/delete, desktop/mobile layout, keyboard actions and reload readback passed. The first full-suite attempt had one diagnostic-evidence-upload test failure that passed in isolation and on the full rerun.
Artifacts: ignored `output/playwright/discussion-edit-desktop.png` and `discussion-edit-mobile.png`.
Deployment and live verification: pending.
Remaining risks or follow-up: required PR CI and live rollout remain separate gates.
