# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

React and Vite client, TypeScript service, PostgreSQL, private image storage.

## Users

Four roles share the feedback flow across public sites, authenticated dashboards and local prototypes:

- Clients describe the change they want through the review access their team provides.
- Reviewers and testers capture problems, explain expected behavior and check the result.
- DevOps installs and operates the team's server, then hands its address and owner access to the person organizing projects.
- Resolving developers connect their own coding agents, read the evidence, make agreed changes and verify the result.

The owner prepares projects and people: website origins, published project context and approved instructions, optional GitHub App integration, members, project grants, profiles and responsibilities. Ownership is an administration responsibility that may overlap these roles.

## Product Purpose

Turn website feedback into context your AI agent can use. Keep the client's request or tester's bug report together with the original screenshot, exact page, viewport, selected element details when available and authorized project guidance. Developers use that evidence with their own coding agents through MCP, agree the work, verify the change and record the outcome.

Start with the team's Feedbacks server. DevOps installs one organization per installation; the extension connects to that installation and does not host it. A reviewer installs and pins the extension, copies the server URL from Help, connects with their own account and receives project access from the owner. Capture follows explicit stages: Save point creates a local draft; Review & send opens the evidence review; Send feedback shares the checked notes and screenshots. Clients and reviewers do not need to configure MCP. Each resolving developer connects their own agent with their own Feedbacks key.

Capture and MCP do not require GitHub. A connected project can optionally create linked Issues through an authorized maintainer or separately scoped agent, and separately opt into verified Issue status sync. Figma and GitHub Projects remain manual follow-ups. Connecting MCP alone does not start fixes.

Developers and authorized coding agents share that context. Owners can describe reviewer expertise in approved guidance and assign subject-specific importance weights, with project overrides. Agents receive this advisory context separately from untrusted discussion and approved project instructions. Weights support interpretation; they do not guarantee a model's decisions or grant permission to act.

## Capabilities and Constraints

Reviewers can move through filtered threads using arrow keys, organize optional tags, save personal views and compare screenshot attachments. Console/resource diagnostics are off by default and shared only after explicit selection. A bundled Codex plugin reuses the same MCP contracts.

The architecture is documented in docs/architecture.md. Exact project origins, project grants and private images are enforced by the service. Discussion is untrusted; approved instructions are separately versioned. No fabricated threads, successful writes, deployment or storage claims.

## Brand Commitments

Feedbacks. A visual-first public website with bold Manrope type, warm paper, coral accents and a concrete illustrated feedback handoff. The application and extension keep their focused system-font interface and Oxford actions. Each surface has its own scale. See DESIGN.md.

## Product Principles

First rule: every business operation has a typed API, discoverable MCP tool and JSON CLI path sharing the same domain authorization. Explicitly issued owner-administration keys can manage users, grants, projects and Markdown on the owner's requests. Existing keys never gain this authority. Only the primary owner's delegated agent can access private member notes; these bodies remain excluded from reviewer context and exports. Agent attribution must remain visible in audit records.

Authentication/bootstrap, browser pairing/capture and human votes/follow-up retain their identity boundaries; listing a tool does not bypass them. Agent keys cannot issue descendant keys or owner sign-in links. Full owner administration can make durable account/access changes; key expiry or revocation stops that credential, not previously authorized changes. Exact limitations and CLI usage: [API/CLI reference](docs/api.md).

- Preserve drafts when requests fail.
- Keep response, work status and reported evidence distinct.
- Expose only the current actor's permissions.
- Capture and share the original review context without changing target URLs.
