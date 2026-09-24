# Plan: project document review

Status: in progress. Owner: Feedbacks maintainers. Date: 2026-09-24.

## Outcome and scope

A project member can upload a private PDF or PNG/JPEG/WebP, open it in Feedbacks, point at a PDF page or image coordinate, and start a normal feedback discussion at that position. The source file stays private to project members. Existing webpage and extension capture remain unchanged. Guest links cannot see documents.

## Evidence and approach

Current threads require website context and current assets belong to threads. Document review needs a project-level file identity and a distinct context type. Use the same object store, project grants, thread replies and status model. Normalize click coordinates to 0–1 so resizing does not move annotations. Render PDFs in the browser, but determine page count on the server before accepting a file.

## Steps and progress

- [x] Read existing asset, thread, grant and UI paths; establish baseline suite (44 pass, 1 native PostgreSQL skip).
- [ ] Add validated private project document storage and page-aware thread creation with regression coverage.
- [ ] Add an unobtrusive Documents view with upload, viewer and coordinate comment form.
- [ ] Update API, workflow and security docs; regenerate operation catalog.
- [ ] Run Node 24 checks, native PostgreSQL migration check and synthetic desktop/mobile browser proof.

## Compatibility and recovery

Migration 12 is additive and creates a document metadata table. Existing threads and assets are untouched. If an upload's database commit outcome is unknown, retain the private object for reconciliation. Roll back application code to the previous revision without dropping the table or deleting object keys.

## Decision log

- Use private stored source files, not public URLs or a browser-only PDF conversion. This preserves original pages for later review and avoids claiming a PDF upload when only a screenshot was saved.
- Limit PDF to 25 pages and files to 8 MiB. Guest review and automated visual diffs are separate features.

## Completion receipt

Source revision: pending.
Checks and results: pending.
Artifacts: pending.
Deployment and live verification: not in scope for this branch.
Remaining risks or follow-up: pending.
