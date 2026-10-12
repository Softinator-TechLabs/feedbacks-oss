# Plan: simpler manual feedback and stable list return

Status: implemented and locally verified. Date: 2026-10-12.

## Outcome and scope

Feedback filters start collapsed on every screen, with active criteria visible on the disclosure. Manual feedback needs only its body; category, tags and page URL remain optional. Returning from a thread immediately restores the list page and reading position while refreshing authoritative data in the background.

The agent start projection also supports body-only feedback: it omits absent page URLs instead of returning a blank reviewed-page target. The bundled native plugins advance to version 0.2.3 for the changed MCP adapter; the extension package is unchanged.

## Evidence and approach

The original [composer](../../src/web/threads/composer.tsx) requires a URL and manually entered viewport before the body. [List filters](../../src/web/threads/list-filters.tsx) collapsed only on mobile. [Navigation](../../src/web/navigation.ts) previously reset scroll, and the [list](../../src/web/threads/list.tsx) discarded loaded rows on remount.

Keep capture context unchanged for the extension and existing API clients. Add an optional manual page URL to thread creation; body-only feedback stores no invented website or viewport. Use bounded in-memory list snapshots, scoped to the signed-in member and cleared on account changes. Preserve server ordering and existing pagination rather than accumulating stale rows.

## Steps and progress

- [x] Reproduce and establish server/browser regressions.
- [x] Implement optional manual context, tag submission, filter disclosure and list restoration.
- [x] Update canonical guides and generated operation contracts.
- [x] Review the diff and run focused acceptance and the full local check matrix. Required CI remains the merge gate; deployment and authenticated live acceptance are recorded in the delivery receipt.

## Compatibility and recovery

Creation input is additive: existing website and document captures keep their validation and origin checks. No migrations, object-key changes or new permissions. New manual threads may have partial context; deploy server and web together. A rollback must retain the optional-context read guards because older UI builds assume every thread has a recorded viewport. Preserve the submitted feedback rather than manufacturing replacement context. Memory snapshots are temporary and never persisted to browser storage; rejected access clears them. Refresh errors retain the last successful list with a visible retry action.

## Completion receipt

Source changes: linked composer, navigation, list and shared creation contract.

Checks: full local check matrix passed (526 tests passed, 43 conditional skips, no failures), including builds, disposable smoke, release checks and dependency audit with zero vulnerabilities. The filter browser suite and manual-review browser regression passed. Synthetic desktop/mobile and keyboard acceptance covered body-only creation, tags, retry identity and cached list/scroll restoration.

Artifacts: generated builds and screenshots remain outside tracked source. Delivery uses the associated PR's required CI and separately verified deployment/live receipt.
