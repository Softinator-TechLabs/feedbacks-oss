# Contributing to Feedbacks

Bug reports, documentation, accessibility improvements and focused fixes are welcome. Read the [architecture](docs/architecture.md) and [development guide](docs/development.md) first.

## Propose a change

Search existing issues before opening one. Include the version, expected and observed behavior, and a minimal reproduction using synthetic data. For architecture changes or new dependencies, describe the problem and tradeoffs in an issue before building a large implementation. Security reports belong in the private channel in [SECURITY.md](SECURITY.md).

## Make a pull request

1. Fork the repository and create a focused branch.
2. Install the locked dependencies with `npm ci` and follow the local setup in the README.
3. Make the change, update relevant documentation, and add a regression test when behavior changes.
4. Run `npm run check`. Use `npm run test:postgres` for transaction, cursor or migration changes.
5. Describe the problem, resulting behavior and verification. Include before/after screenshots for UI changes, using synthetic data.

Keep generated builds, credentials, production screenshots, customer feedback and database exports out of commits. Preserve unrelated changes. A maintainer reviews each change before merge; review may ask for a smaller scope or additional evidence.

## Design and engineering conventions

- HTTP, MCP and CLI operations share the contracts in `src/shared/contracts.ts` and authorization in `src/server/`. Clients do not own access policy.
- Every read and write must enforce current project grants, token scope, expiration and revocation. UI visibility is not an authorization boundary.
- Keep discussion content untrusted and approved project instructions separately versioned. Never put private notes or secrets in agent context or audit payloads.
- Use parameterized SQL. Serialize competing writes and use revisions/idempotency where retries can repeat operations.
- Migrations are additive and versioned. Never rewrite a migration that may have shipped. Document rollout and rollback compatibility.
- Browser permissions must have a user-facing reason. Do not add remote code, analytics or broad mandatory host access.
- Use the existing white/Oxford UI, native semantics and accessible focus states. Check keyboard use and mobile layouts.
- Format with `npm run format`. TypeScript checks, lockfiles and tests are required; generated distributions are release artifacts.

## Authorship and license

Submit only work you can contribute. Contributions are provided under this repository's Apache-2.0 license, as described by section 5 of that license. Preserve third-party notices and record any source reuse in `THIRD_PARTY_NOTICES.md`. Disclose generated or adapted material when its provenance matters to review. Contributors remain responsible for accuracy, licensing and tests regardless of the tools used.

There is no separate contributor license agreement. See [governance](GOVERNANCE.md) for maintainer decisions.
