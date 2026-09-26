# Plan: local diagnostic message masking

Status: isolated Chromium acceptance passed; Store-installed acceptance and publication pending. Owner: Feedbacks maintainers. Date: 2026-09-26.

## Outcome and scope

Reviewers can mask a selected substring of an opt-in console diagnostic before sending feedback. The browser extension rewrites the stored local draft with a redacted value. The existing entry exclusion and explicit sharing toggle remain. No new Chrome permission or server API field is needed.

## Evidence and approach

The [extension guide](../extension.md) describes whole-entry exclusion, but unusual console text can still contain private information. The editor selects a substring; the background context applies the replacement to the saved diagnostic entry. The editor cannot submit arbitrary replacement text.

## Steps and progress

- [x] Inspect local diagnostics capture and submission boundaries.
- [x] Implement selected-text masking and focused bounds tests.
- [x] Check draft transformation and built package.
- [x] Exercise selection, persistence and submission in isolated Chromium.
- [ ] Confirm optional permission flow and masking in the Store-installed Chrome extension after publication.
- [x] Update documentation and verification receipt.

## Compatibility and recovery

Existing drafts remain readable. Masking is one-way within the local draft; capture again to recover removed text. A failed mask leaves the entry unchanged and sharing remains opt-in. Console data is still untrusted after masking.

## Decision log

- Restrict editor input to selection offsets rather than arbitrary replacement text.

## Completion receipt

Source revision: PR [#29](https://github.com/Softinator-TechLabs/feedbacks-oss/pull/29), merged as `1a9c015`.
Checks and results: `npm run check` passed on 2026-09-24; masking and frozen-draft tests passed. On 2026-09-26, `npm run qa:extension-browser` selected a substring in the real editor, masked it, reloaded the editor, sent the opt-in diagnostic to a disposable local sandbox and read the saved thread back without the original substring.
Artifacts: masking is included in extension source version 0.1.15 and its versioned ZIP.
Deployment and live verification: the controlled browser test uses the extension runtime files with test-only host grants in a temporary copy. It does not exercise the Store-installed permission prompt. The public Chrome Web Store listing served 0.1.11 on 2026-09-26; the uploaded 0.1.15 package has not been observed live.
Remaining risks or follow-up: reviewers must still inspect entries and choose sharing explicitly. Masking does not make diagnostics trusted data.
