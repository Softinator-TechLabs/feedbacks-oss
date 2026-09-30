# GitHub App management implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement each task
> in this session, followed by independent whole-change review.

**Goal:** Add and manage private GitHub Apps entirely from the owner page.

**Architecture:** Keep existing project routing and the single-organization
deployment boundary. Add a session-bound GitHub manifest handshake and encrypted
managed credential catalog backed by PostgreSQL and existing private storage.

**Tech stack:** Node 22/24, TypeScript, PostgreSQL/PGlite, React and existing
AssetStore; no new dependencies.

**Spec:** [Design](../superpowers/specs/2026-09-30-github-app-management.md).

## Constraints and review focus

- Human server owners only; current authorization before external work and commit.
- RSA keys and exchange responses never appear in outputs, events or errors.
- Private registration requires the intended GitHub account's approval.
- Preserve applied migrations, legacy default identity and historical routing.
- Bound catalogs to 21 Apps, registration attempts and external timeouts.
- Test callback replay after lost exchange response and ownership revocation.
- Test private storage unavailable/tampered and disabled legacy override.
- Test fresh browser navigation with stale walkthrough cache and keyboard flow.

## Tasks

- [x] Reproduce: direct GitHub page walkthrough loading and missing owner
      registration operation; add failing managed-catalog/handshake tests.
- [x] Persistence: additive migration 28 for encrypted App records and
      single-use session-bound registration requests. Bump native migration
      assertions; preserve existing rows and object keys.
- [x] Catalog: current metadata overlay plus lazy selected-key decryption;
      keep injected fetcher across config snapshots. Route HTTP and background
      sync through the same managed catalog.
- [x] Operations: owner-only start/import/adopt/update/enable, callback exchange
      with expiration, state/session checks, account/permission validation,
      generic failures, safe audit data and pending-write guards.
- [x] Transport: authorized callback route, origin/CSRF-safe start operation,
      narrow GitHub form CSP and callback no-store redirects without codes.
- [x] UI: Add GitHub account, GitHub approval, successful installation/project
      steps, existing App management and optional PEM file input; shared
      illustration reflects the working flow and loads on direct navigation.
- [x] Focused tests: restart/multi-instance routing, role denial, encrypted
      storage, replay/expiration, invalid owner/permissions, key rotation,
      disabled fallback, revision conflicts and background sync.
- [x] Knowledge: update canonical operator/API/architecture and public guide;
      remove claims that browser management requires per-App deployment edits.
- [x] Acceptance: loopback browser desktop/mobile light/dark, fresh direct
      navigation, keyboard flow and bounds; full check/native PostgreSQL and
      independent review.
- [ ] Release: exact-head CI, merge and live UI proof.

## Accepted extension: common integration foundation

The owner requested a shared foundation for future GitLab, Bitbucket, Jira,
Asana and ClickUp adapters, while completing GitHub now. Implement a common
owner-only Integrations catalog/page and provider-scoped encrypted credential
vault. Keep GitHub registration, repository permissions, history and sync in its
own adapter/domain. Show only implemented providers; future authentication and
sync must be implemented and verified before enabling another provider.

- [x] Add failing catalog authorization and cross-provider vault tests.
- [x] Extract the shared credential vault and register the GitHub catalog adapter.
- [x] Add Setup → Integrations; reuse credential storage choices in GitHub.
- [x] Document adapter contracts, persistence boundaries and future acceptance gates.
- [ ] Verify focused/full/browser checks and independent review, then release.

## Status and evidence

Focused backend and independent review passed. Same-ID key recovery preserves
account policy and disconnected state. Both encrypted and environment choices
remain supported. Cross-site Chromium flow, 3 native PostgreSQL checks and the full check
passed (457 passed, 26 optional skips), including vault prefix/readback and cross-server
identity checks. Final CI and live rollout remain release gates. No real
GitHub App has been created by this plan.
Keep live credentials and operational evidence outside tracked source.

Common foundation verification: 14 focused tests and the owner hub/GitHub browser flow passed; full check passed with 462 tests and 30 optional skips. Independent review passed 23 focused tests and found no remaining critical/important issues. Discovery exclusion was rechecked afterward; required CI and live release remain pending.
