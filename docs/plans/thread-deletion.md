# Plan: thread archive and permanent deletion

Status: completed in source; deployment and live storage verification pending. Date: 2026-09-27.

## Outcome and scope

Make Archive discoverable, allow maintainers to select a page of feedback for deletion, and show explicit header actions with consequence confirmations. Remove thread-owned records and current private objects without deleting shared documents. Never exercise this feature on real user data during development.

## Decisions and progress

- [x] Inspect existing archive, asset storage, authorization and dependent records.
- [x] Add bounded revision-checked deletion, durable receipts and leased object cleanup after commit.
- [x] Add list selection, Archive access, header actions and visible cleanup retries.
- [x] Add synthetic authorization, rollback, retry and shared-document regression coverage.
- [x] Update canonical workflow, API and operations guides and generated catalog.
- [x] Finish focused checks and synthetic desktop/mobile browser verification.

## Compatibility and recovery

Migration 18 is additive. Human maintainer access is required and rechecked on retries. Existing scoped agent keys gain no deletion authority. Archive is reversible. Deletion preserves a metadata tombstone and invalidates project export snapshots. Shared documents and linked external issues stay available. S3 current-object deletion does not bypass object retention or purge old versions. Cleanup failures remain in the database and are retried automatically with backoff; the list also offers an immediate retry.

## Verification

See [thread deletion regression tests](../../tests/thread-deletion.test.ts) and [cleanup implementation](../../src/server/thread-deletion.ts). No production deletion or deployment is implied by these checks.

Focused deletion tests cover denied access, all-or-nothing stale/cross-project selections, the 50-thread limit, shared-document object retention, failed cleanup, retry/backoff, expired leases, automatic continuation beyond 12 objects and prevention of delayed create replay after deletion. Typecheck, harness/catalog checks and server/web builds passed. The final Node 22 integration suite passed 132 tests with four configured skips; the native PostgreSQL check ran separately and passed.

A disposable loopback browser run at 1280px and 390px verified Archive/restore, explicit delete consequences, Cancel focus, Escape cancellation, selection, synthetic deletion/readback, no horizontal overflow and no console errors. No production/customer data was accessed or deleted. Native PostgreSQL also verified concurrent worker claims, active-lease exclusion, failure backoff and manual retry. Live Wasabi retention/version behavior remains unverified; synthetic tests do not delete real data.
