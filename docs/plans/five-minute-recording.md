# Five-minute review recordings

Status: completed. Date: 2026-09-27.

## Outcome

Record up to five minutes of a Chrome tab, with separate opt-in tab audio and microphone controls. Use compressed WebM with browser codec detection. Page Controls expose highlighting (on for normal review), click indicators, and navigation. Recording defaults to highlighting off and navigation allowed; stopping restores normal review choices.

Keep the recorder's initial project and source context while navigating. Preview before sending, with optional local trim/crop and a recoverable original. No new installed codec or extension permission is required. Native microphone and tab selection remain explicit browser prompts.

## Steps

- [x] Inspect recorder, upload contracts, lifecycle and existing browser tests.
- [x] Implement media controls, local editing and coherent duration/upload limits.
- [x] Verify real MediaRecorder output with synthetic media, source-page controls and failure paths.
- [x] Check desktop/mobile UI, documentation, CI, package and deployment.

## Decisions and risks

WebM VP9/Opus, with VP8 fallback, fits Chrome desktop. AVIF is a still-image format. Limit recordings to 40 MiB and target 1 Mbps video plus 64 Kbps audio at up to 1600 × 900 / 24 fps. Pause time is excluded. Editing re-encodes locally at playback speed and preserves the original until discarded or sent. Windows/Ubuntu native picker and microphone behavior require platform testing; automated browser evidence must not be presented as native OS evidence.

## Verification receipt

Local `npm run check`: 130 tests, 126 passed, four explicitly skipped; formatting, architecture/docs, types, builds, sandbox smoke and release checks passed. Focused checks cover every audio-source combination, five-minute active-time cutoff, source cleanup, invalid crop bounds, recording-context binding, duration validation and a video HTTP request larger than the old 14 MiB transport limit. Real Chromium MediaRecorder checks cover pause/resume, navigation, crop export and restoring the original. Independent review found and verified a millisecond rounding repair for crop-only edits.

All six CI jobs passed for PR #80. Deployment at b266084 and the public v0.1.27 ZIP were verified; every ZIP entry matched the tested local build. Windows/Ubuntu native media-picker and microphone-device testing remains unperformed.
