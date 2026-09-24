# Scoped guest review links

## Goal

Allow a project maintainer to issue a short-lived, revocable link so a guest can reply to one feedback thread without creating an account. The guest cannot list threads, see other replies, private member notes or reviewer guidance, or create an agent token.

## Scope

- One thread per link. Token material stays in the URL fragment and is stored server-side only as a hash.
- The public form shows the original feedback text and accepts a name and reply. It returns only a success acknowledgement.
- An active-link cap per thread, a per-link reply limit and an IP ingress limit bound abuse.
- Guest replies require a Cloudflare Turnstile token verified server-side. Production rejects Cloudflare's documented test keys.
- Project maintainers can list active and revoked links and revoke them. Existing submissions remain.
- Guest screenshot capture and embedded review are separate work and are not implied by this text reply flow.

## Verification

- Domain tests: create, inspect, submit, revoke, expiry and access control. Turnstile verification tests cover fail-closed behavior, hostname and action.
- Full local check, required CI and security review before merge.
- Browser test of the public form with synthetic data.

## Status

In progress. This plan records a first delivery slice, not the entire guest review candidate.
