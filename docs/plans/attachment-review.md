# Plan: project document review

Status: merged and deployed; production document interaction pending. Owner: Feedbacks maintainers. Date: 2026-09-24.

## Outcome and scope

A project member can upload a private PDF or PNG/JPEG/WebP, open it in Feedbacks, point at a PDF page or image coordinate, and start a normal feedback discussion at that position. The source file stays private to project members. Existing webpage and extension capture remain unchanged. Guest links cannot see documents.

## Evidence and approach

Current threads require website context and current assets belong to threads. Document review needs a project-level file identity and a distinct context type. Use the same object store, project grants, thread replies and status model. Normalize click coordinates to 0–1 so resizing does not move annotations. Render PDFs in the browser, but determine page count on the server before accepting a file.

## Steps and progress

- [x] Read existing asset, thread, grant and UI paths; establish baseline suite (44 pass, 1 native PostgreSQL skip).
- [x] Add validated private project document storage and page-aware thread creation with regression coverage.
- [x] Add a Documents view with upload, viewer and coordinate comment form.
- [x] Update API and workflow docs; regenerate operation catalog.
- [x] Run Node 24 checks, native PostgreSQL migration check and synthetic desktop/mobile browser proof.

## Compatibility and recovery

Migration 12 is additive and creates a document metadata table. Existing threads and assets are untouched. If an upload's database commit outcome is unknown, retain the private object for reconciliation. Roll back application code to the previous revision without dropping the table or deleting object keys.

## Decision log

- Use private stored source files, not public URLs or a browser-only PDF conversion. This preserves original pages for later review and avoids claiming a PDF upload when only a screenshot was saved.
- Limit PDF to 25 pages and files to 8 MiB. Guest review and automated visual diffs are separate features.

## Completion receipt

Source revisions: `d452aad` adds document review; `eb39563` pages markers so later comments remain reachable; PR [#37](https://github.com/Softinator-TechLabs/feedbacks-oss/pull/37) merged as `b129cfe`.
Checks and results: Node 24 `npm run check` passed with 55 tests passed and one native PostgreSQL test skipped in that suite; `npm run test:postgres` passed separately. A 511-marker regression traversed all six batches without duplicates. A synthetic PDF uploaded, rendered and created a normal feedback thread at a page coordinate in a local sandbox. Desktop and mobile views were inspected at 1440 × 900 and 390 × 844.
Artifacts: [desktop document review](../screenshots/document-review/desktop.png) and [mobile document review](../screenshots/document-review/mobile.png), both using a generated sample PDF and sandbox identity.
Deployment and live verification: the merged app was deployed; authenticated production upload and point-to-thread readback are still pending. On 2026-09-25 a new disposable local browser run uploaded a generated two-page PDF and image, created a page-two discussion, and returned to its marker after reload. The 390px image form also created a point-linked thread. This is synthetic acceptance, not production object-storage proof.
Remaining limit: PDFs are capped at 25 pages and files at 8 MiB. Document annotations are page points; freehand markup is not included.
