# Project board

Open a project and choose **Board** beside the feedback list. Each card opens the same thread, discussion, screenshots and evidence. Existing project permissions apply in both views. New feedback enters **Intake**. The default columns are Intake, In progress, Ready for review and Done; Done includes Resolved and Declined.

A maintainer can open **Configure columns** to rename, reorder or group the five existing work statuses into one to five columns. Every status belongs to exactly one column. The intake column contains Open, and each column chooses the status saved when a card moves there. Configuration changes do not rewrite existing feedback or create another status system.

## Triage and batch changes

The board shares category, tag, search, device, author, work status, planning and archive filters with the list. Column totals cover every matching feedback item; each lane pages through 15 cards. Finished items are shown by default on the board. The list and board links preserve the selected filters.

Drag a card to another column, or select cards and use the keyboard-accessible action controls to move, assign, unassign or archive. Select at most 50 cards. Batch changes validate all current thread revisions, assignment versions and the board configuration before saving. A denied or stale item cancels the entire batch; reload and review the selection before retrying. A successful receipt gives the affected count. Network retries reuse the same request identity.

Assignment does not grant project access. Eligible assignees need current write access; changing assignments never starts an agent. Resolution still requires resolution permission. Read-only members can inspect cards but cannot change them. Priority, duplicate review and discussion remain available in the thread. On a small screen, board lanes stack vertically with their own card pagination. The feedback list remains available as a compact alternative.

## API and verification

The shared contracts expose `board.get`, `board.column`, `board.configure` and `board.batch`. Agent keys must explicitly include these scopes and the underlying action scopes; adding a board scope does not grant status, assignment or archive permission. Existing keys retain their grants. See the [operation catalog](generated/operations.md).

Source: [board operations](../src/server/board.ts), [configuration contract](../src/shared/board.ts) and [board interface](../src/web/board/index.tsx). [Domain checks](../tests/board.test.ts) cover permissions, conflicts and rollback. Run `FEEDBACKS_BOARD_BROWSER_SMOKE=1 node --import tsx --test tests/board-browser.test.ts` after building for synthetic desktop/mobile, keyboard, pagination, assignment and drag/drop acceptance. These checks use a disposable local app; live deployment is a separate gate.
