# Plan: visual capture editing

Status: completed in source; release deployment pending. Date: 2026-09-27.

## Outcome and scope

Make video trimming directly manipulable and preserve readable full-page screenshot previews. Add local annotated image/PDF downloads, clipboard copy and compact screenshot tools without changing the coordinate contract of saved feedback points.

## Decisions and progress

- [x] Reproduce the combined preview reduction: the upload image height cap also reduced narrow full-page capture width.
- [x] Replace the editor preview with stacked original-resolution sections and explicit zoom.
- [x] Add dual video trim handles, scrubbing, selected-range playback and keyboard controls; keep precise fields secondary.
- [x] Add screenshot highlighter, steps, blur, stamps and movable/resizable local images, plus local exports.
- [x] Preserve source coordinates by limiting crop to explicitly labeled local exports.
- [x] Finish focused browser/pixel checks, integration checks and independent review.
- [ ] Build, integrate and verify the released package.

## Compatibility and recovery

No new dependencies or extension permissions. New visual marks are flattened into approved images; existing point/element metadata stays attached to its original coordinates. The optional combined upload still follows server decoder limits. Full-page local raster exports reject oversized dimensions instead of silently shrinking. PDF exports keep separate sections readable. Blur can be undone and is not permanent redaction. Original recording remains available while editing locally; pending changes must be applied before sending.

## Verification

Timeline tests cover bounded, non-crossing handles and time labels. Browser checks cover actual recording, drag/play boundaries, sequential typing in precise fields, crop re-editing and export. Screenshot checks cover 26-section original-resolution preview, annotated copy/download pixels and PDF page counts. Final integration and release receipts are recorded after those checks complete.

The full Node 22 check passed (132 tests, four configured skips), as did the separate native PostgreSQL check and complete extension browser regression. Pixel tests verified 26 narrow sections, PNG/JPEG/WebP, clipboard, PDF page counts and permanent redaction of imported image pixels across reload/move/resize/reset/export. A public long-page capture produced 19 original-resolution sections and a 17,611px preview with successful upload/readback in the disposable local server. Independent review has no outstanding blocking findings. CI and production package/deployment verification remain release gates.
