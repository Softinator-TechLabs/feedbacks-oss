# Thread Pin Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let readers hide point markers on each thread screenshot, while point originals use an unnumbered red target circle.

**Architecture:** The extension keeps its approved local annotated export but sends a second rendering without point shapes as the thread screenshot. Point positions and numbers stay in asset `markings`; the thread draws these as a separate layer with per-asset visibility. Legacy annotated images keep their baked pixels and are labeled accordingly.

**Tech Stack:** Chrome extension canvas/IndexedDB, TypeScript, React, CSS, Playwright browser QA.

**Spec:** User request in this chat on 2026-09-28: thread screenshot pins can be hidden independently per screenshot, and visible pins should be smaller and translucent so they obscure less content.

## Global Constraints

- Preserve approved non-pin marks, redactions, image proportions, original links and point-to-image identities.
- A failed upload retry must send the same approved pixels and metadata with its original idempotency key.
- Older images cannot reveal pixels that were already replaced by baked pins.

## Review Focus

- A user hides pins on one screenshot while other screenshot pins stay visible.
- A redacted area stays redacted in the pin-free image.
- A mixed full-page capture retains each page's dimensions and aligned pin coordinates.
- A failed upload cannot switch between annotated and pin-free renditions on retry.
- Legacy annotated assets do not offer a misleading hide action.
- Settings save a capture marker default, while Page Controls override it for the active review.
- No marker preserves point coordinates and screenshot identity without drawing a marker.
- Marker style and size match across the point preview, local export, and thread overlay.

---

### Task 1: Produce pin-free approved captures

**Files:** `extension/editor.js`, `extension/background.js`, `extension/screenshot-render.js`, `scripts/screenshot-editor-qa.mjs`.

**Interfaces:** `imageWithoutPins(type)` paints every approved shape except `point`; `approveCapturePage.imageWithoutPins` stores the page blob; `submit.imageWithoutPins` stores the single-image blob. Upload uses `rendition: "screenshot"` when that approved blob is present.

- [x] Add browser QA proving a point differs between annotated and pin-free pixels while redaction remains.
- [x] Render and store the pin-free pixels separately from local annotated exports.
- [x] Keep the chosen rendition and pixels stable across retry and combined-page rebuilding.
- [x] Pass extension browser QA.

### Task 2: Present controllable pins in thread view

**Files:** `src/web/review-evidence.tsx`, `src/web/thread-detail.css`, `scripts/extension-browser-qa.mjs`.

**Interfaces:** `<EvidenceScreenshot>` draws pins only for `screenshot` assets with point markings, and toggles visibility by asset ID. `annotated` assets show a legacy label instead.

- [x] Add browser QA for independent hide/show and all three point images.
- [x] Render small translucent numbers on the overview and a red hollow target on each point original, aligned to the displayed image.
- [x] Inspect desktop and mobile, light and dark; browser QA checks the toggle.

### Task 3: Document and release

**Files:** `docs/extension.md`, `src/shared/operation-descriptions.ts`, generated operation docs, `DESIGN.md`.

- [x] Explain the new capture behavior and legacy limit.
- [x] Run focused QA, full `npm run check`, and the Impeccable detector.
- [ ] Commit, pass required CI, merge, deploy, and verify the live route.

### Task 4: Configurable capture markers

**Files:** `extension/review-preferences.js`, `extension/options.*`, `extension/content.*`, `extension/background.js`, `extension/screenshot-render.js`, `src/shared/contracts.ts`, `src/web/review-evidence.tsx`, `src/web/thread-detail.css`.

- [x] Save style and size defaults in extension Settings, including No marker.
- [x] Expose the same choices in hover Page Controls as review-scoped overrides.
- [x] Carry choices in capture context and render matching markers or none across captures and thread images.
- [x] Verify the choices through focused unit/browser checks and responsive UI inspection.
