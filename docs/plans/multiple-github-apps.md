# Multiple GitHub Apps per Feedbacks server

Status: implemented and verified locally; required PR CI remains the integration gate.
Date: 2026-09-30.

## Outcome and design

A server owner can select a different GitHub App for each project. Private Apps
owned by different GitHub organizations can therefore share one controlled
Feedbacks server. Each project still connects up to 20 repositories through its
selected App. No private key is sent to the browser or stored in project data.

DevOps registers additional Apps in a bounded `GITHUB_APPS_JSON` deployment
secret (App ID, label, slug, RSA key and approved owning accounts). The existing
three single-App variables remain the default for projects without an explicit
selection. Only a signed-in human server owner can assign or clear a project's
App. Maintainers can connect repositories within that App's approved accounts.

Changing App clears repository connections and disables sync. The assignment
is revision checked and cannot change while an external write or sync lease is
unsettled. Issue reservations and verified links record the original App ID;
refresh/recovery use that identity, never the project's new selection. Missing
credentials fail closed. Legacy unlabelled Issues use only the legacy default.

## Interfaces and steps

- [x] Configuration: `Config.githubApps` contains validated App credentials;
      `GithubApp.forApp(id)` keeps the injected transport and narrows credentials.
      Test duplicate IDs/slugs, malformed/oversize secrets, RSA keys, account
      allowlists, legacy compatibility and errors that do not include secrets.
- [x] Contracts: owner-only `github.appSelect {projectId,revision,appId:null|string}`;
      connection returns selected identity, safe App metadata and owner ability.
      Deny agent/extension/member assignment; preserve selection on project edits.
- [x] Routing: connection, reviewed/quick creation, polling, manual sync, refresh
      and reconciliation use the selected or historically pinned App. Exercise
      two RSA identities, account restrictions, removed credentials, switching,
      cross-project access, stale revisions and pending-write recovery.
- [x] UI: native App selector, owner-only save, selected account/install guidance,
      explicit reconnect notice, missing configuration and empty states. Verify
      desktop/mobile, keyboard controls and both owner/maintainer views.
- [x] Central owner page: **Setup → GitHub Apps** lists safe configured App
      metadata, approved accounts, assigned projects and missing credentials.
      Link to project assignment/install actions and explain GitHub registration,
      server configuration and project selection. Keep credential changes in
      deployment secrets; deny inventory access to members and agent/extension
      tokens. Verify empty/missing states and desktop/mobile keyboard behavior.
- [x] Simple guidance: reuse the Setup walkthrough player for three illustrated
      steps (GitHub registration, operator configuration, project connection).
      Keep IDs and operator instructions behind disclosure; verify manual steps,
      reduced motion, keyboard controls and mobile bounds in the existing
      walkthrough acceptance suite.
- [x] Docs and local verification: update canonical setup/API/operations guidance,
      regenerate catalogs; run focused tests, full checks and native PostgreSQL.
      Review final diff. Required PR CI remains the integration gate.

## Compatibility and recovery

Migration 27 adds nullable App identity to the Issue reservation table; existing
rows and persistent storage are preserved. Keep legacy credentials while older
unlabelled links need access. RSA key rotation for the same App ID preserves
routing. Removing an App disables its selected projects and historical access;
restore its credentials to recover. Changing App ID is a project switch, not key
rotation. Never distribute server App secrets to another installation.

## Verification receipt

The complete per-project, central inventory and illustrated setup change is
tracked in [PR #160](https://github.com/Softinator-TechLabs/feedbacks-oss/pull/160).
Its initial implementation at `ff8f575695e5d8e223f770a6ab9720b34f34fcd1`
passed all six CI jobs. Final-head CI is recorded on the PR.

- Node 24 `npm run check` after updating from `main`: passed; 439 tests passed, 24 opt-in browser/native
  checks skipped, zero failures. Includes formatting, generated contracts/docs,
  types, application/site/extension/plugin builds, isolated smoke and release
  boundary checks.
- `npm run test:postgres`: all three native PostgreSQL checks passed, including
  concurrent migration application through migration 27.
- Focused multiple-App tests: all nine passed, including the owner inventory's
  metadata-only response, zero-project setup and member/agent denial. Earlier
  multiple-App/quick-Issue/status-sync verification passed all 13 tests. Two regression
  cases first reproduced explicit-selection persistence and client account-list
  shadowing, then passed after their repairs. An independent reviewer ran all
  eight initial multiple-App tests, reviewed the central page and walkthrough,
  and reported no remaining important findings.
- Synthetic loopback browser QA: owner assignment/save, connection and second
  repository, central inventory through Setup, assigned-project/install links,
  empty/missing/zero-project states, maintainer restrictions, keyboard focus,
  1280/390 widths, light/dark themes and no horizontal overflow passed. Opening
  the walkthrough preserves mobile bounds. Desktop Add repository/Save App
  controls align with their inputs; mobile helper text precedes the actions.
  Saved synthetic screenshots: [desktop](../screenshots/github-apps/desktop.png)
  and [mobile](../screenshots/github-apps/mobile.png); central owner page
  [desktop](../screenshots/github-apps/inventory-desktop.png) and
  [mobile](../screenshots/github-apps/inventory-mobile.png).
- `npm run qa:walkthrough-browser`: all nine scenes passed, including GitHub
  guidance, manual steps, Play/Pause, reduced motion, keyboard controls and
  mobile bounds. The existing Setup scenes retain their original content.
- Local container checks require a running Docker daemon and were not run. The
  required CI container job verifies that boundary before integration.

Production App creation, deployment credentials, project assignment and live
deployment remain operator setup; no customer data or secrets are part of the
source change. Loopback evidence does not prove production behavior.
