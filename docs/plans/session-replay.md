# Session replay and agent debug bundles implementation plan

Status: implemented and locally verified; deployment pending. Date: 2026-09-28.

> Implementation uses the writing-plans, TDD, parallel-agent and verification workflows. The user approved the written research design and explicitly requested implementation, delegated dependency choices, and asked to retain optional redaction without making it obstructive.

## Outcome and scope

Reviewer-initiated recordings combine rrweb DOM replay, activity, console, network, environment and optional WebM on a common timeline. The thread can play replay and inspect diagnostics. Agents can read scoped evidence remotely and materialize a private local debug directory through the bundled stdio MCP adapter. This does not enable continuous visitor tracking or deploy another analytics service.

Use `@rrweb/record` and `@rrweb/replay` pinned at 2.1.6. Spot is a source reference for capture coordination and diagnostics. No AGPL source is copied. Chrome debugger is a declared permission with attachment only while explicit recording is active. Basic capture without debugger remains useful and clearly reports reduced coverage. Passwords/credentials remain masked; optional text/input masking and payload inclusion are reviewer controls.

## Global constraints

- Shared contracts and server domain authorization govern HTTP, MCP and CLI; preserve old diagnostic and video threads.
- Bundle executable dependencies locally, retain notices, and update extension packaging permission checks and disclosure documentation.
- Recording project/tab/account and initial URL are fixed. Explicitly authorized exact redirect origins continue with new document identity on the same timeline; an unknown origin produces a coverage gap. Destination project membership never rebinds the original recording.
- Durably buffer local chunks; expose size/time limits, dropped events, failures and incomplete capture. Stop honestly at resource limits.
- Replay is sandboxed with original scripts disabled. Captured logs/DOM and downloaded files are untrusted evidence.
- Browser metadata/diagnostics require an active capture; no always-on collection.
- Use Node 22 for checks. The public repo base is ccd62b54df4ae3efa296936e9fac3b9226e8ca95.
- No live deployment or Store publication is implied by local implementation.

## Shared interface

`src/shared/recordings.ts` exports `recordingSchema`, `Recording`, and event helpers. Recording input contains `schemaVersion:1`, UUID `id`, ISO `startedAt`, `durationMs`, `mode:session|video`, sanitized `url`, JSON `environment`, `privacy:{maskText,maskInputs,networkBodies}`, `coverage:[{channel,status,detail?}]`, and ordered `events:[{seq,atMs,type,data}]`. Types are replay/console/network/activity/performance. rrweb event `data` preserves its native timestamp and format. Other event data is structured, bounded JSON. Optional `video:{assetId,offsetMs,segments?}` links an already uploaded same-thread asset, with source/output edit mapping. Capture, replay and exporters consume this one representation.

Operations:

- `recordings.upload {threadId,revision,idempotencyKey,recording}` -> `{recording:summary,thread}`.
- `recordings.list {threadId}` -> `{items:summary[]}`.
- `recordings.get {recordingId}` -> `{recording}` including bounded raw events for browser playback.
- `recordings.events {recordingId,offset?,limit?,type?,fromMs?,toMs?}` -> `{items,nextOffset,total}` with immutable recording identity.
- `recordings.export {recordingId}` -> `{recording,thread}`; excludes private instructions and member notes. Local materializer writes safe generated paths and a checksum index and obtains video separately with current asset authorization.

Server sets final limits and communicates them to all implementers before client finalization. Recorded objects are immutable; retries must preserve original content. A cap stops the capture with explicit coverage rather than silently evicting earlier replay snapshots. Binary video uses the existing asset upload path; capture evidence is uploaded after video so the asset ID is known. Session-only mode creates a thread and uploads evidence without video.

## Tasks and ownership

