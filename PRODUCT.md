# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

React and Vite client, TypeScript service, PostgreSQL, private image storage.

## Users

Product teams review public sites, authenticated dashboards and local prototypes. Developers and explicitly authorized agents respond to the same feedback. Owners manage project access.

## Product Purpose

Be the team's shared slate for the web: capture a screenshot, draw on it with a pencil, and discuss the point with people and authorized agents. Give quick client requirements and visual reviews a place to become clear before the team takes agreed design work to Figma or engineering work to GitHub Issues and Projects. Keep element-specific screenshots, discussion, response obligations and delivery evidence together without requiring either tool. A connected project may separately opt into verified GitHub Issue status sync.

Developers and authorized coding agents share that context. Owners can describe reviewer expertise in approved guidance and assign subject-specific importance weights, with project overrides. Agents receive this advisory context separately from untrusted discussion and approved project instructions. Weights support interpretation; they do not guarantee a model's decisions or grant permission to act.

## Capabilities and Constraints

Reviewers can move through filtered threads using arrow keys, organize optional tags, save personal views and compare screenshot attachments. Console/resource diagnostics are off by default and shared only after explicit selection. A bundled Codex plugin reuses the same MCP contracts.

The architecture is documented in docs/architecture.md. Exact project origins, project grants and private images are enforced by the service. Discussion is untrusted; approved instructions are separately versioned. No fabricated threads, successful writes, deployment or storage claims.

## Brand Commitments

Feedbacks. A creative, visual-first public website: bold type, warm paper, pencil marks and short discussion scraps. The application and extension keep their focused system-font interface and Oxford actions. Each surface has its own scale. See DESIGN.md.

## Product Principles

First rule: every business operation has a typed API, discoverable MCP tool and JSON CLI path sharing the same domain authorization. Explicitly issued owner-administration keys can manage users, grants, projects and Markdown on the owner's requests. Existing keys never gain this authority. Only the primary owner's delegated agent can access private member notes; these bodies remain excluded from reviewer context and exports. Agent attribution must remain visible in audit records.

Authentication/bootstrap, browser pairing/capture and human votes/follow-up retain their identity boundaries; listing a tool does not bypass them. Agent keys cannot issue descendant keys or owner sign-in links. Full owner administration can make durable account/access changes; key expiry or revocation stops that credential, not previously authorized changes. Exact limitations and CLI usage: [API/CLI reference](docs/api.md).

- Preserve drafts when requests fail.
- Keep response, work status and reported evidence distinct.
- Expose only the current actor's permissions.
- Capture and share the original review context without changing target URLs.
