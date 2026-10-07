# Normal website use during background sending

Status: implementation and focused checks complete; packaged acceptance and delivery pending. Date: 2026-10-07.

## Outcome

Choosing **Send & Return** ends the captured page's review UI before focusing that page. Pins, selection overrides and the ON badge disappear while uploads continue in the capture tab. Normal website interactions are available immediately. Failed sends still focus the capture tab with the original draft and retry state.

## Approach and compatibility

The [navigation helper](../../extension/submission/review-navigation.js) invokes a worker-owned handoff before focusing the website. The worker validates the stored screenshot draft or bound video target and ends only its matching review session. It retains the recorder binding, diagnostic evidence and saved frames needed by submission. New screenshot drafts retain the source review ID; older drafts remain readable. Completion notifications from an older capture cannot alter a replacement review.

No server API, permissions, dependencies or database migrations change. **Send & Open** keeps its existing foreground behavior. The package version advances to `0.1.59`.

## Verification and delivery

- [x] Regression checks for cleanup before focus, failed handoff recovery, retained drafts and replacement review protection.
- [x] Screenshot/video entrypoint checks with delayed failure and both retry destinations.
- [ ] Packaged screenshot/video acceptance, including normal website navigation while upload is held.
- [ ] Repository gates, package inspection and exact-revision CI.
- [ ] Merge, published versioned release and hosted package readback; report Store publication separately.
