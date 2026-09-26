# Plan: native mobile feedback clients

Status: Android host compilation passed in PR CI; real-device verification pending. Owner: Feedbacks contributors. Date: 2026-09-26.

## Outcome and scope

An authenticated reviewer can connect an iOS or Android app to an existing Feedbacks installation, capture that app's current screen with an explicit user action, inspect or redact it in the host app, and submit feedback with an approved HTTPS screen URL. The clients use the existing public HTTP operations. This is an integration kit for apps, not an anonymous end-user SDK or a system-wide screen recorder.

## Evidence and approach

The server's existing `pairing.request`/`pairing.poll` flow issues a revocable 30-day device token after browser approval. That token already has `threads.create`, `assets.upload`, `projects.list` and project-scoped access. `contextSchema` requires an HTTP(S) URL, and `viewContext` enforces an approved project origin unless the project is set to Any website. Reuse these boundaries instead of embedding an owner/agent secret or adding another public ingest route. Implement dependency-free Swift and Android Kotlin clients that speak the same JSON envelope and expose separate create/upload steps, so an uncertain upload can retry with the identical idempotency key and bytes.

## Steps and progress

- [x] Inspect the public API, token issuance, screenshot limits and URL rules.
- [x] Add Swift client, pairing and iOS in-app capture helper. The Swift smoke executable runs locally.
- [x] Add Android client, Keystore-backed token storage and in-app capture helper.
- [x] Document integration, limits and explicit screenshot review.
- [x] Run available repository checks and record native tooling gaps.
- [x] Compile the Android module in a minimal host app on CI.
- [ ] Verify capture, pairing and upload in an actual host app on a real device.

## Compatibility and recovery

No server schema, migration, operation or default scope changes. Existing device tokens retain their current scope and expiry. Users can revoke a mobile device token in Account; app sign-out clears its local secret. Failed or uncertain uploads leave an existing thread; the host keeps its draft and retries the exact upload request rather than silently creating a second thread.

## Decision log

- 2026-09-25: Use existing pairing, not a static app-wide API key or guest link. Native apps cannot safely embed a long-lived secret, and guest submission requires browser Turnstile and omits screenshot uploads.

## Completion receipt

Source revision: PR #48 merged as `919ff35`.
Checks and results: Node 24 `npm test` 67 passed, 1 intentional native PostgreSQL skip; `npm run check:harness`, `npm run typecheck`, `npm run format:check`, `npm run build`, `npm run check:release` passed. The Swift stub-transport smoke executable passed again on 2026-09-25. PR #68 `android-host` CI built the library inside a minimal Android app with SDK 35 on 2026-09-26; local Android compilation remains unavailable without an SDK. SwiftPM's XCTest target did not run because this machine has Command Line Tools without XCTest.
Artifacts: iOS Swift package, Android library source, compile-only Android host, integration guide and synthetic HTTP contract test.
Deployment and live verification: shared API source is deployed; no real-device client test performed.
Remaining risks or follow-up: test both platforms on real devices, including screenshot review, pairing, upload and app-specific canonical screen URLs. The compile-only host does not establish runtime behavior.