- [x] A. Server and contracts: shared recording validation/redaction, private storage, immutable authorization/idempotency, operations/discovery and migration/cleanup integration. Tests must reject cross-project video linkage, unauthorized reads and altered retry payloads. Own src/shared/recordings.ts, contracts/descriptions, server recording/domain changes and server tests.
- [x] B. Browser capture: rrweb MAIN-world bundle with isolated message bridge, console/network/activity collection, durable extension session lifecycle, explicit debugger capture, review controls and video/session-only submission. Test collector ordering, stop/navigation, redaction, quota/gaps and video linkage. Own extension files, extension packaging and collector tests; root owns package installation/lockfile.
- [x] C. Thread viewer: add recording list/player with console/network/activity/environment tabs, shared time seek, coverage and redaction indicators, responsive/keyboard states. Own new web recording modules and minimal thread integration, viewer tests. Use Impeccable and existing DESIGN.md.
- [x] D. Agent delivery: remote discovery and local stdio materialization, directory permissions, checksums, structured files, authorized media download, text/JSON evidence provenance and agent guidance. Own src/cli, MCP extension hook, local export tests and agent docs.
- [x] E. Integration: verify actual packaged extension on synthetic pages; server/browser upload/read/replay, navigation, failure and redaction. Run complete check pipeline, inspect desktop/mobile UI, update operation catalog, docs, package notices and deliver reviewable branch.

## Review focus

1. Navigation or worker suspension while capture is running: preserve prior evidence and state coverage.
2. Video pause/trim or mismatched picker tab: diagnostics must refer to the correct source tab and source timeline; disclose unsupported alignment instead of fabricating it.
3. Synthetic credentials in headers, URLs, DOM, logs and payloads: secret canaries must not reach stored/exported evidence.
4. Retry after committed upload/lost response: same immutable recording, no duplicate artifacts or rebinding.
5. Agent running on a different host: returned local path exists on that agent host; remote MCP never returns a server path as a client path.

## Compatibility and recovery

Additive contracts and migration; preserve existing asset keys and histories. New scopes must not silently broaden existing agent keys. Recording deletion follows thread deletion and private object cleanup. A failed evidence upload retains the local capture and thread/video references for retry. No backend migration is applied to a real database during development.

## Decisions and progress

- User authorized implementation and package selection after reading the research design; proceed without repeating design approval.
- Work is isolated on the public-repository branch `codex/session-replay` from the base revision above.
- Parallel work uses disjoint ownership and the shared interface above; changes to it are communicated before implementation consumers finalize.

## Completion receipt

Implemented shared/server recording operations and private storage, extension capture, thread replay and local MCP materialization. A real packaged Chrome recording with 28 events was uploaded to the isolated server and rendered in desktop/mobile thread views; console, network and activity controls, no page errors and no horizontal overflow were verified. Its authorized evidence was materialized into an owner-only local directory.

Independent review identified and drove fixes for credential snapshot masking, replay CSS resource isolation, capture timestamp preservation, cross-origin child-frame handling and edited-video retry. Final checks and remaining verification boundaries are recorded below before completion.

- Follow-up acceptance: keep the player visible while inspecting diagnostics; live playhead filtering must not reveal future console/network state. Typed changes must identify their field and honor input masking. Verify event-to-player seeking and playback-driven evidence in an actual browser.

- Follow-up acceptance: the same readable activity, typing, console/error and network timeline must be visible in the extension after Stop and before Send. Video preview and DOM replay must seek with events; no raw-JSON-only review. Local screenshots can be queued for the eventual thread without uploading before Send.

- Verified actual packaged local stdio MCP against an isolated authenticated server: complete evidence directory contains native video, two saved frames, timestamp index, structured logs, manifest and checksums. Remote HTTP transport remains read/export only.
- Verified native tab capture, pause/resume and nonzero 400 ms trim. HTTP video delivery now supports authenticated byte ranges; actual desktop/mobile event-to-video seek and screenshot export passed after the fix.
- Independent review drove fixes for trailing diagnostic playback after the last DOM event, resumed-segment boundary mapping, removed-gap seeking, and saved-frame duration validation.

- Follow-up acceptance: a public submission workflow can redirect to a different website/project while remaining one recording in the starting project. The reviewer explicitly grants additional exact origins; unknown origins remain excluded. Backend integration verifies cross-origin evidence round-trip and preserves original-origin/project authorization.
- Large-site testing exposed a roughly 5 MiB DOM baseline. Full snapshots now retain bounded inline content (6 MiB per snapshot, 12 MiB total) and use atomic IndexedDB event persistence with a background-worker cache. Chromium verifies an 11 MiB baseline survives reload and failed writes do not corrupt the earlier timeline.
- Native and edited WebM metadata repair is bundled from pinned MIT packages. Browser proof confirms finite durations and frame-preserving seeks; limits are enforced after repair.

