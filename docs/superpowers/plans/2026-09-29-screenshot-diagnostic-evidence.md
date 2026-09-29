# Screenshot Diagnostic Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make screenshot threads carry complete available developer diagnostics as private, downloadable evidence while keeping normal MCP thread reads small.

**Architecture:** Reuse the recording engine's Chrome debugger and page-event sources, but write screenshot evidence to a separate raw, versioned, chunked artifact. Upload chunks to private project storage and commit a small manifest after integrity checks. Web and MCP read only summaries by default; authorized follow-up reads, archive download and local materialization retrieve the full evidence.

**Tech Stack:** Chrome MV3 JavaScript, IndexedDB, CDP through `chrome.debugger`, TypeScript, Zod, PostgreSQL, existing S3-compatible `AssetStore`, Express, MCP, React, Node built-in `crypto` and `zlib`. No new package is planned.

**Spec:** [Screenshot diagnostic evidence design](../specs/2026-09-29-screenshot-diagnostic-evidence-design.md).

## Global Constraints

- Start implementation from the verified merged revision of modular refactor PR #117. Keep its feature-folder ownership and all external entrypoints stable.
- New screenshot artifacts preserve Chrome-exposed raw values. Do not call legacy `diagnosticText`, `sanitizeCapture` or `redactRecording` on their bytes. Existing recording and legacy screenshot formats retain their behavior.
- The review checkbox is checked by default, follows the Settings default for new drafts, and needs no per-entry selection or extra approval.
- Use 2 MiB maximum raw chunks, a 256 MiB aggregate local and server limit, and 32 KiB maximum decoded MCP read pages. Every omitted or stopped channel has explicit coverage.
- Keep raw bytes outside thread JSON, SQL summaries, logs, default MCP results, issue drafts and public source. All reads recheck current thread/project authorization and new explicit scopes.
- Reproduce tests with synthetic pages and fake credentials. Preserve existing migrations, volumes and object keys. A ZIP build, CI, installed Chrome, deployment and live behavior are distinct gates.

## Review Focus

1. A 5 MiB+ DOM with multibyte UTF-8 crossing a chunk boundary must round-trip exactly through upload, archive and MCP paging (Tasks 1, 3, 5).
2. A CDP disconnect or inaccessible frame must preserve collected bytes and identify missing channels, not display zero errors as healthy (Tasks 4, 5, 7).
3. Duplicate or conflicting chunk retries, simultaneous finalization and account/project changes must not link the wrong bytes or leak an object (Tasks 2, 6).
4. A screenshot during an active session recording must share the debugger event source or report a precise gap without detaching the recording (Task 4).
5. Large or malicious page text, filenames and archive labels must stay inert in preview, download and agent files; binary data must not be treated as UTF-8 (Tasks 3, 6, 7, 8).

## File map and interfaces

- `src/shared/screenshot-diagnostics.ts`: browser-safe v1 manifest, file and coverage schemas; 2 MiB/256 MiB/32 KiB constants; `splitDiagnosticBytes(bytes, fileId)` and `nextDiagnosticPage(bytes, offset, limit, text)` pure functions.
- `src/shared/contracts/domains/diagnostics.ts`: `diagnostics.begin`, `putChunk`, `finalize`, `list`, `describe` and `read` contracts. `src/shared/contracts/{registry,scopes,output-common}.ts` expose them without duplicating rules.
- `src/server/diagnostic-evidence.ts`: upload state machine, chunk integrity, authorization and read model. `src/server/diagnostic-archive.ts`: authenticated binary chunk and `.tar.gz` stream. `src/server/migrations.ts` adds v25 tables without touching earlier migrations.
- `extension/diagnostics/{evidence-store,raw-debug,archive}.js` and `extension/capture/dom-stream.js`: IndexedDB chunks, CDP event projection, prepared-DOM streaming and local archive. Existing `session/session-coordinator.js` provides a raw event tap while preserving recording projection.
- `extension/capture/workflow.js`, `extension/submission/workflow.js`, `extension/background.js`, `extension/{editor,options,popup}.{js,html}`: capture lifecycle, review default, upload/retry and bounded preview.
- `src/web/threads/detail.tsx` and `src/web/threads/diagnostic-evidence.tsx`: private summary, bounded channel preview and authenticated download. `src/shared/agent-workflow.ts`, `src/server/mcp.ts`, `src/cli/diagnostic-materialize.ts`: small agent hints and on-demand evidence.

