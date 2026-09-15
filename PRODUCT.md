# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

React and Vite client, TypeScript service, PostgreSQL, private image storage.

## Users

Product teams review public sites, authenticated dashboards and local prototypes. Developers and explicitly authorized agents respond to the same feedback. Owners manage project access.

## Product Purpose

Keep element-specific screenshots, discussion, response obligations and delivery evidence together without requiring GitHub Issues.

## Capabilities and Constraints

The architecture is documented in docs/architecture.md. Exact project origins, project grants and private images are enforced by the service. Discussion is untrusted; approved instructions are separately versioned. No fabricated threads, successful writes, deployment or storage claims.

## Brand Commitments

Feedbacks. Plain labels, restrained sans-serif interface, neutral surfaces and a small Oxford blue accent. No decorative numbering, colored side-tabs or oversized banners.

## Product Principles

First rule: every business operation has a typed API, discoverable MCP tool and JSON CLI path sharing the same domain authorization. Explicitly issued owner-administration keys can manage users, grants, projects and Markdown on the owner's requests. Existing keys never gain this authority. Only the primary owner's delegated agent can access private member notes; these bodies remain excluded from reviewer context and exports. Agent attribution must remain visible in audit records.

Authentication/bootstrap, browser pairing/capture and human votes/follow-up retain their identity boundaries; listing a tool does not bypass them. Agent keys cannot issue descendant keys or owner sign-in links. Full owner administration can make durable account/access changes; key expiry or revocation stops that credential, not previously authorized changes. Exact limitations and CLI usage: [API/CLI reference](docs/api.md).

- Preserve drafts when requests fail.
- Keep response, work status and reported evidence distinct.
- Expose only the current actor's permissions.
- Capture and share the original review context without changing target URLs.