- Actual authorized two-site submission capture: 45.159 seconds and 462 events, including ordinary typed values, submit click, cross-origin handoff and dashboard navigation. Desktop/mobile selected-event seeking matched native video time exactly; local packaged MCP exported complete video, saved frame, HAR, logs and checksums. AI article processing was intentionally not awaited.
- The initial real capture exposed a navigation-trigger click loss. Critical activity now flushes synchronously, unacknowledged batches remain available to Stop, and sequence acknowledgements prevent duplicate events. A fresh read-only two-site browser run preserved both navigation clicks in 382 events with zero drops and no scope gap; the older recording was not modified to fabricate its missing click.
- Real DOM snapshots exceeded the earlier generic 100,000-node validation cap. Full rrweb snapshots now allow 500,000 nodes while diagnostics/environment keep 100,000; bounded depth and the overall 16 MiB server limit remain. Schema and API round-trip regression coverage includes large snapshots and rejects misuse.
- Replay reconstructs captured inline styles through a resource-free CSS filter, excludes nested iframe Document mutations and makes media inert. Real large-site replay at beginning/middle/end produced no external requests or page errors; external image/font/media fidelity is intentionally limited, with linked video opening by default.
- Final local check pipeline: 267 tests, 253 passed, 14 optional tests skipped, zero failures; formatting, contracts/docs, types, all builds, sandbox smoke and public release/source checks passed. Separately enabled Chromium recording checks passed 9/9, and the latest desktop/mobile viewer checks passed 2/2.
- All four extension acceptance scripts passed, covering existing screenshot/video behavior, full-resolution screenshot editing, packaged recording and explicit cross-origin capture. The legacy harness now loads the built extension so generated metadata repair dependencies are exercised. Dependency audit found zero vulnerabilities; the actual materialized evidence bundle passed all 16 file checksums.
- Native PostgreSQL verification passed 2/2 with zero skips, including concurrent cursor visibility and shared login throttling.
- These receipts establish local source, packaged browser behavior and isolated API/thread/MCP behavior. Live Feedbacks deployment, Chrome Web Store distribution and exact-revision remote CI have not been performed.

## Recording reliability follow-up

Status: implemented; release verification in progress. Fixed failures at the integration boundaries around the packaged rrweb engine: resource-free CSS reconstruction, hidden control geometry, replay preview sizing, DOM event budgets, and native video control ownership. Keep diagnostics recording after a DOM-only failure, display capture coverage before sending, and preserve native pause/stop controls on the source page. Verify focused Chromium regressions, real-page geometry/capture, the full repository check and release CI before distributing a new extension. Existing local captures must remain intact.

Local verification: `npm run check` passed (274 tests passed; 18 environment-dependent tests skipped). `npm run qa:recording-browser` passed all 16 browser checks and is now part of extension CI. Packaged-extension QA and required CI remain merge gates. A short-trim probe returned an empty export once but passed subsequent isolated and full browser runs; its cause remains unconfirmed and no speculative media fix is included.

## Screenshot comments during recording

Status: implementation and verification in progress. Right-click a website element during session/video capture to pause capture, save a screenshot and element comment at the same source timestamp, then resume after Save or Cancel. A manually paused video stays paused. Hide the comment editor before resuming; refresh the DOM baseline afterward. Keep saved points across approved navigation, cancel an unfinished editor on document navigation, and preserve the original project. Pre-send and thread views expose comment screenshots; local MCP materialization includes their source timestamps and anchors. Network, console, activity and loading monitoring start with recording by default; capture gaps must remain visible.

Verification gates: real packaged Chrome session/video Save/Cancel, navigation, default diagnostics/loading, screenshot uploads and retry behavior, thread association, and materialized no-video session frames; then full checks and required CI before release.

The follow-up reproduced the short-trim failure with a valid static recording containing one encoded frame. Export now republishes the decoded frame after the encoder starts and preserves a known-duration static tail; repeated 400 ms exports of static and moving recordings, cancellation, and seeks pass in Chromium. Screenshot-comment tests cover session pause clocks, native pause acknowledgments, stopped-capture finalization, failed reinjection retries, and immutable image upload retries. The full local check passed with 322 tests passed and 19 optional browser/environment checks skipped; the separately enabled recording browser suite passed all 18 tests. Release CI and live distribution remain separate gates.
