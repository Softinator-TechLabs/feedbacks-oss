# Compact Account navigation

Status: review-ready; CI and deployment pending. Owner: Feedbacks maintainers. Date: 2026-09-29.

## Outcome and scope

Account presents Agent setup, Connections, Owner links and Security as reachable tabs on desktop and mobile. Deep links to `#agent-setup` open the correct tab. Active credentials remain easy to identify; revoked and expired history stays accessible without filling the page. New owner sign-in links show their last four characters in the list. The mobile Menu overlays the page without moving its header or content.

## Evidence and approach

The reported 660px Account viewport shows five full-height revoked owner-link rows before any other account control. The current owner-link record stores only a hash, so old secret endings cannot be reconstructed. Existing agent-token issuance already stores a nullable four-character suffix. Add a nullable suffix for new owner links and show an honest legacy fallback. Preserve all records and revocation behavior.

## Steps and progress

- [x] Inspect the live page, current UI, operation contract and migration path.
- [x] Add focused regression coverage for owner-link suffix persistence and old records.
- [x] Build Account tabs and compact credential groups; keep hash navigation and keyboard access.
- [x] Fix mobile Menu geometry and verify no header/content shift.
- [x] Update canonical guidance, review the diff, run required local checks and inspect synthetic desktop/mobile views.
- [ ] Complete required CI and deployment/live verification if released.

## Compatibility and recovery

Migration 24 adds a nullable `account_links.secret_suffix` column. Existing links keep `NULL`; no raw secret is recovered or stored. Application rollback can leave the nullable column in place. The revised list response adds an optional nullable field; existing clients remain compatible.

## Decision log

- Tabs follow task intent rather than credential type details: Agent setup, Connections, Owner links, Security.
- Historical credentials remain available behind disclosures; they are not deleted or silently omitted.
- The shared `details[open] > summary` rule adds an 18px bottom margin. In the mobile header it expanded Menu and moved the page by 12px; the Menu now cancels that margin. A 660px synthetic browser check measured header and main top at 73px both before and after opening.
- A managed checkout under `.codex` caused Express to reject static files as dotfiles during visual QA. A temporary sandbox-only static-file override enabled the captures and was removed from source afterward. The normal built sandbox smoke check passed without it.

## Completion receipt

Source revision: `codex/account-mobile-ux`; exact commit is recorded in Git history.
Checks and results: Node 22 `npm run check` passed (325 tests passed, 20 skipped), `npm run test:postgres` passed (2 tests), and the focused owner-link test passed after failing on the old behavior. Synthetic browser checks covered 660px and 320px, light/dark, tabs, keyboard ArrowRight, direct `#agent-setup`, owner-link suffix, collapsed history and stable Menu geometry. A local Node 24 run hit a V8/Wasm worker crash; it is not reported as passed.
Artifacts: synthetic browser screenshots remain in ignored local output; no real credential or production screenshot is tracked.
Deployment and live verification: not performed.
Remaining risks or follow-up: required CI and any production release/live readback.
