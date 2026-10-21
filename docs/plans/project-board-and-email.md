# Plan: project workflows and subscribed email delivery

Status: in progress. Owner: Codex. Date: 2026-10-21.

## Outcome and scope

Add a keyboard-accessible board alongside the feedback list, preserving thread identity, filters, permissions and revision conflicts. Add opt-in email notifications for project members, including external clients, with server defaults and project overrides for delivery and templates. Support SMTP (including Google), Mailjet and Amazon SES without requiring an inbound public endpoint.

Extend the same workspace with scoped analytics, permanent website intake, explicit tracker/channel/replay/time connections and authenticated automation. The organization roadmap and provider rollout inventory remain private. This plan describes this implementation only; it does not certify untested external integrations.

## Evidence and approach

Reuse the [thread operations](../../src/server/feedback.ts), [event transaction](../../src/server/access.ts), [credential vault](../../src/server/integrations/credential-vault.ts) and [application controls](../../src/web/threads/list.tsx). Queue notifications in the same transaction as the event, send outside domain transactions, and recheck subscriptions and access before sending. Never include screenshots, diagnostics, private notes or recipient lists in email.

## Steps and progress

- [x] Inspect current source and privately record the requested roadmap scope.
- [x] Implement board configuration, queries, moves and batch actions with denied-access and conflict coverage.
- [x] Implement scoped current project analytics and historical activity metrics.
- [ ] Verify project charts and exact pending, overdue and high-priority drilldowns, including saved-timezone boundaries.
- [x] Implement email configuration, safe templates, subscriptions and a durable delivery worker.
- [x] Verify provider request construction and ambiguous-send recovery with synthetic transports.
- [x] Update canonical guides and generated operation facts.
- [ ] Run the verification matrix and inspect desktop/mobile/keyboard behavior.

## Compatibility and recovery

New configuration and queue tables are additive. Existing threads keep their statuses and history. Existing installations send no email until configured and members subscribe. Existing agent keys do not gain new scopes. Disabling a provider or subscription suppresses queued mail; ambiguous delivery is held for operator reconciliation rather than automatically duplicated. Back up the database and private storage together for encrypted credentials. Older application versions ignore new tables; do not remove applied migrations.

## Direction contract

THESIS: Give the existing review workspace a clear path from intake to resolution and subscribed follow-up.
OWN-WORLD: Preserve the app’s Oxford actions, system typography, quiet surfaces, native fields and disclosures.
STORY: Reviewers find feedback, move or assign it, inspect progress and choose notifications; maintainers connect only the tools they need.
FIRST VIEWPORT: One page heading, relevant filters or concise settings context, followed by the board, report or configuration action. Optional credentials and templates open in disclosures; mobile controls and board lanes stack vertically.
FORM: Extend the existing Operate surface, code-led. The signature interaction is a revision-checked card move with visible success or conflict recovery. Existing restrained motion and reduced-motion behavior continue.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Decision log

- Keep the existing application typography, theme and controls. The board is an alternate project view.
- Treat provider acceptance separately from inbox delivery. Do not label queued or accepted messages delivered.
- SMTP uses Nodemailer for TLS, authentication and MIME handling; SES uses its official client; Mailjet uses its HTTPS Send API. These dependencies serve concrete requested transports.

## Completion receipt

Source revision: pending.
Checks and results: pending.
Artifacts: pending.
Deployment and live verification: not yet performed.
Remaining risks: real provider credentials and live sandbox acceptance are separate gates.