### Task 1: Versioned evidence and byte paging contract

**Files:** Create `src/shared/screenshot-diagnostics.ts`, `tests/screenshot-diagnostics-contract.test.ts`. Later tasks register operations separately.

**Interfaces:** `DiagnosticManifestV1` has `schemaVersion:1`, UUID `id`, source origin and time range, `coverage: Record<DiagnosticChannel,{status,observedCount,capturedBytes,reasons}>` where status is `complete|partial|unavailable|stopped`, `files` with generated UUID `fileId`, kind (`dom|console|network|body|storage|environment|performance|coverage`), MIME type, byte length, SHA-256 and ordered `{sequence,byteLength,sha256}` chunk references, plus `totalBytes`. Archive names derive from kind and fileId; raw URLs and original page labels live in evidence files, not SQL metadata. `splitDiagnosticBytes(bytes: Uint8Array, fileId: string): Promise<DiagnosticChunk[]>` yields `{sequence,data:Uint8Array,byteLength,sha256}` chunks of at most `2097152` bytes. `nextDiagnosticPage(bytes: Uint8Array, offset: number, limit: number, text: boolean)` returns `{data:Uint8Array,nextOffset,text?}` with a UTF-8 boundary when `text` is true; binary remains bytes.

- [ ] **Step 1: Write the failing contract test.** `tests/screenshot-diagnostics-contract.test.ts` creates 5 MiB of HTML with `é` straddling a 2 MiB boundary, asserts chunk sizes, SHA-256 and concatenated byte equality; a 32 KiB text page resumes on a code-point boundary. Invalid UTF-8 is returned as binary, a manifest over 256 MiB is rejected, and a client-supplied `archiveName: "../escape"` is rejected by the strict schema.
      Core assertions: `assert.deepEqual(concat(parts.map(p => p.data)), sourceBytes)` and `assert.ok(parts.every(p => p.byteLength <= 2097152))`.
- [ ] **Step 2: Run the test and see the missing-module failure.** `node --import tsx --test tests/screenshot-diagnostics-contract.test.ts` must fail before implementation.
- [ ] **Step 3: Implement the schemas and pure functions.** Use `TextEncoder`/`TextDecoder` and `globalThis.crypto.subtle` so shared code works in Node and Chrome; keep file paths generated from kind and UUID, never supplied names. `DIAGNOSTIC_CHUNK_BYTES=2097152`, `DIAGNOSTIC_MAX_BYTES=268435456`, `DIAGNOSTIC_READ_BYTES=32768`.
- [ ] **Step 4: Run the focused test and typecheck.** Both `node --import tsx --test tests/screenshot-diagnostics-contract.test.ts` and `npm run typecheck` pass.
- [ ] **Step 5: Commit.** `git add src/shared/screenshot-diagnostics.ts tests/screenshot-diagnostics-contract.test.ts && git commit -m "Add screenshot evidence byte contract"`.

### Task 2: Authorized chunk upload and immutable commit

**Files:** Create `src/shared/contracts/domains/diagnostics.ts`, `src/server/diagnostic-evidence.ts`, `tests/diagnostic-evidence-upload.test.ts`, `tests/diagnostic-evidence-postgres.test.ts`; modify `src/shared/contracts/{registry,scopes,output-common}.ts`, `src/server/{migrations,operations,thread-deletion,thread-move,index}.ts`, `src/server/auth.ts`, `package.json`, and generated `docs/generated/operations.md`.

