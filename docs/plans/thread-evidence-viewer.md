# Thread evidence types and expanded screenshot review

Status: implemented; CI and integration pending. Date: 2026-09-30.

## Outcome and scope

Hide the recording section when a thread has no recording or video. Identify text,
text edits, screenshots, full-page captures, documents, video and session recordings
in the feedback list, including mixed evidence. Expand screenshot evidence with the
same point, element-outline and text-selection layers used in the inline review.
Keep editing in that viewer, standardize control heights, and present large point
sets as five compact rows per page with independent and bulk expansion.

## Evidence and approach

The recording viewer previously rendered an empty section after a successful empty
listing. Screenshot links opened the raw file, which cannot include browser-rendered
layers. List attachment counts could not identify session-only recordings.

Reuse the screenshot rendering and layer state in a native modal dialog with zoom
and scrolling. Keep original-file access explicitly labeled. Add only recording mode
metadata to thread reads, bulk-loaded for list pages; no recording events are loaded
by the list. Derive other labels from existing evidence metadata.

## Steps and progress

- [x] Reproduce the empty section and raw-image behavior; establish acceptance cases.
- [x] Add regression assertions for capture labels, recording metadata and expansion.
- [x] Implement and verify desktop/mobile, overlay alignment and keyboard dismissal.
- [x] Keep view/edit in one dialog, preserving zoom, layers and failed-save drafts.
- [x] Add compact point summaries, pagination, filtering and direct-link reveal.
- [x] Add Expand all / Collapse all with reduced-motion-aware transitions.
- [x] Update canonical review docs and generated contracts.
- [x] Review diff and complete the repository check matrix.

## Compatibility and recovery

The optional `recordingModes` response field is additive. Older snapshots remain
valid; older responses retain recording discovery through `recordings.list`. List
reads fetch only distinct recording modes for already-authorized thread IDs. No
migration, object rewrite, new permission or dependency is required. Reverting the
application change restores the previous presentation without data conversion.

## Verification

- `npm run check`: passed; includes formatting,
  boundaries/docs, types, tests, all builds, isolated app smoke and release checks.
- Explicit Chromium tests: expanded-image layers/zoom/focus on desktop and mobile,
  empty recording sections, replay diagnostics and video frame saving passed.
- Independent code review found a viewport/full-page classification edge case;
  corrected with a regression case using real capture metadata shape.
- [Desktop list](../screenshots/thread-evidence-viewer/list-desktop.png),
  [mobile list](../screenshots/thread-evidence-viewer/list-mobile.png),
  [desktop viewer](../screenshots/thread-evidence-viewer/expanded-desktop.png) and
  [mobile viewer](../screenshots/thread-evidence-viewer/expanded-mobile.png) use
  synthetic content. Reproduce with `FEEDBACKS_RECORDING_BROWSER_SMOKE=1 node
--import tsx --test tests/evidence-viewer-browser.test.ts`.
- Follow-up Chromium evidence covers same-dialog editing, failed-save retry,
  cancel, twenty-point pagination, filters and keyboard interaction. Desktop/mobile
  screenshots: [editing](../screenshots/thread-evidence-viewer/edit-desktop.png),
  [mobile editing](../screenshots/thread-evidence-viewer/edit-mobile.png),
  [points](../screenshots/thread-evidence-viewer/points-desktop.png),
  [mobile points](../screenshots/thread-evidence-viewer/points-mobile.png),
  [grouped point controls](../screenshots/thread-evidence-viewer/point-layout-desktop.png)
  and [mobile point controls](../screenshots/thread-evidence-viewer/point-layout-mobile.png).
- Independent follow-up review found stale navigation hashes being reapplied after
  saving. Point and asset hashes now run only on navigation, with regressions for
  planning and editing after moving to a different point.
- Packaged extension acceptance opens the point accordions and expanded viewer
  before using their controls, preserving layer independence, planning readback,
  resolve/remove/restore and same-dialog editing checks. `npm run qa:extension-browser`
  passed after updating these navigation steps.
- CI, merge, deployment and production verification remain pending.
