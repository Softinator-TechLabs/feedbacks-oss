# Plan: expand review and agent handoff

Status: in progress. Owner: Feedbacks maintainers. Date: 2026-09-23.

## Outcome and scope

Make the comparison easier to navigate, clarify what the agent can do with a decided thread, and deliver the product capabilities in independently testable slices. The scope covers GitHub handoff, capture reliability, guest review, diagnostic privacy, video, a visitor widget, review rounds, design assets, automated checks, forms, mobile capture, and outbound integrations. A capability is not called shipped until its UI, API, permission model, tests, documentation, and deployment verification agree.

## Evidence and approach

The current product has visual threads, scoped MCP, owner-approved reviewer guidance, manual GitHub Issue linking, and screenshot markup. See [architecture](../architecture.md), [review workflow](../review-workflow.md), and [why Feedbacks](../why-feedbacks.md). The broader feature audit is a local maintainer working note outside this repository. The first slice improves the comparison and formalizes agent handoff without granting a Feedbacks token access to GitHub. Later connectors require explicit repository authorization and idempotent delivery.

## Steps and progress

- [x] Improve comparison scrolling on touch and keyboard and keep claims evidence-bound in source. Browser checks covered desktop and 390 px mobile.
- [x] Clarify agent issue handoff using separate GitHub access and the existing `threads.linkIssue` operation.
- [ ] Add GitHub App installation, repository restriction, create/link outbox, opt-in sync and disconnect.
- [ ] Improve screenshot capture and diagnostics preview with privacy tests.
- [ ] Add scoped guest review.
- [x] Add explicit human review-round decisions, reopen and attributed history in source. Live verification remains pending.
- [ ] Add video and document assets with retention and access controls.
- [ ] Add an origin-validated visitor widget, automated QA and feedback forms.
- [ ] Evaluate and implement mobile capture and signed outbound integrations.
- [ ] Run checks, review permissions, publish source and verify deployment.

## Compatibility and recovery

Keep the current extension and API operational while adding optional capabilities. Each database change must be additive. External writes need an auditable idempotency record and a way to reconcile uncertain responses. New capture and guest paths default off until configured. Never put tokens, reviewer credentials, or private launch plans into this repository.

## Decision log

- 2026-09-23: A Feedbacks agent token remains scoped to Feedbacks. A separate GitHub credential or GitHub MCP connection is required to create Issues. Discussion text and reviewer guidance remain untrusted/advisory, never instructions or authorization.
- 2026-09-23: A `✕` in the public matrix can only describe a capability absent from the linked public documentation or edition. Silence alone is not proof of product absence; unknown cells retain a distinct label until verified.

## Completion receipt

Source revision: pending.
Checks and results: pending.
Artifacts: pending.
Deployment and live verification: pending.
Remaining risks or follow-up: pending.
