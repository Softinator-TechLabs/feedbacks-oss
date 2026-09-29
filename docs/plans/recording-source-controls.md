# Source-page recording controls and video upload progress

Status: in progress. Owner: Feedbacks extension. Date: 2026-09-29.

## Outcome and scope

Record video or a session from the reviewed website with one click. Before starting, the page controls expose the relevant saved audio, privacy, and exact redirect-origin choices. During capture, the same compact controls show the clock, Pause/Resume (video), Stop, and capture health. The video recorder runs in a hidden Chrome offscreen document; a visible review tab opens only after Stop. The completed review does not show a stale recording setup form. Send video displays actual browser upload-byte progress in the button and an accessible status, then distinguishes video, diagnostics, and frame confirmation.

Existing screenshot review and session-only recording remain usable. A failed send retains the draft thread link and local video for retry. A pending capture from an older extension version is not migrated by this change.

## Evidence and approach

The reported 0.1.38 screenshot shows an extra `video.html` tab with pre-recording settings after Send. `extension/recording-controls.js` creates that tab at Start; `extension/video.js` owns MediaRecorder and reverts to the setup layout after successful submission. `assets.uploadVideo` uses background `fetch` without an upload progress channel. Chrome's offscreen API supports a hidden document and, since Chrome 116, a service-worker tab-capture stream ID can be consumed there. Move media collection to that document, persist the bounded Blob in extension IndexedDB for the review handoff, and keep server authorization in the background. A verified extension review page can perform the upload through XHR with a short-lived worker-provided credential and report sent bytes; 100% means transport sent, with a separate server-confirmation state.

## Steps and progress

- [x] Reproduce the layout/lifecycle from current source and the user's capture; identify upload transport limits.
- [x] Cover no start-time tab, source-page options, Stop-to-review handoff, retry retention, and byte-progress states.
- [x] Implement offscreen capture and bounded local review handoff; preserve pause, stop, navigation, diagnostics, and account binding.
- [x] Move recording settings into contextual page controls and remove stale settings from the video review page.
- [x] Add honest upload progress, button fill, error/retry states, and accessible announcements.
- [ ] Update extension packaging/docs; run focused browser, full check, CI, package, and live release gates.

## Compatibility and recovery

The extension adds Chrome's `offscreen` permission and moves local video storage to IndexedDB. No server schema change is intended. Keep existing authenticated upload idempotency keys and thread revision handling. On recording failure, release tracks and expose a recoverable error on the source page. On failed send, retain the local Blob until retry or explicit discard; do not call a draft link a completed video.

## Decision log

- A hidden recorder is required to avoid an unexplained tab in the tab strip. A background tab styled differently would still expose that tab and would not meet the request.
- The source-page controls own pre-start choices; the review page owns trim, crop, frame selection, comment, and Send.
- Upload percent represents bytes handed to the browser transport, then waits visibly for server confirmation. Only a successful response marks video as uploaded.

## Completion receipt

Source revision: pending.
Checks and results: pending.
Artifacts: pending.
Deployment and live verification: pending.
Remaining risks or follow-up: pending.
