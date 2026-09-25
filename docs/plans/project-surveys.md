# Plan: opt-in project surveys and NPS

Status: merged; production challenge acceptance pending. Owner: Feedbacks contributor. Date: 2026-09-25.

## Outcome and scope

Project maintainers create a short anonymous survey with NPS, 1–5 rating, single choice and text questions. Each survey has an expiring, capacity-limited public link. Visitors complete it without joining the project. Maintainers review counts, distributions, NPS and bounded individual answers. Survey responses do not become feedback threads.

## Evidence and approach

Existing project guest links establish the public-ingress pattern: a hash of a one-time link token, Turnstile, per-IP rate limit and current project authorization for management. Survey definitions are immutable after creation, so an answer is always interpreted against the same questions. Response bodies remain project-private. Shared schemas expose every management operation through HTTP, MCP and JSON CLI; public inspect and submit retain the guest identity boundary.

## Steps and progress

- [x] Add focused contract, authorization, public-ingress and aggregate tests that fail first.
- [x] Add additive migration and survey domain operations with bounded storage and response validation.
- [x] Add public survey and project results UI with readable empty/error states.
- [x] Update API/usage docs and generated operation catalog.
- [x] Run checks, inspect diff and record exact evidence.

## Compatibility and recovery

Migration 15 adds survey and response tables; it does not change existing threads or guest links. Expiry, revocation and response capacity stop new submissions while existing results remain available. A survey link token is returned only on creation. Dropping the new tables would delete surveys and responses, so recovery uses the deployment database backup.

## Decision log

- Keep surveys opt-in and independent of unsolicited website capture. The only visitor flow is the explicitly shared link.
- Freeze questions at issuance. Edits to live questions would make distributions ambiguous; a new survey is the versioning mechanism.
- Do not collect visitor names, email or IP in response rows. Turnstile and transient ingress throttling protect public writes.

## Completion receipt

Source revision: PR #43 merged as `e0ff97f`.
Checks and results: Node 24 `npm run check` passed (67 tests, one opt-in native PostgreSQL skip). `npm run test:postgres` passed against a disposable local PostgreSQL cluster, including concurrent application of migration 15. Focused survey HTTP/domain test passed after the final behavior change. Synthetic browser inspection verified creation, public form, desktop and 390px mobile layouts; the mobile project navigation remains within the viewport.
Artifacts: project survey editor/results screen, public response page, additive migration, shared operation contracts and generated operation catalog.
Deployment and live verification: source merged into the deployed app; real public Turnstile submission has not been verified.
Remaining risks or follow-up: production Turnstile hostname/action checks and real customer traffic were not exercised. HTTP tests use a synthetic verifier; the browser pass did not solve a challenge. Multi-replica deployments need the shared ingress throttle described in self-hosting docs.
