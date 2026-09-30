# Selected text edits and screenshot evidence layers

Status: implemented and locally verified. [PR #159](https://github.com/Softinator-TechLabs/feedbacks-oss/pull/159). Production release pending. Date: 2026-09-30.

## Outcome

In active page review, selecting eligible text exposes **Suggest edit** beside the selection. The reviewer sees the exact original text and enters a replacement, including an empty replacement for deletion. Saving creates a local point, and Review & send preserves the original/replacement pair in the existing thread and agent contracts. Right-click remains an element-comment action. Hover outlines remain a temporary targeting aid.

Screenshots retain point, element and text-selection geometry separately from approved image pixels. The capture editor and thread view provide independent visibility controls. Points and text selection start visible; element outlines start hidden because they are supporting element context. Visibility never removes evidence or changes the suggested text. Existing images with baked marks retain their limitation label.

## Steps

- [x] Add bounded text-edit contracts and independent evidence geometry.
- [x] Add selection action, safe-field exclusions, before/after entry and draft editing.
- [x] Add capture-editor and thread-view layer controls, including before/after presentation.
- [x] Verify synthetic selection, keyboard, stale selection, capture/readback and responsive behavior.
- [x] Run required checks, inspect packaged extension and prepare the PR.

## Compatibility and verification

New annotation fields are optional; existing points and screenshots remain readable. Inputs, editable regions and hidden content are excluded from suggestions. The reviewed website is never edited. Native selection is cleared before the screenshot is saved so highlights remain removable. Focused contract/geometry tests and browser QA establish the selection-to-thread path; a built package does not prove an installed Store release.

## Verification receipts

- `npm run check`: 430 passed, 24 skipped; formatting, contracts, types, builds, sandbox smoke and release checks passed.
- Selection browser acceptance covers mouse and keyboard action, private/editable exclusions, stale selection, deletion, draft editing, independent layers, failed-send retry, thread/reply controls, list preview, search and issue handoff.
- Geometry checks cover full-page selection, ordinary inline text, boxless text, overflow clipping and transformed iframes.
- Screenshot-editor browser QA passed drawing, crop, image/PDF/clipboard exports and permanent redaction. The evidence controls live inside the image stage so desktop thumbnails retain their own column.
- Original and replacement text use labels and spacing, with no side accent border.
- `npm run qa:extension-browser`: all five scripts passed, including packaged review, screenshot editor, replay, origin isolation and navigation.
- `npm run qa:recording-browser`: 25 passed with no skips. The frame test uses a valid thread context and asserts that saved point geometry is absent from image pixels.
- ZIP 0.1.50 matches the final source and preserves manifest permissions. SHA-256: `aec042635a9f46f88de33c5eda16abd8bd84ecae550a4367cee6d1ee4bcf83ca`.