**Interfaces:** `diagnostics.begin({threadId,revision,evidenceId,idempotencyKey,sourceUrl,startedAt})` returns a pending evidence summary. `diagnostics.putChunk({evidenceId,fileId,sequence,sha256,contentBase64})` accepts at most 2 MiB decoded bytes and returns the stored digest. `diagnostics.finalize({evidenceId,manifest,idempotencyKey})` verifies every listed part and total before making the manifest immutable; it returns the committed summary and updated thread. A v25 `diagnostic_evidence` row holds project/thread/owner/status/summary/manifest; `diagnostic_chunks` rows hold file/sequence/hash/size/private key, unique by `(evidence_id,file_id,sequence)`. `drainExpiredDiagnosticEvidence(db,store)` marks pending artifacts older than 24 hours expired under a row lock before removing their objects through the existing bounded maintenance loop; thread deletion enqueues all committed and pending chunk keys, and thread move updates evidence project ownership. A retry after expiry starts a new evidence ID on the same thread.

- [ ] **Step 1: Write failing upload tests.** `tests/diagnostic-evidence-upload.test.ts` asserts begin requires thread write access, a new explicit scope and matching page origin; an old paired extension key is denied. Same-hash retry is idempotent, different-hash retry conflicts; missing/extra chunks, 256 MiB overflow, concurrent finalize and a changed project/account do not commit. Raw sample `Cookie`, `Authorization` and `password` bytes survive unchanged in private storage while summary omits them. `tests/diagnostic-evidence-postgres.test.ts` exercises v25 migration, conflicting concurrent finalize, 24-hour pending cleanup, thread deletion object receipts and project move authorization against native PostgreSQL; add it to `npm run test:postgres`.
      Core assertions: `assert.equal(await countStoredChunks(evidenceId), 1)` after an identical retry; `await assert.rejects(conflictingRetry, {code: "CONFLICT"})`; `assert.deepEqual(await store.get(key), rawBytes)`.
- [ ] **Step 2: Run focused tests to confirm failure.** `node --import tsx --test tests/diagnostic-evidence-upload.test.ts` fails on missing operations.
- [ ] **Step 3: Add migration and upload operations.** Use object keys under the existing private project prefix with evidence/file/sequence/hash components. Recheck authorization after object writes before SQL commit. Store pending rows so upload failure is visible; enqueue eventual cleanup for expired pending rows and deleted threads. Add only the three upload operations to registry/scopes at this stage.
- [ ] **Step 4: Verify focused tests and native migration.** Run the focused test, `npm run docs:generate`, `npm run typecheck`, `npm run check:harness` and `npm run test:postgres`; all pass.
- [ ] **Step 5: Commit.** Commit the contract, migration, server and test files as `Add private screenshot evidence upload`.

### Task 3: Bounded reads and streamed full download

**Files:** Create `src/server/diagnostic-archive.ts`, `tests/diagnostic-evidence-read.test.ts`, `tests/diagnostic-archive.test.ts`; modify `src/server/{diagnostic-evidence,app,thread-read-model}.ts`, `src/shared/contracts/domains/diagnostics.ts`, `src/shared/contracts/{registry,scopes,output-common}.ts`, `src/shared/agent-workflow.ts`, `src/shared/operation-descriptions.ts`, and generated `docs/generated/operations.md`.

**Interfaces:** `diagnostics.list({threadId,offset,limit})` pages summaries. `diagnostics.describe({evidenceId,offset,limit})` pages file metadata and channel coverage. `diagnostics.read({evidenceId,fileId,sequence,byteOffset,limitBytes})` returns `{byteLength,encoding,text?,dataBase64?,next?}` with at most 32768 decoded bytes; UTF-8 text is returned only at valid boundaries, otherwise base64. `next` carries `{sequence,byteOffset}`. `GET /api/diagnostics/:id/files/:fileId/chunks/:sequence` streams one authenticated binary chunk; `GET /api/diagnostics/:id/archive` streams generated-name `.tar.gz` with manifest, coverage and hashes. The optional `thread.diagnosticEvidence` field has count and up to three newest small summaries; legacy `thread.diagnostics` stays intact.

