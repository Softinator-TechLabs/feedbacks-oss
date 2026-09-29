# Plan: visible screenshot capture progress

Status: implemented and locally verified; PR integration pending. Owner: Feedbacks contributors. Date: 2026-09-29.

## Outcome and scope

During user initiated screenshot capture, show the active collection and save stage on the source page. Keep that status out of captured pixels and remove it after success, failure or review exit. Applies to visible, point-finalization and full-page capture. No new permissions or server contracts.

## Evidence and approach

The popup closes when Capture view starts and the review host hides before diagnostic streaming, leaving multi-second DOM captures with no visible progress. A separate closed-shadow status host lets the review controls stay hidden while progress remains visible. The capture workflow reports real boundaries and the DOM stream reports completed channels; no estimated percentage is shown. Native screenshot callbacks hide the status before capture and restore it after pixels are taken. The packaged browser regression uses a synthetic 5.4 MiB DOM and checks the status labels and captured pixels.

## Steps and progress

- [x] Reproduce the silent large-DOM capture with a failing packaged browser regression.
- [x] Implement source-page status, diagnostic stage callbacks and screenshot pixel isolation.
- [x] Update the extension guide.
- [x] Complete browser, repository and release checks; review the diff and record the final revision.

## Compatibility and recovery

This only adds an extension message and local UI. Existing drafts and evidence objects are unchanged. If a progress message cannot reach the page, capture continues through the existing path; restoring the page also removes any status host.

## Decision log

- 2026-09-29: Use named stages instead of time-based percentages because DOM, storage and image sizes vary by page.
- 2026-09-29: Keep progress in a separate host so hiding review controls cannot hide the stage, and hide it at the native pixel boundary.

## Completion receipt

Source revision: `codex/capture-progress` branch; exact commit and PR are recorded in the repository history.
Checks and results: `npm run check` and `npm run qa:extension-browser` passed; packaged browser QA captured a 5.4 MiB DOM in six chunks and verified the progress status was absent from screenshot pixels. Impeccable detector returned no findings.
Artifacts: extension 0.1.46 ZIP, SHA-256 `83808edee54e03f3d00a4815275095279730a13c019aa0ac1ab8b9336fad58f9`; synthetic [desktop](../screenshots/extension-capture-progress/desktop.png) and [mobile](../screenshots/extension-capture-progress/mobile.png) status screenshots.
Deployment and live verification: no production deployment or installed-browser update in this local change.
Remaining risks or follow-up: Real large-site timing and installed-extension proof remain to be checked after release.
