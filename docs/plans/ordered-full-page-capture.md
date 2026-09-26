# Plan: ordered full-page screenshots

Status: source and isolated Chromium acceptance passed; Chrome Web Store publication remains separate. Owner: Feedbacks maintainers. Date: 2026-09-26.

## Outcome

Capture a long web page as a sequence of viewport-sized images instead of one downscaled image. Give every page a stable `full-page-001-of-043.webp` style name, crop overlaps, show the order in the editor, and upload every reviewed image in that order. Do not impose an arbitrary screenshot-count or whole-page pixel limit.

## Approach

- Keep the existing explicit **Capture full page** action and `activeTab` permission. Capture one page at a time at the Chrome API's supported rate.
- Store each local image as a Blob in extension IndexedDB. Keep the draft record and per-page annotation state in trusted extension storage. Never store one giant base64 image.
- Review, annotate and permanently redact pages individually. Freeze an approved image for each page before thread creation; send sequentially with a stable idempotency key per page. A failed upload resumes at the first unsent page.
- Save the ordered filename with each private asset. Show it on the thread and in the GitHub Issue attachment list. Agents can fetch individual assets instead of decoding one huge combined image.
- Group numbered pages in a compact thread gallery so a long capture does not turn the feedback detail into dozens of full-size images.
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
- The optional single combined attachment is an overview. Draw each annotation on its numbered page; those approved pixels are stitched into the combined copy. Scale the combined copy before encoding when its native dimensions exceed the server decoder's height or pixel limits. Numbered originals stay full size. A frozen draft made by an older extension can rebuild its oversized combined copy from the retained approved pages during Retry Send.

## Verification receipt

`npm run check`, `npm run test:postgres`, `npm audit --audit-level=high` and `npm run qa:extension-browser` passed on 2026-09-26. The isolated Chromium run captured a 22,000px page as 28 images and a 35,000px page as 44 images; the last page was cropped to its remaining pixels and the original scroll position was restored. A four-image series was navigated, its second page permanently redacted, and submission was interrupted at image two. Retry resumed from image two; readback returned the four ordered asset filenames, the browser rendered four items in the compact thread gallery, and the local draft was cleared. A changing page kept no captured image. The popup, editor and thread gallery were visually inspected in the isolated browser. Store-installed acceptance and publication remain unverified.

Extension 0.1.19 additionally reproduced a failed combined-image send on the public `globaljournals.org` page against an isolated local Feedbacks server: 19 numbered images uploaded, then the original-height combined image was rejected. With scaled export, the same synthetic local send uploaded all 19 full-resolution images and a 1308 × 12000 combined copy. A frozen draft with an injected oversized combined image resumed on Retry Send, rebuilt that copy and completed without a duplicate thread; a rectangle annotation on the first page was detected in the combined attachment. `npm run check` and the isolated browser QA passed. This does not prove the user's existing Chrome draft was sent; that requires reloading the unpacked extension and retrying in that browser.