- [ ] **Step 1: Write failing read and archive tests.** Assert cross-project and scope denial for each operation and route; a 5 MiB+ file reassembles by MCP pages and archive with identical SHA-256; `diagnostics.describe` paginates thousands of file entries; a binary body is base64, not lossy text; a malicious original filename cannot escape the archive; a pending upload is visibly pending but unreadable as complete. An old thread's legacy `diagnostics` field and v1 recording summary remain readable.
      Core assertions: `assert.equal(sha256(reassemble(pages)), manifest.files[0].sha256)` and `assert.equal(sha256(extractTar(archive, generatedName)), manifest.files[0].sha256)`.
- [ ] **Step 2: Run the two focused test files and confirm failure.** `node --import tsx --test tests/diagnostic-evidence-read.test.ts tests/diagnostic-archive.test.ts` fails before code.
- [ ] **Step 3: Implement read contracts and streams.** Reuse `threadRow` authorization and explicit scopes on every request; fetch only the selected 2 MiB object for MCP paging. Produce tar headers from generated file names, pipe through `createGzip()`, and honor response backpressure. The route accepts browser session or bearer credentials without redirects or signed-object URL exposure.
- [ ] **Step 4: Verify focused tests and harness.** Run the two test files, `npm run docs:generate`, `npm run typecheck`, `npm run check:harness` and `npm run test:postgres`; all pass.
- [ ] **Step 5: Commit.** Commit as `Add bounded diagnostic reads and archive download`.

### Task 4: Raw CDP channel without changing recordings

**Files:** Create `extension/diagnostics/raw-debug.js`, `extension/diagnostics/evidence-store.js`, `tests/diagnostic-raw-debug.test.ts`; modify `extension/session/session-coordinator.js`, `extension/background.js`, extension packaging/fixture allowlists in `scripts/package-extension.mjs` and `scripts/qa/extension/`.

**Interfaces:** `createRawDiagnosticCapture({tabId,sourceOrigin,store,debuggerSource})` exposes `start()`, `stop()` and `status()`. `sessionCoordinator.subscribeRawDebugger(tabId, async (method,params,ingressAt) => {})` returns an unsubscribe function and taps events before the recording sanitizer. The tap feeds JSONL/network-body files into `putEvidenceChunk(evidenceId,fileId,sequence,bytes)` in IndexedDB. It shares an existing debugger attachment for the same tab, or attaches for explicit **Start diagnostics**; it never detaches a recorder it does not own. CDP request/ExtraInfo/response/failure, post/response bodies, WebSocket frames, EventSource messages, Runtime, Log, page lifecycle and attachable frame/worker events become raw evidence or a coverage reason. The collector never evaluates object getters or captured code.

- [ ] **Step 1: Write failing collector tests.** Feed synthetic CDP events containing raw headers/cookies, structured console arguments, redirect, WebSocket frame and text/binary body; assert exact bytes and ordering. Test debugger attach failure, detach, a response body Chrome no longer exposes, inaccessible worker/frame, navigation outside approved origin, and a simultaneous session recording that continues undisturbed. Assert the extension chunk limit equals the shared contract constant.
      Core assertions: `assert.deepEqual(savedBody, rawBody)` and `assert.equal(recording.debuggerDetached, false)` when screenshot capture stops.
- [ ] **Step 2: Run the focused test to confirm failure.** `node --import tsx --test tests/diagnostic-raw-debug.test.ts` fails.
- [ ] **Step 3: Implement raw tap and chunk store.** Keep the recording path's existing sanitization and caps unchanged. Request `Network.enable` buffers of 256 MiB total and 64 MiB per resource for the explicit screenshot collector; a refused or unavailable body gets a coverage reason. Use `Network.getRequestPostData` and `Network.getResponseBody` when Chrome provides bytes, then stop at the 256 MiB evidence budget. IndexedDB stores binary `Blob`s and a manifest, not huge `chrome.storage.local` JSON.
- [ ] **Step 4: Verify test, recording regression and packaged extension.** Run `node --import tsx --test tests/diagnostic-raw-debug.test.ts tests/recording-capture.test.ts tests/recordings.test.ts`, `npm run qa:recording-browser`, `npm run qa:extension-browser` and `npm run check:release`; all pass.
- [ ] **Step 5: Commit.** Commit as `Capture raw screenshot debug evidence`.

