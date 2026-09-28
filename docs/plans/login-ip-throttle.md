# Plan: five-minute sign-in lock by client IP

Status: locally verified; CI and internal release pending. Owner: maintainer. Date: 2026-09-28.

## Outcome and scope

After three failed password sign-ins from one trusted client IP within five minutes, reject the third and later attempts for five minutes. Show a plain retry message and HTTP `Retry-After`. A successful sign-in clears that IP's failed-attempt count. Owner links, invitations and password resets keep their separate flows.

## Evidence and approach

`src/server/app.ts` currently applies a process-local 30-request/minute account ingress limit; `src/server/auth.ts` does not count failed passwords. `req.ip` follows the configured trusted-proxy hop count. Add a versioned PostgreSQL table keyed by a hash of the normalized IP. Update/check the row under the existing account transaction lock, and commit failed-attempt state before returning an authentication error. Expired rows are ineffective immediately and pruned in bounded batches. Keep the existing ingress ceiling as an independent safeguard.

## Steps and progress

- [x] Add failing HTTP tests for the third failure, correct-password rejection during the lock, `Retry-After`, success reset, expiry and separate IPs; test untrusted forwarded headers.
- [x] Add migration 22 and implement the transactional per-IP password-login guard.
- [x] Update auth/proxy documentation and migration expectations.
- [x] Review bypasses and legitimate paths, then run focused tests, native PostgreSQL concurrency checks, `npm run check` and synthetic browser QA.
- [ ] Confirm CI on the reviewed PR.
- [ ] Release the reviewed commit to the internal app and verify deployment and live readiness without brute-forcing a production account.

## Compatibility and recovery

The new table is additive. Existing sessions and owner sign-in links are unaffected. The application must run migration 22 before serving sign-ins. Rollback to the prior app version can leave the harmless table in place; do not remove it during rollback. Shared IPs can be locked together for five minutes, so ingress must report the real client IP and overwrite untrusted forwarded headers.

## Decision log

- Count failed password attempts within a five-minute window. The third failure starts a fresh five-minute block; blocked requests do not extend it.
- Do not use an account identifier supplied by the caller as a throttle key. The requested control is per trusted client IP.

## Completion receipt

Source revision: pending.
Checks and results: `npm run check` passed after rebasing on current `main`; `npm run test:postgres` passed (2 tests); synthetic browser showed the plain five-minute message on the third failure. Reviewer-found transaction clock and scoped IPv6 cases were fixed and retested.
Artifacts: reviewed PR pending.
Deployment and live verification: pending.
Remaining risks or follow-up: per-IP throttling does not stop a distributed attacker rotating IPs; retain ingress controls and monitor failures.
