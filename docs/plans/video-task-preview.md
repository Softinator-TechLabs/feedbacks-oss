# Plan: usable video evidence in the first task read

Status: implemented; CI and deployment acceptance pending. Date: 2026-09-30.

## Outcome and scope

Extend the existing authorized asset preview and task handoff: bounded native video contact sheets, optional explicit reproduction identity, and one exact deferred-tool discovery hint. Keep text-only reads small and diagnostics on demand. No customer material or credentials in fixtures. Subsequent user review of a nine-point copy added marked screenshot previews and compact numbered summaries with geometry on demand.

## Approach

Use the existing `assets.get(includeImage:true)` and native MCP image channel for both images and WebM. A server-side FFmpeg process reads only authorized local bytes, with format/protocol, time, byte, pixel and concurrency limits. A contact sheet carries actual decoded timestamps and a source hash; it proves samples only. A requested video timestamp focuses the samples. Existing screenshots/saved frames remain preferred. No persistent derived objects or migration.

Reproduction metadata is optional, explicit application/reporter input, separate from sanitized navigation URLs. No guessing identifiers from credential-bearing URLs. Existing anchor/document identity remains useful on older captures.

## Progress

- [x] Inspect current flow and define focused regression cases.
- [x] Implement shared contracts, server preview, compact start and copy changes.
- [x] Update canonical media guide, deployment dependency and generated catalog.
- [x] Run focused and full local gates; inspect synthetic marked and video previews and independently review the diff.

## Compatibility and recovery

`assets.get` scope and project authorization remain unchanged. New optional fields are additive. Container adds the FFmpeg executable; non-container operators install FFmpeg/ffprobe. Missing decoder, invalid media and busy/timeout states return explicit bounded unavailability. No automatic client-side credential lookup. Rollback needs no data migration.

## Completion receipt

Local verification: 482 passing tests and 33 opt-in skips (515 total), type checks, formatting, harness/catalog checks, full build, isolated app smoke and release checks. Packaged extension browser acceptance passed. Review follow-ups passed 14 focused tests, including nonzero video timestamps, current scope/project denial, revocation during decoding and saved-frame pin numbering. Synthetic marked and video previews were visually inspected.

Container builds/smoke remain pending because no local Docker daemon was available; CI installs the decoder and runs container checks. Production deployment, installed Chrome package and fresh-chat discovery are not claimed. FFmpeg is a separate server executable; missing support produces explicit unavailability. No data migration is required.