### Task 5: Prepared DOM, storage and performance snapshot

**Files:** Create `extension/capture/dom-stream.js`, `tests/diagnostic-dom-capture.test.ts`; modify `extension/capture/workflow.js`, `extension/content.js`, `extension/background.js`, `scripts/qa/extension/` and packaging allowlist.

**Interfaces:** `capturePreparedDom({tabId,captureEpoch,evidenceId,store})` serializes the prepared top document's UTF-8 HTML through an isolated-world port with acknowledgements and <=2 MiB messages, plus accessible frames, open shadow roots, live form state, local/session storage, read-only IndexedDB and Cache Storage values where accessible, resource/performance timing and environment. CDP fills additional frame/DOM information when available. It returns file metadata and coverage, never an inline 5 MiB response. Its capture epoch and URL must match the screenshot draft; navigation, storage API failure or port loss records partial coverage.

- [ ] **Step 1: Write failing capture tests.** A synthetic site produces >5 MiB HTML with a multibyte boundary and shadow root, then compares stored/reassembled SHA-256 to the prepared DOM; changed epoch/navigation cannot attach stale DOM. An inaccessible cross-origin frame, blocked IndexedDB/Cache Storage and storage exceptions have explicit partial coverage. Captured form and storage state retain raw values until the 256 MiB budget.
      Core assertions: `assert.equal(sha256(reassembledDom), sha256(preparedDom))` and `assert.equal(staleEpochResult.coverage.dom.status, "partial")`.
- [ ] **Step 2: Run the focused test and packaged Chromium scenario to see failure.** Run `node --import tsx --test tests/diagnostic-dom-capture.test.ts` and `npm run qa:extension-browser`.
- [ ] **Step 3: Implement port streaming and screenshot hookup.** Snapshot after `prepareCapture` hides Feedbacks controls and before native pixels, with capture guard checks before/after. Always take the point-in-time snapshot for eligible screenshots, even without prior Start; mark prior console/network history unavailable in that case.
- [ ] **Step 4: Verify focused and packaged browser tests.** The test file and `npm run qa:extension-browser` pass; verify >5 MiB byte and hash equality in actual packaged Chromium.
- [ ] **Step 5: Commit.** Commit as `Attach full prepared DOM to screenshot evidence`.

### Task 6: Settings, review, local download and reliable send

**Files:** Create `extension/diagnostics/archive.js`, `tests/diagnostic-review.test.ts`; modify `extension/{options,editor,popup}.{html,js,css}`, `extension/background.js`, `extension/submission/workflow.js`, `extension/review/review-preferences.js`, and extension browser QA.

**Interfaces:** `reviewDefaults.includeDiagnostics` defaults to `true`. A new draft copies that value once; editor override persists. `sendDiagnosticEvidence(draft,thread)` performs begin/putChunk/finalize with stable IDs and checksums, retaining local chunks until finalize succeeds. `downloadDraftDiagnostics(evidenceId)` streams a generated-name `.tar.gz` using browser `CompressionStream` and verifies source hashes. Editor preview is escaped and capped by channel; no raw body/DOM is rendered in full.

- [ ] **Step 1: Write failing review tests.** Assert default checked, Settings-off new draft unchecked, open-draft override stable, unchecked send uploads zero diagnostic chunks and deletes local data after success/discard, and failed chunk/finalize leaves a retryable draft and a pending thread. After 24-hour server expiry, retry starts a new evidence ID on the same thread. An account switch cannot upload to the original thread. Preview renders `<script>` as text; local archive reassembles the captured bytes and marks partial coverage.
      Core assertions: `assert.equal(newDraft.includeDiagnostics, true)`, `assert.equal(uncheckedSend.uploadedChunks, 0)` and `assert.equal(retry.threadId, firstAttempt.threadId)`.
