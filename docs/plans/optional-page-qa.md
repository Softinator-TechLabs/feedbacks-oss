# Plan: optional page QA scan

Status: source complete, Chrome smoke pending. Owner: Feedbacks maintainers. Date: 2026-09-24.

## Outcome and scope

Give a reviewer an explicit scan action in the browser extension for missing image alt attributes and same-origin broken links. Findings enter an editable feedback draft with a screenshot. Nothing is published until the reviewer chooses Send. The current project selection scopes the draft. No new Chrome permission or server operation is required.

## Evidence and approach

The extension already has an active-page review gesture and a local draft editor. A scan that runs inside that review session can reuse the existing capture, redaction and submission boundaries. Check a bounded number of links with HEAD, report only 404 and 410, and treat all other network outcomes as unknown. Never crawl another page or follow cross-origin redirects.

## Steps and progress

- [x] Trace the review and capture path.
- [x] Implement the explicit scan, bounded report and editable draft handoff.
- [x] Add focused validation tests and run the package checks.
- [ ] Verify actual browser behavior on a controlled page.
- [x] Update extension guidance.

## Compatibility and recovery

Existing captures and drafts remain unchanged. Unsupported HEAD requests may leave a broken link unreported; a missing finding is not a clean bill of health. Re-running the scan is safe but sends another bounded set of HEAD requests to the reviewed site. The reviewer can discard the draft before any Feedbacks submission.

## Decision log

- Keep the first scanner local and deterministic. Do not publish agent-generated findings or scan cross-origin websites automatically.

## Completion receipt

Source revision: pending merge.
Checks and results: `npm run check` passed on 2026-09-24, including popup, report, package, sandbox and release checks. Chrome browser smoke is pending.
Artifacts: extension 0.1.15 source and a local versioned ZIP.
Deployment and live verification: not deployed; Chrome Web Store publication is separate.
Remaining risks or follow-up: HEAD requests can be unsupported or misleading on a site. The reviewer must confirm and edit every finding before sending.
