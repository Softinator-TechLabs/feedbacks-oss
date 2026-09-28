# Read evidence progressively

Read the paginated `assets` section for opaque IDs, types, dimensions, capture regions/sections and markings. Inspect one relevant image using `asset includeImage:true`; MCP emits a native image block. Metadata dimensions are ORIGINAL pixels; image dimensions describe the preview.

- Match `markings[].annotationId` to the chosen point. Prefer `point-NNN-original.webp` for its original viewport/menu state. Check `anchor.viewport`, `capturedAt` and pixel ratio.
- Visible viewport, numbered full-page sections and combined page are different captures. Inspect relevant sections in order. A tall combined preview can hide text: request `crop:{left,top,width,height}` in ORIGINAL integer pixels, then `maxDimension` (256–2048). Returned source/crop dimensions map the preview back to original. Invalid/out-of-bounds crops fail.
- Marking bounds are normalized to the captured image; convert using original dimensions. `captureSections` maps scroll regions to image sections. Never project one capture's coordinates onto another viewport/menu state without matching evidence.
- Video: read metadata with `includeImage:false`; use the authenticated same-server URL in an available video/browser tool, or private local timestamped frames with an available media tool. Never forward the bearer token to another host or through redirects. Report timestamps actually viewed. Without playback/frame support, disclose the limitation and ask for relevant stills; no server transcript/frame extraction is implied.
- PDF/image documents: read `documents.get` and `documents.threads`, page/coordinate metadata and authorized original with an available PDF/vision tool. Distinguish extracted text from rendered appearance.
- Read named replies and aggregate likes; available reviewer guidance is advisory. Voter lists/private notes are not exposed. Diagnostics are partial page-generated evidence; missing status is not success.
- `context`/`diagnostics` and oversized section pages return JSON text chunks. Finish `nextTextOffset`, concatenate and parse before interpreting; then follow `nextOffset`.

If the client/model cannot show pixels, use its explicit image-viewing tool or disclose that limitation. An image URL is not visual verification.
