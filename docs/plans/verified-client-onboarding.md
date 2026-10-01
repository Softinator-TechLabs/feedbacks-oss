# Verified client installation and onboarding

Status: in progress. Date: 2026-10-01.

## Intended behavior

A developer can distinguish installing a coding client, signing in to its model account, installing Feedbacks tools and importing a personal Feedbacks key. The public quickstart presents the connection as a diagram, keeps troubleshooting collapsed and provides one key-free verification prompt. Preserve existing Setup issuance, scoped access and private credential import.

## Evidence and scope

Actual CLI use exposed a missing terminal command and a stale provider login even though a desktop client was installed. Native plugin installation alone did not prove model/tool access. Tested Claude Code 2.1.286 and Codex CLI 0.159.3 support the documented native commands. Feedbacks tool reads, marked images, denied project access and denied write scopes were verified separately. Detailed operational evidence and credentials remain private.

## Steps

- [x] Inspect Setup, canonical client references and vendor quickstarts.
- [x] Explain the separate account paths with an accessible diagram.
- [x] Add exact symptom/recovery actions and bounded agent verification.
- [x] Verify links, generated manual publication and desktop/mobile rendering.
- [ ] Publish through required CI and verify the live guide.

## Verification and recovery

Run formatting, `npm run check:harness`, `npm run build:site` and the public documentation browser checks. Check diagram accessibility, image loading, collapsed help, code-block copy and no horizontal overflow on desktop and mobile. Required CI remains the merge gate. Revert these documentation and asset changes to recover; no runtime contract, migration or installed client setting changes.

Local checks passed: formatting for Markdown, harness (120 documents), site/manual build and the public browser QA suite at 1440px and 390px. The diagram was visually inspected on both widths.
