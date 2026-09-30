# Multiple GitHub Apps per Feedbacks server

Status: implemented and verified locally; PR CI is the integration gate. Date: 2026-09-30.

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

- Node 24 `npm run check`: passed; 433 tests passed, 24 opt-in browser/native
  checks skipped, zero failures. Includes formatting, generated contracts/docs,
  types, application/site/extension/plugin builds, isolated smoke and release
  boundary checks.
- `npm run test:postgres`: all three native PostgreSQL checks passed, including
  concurrent migration application through migration 27.
- Focused multiple-App/quick-Issue/status-sync tests: all 13 passed. Two regression
  cases first reproduced explicit-selection persistence and client account-list
  shadowing, then passed after their repairs. An independent reviewer ran all
  eight multiple-App tests and reported no remaining important findings.
- Synthetic loopback browser QA: owner assignment/save, connection and second
  repository, maintainer restrictions, keyboard focus, 1280/390 widths, light/dark
  themes and no horizontal overflow passed. Desktop Add repository/Save App
  controls align with their inputs; mobile helper text precedes the actions.
  Saved synthetic screenshots: [desktop](../screenshots/github-apps/desktop.png)
  and [mobile](../screenshots/github-apps/mobile.png).
- Local container checks require a running Docker daemon and were not run. The
  required CI container job verifies that boundary before integration.

Production App creation, deployment credentials, project assignment and live
deployment remain operator setup; no customer data or secrets are part of the
source change. Loopback evidence does not prove production behavior.
