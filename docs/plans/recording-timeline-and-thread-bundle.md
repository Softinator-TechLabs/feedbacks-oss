# Recording timeline and portable thread bundle

Status: in progress. Owner: Feedbacks contributors. Date: 2026-09-29.

## Outcome and scope

The pre-send video review and thread viewer place one aligned playhead through the seek rail and event marks. Selecting a mark reveals its exact event inside the diagnostics list without moving the outer page; playback follows the list smoothly by default. The video preview itself toggles play and pause. Editing and capture explanation remain available after the diagnostics, leaving the event feed next to the player.

A download action beside **Copy task for agent** produces a self-contained, authorized thread archive with readable metadata, discussion, points, assets, recording clocks/events and media. A developer can inspect it without Feedbacks or MCP. Existing MCP materialization remains available.

## Evidence and approach

The existing viewers split marks from the seek rail and select the latest event at a timestamp, which loses a clicked mark's identity when several events share that time. The pre-send inspector paginates rows but does not change pages for a selected late mark. The download reuses the authenticated thread/recording/asset read rules and the existing tar.gz archive style; it adds no new package or browser permission.

## Steps and progress

- [x] Reproduce wrong-row and wrong-page mark selection with browser regressions.
- [x] Unify seek geometry, exact-row selection and playback follow in both viewers.
- [x] Move video edit and capture explanations after the evidence feed.
- [x] Add the portable archive with authorization, completeness and content tests.
- [x] Update session-replay guidance, run checks and inspect desktop/mobile renders.
- [ ] Confirm CI, release deployment and live readback.

## Compatibility and recovery

No migration or capture format change. Existing recordings and standalone screenshots remain readable. Archive downloads require current thread and asset access, use generated names, and must fail visibly if complete media cannot be included. Revert the UI/route commit to recover the earlier viewer; stored evidence is unchanged.

## Decision log

- Use one shared event clock per recording. The extension's editable video rail retains its trim handles, but its event markers and playhead share that rail's horizontal geometry.
- Keep secondary editing controls behind a disclosure below the evidence list.
- Keep the human download independent of MCP setup; the MCP materializer remains the agent-oriented private temporary-directory path.

## Completion receipt

Source revision: pending.
Checks and results: `npm run check` passed; 24 recording browser tests passed; portable archive content and authorization tests passed. Desktop light/dark and mobile synthetic review captures were inspected.
Artifacts: pending.
Deployment and live verification: pending.
Remaining risks or follow-up: pending.
