# Plan: local diagnostic message masking

Status: source complete, Chrome smoke pending. Owner: Feedbacks maintainers. Date: 2026-09-24.

## Outcome and scope

Reviewers can mask a selected substring of an opt-in console diagnostic before sending feedback. The browser extension rewrites the stored local draft with a redacted value. The existing entry exclusion and explicit sharing toggle remain. No new Chrome permission or server API field is needed.

## Evidence and approach

The [extension guide](../extension.md) describes whole-entry exclusion, but unusual console text can still contain private information. The editor selects a substring; the background context applies the replacement to the saved diagnostic entry. The editor cannot submit arbitrary replacement text.

## Steps and progress

- [x] Inspect local diagnostics capture and submission boundaries.
- [x] Implement selected-text masking and focused bounds tests.
- [x] Check draft transformation and built package.
- [ ] Exercise selection, persistence and submission in Chrome.
- [x] Update documentation and verification receipt.

## Compatibility and recovery

Existing drafts remain readable. Masking is one-way within the local draft; capture again to recover removed text. A failed mask leaves the entry unchanged and sharing remains opt-in. Console data is still untrusted after masking.

## Decision log

- Restrict editor input to selection offsets rather than arbitrary replacement text.

## Completion receipt

Source revision: pending merge.
Checks and results: `npm run check` passed on 2026-09-24; masking and frozen-draft tests passed. Browser smoke remains pending.
Artifacts: extension 0.1.14 source and a local versioned ZIP.
Deployment and live verification: not deployed; Chrome Web Store submission is separate.
Remaining risks or follow-up: reviewers must still inspect entries and choose sharing explicitly. Masking does not make diagnostics trusted data.
