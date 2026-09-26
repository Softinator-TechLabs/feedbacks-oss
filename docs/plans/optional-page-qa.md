# Plan: optional page QA scan

Status: isolated Chromium acceptance passed; Store-installed acceptance and publication pending. Owner: Feedbacks maintainers. Date: 2026-09-26.

## Outcome and scope

Give a reviewer an explicit scan action in the browser extension for missing image alt attributes and same-origin broken links. Findings enter an editable feedback draft with a screenshot. Nothing is published until the reviewer chooses Send. The current project selection scopes the draft. No new Chrome permission or server operation is required.

## Evidence and approach

The extension already has an active-page review gesture and a local draft editor. A scan that runs inside that review session can reuse the existing capture, redaction and submission boundaries. Check a bounded number of links with HEAD, report only 404 and 410, and treat all other network outcomes as unknown. Never crawl another page or follow cross-origin redirects.

## Steps and progress

- [x] Trace the review and capture path.
- [x] Implement the explicit scan, bounded report and editable draft handoff.
- [x] Add focused validation tests and run the package checks.
- [x] Verify actual browser behavior on a controlled page in isolated Chromium.
- [ ] Confirm optional permission flow and scan in the Store-installed Chrome extension after publication.
- [x] Update extension guidance.

## Compatibility and recovery

Existing captures and drafts remain unchanged. Unsupported HEAD requests may leave a broken link unreported; a missing finding is not a clean bill of health. Re-running the scan is safe but sends another bounded set of HEAD requests to the reviewed site. The reviewer can discard the draft before any Feedbacks submission.

## Decision log

- Keep the first scanner local and deterministic. Do not publish agent-generated findings or scan cross-origin websites automatically.

## Completion receipt

Source revision: PR [#30](https://github.com/Softinator-TechLabs/feedbacks-oss/pull/30), merged as `5d29c7c`.
Checks and results: `npm run check` passed on 2026-09-24, including popup, report, package, sandbox and release checks. On 2026-09-26, `npm run qa:extension-browser` opened a controlled page with a missing image alt attribute and a same-origin 404 link. The explicit scan created a local draft containing both findings and a screenshot, then the draft was discarded without publication.
Artifacts: extension 0.1.15 source and a versioned ZIP.
Deployment and live verification: the controlled browser test uses extension runtime files with test-only host grants in a temporary copy. The public Chrome Web Store listing served 0.1.11 on 2026-09-26; the uploaded 0.1.15 package has not been observed live.
Remaining risks or follow-up: HEAD requests can be unsupported or misleading on a site. The reviewer must confirm and edit every finding before sending.