- [ ] **Step 2: Run focused and browser tests to confirm failure.** Run `node --import tsx --test tests/diagnostic-review.test.ts` and `npm run qa:extension-browser`.
- [ ] **Step 3: Implement one-checkbox review and upload state machine.** Remove per-entry selection/masking from the new artifact UI, leave legacy packet display readable, and show counts, size, coverage and a bounded sample. Keep the extension's server permission and current account checks on retries.
- [ ] **Step 4: Verify focused tests, packaged Chromium and full Node check.** Run `node --import tsx --test tests/diagnostic-review.test.ts`, `npm run qa:extension-browser`, `npm run check`, and `shasum -a 256 dist/web/downloads/feedbacks-extension.zip` on Local Node 25.2.1; record the ZIP hash and browser scenario output.
- [ ] **Step 5: Commit.** Commit as `Review and send screenshot diagnostic artifacts`.

### Task 7: Thread preview and authenticated download

**Files:** Create `src/web/threads/diagnostic-evidence.tsx`, `tests/diagnostic-thread-ui.test.ts`; modify `src/web/threads/detail.tsx`, `src/web/threads/detail/evidence.css`, and the browser UI QA scenario.

**Interfaces:** `DiagnosticEvidencePanel({threadId,summaries})` lists status/coverage/size, loads `diagnostics.describe` and a short `diagnostics.read` sample only on selection, and downloads via the authenticated archive route. Large DOM/body rows show size and sample, with **Download captured diagnostics** available. The page never calls `recordings.get` or loads the whole diagnostic artifact for this panel.

- [ ] **Step 1: Write failing UI tests.** Assert the initial thread read has only summaries; selecting an artifact issues bounded reads; 5 MiB DOM and malicious HTML remain escaped and truncated; pending/partial coverage is visible; unauthorized download shows an error without a stale link. Test desktop and compact viewport controls.
      Core assertions: `assert.equal(initialCalls.some(c => c.name === "diagnostics.read"), false)` and `assert.ok(selectedReads.every(r => r.byteLength <= 32768))`.
- [ ] **Step 2: Run component and browser tests to confirm failure.** Run `node --import tsx --test tests/diagnostic-thread-ui.test.ts` and `npm run qa:app-visual`.
- [ ] **Step 3: Implement the panel and restrained styling.** Follow `PRODUCT.md` and `DESIGN.md`; download with current session credentials and no redirects to object storage.
- [ ] **Step 4: Verify tests and the Impeccable detector.** Run `node --import tsx --test tests/diagnostic-thread-ui.test.ts`, `npm run qa:app-visual`, `npm run check`, and the installed Impeccable detector once; inspect desktop and compact browser screenshots.
- [ ] **Step 5: Commit.** Commit as `Show and download screenshot diagnostic evidence`.

### Task 8: Agent discovery and local materialization

**Files:** Create `src/cli/diagnostic-materialize.ts`, `src/shared/diagnostic-export.ts`, `tests/diagnostic-materialize.test.ts`; modify `src/shared/agent-workflow.ts`, `src/shared/operation-descriptions.ts`, `src/server/mcp.ts`, `src/cli/{client,mcp}.ts`, `plugins/feedbacks/skills/review-feedback/references/media.md` and generated catalog.

**Interfaces:** `feedbacks_thread` overview includes `diagnosticEvidence: {count,latest}` with follow-up operation names, never raw content. `materializeDiagnostics(execute,downloadChunk,{evidenceId,baseDirectory?})` checks the manifest and every chunk SHA-256, writes generated file names in a mode-0700 temporary directory with mode-0600 files, and returns actual paths and coverage. `apiClient().downloadDiagnosticChunk(evidenceId,fileId,sequence)` uses the same server bearer, a 2 MiB ceiling and `redirect:"error"`. The local stdio MCP tool is `feedbacks_diagnostics_materialize`; HTTP MCP uses `diagnostics.describe/read` and the authorized download path without inventing local files.

