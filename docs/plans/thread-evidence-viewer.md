# Thread evidence types and expanded screenshot review

Status: implemented; CI and integration pending. Date: 2026-09-30.

## Outcome and scope

Hide the recording section when a thread has no recording or video. Identify text,
text edits, screenshots, full-page captures, documents, video and session recordings
in the feedback list, including mixed evidence. Expand screenshot evidence with the
same point, element-outline and text-selection layers used in the inline review.

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
- [x] Update canonical review docs and generated contracts.
- [x] Review diff and complete the repository check matrix.

## Compatibility and recovery

The optional `recordingModes` response field is additive. Older snapshots remain
valid; older responses retain recording discovery through `recordings.list`. List
reads fetch only distinct recording modes for already-authorized thread IDs. No
migration, object rewrite, new permission or dependency is required. Reverting the
application change restores the previous presentation without data conversion.

## Verification

- `npm run check`: passed (433 passed, 25 opt-in tests skipped); includes formatting,
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
- CI, merge, deployment and production verification remain pending.
