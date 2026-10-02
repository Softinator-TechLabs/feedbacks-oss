# Plan: connect coding agents through OAuth

Status: implemented; required CI and deployment pending. Date: 2026-10-02.

## Outcome and scope

Keep local stdio plugins and existing scoped API keys working. Add an optional
OAuth authorization-code connection to each installation's existing HTTP MCP
endpoint. A signed-in human chooses projects and approves read access or read
and reply access. OAuth never delegates owner administration, resolution,
external GitHub writes or extension credentials.

## Evidence and approach

The current [MCP route](../../src/server/app.ts) authenticates manually issued
agent keys. [The adapter](../../src/cli/client.ts) deliberately uses private
configuration. HTTP MCP clients can instead discover an authorization server
and complete a browser consent flow. Reuse the application's account identity,
project authorization and token revocation; do not introduce another account
service or duplicate operation authorization.

Implement discovery, public-client registration, exact registered redirects,
authorization code with mandatory S256 PKCE and resource binding, short-lived
opaque access tokens and rotating refresh tokens. Store secrets only as hashes.
Use database transactions for one-use codes and rotation. Consent requires the
existing human session, origin and CSRF checks. Display the registered client
and callback destination without claiming its name is verified.

## Steps and progress

- [x] Establish current transport, account and project boundaries.
- [x] Add additive OAuth persistence and bounded registration.
- [x] Implement discovery, consent, exchange, refresh and revocation.
- [x] Add the existing-style connection screen and setup illustration.
- [x] Verify positive flow and PKCE, replay, redirect, CSRF, audience, scope and
      account-revocation denials with the real MCP SDK.
- [x] Run local checks and real PostgreSQL concurrency evidence.
- [ ] Pass required CI before integration.

## Compatibility and recovery

OAuth is opt-in through deployment configuration. Existing key and stdio paths
retain their contracts. Applied migrations remain additive. Disabling OAuth
stops OAuth issuance and OAuth MCP access while manual keys keep working.
Account key revocation invalidates the associated refresh grant; password
replacement and account disable invalidate its credentials as before. Rollback
must preserve the new tables and token metadata rather than rewrite migrations.

## Decision log

- Use a public-client OAuth flow with PKCE and dynamic registration. Client
  names are display metadata, not proof of identity. No remote client metadata
  fetching or arbitrary customer-server proxy is needed.
- Keep access on the customer's installation. Public-directory acceptance and
  customer-specific endpoint eligibility are separate from protocol support.
- Do not advertise OIDC or verified email claims without an implemented email
  verification mechanism. Basic OAuth does not imply workspace-domain controls.

## Completion receipt

Node 24 local verification: the complete suite passed 520 tests with 39
environment-dependent skips and no failures. Four native PostgreSQL checks
passed, including concurrent code exchange and refresh replay. Formatting,
types, harness/docs checks, all builds, isolated application smoke and release
checks passed. An actual Codex CLI OAuth login completed against a disposable
loopback installation; its temporary credentials were removed afterward.
The real MCP SDK read permitted feedback and rejected extra project/write/admin
access. Consent was inspected at desktop and mobile widths. Callback recovery
offers an explicit return link after approval without repeating the grant.

This proves local implementation and client interoperability. Public HTTPS
deployment, provider review and directory publication are separate gates.
