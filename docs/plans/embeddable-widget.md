# Plan: embeddable website feedback widget

Status: local implementation and checks complete. Owner: Feedbacks contributor. Date: 2026-09-24.

## Outcome and scope

A project maintainer can issue a bounded widget script for exact approved website origins. Visitors can send new feedback from the host page with URL and viewport context. The host script does not capture screenshots; visitors use the Chrome extension for private screenshot review. The widget cannot read existing project feedback or private notes.

## Evidence and approach

This builds on [project guest feedback links](../review-workflow.md) and their hashed token, expiry, revocation, submission limit and Turnstile verification. Widget mode is separate from standalone guest links. The host script uses scoped styles for a small launcher and sends only public form inputs to exact-origin CORS endpoints. The service checks the host Origin, URL origin, token, limit and challenge.

## Steps and progress

- [x] Establish an opt-in widget link mode with a one-time snippet.
- [x] Add exact-origin bootstrap and submission endpoints with bounded image processing.
- [x] Add a host launcher, form and concise privacy copy without host-page capture.
- [x] Add focused API tests and update canonical docs.
- [x] Verify full Node 24 check, native PostgreSQL migration, desktop/mobile and keyboard flow.

## Compatibility and recovery

Migration 12 adds a default-false widget mode to project guest links, leaving existing links as standalone guest pages. Revoking or exhausting a widget link stops new submissions. Removing the host snippet hides the launcher. Already submitted threads and private assets remain under project retention policy.

## Decision log

- Build on the isolated project guest link commit so revocation and submission caps share one implementation.
- Keep the widget token in host page source; rely on exact-origin server checks, Turnstile and small caps, not secrecy of public page markup.
- Accept one user-chosen browser tab frame. Browser APIs do not prove that the selected tab is the current page, so the preview is part of consent.
- Use scoped light DOM styles because Cloudflare Turnstile did not issue a token inside Shadow DOM in the synthetic browser run.

## Completion receipt

Source revision: this branch's final commit.

Checks and results: Node 24 `npm run check` and `npm run test:postgres` passed. Synthetic host desktop/mobile browser submissions passed with a Cloudflare test key. Keyboard focus and Escape behavior were reviewed. The host widget deliberately does not capture another tab; screenshot review remains in the extension.

Artifacts: host script, stylesheet and project settings snippet.

Deployment and live verification: out of scope.

Remaining risks or follow-up: test real host CSP, Turnstile hostname configuration and supported browser tab picker before release. The visitor can choose a different tab from the page being reviewed; the preview makes the choice visible, but the service cannot prove it matches the page URL.
