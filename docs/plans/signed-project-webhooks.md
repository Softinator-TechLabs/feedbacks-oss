# Plan: signed project webhooks

Status: merged; live destination acceptance pending. Owner: contributor. Date: 2026-09-25.

## Outcome and scope

Project maintainers can opt into one signed HTTPS destination per project in Project settings or through the shared API, rotate its secret, disable it, and inspect the last 50 delivery outcomes. Committed thread activity queues a bounded event. Delivery is asynchronous with retry.

## Evidence and approach

The existing `event` writer participates in the thread transaction. Queue insertion there keeps thread changes and delivery intent together. The worker uses a persisted lease and validates public DNS results before a pinned HTTPS request. It does not follow redirects.

## Steps and progress

- [x] Define the payload and maintainer operations with regression coverage.
- [x] Add migration, transaction enqueue, signed worker and failure status.
- [x] Add maintainer settings with one-time secret display, draft preservation and delivery status.
- [x] Document setup, verification and recovery.
- [x] Run full checks and review the diff.

## Compatibility and recovery

Migration 9 adds two tables and does not rewrite existing projects or events. The feature starts disabled. Editing the URL keeps the secret; rotation changes signatures on later attempts. Disable removes queued deliveries; an in-flight request may complete. Delivered and failed metadata remain for project maintainers. Restore a database backup to recover configuration and delivery history.

## Decision log

The payload includes only event identity, kind, project/thread IDs, revision and timestamp. Receivers can use an authorized API to read thread details. No discussion body, context URL, diagnostic, reviewer policy or private note is transmitted.

## Completion receipt

Source revision: PR #34 merged as `081738f`.
Checks and results: Node 24 `npm run check` passed with 46 tests passing and one skipped PostgreSQL concurrency test. The focused webhook service and settings render tests passed with seven cases. Node 24 `npm run test:postgres` passed. In the disposable browser app, desktop and mobile settings rendered without overflow; invalid URL feedback kept its draft; create, rotate, reload, URL edit and disable showed the expected secret and status behavior. A new reply appeared in delivery history as pending. Keyboard Tab reached Save webhook with a visible focus outline.
Artifacts: source, tests and docs.
Deployment and live verification: source merged into the deployed app; an external destination delivery has not been verified.
Remaining risks or follow-up: live destination delivery and worker concurrency remain unverified. See [signed webhook guide](../webhooks.md).
