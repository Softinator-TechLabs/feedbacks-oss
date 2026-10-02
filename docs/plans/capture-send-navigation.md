# Plan: capture sending and destination

Status: completed for implementation and local verification. Date: 2026-10-02.

## Outcome and scope

Screenshot and video review offer **Send & Return** and **Send & Open**. Background sending immediately focuses the reviewed website, retains the capture page during all uploads, and closes that page after success. Foreground sending retains progress and opens the completed thread in the same tab. Normal success requires no confirmation screen.

## Evidence and approach

Before this change, the [screenshot editor](../../extension/editor.js) shows a completion screen and the [video review](../../extension/video.js) leaves a thread link after sending. Reuse both submission paths, including image approval, revision checks, idempotency and partial-upload recovery. A shared [navigation helper](../../extension/submission/review-navigation.js) changes only the destination and recovery focus.

## Steps and progress

- [x] Inspect screenshot and video submission, including selected diagnostic and saved-frame uploads.
- [x] Add two explicit actions and completion navigation without new permissions or API changes.
- [x] Verify delayed success, failure/retry, missing source tab and responsive keyboard controls.
- [x] Update canonical guides and browser acceptance checks.
- [x] Run repository checks and build the versioned extension package.

## Compatibility and recovery

No server, storage schema or permission changes. Uploads continue in the open review tab. A background failure focuses that tab and preserves existing retry state. If the website tab has closed, background sending leaves the draft intact and offers foreground sending. Closing the capture tab manually before sending completes can interrupt uploads. The existing completion/link fallback remains available only if post-send navigation fails or the screenshot editor opens without a draft.

## Completion receipt

Source: `codex/capture-send-flow`, based on `50180cf`.

Verification:

- Full repository gates with Node 24 and two test workers: formatting, harness/docs, types, 511 passed / 38 optional skips / 0 failed, all builds, isolated smoke and release checks.
- [Capture send browser checks](../../tests/capture-send-browser.test.ts): delayed upload, website focus before completion, failure recovery, retry to both destinations, light/dark desktop/mobile layout and keyboard focus.
- [Packaged navigation acceptance](../../scripts/qa/extension/capture/send-navigation.mjs): actual website activation, capture tab alive during delayed upload, capture tab removal after success and authorized image readback.
- Packaged video acceptance retains assignment and retry idempotency, returns to the source and closes the capture tab after a successful retry.
- Recording browser suite: 42 passed / 0 skipped / 0 failed. Screenshot editor, session replay, allowed redirects and recording navigation scenarios passed.
- Recording navigation acceptance now awaits Chrome status responses in Node. An async Playwright predicate previously ended polling before the returned boolean was checked. Save/Cancel and evidence-leakage assertions remain enforced.

Artifact: `feedbacks-extension-0.1.58.zip`, with the manifest at ZIP root, the navigation module included and permissions preserved.

PR CI, merge, deployment and Chrome Web Store publication are separate delivery gates.
