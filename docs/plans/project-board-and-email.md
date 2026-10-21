# Plan: project workflows and subscribed email delivery

Status: implementation and release complete; external account acceptance remains separate. Owner: Codex. Date: 2026-10-21.

## Outcome and scope

Add a keyboard-accessible board alongside the feedback list, preserving thread identity, filters, permissions and revision conflicts. Add opt-in email notifications for project members, including external clients, with server defaults and project overrides for delivery and templates. Support SMTP (including Google), Mailjet and Amazon SES without requiring an inbound public endpoint.

Extend the same workspace with scoped analytics, permanent website intake, explicit tracker/channel/replay/time connections and authenticated automation. Analytics separates visual current project priorities, period trends and contextual exploration into Overview, Trends and Explore tabs; supporting tables and definitions stay optional. The organization roadmap and provider rollout inventory remain private. This plan describes this implementation only; it does not certify untested external integrations.

## Evidence and approach

Reuse the [thread operations](../../src/server/feedback.ts), [event transaction](../../src/server/access.ts), [credential vault](../../src/server/integrations/credential-vault.ts) and [application controls](../../src/web/threads/list.tsx). Queue notifications in the same transaction as the event, send outside domain transactions, and recheck subscriptions and access before sending. Never include screenshots, diagnostics, private notes or recipient lists in email.

## Steps and progress

- [x] Inspect current source and privately record the requested roadmap scope.
- [x] Implement board configuration, queries, moves and batch actions with denied-access and conflict coverage.
- [x] Implement scoped current project analytics and historical activity metrics.
- [x] Verify project charts and exact pending, overdue and high-priority drilldowns, including saved-timezone boundaries.
- [x] Implement email configuration, safe templates, subscriptions and a durable delivery worker.
- [x] Verify provider request construction and ambiguous-send recovery with synthetic transports.
- [x] Update canonical guides and generated operation facts.
- [x] Run the initial verification matrix and inspect desktop/mobile/keyboard behavior.
- [x] Split integration settings into concise provider tabs, preserve drafts and verify desktop/mobile/keyboard behavior.
- [x] Expose project-scoped task connections and add the explicitly configured OpenProject adapter.
- [x] Complete final release, image and live acceptance.

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
- Integration settings show one provider category at a time. Keep short form labels and a clear next action; open setup details and delivery history only when needed. Load a panel on first visit and preserve its drafts across tab changes.
- Separate current work, historical activity and contextual breakdowns into visual tabs. Keep pending, overdue and high-priority project comparisons explicit, with exact matching-thread actions.
- Treat provider acceptance separately from inbox delivery. Do not label queued or accepted messages delivered.
- SMTP uses Nodemailer for TLS, authentication and MIME handling; SES uses its official client; Mailjet uses its HTTPS Send API. These dependencies serve concrete requested transports.

## Completion receipt

Source revision: `4a8982e2485faed2937bd866cdbc4da358217475`. [Exact-main CI, attempt 2](https://github.com/Softinator-TechLabs/feedbacks-oss/actions/runs/39629366205/attempts/2) passed all six jobs, including native PostgreSQL and browser acceptance.

Artifacts: [application 0.3.0](https://github.com/Softinator-TechLabs/feedbacks-oss/releases/tag/v0.3.0) was downloaded anonymously; all seven checksummed files and 1,120 exported source hashes matched. [Image publication](https://github.com/Softinator-TechLabs/feedbacks-oss/actions/runs/39632919326) passed native AMD64/ARM64 checks, with public manifests, SBOM/provenance and anonymous pulls.

Released-image acceptance passed twelve isolated S3/authentication/pairing/MCP/board/analytics checks. It used a fresh database and a new project beneath the configured staging organization without widening the scoped storage key; normal deletion left that project's prefix empty and the owned containers were cleaned up. Four subscribed feedback/reply emails traversed the scheduled SMTP worker; inbox content and both configured From addresses were verified. Two deployed Mailjet API tests were accepted with one attempt each; acceptance alone is not inbox delivery.

Deployment and live verification: the existing application now runs the same published immutable image with its environment and owner session preserved. Authenticated readback confirmed board columns/cards, Overview/Trends/Explore analytics and a Pending drilldown matching its displayed count. Settings showed ten task providers, the Asana editor, the separate Email notifications tab and the saved project sender. Readiness and a fresh synthetic production screenshot upload/authenticated readback passed; the downloaded dimensions and exact normalized bytes matched, anonymous access was denied and the test thread was archived. Detailed operational evidence remains private.

Remaining acceptance: external tracker/provider accounts, Jira OAuth distribution/consent, OpenProject instance rules, SES/Google SMTP, production widget challenge and installed Chrome/Store verification remain separate gates. Synthetic adapter tests and visible setup forms do not certify those accounts.
