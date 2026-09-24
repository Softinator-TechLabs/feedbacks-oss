# Plan: signed project webhooks

Status: implemented and locally verified. Owner: contributor. Date: 2026-09-24.

## Outcome and scope

Project maintainers can opt into one signed HTTPS destination per project, rotate its secret, disable it, and inspect the last 50 delivery outcomes. Committed thread activity queues a bounded event. Delivery is asynchronous with retry. The browser has no configuration screen in this slice; the shared API operations are the configuration surface.

## Evidence and approach

The existing `event` writer participates in the thread transaction. Queue insertion there keeps thread changes and delivery intent together. The worker uses a persisted lease and validates public DNS results before a pinned HTTPS request. It does not follow redirects.

## Steps and progress

- [x] Define the payload and maintainer operations with regression coverage.
- [x] Add migration, transaction enqueue, signed worker and failure status.
- [x] Document setup, verification and recovery.
- [x] Run full checks and review the diff.

## Compatibility and recovery

Migration 9 adds two tables and does not rewrite existing projects or events. The feature starts disabled. Disable removes queued deliveries; an in-flight request may complete. Delivered and failed metadata remain for project maintainers. Restore a database backup to recover configuration and delivery history. Secret rotation changes signatures on later attempts, so receivers should update their verifier before rotating.

## Decision log

The payload includes only event identity, kind, project/thread IDs, revision and timestamp. Receivers can use an authorized API to read thread details. No discussion body, context URL, diagnostic, reviewer policy or private note is transmitted.

## Completion receipt

Source revision: recorded in the implementing commit.
Checks and results: Node 24 `npm run check` passed with 44 tests passing and one skipped PostgreSQL concurrency test. The focused webhook test passed with five cases. Node 24 `npm run test:postgres` passed after updating the migration expectation to version 9.
Artifacts: source, tests and docs.
Deployment and live verification: outside scope.
Remaining risks or follow-up: live destination delivery and worker concurrency remain unverified. See [signed webhook guide](../webhooks.md).
