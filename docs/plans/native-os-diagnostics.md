# Plan: reuse native OS diagnostics

Status: implemented; real application-event acceptance pending. Owner: Feedbacks contributors. Date: 2026-10-21. Design: [issue 218](https://github.com/Softinator-TechLabs/feedbacks-oss/issues/218).

## Outcome

Reuse Get-WinEvent, journalctl and macOS Unified Logging for explicitly selected process/time windows. A local CLI collector produces a bounded, sanitized JSON event snapshot. A reviewer imports and edits it beside an app screenshot before explicitly including it in Send. Keep native evidence separate from browser diagnostics.

## Steps

- [x] Inspect existing capture, project authorization, idempotency and progressive agent context.
- [x] Verify OS facilities against Microsoft, systemd and Apple documentation.
- [x] Implement fixed-command adapters, bounded process execution and a shared event report schema.
- [x] Add reviewed screenshot-workflow import, native context and compact agent summaries.
- [x] Verify parsers, filtering, command safety, redaction, limits, access denial, recovery and browser submission.
- [x] Run available OS tool and repository checks; add matching-OS CI and update compatibility/quality guides with exact boundaries.

## Acceptance and compatibility

Native snapshots are at most 128 KiB, 100 messages and a one-hour selected window. Coverage is partial or unavailable, with explicit reasons. Collection never uploads or starts a background monitor. Fixed tools run without shell expansion, elevation or Feedbacks credentials. OS-retained private values stay hidden; no logging/privacy configuration is changed. The browser imports JSON and does not execute OS commands.

The optional threads.create field uses existing project write authorization and request identity. Stored snapshots are untrusted native context, distinct from browser diagnostics, and ordinary agent summaries omit event bodies. Existing context pagination reads them on request. No migration, new scope, dependency, binary dump intake or weakening of browser-origin checks is required. Existing drafts remain readable; approved native snapshots join the existing exact retry draft. Removing a local snapshot does not delete submitted evidence.

## Evidence and remaining work

Record final tests and source revision in the implementation PR. Synthetic event fixtures and empty-process tool invocation smoke establish separate evidence; neither proves collection for every application. Standalone GUI companions, signed installers, full crash dumps, ETW tracing, coredump decoding and Instruments profiling remain separate work.

Local evidence includes the repository test suite with two workers, production builds, sandbox smoke, release checks, native PostgreSQL tests, synthetic API/browser submission and a macOS empty-process query through both the adapter and built CLI. Browser acceptance covers explicit review, edit invalidation, exact reload/retry and responsive editor/thread presentation with long identifiers. The final revision's CI records Windows, Ubuntu and macOS tool invocation separately. Production deployment, installed desktop clients and real matching application events remain unverified.