- [ ] **Step 1: Write failing agent tests.** Assert ordinary overview and `threads.get` stay small for 5 MiB DOM; next `diagnostics.describe/read` call returns authorized bounded data; missing scope is denied; local materialization preserves raw fake credentials and binary bytes, validates hashes, rejects generated-name collisions and cleans up on failure.
      Core assertions: `assert.equal("rawDom" in overview, false)` and `assert.deepEqual(await readFile(materializedBodyPath), rawBody)`.
- [ ] **Step 2: Run focused tests to confirm failure.** Run `node --import tsx --test tests/diagnostic-materialize.test.ts tests/agent-mcp.test.ts tests/agent-workflow.test.ts tests/recording-stdio.test.ts`.
- [ ] **Step 3: Implement discovery, stdio tool and guide.** Keep the normal compact MCP profile small; add the opt-in tool only to local stdio, and expose full-profile operations through shared registry. Regenerate the operation catalog and agent guides from source.
- [ ] **Step 4: Verify focused, stdio and catalog tests.** Run `node --import tsx --test tests/diagnostic-materialize.test.ts tests/agent-mcp.test.ts tests/agent-workflow.test.ts tests/recording-stdio.test.ts`, `npm run docs:generate`, `npm run check:harness`; all pass.
- [ ] **Step 5: Commit.** Commit as `Expose screenshot diagnostics on demand to agents`.

### Task 9: Cross-surface verification and release receipt

**Files:** Modify canonical `docs/{extension,agents,api,session-replay,verification}.md`, `docs/index.md`, `docs/plans/README.md`, `scripts/extension-browser-qa.mjs`; create `docs/plans/screenshot-diagnostic-evidence.md` from the repository template and `scripts/qa/extension/diagnostic-evidence.mjs` for the cross-surface browser scenario.

**Interfaces:** Documentation distinguishes screenshot raw artifacts from masked recording v1 and legacy packets, describes pre-start history limits, scopes, download and retry behavior, 256 MiB coverage and untrusted agent treatment. The receipt names exact source revision, checks, package hash, CI, installed Chrome and deployment/live proof separately.

- [ ] **Step 1: Add end-to-end regression assertions.** One synthetic review sends a 5 MiB+ DOM, raw console/network fake credentials and binary body, then UI download, bounded MCP and local materializer yield matching SHA-256; a second review with checkbox off sends no artifact; a failed upload retries on the same thread.
      Core assertions: `assert.deepEqual([uiHash, mcpHash, localHash], [captureHash, captureHash, captureHash])` and `assert.equal(uncheckedThread.diagnosticEvidence.count, 0)`.
- [ ] **Step 2: Run the end-to-end test to catch any integration failure.** `npm run qa:extension-browser` runs the new module against its existing isolated sandbox and packaged Chromium; record a failing gate before fixes.
- [ ] **Step 3: Resolve failures in their owning task and rerun that task's focused tests, then update canonical docs and generated catalog.** Review the full diff and object-key/migration compatibility.
- [ ] **Step 4: Run local gates on the exact revision.** On supported Node 22 or 24 run `npm run check`, `npm run qa:extension-browser`, `npm run qa:recording-browser`, `npm run qa:app-visual`, `npm run test:postgres`, `npm run build:site` and `npm run check:release`; record the source SHA, ZIP hash, outputs and any gate that did not run.
- [ ] **Step 5: Commit and submit the verified change.** Commit the integration/docs receipt, push a PR, attach it to this task, wait for required CI and review the final diff before merge. Report installation, deployment and live behavior separately, without claiming proof that did not run.

## Execution order

Tasks 1-3 establish the shared contract and authorized storage/read path. Tasks 4-6 add browser capture and review while sharing the recording debugger. Tasks 7-8 consume the committed manifest independently; Task 9 is the exact-revision integration gate. The implementation was merged forward through PRs #117-#126 and #128 before final integration checks.

## Implementation record · 2026-09-29

