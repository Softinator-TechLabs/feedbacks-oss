# Plan: cross-platform app feedback

Status: proposed implementation; compatibility and Upcoming documentation prepared. Owner: Feedbacks contributors. Date: 2026-10-21.

## Outcome and scope

Extend the shared feedback workflow to explicitly identified native-app captures, starting with a desktop browser window-capture pilot. Follow with verified host-app mobile integrations, optional desktop/mobile companions and deliberately instrumented diagnostics. Current and proposed capabilities remain separate in the [compatibility matrix](../platform-compatibility.md) and [Upcoming](../upcoming.md).

This plan does not claim implementation, OS-wide inspection, automatic HTTPS decryption, anonymous customer SDK availability, real-device acceptance or Store publication. Private release schedules and launch material remain outside tracked source.

## Evidence and approach

The existing [mobile clients](../mobile-sdk.md) reuse paired-device operations with approved HTTPS screen locations. [Browser recordings](../session-replay.md) bind video and diagnostics to a selected tab/project. The recorder's [source validation](../../extension/video.js) rejects non-tab display surfaces. Native capture needs its own explicit provenance and project policy; simply relaxing that guard would mix unrelated browser evidence with native pixels.

Reuse existing private assets, revisions, idempotency and current project grants. First inspect [shared contracts](../../src/shared/contracts.ts), [project routing](../project-routing.md) and the [architecture](../architecture.md) before choosing an additive native capture identity. Do not introduce a generic ingestion service, framework dependency or credential model without a concrete requirement. Platform research and primary references are in the compatibility matrix.

## Steps and progress

- [x] Document current integrations, proposed platform capabilities and OS restrictions with primary-source provenance.
- [x] Add Upcoming documentation with availability criteria and no delivery promises.
- [ ] Define native capture identity, project authorization and backward-compatible context contracts; record whether any additive migration is required.
- [ ] Implement a desktop browser screenshot pilot with explicit window/display selection, image preview, annotation/redaction and authorized submission.
- [ ] Verify the existing mobile SDKs in real host apps on physical iOS and Android devices.
- [ ] Evaluate companion packaging and mobile sharing after pilot findings; implement each platform as a separately verifiable slice.
- [ ] Add app-integrated diagnostics only with explicit bounded instrumentation, redaction and channel coverage.
- [ ] Update availability only after required checks, packaging and platform acceptance are recorded.

## Acceptance criteria

- Native captures have explicit app/screen/source identity. Website origin checks remain enforced for browser captures. No fabricated location bypasses project authorization.
- Window/display capture starts only on user action. Denial, cancellation, stopped sources and unavailable capture support leave no submitted thread or silently active recorder.
- Preview and redaction precede Send. Native screenshots do not attach another tab's DOM, session events, console or network evidence.
- Creation/upload retries preserve idempotency. Interrupted uploads can recover the same thread; revoked devices and removed project grants are denied by the server.
- Existing screenshot, tab recording, mobile SDK and agent read workflows remain compatible. New native context is readable through HTTP/MCP/CLI without contradictory rules.
- Actual desktop picker/capture/review/upload checks run on Windows, macOS and Ubuntu, with Ubuntu's tested desktop/session recorded. Unsupported combinations show a truthful fallback.
- Mobile acceptance records real device/OS, pairing, capture, protected surfaces, cancellation, background/termination, upload recovery and revocation. Compilation alone does not pass this gate.
- Optional logs/network/crash/performance channels report their source, bounds and gaps. Symbols and backend correlation are verified when claimed.

## Compatibility and recovery

This documentation change has no API, permission, persistence, credential or runtime changes. Any later implementation must define additive compatibility and recovery in its own reviewed change. Preserve existing applied migrations, object keys and stored evidence; do not reinterpret a browser recording as a native capture. Clients must retain approved local drafts across uncertain outcomes, and owners retain server-side device revocation.

## Decision log

- 2026-10-21: Start with an explicit desktop visual-capture pilot; retain the tab recorder's identity checks. Share one domain authorization/evidence workflow while keeping capture adapters platform-specific.
- 2026-10-21: Existing iOS/Android integration source is an input to verification, not evidence of standalone companion availability or general deep diagnostics.

## Completion receipt

Source revision: implementation not started.
Checks and results: documentation checks recorded in the documentation change receipt.
Artifacts: compatibility matrix, Upcoming page and this proposed plan.
Deployment and live verification: no new capture client deployed or physically verified by this plan.
Remaining risks or follow-up: native identity design, OS/device access, permission UX, packaging/distribution and per-platform acceptance.
