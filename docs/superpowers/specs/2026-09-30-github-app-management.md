# GitHub Apps managed from Feedbacks

Date: 2026-09-30. User-authorized correction to the environment-only setup in PR #160.

## Outcome

A signed-in server owner adds an organization's private GitHub App from Setup.
They enter a GitHub account, approve registration on GitHub, return to Feedbacks,
install on selected repositories and choose the App for a project. Per-App
Dokploy/environment editing and server restarts are unnecessary. Existing
environment Apps remain usable and can be adopted into browser management.

## Design

Use GitHub's official manifest handshake, with private visibility, Metadata read
and Issues write, no webhooks or user OAuth. Target personal or organization
registration explicitly. Validate returned App identity, owner and permissions.
Only GitHub performs registration and repository installation approval.

Store RSA keys encrypted with AES-256-GCM in a new database table. Store each
encryption key under a random, server-only object in the existing private asset
store. This needs no new environment variable or volume, survives credential
rotation for S3, and separates database backups from decryption keys. Normal
asset APIs cannot address these objects. Backups must preserve both stores.

Each request/worker loads current catalog metadata from PostgreSQL. Resolve
only the selected App's secret lazily from private storage; do not mutate the
global configuration. Managed records override an environment App of the same
ID. Disabled records suppress environment fallback. Preserve App IDs on
historical links and the legacy default identity.

Owner-only operations start registration, complete its callback, import/rotate
a PEM key, adopt environment credentials, and enable/disable managed Apps.
Registration state is random, hashed, bound to the human owner's session,
expires in 30 minutes and is consumed before the code exchange. Failures never
return keys, codes, raw GitHub bodies or crypto details. Recheck current owner
authorization before persistence. Use revisions for management updates and
block disconnect while writes or sync leases are unsettled; allow verified same-ID credential recovery.
Retain encrypted credentials and provenance when disabled.

## Interface

One primary action: Add GitHub account. A compact form asks account type and
name, then Continue to GitHub. Explain which GitHub login is needed. Show
successful return with Install on selected repositories and project links.
Existing App details contain management actions, account-specific GitHub
settings links, and optional PEM import/rotation. Keep technical instructions
secondary. No private key is rendered back to the browser.

The shared three-step illustration describes this automatic flow. Verify
fresh direct navigation and invalidate stale walkthrough asset versions.

## Verification

Synthetic RSA keys and loopback GitHub mocks only. Cover owner/member/agent/
extension denial, CSRF/session binding, expired/replayed state, wrong owner,
invalid permissions/keys, storage failure/tampering, concurrent revisions,
disabled fallback, restart/second Operations instance, historical access and
worker routing. Browser acceptance includes direct navigation, both account
types, callback success/failure, management, mobile/dark, keyboard and bounds.
Run full check, native PostgreSQL migrations, walkthrough/browser acceptance
and exact-head CI; independently review credential and callback boundaries.

Reference: [GitHub manifest registration](https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest),
checked 2026-09-30. Implement the handshake; do not copy documentation examples.

## Review decisions

Preserve Strict session cookies with a same-origin callback bridge; do not weaken
the session cookie. The bridge strips codes from history and calls normal CSRF
operations. Recheck current App availability before reservation and use live
loaders for environment entries too. Adoption/rotation preserve account policy.
Same-ID verified key recovery is allowed during pending writes; disconnect stays
guarded. Key replacement preserves disabled state. Manual import cannot verify
GitHub visibility; only the new manifest requests private registration.

Both storage choices remain explicit: encrypted owner-page management or existing
deployment-environment setup. Moving environment credentials is optional.

## Accepted integration foundation

Setup opens a common owner-only Integrations page. A typed local catalog registers only implemented adapters; GitHub remains a provider-specific management page. A shared versioned credential vault binds encryption to provider, installation and connection and a reusable storage choice control keeps both options consistent. Future provider authentication, schemas, refresh and sync are separate implementations, documented in [integration adapters](../../integrations.md); this release does not enable planned providers.
