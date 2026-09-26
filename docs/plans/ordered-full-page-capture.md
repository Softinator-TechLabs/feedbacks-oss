# Plan: ordered full-page screenshots

Status: source and isolated Chromium acceptance passed; Chrome Web Store publication remains separate. Owner: Feedbacks maintainers. Date: 2026-09-26.

## Outcome

Capture a long web page as a sequence of viewport-sized images instead of one downscaled image. Give every page a stable `full-page-001-of-043.webp` style name, crop overlaps, show the order in the editor, and upload every reviewed image in that order. Do not impose an arbitrary screenshot-count or whole-page pixel limit.

## Approach

- Keep the existing explicit **Capture full page** action and `activeTab` permission. Capture one page at a time at the Chrome API's supported rate.
- Store each local image as a Blob in extension IndexedDB. Keep the draft record and per-page annotation state in trusted extension storage. Never store one giant base64 image.
- Review, annotate and permanently redact pages individually. Freeze an approved image for each page before thread creation; send sequentially with a stable idempotency key per page. A failed upload resumes at the first unsent page.
- Save the ordered filename with each private asset. Show it on the thread and in the GitHub Issue attachment list. Agents can fetch individual assets instead of decoding one huge combined image.
- Keep practical per-image server limits and browser storage errors explicit. A failed capture clears incomplete local images, restores scroll and leaves a context-only draft with a visible-area retry.

## Acceptance criteria

- A controlled page requiring more than eight screenshots yields all ordered page images, with no repeated overlap and no shrink-to-fit step.
- Editor navigation, per-page annotation and redaction, persisted draft reload, and all-page approval work.
- Thread assets retain each filename and order; an interrupted upload resumes without duplicate attachments.
- Existing visible-area captures and drafts remain compatible. Permission status remains visible in the popup.
- Focused tests, isolated browser acceptance, full repository checks and extension package pass; Store installation is a separate release gate.

## Decision log

- Use IndexedDB because Chrome local storage's aggregate quota is too small for a long page. Preserve local-only pixels until Send.
- Preserve the server's per-image upload limit. “No limit” means no arbitrary page-count cap, not unlimited device disk or network capacity.

## Verification receipt

`npm run check`, `npm run test:postgres`, `npm audit --audit-level=high` and `npm run qa:extension-browser` passed on 2026-09-26. The isolated Chromium run captured a 22,000px page as 28 images and a 35,000px page as 44 images; the last page was cropped to its remaining pixels and the original scroll position was restored. A four-image series was navigated, its second page permanently redacted, and submission was interrupted at image two. Retry resumed from image two; readback returned the four ordered asset filenames and cleared the local draft. A changing page kept no captured image. The popup and editor were visually inspected in the isolated browser. Store-installed acceptance and publication remain unverified.