Tasks 1-9 are implemented on `codex/screenshot-diagnostics`, based on merged modular refactors #117, #119, #121-#126 and #128 and one-click recording #120. The browser collector shares the debugger with recording in either start order, streams DOM and other page state to local evidence, and keeps failed-cleanup IDs in the draft until deletion succeeds. Review uses one default-checked diagnostic choice. Server migration v25 stores private chunks and v26 indexes bounded diagnostic event searches. Thread UI and MCP expose compact summaries first, then authorized previews, search, archive download and local materialization. The diagnostic archive routes were integrated into the refactored HTTP module layout; the recording offscreen flow and replay-prefix handling remain in place. The detailed checkboxes above preserve the intended implementation sequence; the following receipts are the evidence for the implemented behavior.

- Local Node 25.2.1 `npm run check`: 415 tests, 391 passed, 24 intentionally skipped, 0 failed; formatting, import and documentation checks, types, builds, isolated smoke and release checks passed.
- Local Node 25.2.1 `npm run test:postgres`: 3 native PostgreSQL tests passed, including concurrent migration/finalize, expiry, thread move and deletion receipts.
- Local Node 25.2.1 `npm run qa:extension-browser`: packaged Chrome capture, editor review, local archive and send passed. The synthetic prepared DOM was 5,408,239 bytes in six chunks with SHA-256 `db0ed5c4e5d84bed56634169f427e2181069ec8569b60c21d3252762a53228cf`. Session replay, redirect origins and navigation scenarios also passed.
- Local Node 25.2.1 `npm run qa:recording-browser`: 22 tests passed.
- Local Node 25.2.1 `npm run qa:app-visual -- --baseline-dir=.local/visual-baseline-stable --output-dir=.local/visual-first-stable --init-baseline=true`, followed by comparison to `.local/visual-compare-stable` with `--max-change=0.5`: 56 synthetic desktop, medium, tablet and mobile views across light and dark themes; maximum image change was 0.09%, with zero blocked external requests. This baseline is from this branch, so it checks render stability rather than comparison to a previous release. The diagnostic panel itself was inspected separately at desktop and compact widths with a 5 MiB item and escaped 4 KiB preview.
- Impeccable's detector ran on the changed UI. It reported existing arrow-border styling as a side-tab heuristic and typography/token advisories; the generated UI screenshots and focused accessible-control tests were inspected in context.
- After merging #120 and #123-#125, Local Node 25.2.1 `npm run check` passed: 421 tests, 397 passed, 24 intentionally skipped, 0 failed. Formatting, docs/import gates, types, builds, isolated smoke and release checks passed for 727 public source files.
- On that merged source, Local Node 25.2.1 `npm run qa:extension-browser` passed packaged extension capture and review, the 5,408,239-byte six-chunk DOM receipt above, diagnostic archive/upload, one-click hidden recording handoff, session replay and redirect/navigation scenarios.
- Local Node 25.2.1 `npm run qa:recording-browser` passed 23 of 23 Chromium regressions; native `npm run test:postgres` passed 3 of 3 migration and concurrency tests on the merged source.
- Post-merge visual QA captured and compared 56 desktop, medium, tablet and mobile views in light/dark themes. The maximum image difference was 0.10% under the 0.5% threshold, with zero blocked external requests. An initial run exposed an asynchronous loading state in the Instructions view; the QA script now waits for that view to load before capture. This checks repeatability on the merged branch, not parity with a prior release.
- After #126, local Node 25.2.1 `npm run check` passed again (421 tests, 397 passed, 24 expected skips, zero failures). Supported Node 24.19.0 `npm run check` passed on rerun: 421 tests, 397 passed, 24 expected skips, zero failures; build, smoke and release checks passed. Its packaged browser capture/review run passed, including the 5,408,239-byte DOM. An earlier local Node 24 run hit a native V8 crash in an unrelated work-claims test, which passed in isolation; the full rerun passed. The earlier PR head passed Node 22/24 and extension-browser CI, but final-head CI is still required.
- After #126 the built extension package is version 0.1.39 at `dist/web/downloads/feedbacks-extension.zip`, Node 24 build SHA-256 `b82d563c5e5f784a15b904c7304b8da99e8d52bb9aefbba351e79d54d0005d5c`.

Final-head CI, a Store-installed extension, deployment and live-server behavior remain separate gates. They are not established by the local checks above.
