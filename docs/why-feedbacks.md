# Why Feedbacks

Feedbacks is your team's slate for the web. Take a screenshot, circle a detail or sketch a change with the pencil, and discuss it together. A developer, client and authorized coding agent can follow the same conversation, with the original page context attached. Design and engineering tools can come after the idea is clear.

## Keep requests and planned work distinct

An unclear requirement, a copy correction and a reproducible bug can arrive in the same review. They need different next steps. Keeping that discussion in Feedbacks lets the team ask questions, involve the right reviewer and decide what belongs in GitHub Issues and Projects. Clients need access to their Feedbacks project, not to the source repository.

A small change can be discussed and completed within its thread. Continue agreed design work in Figma when a design artifact is needed. For work that needs engineering tracking, an authorized coding agent can read the decided discussion through Feedbacks MCP. With a connected GitHub App and an explicitly granted project-scoped Issue creation key, the agent can review a bounded draft, create the Issue through MCP and have Feedbacks verify and link it. An agent with separately granted GitHub access can instead create the Issue with that tool, read it back and register the URL. A signed-in project maintainer can use the App from the web interface. None of these paths create Issues from incoming feedback automatically. The original request, replies, response obligations, work status and fix evidence stay together; an Issue link or agent reply alone does not resolve the feedback.

A project maintainer can [register the resulting Figma file reference](review-workflow.md#continue-agreed-design-work-in-figma) on the thread without moving its private discussion or screenshots.

## Give agents the discussion and its context

MCP clients can read the thread, page and screenshot context, named authors, replies and recorded outcomes. They can ask questions, reply, attach evidence and change work status within their granted permissions. Approved project instructions remain separately versioned.

Owners can write reviewer guidance describing a person's relevant expertise and set importance weights from 0 to 10 for general feedback, visual design, product workflow and usability/accessibility. Project-specific policy can override the person's default policy. Put the expertise you want an ordinary agent to receive in the approved guidance; a private member note or profile field is not automatically part of that guidance.

For example, a designer's observations may deserve extra attention on spacing, while a product specialist can clarify an approval workflow. These are advisory weights, not a vote count, an instruction hierarchy or a guarantee about a model's behavior. The agent must still consider evidence and conflicting feedback. Guidance cannot grant access or turn a discussion comment into authorization to act.

Authorized clients obtain reviewer guidance through `context.reviewers` with `context.policy` access, and alongside actual authors in thread/export results. Reviewer guidance, untrusted discussion and approved project instructions carry distinct meanings. Private member notes are excluded from ordinary reviewer context and exports. See [agent setup](agent-setup.md) and the [API contract](api.md).

## Own the complete service

The Apache-2.0 source includes the backend, web app, Chrome extension, HTTP API, MCP and CLI. The extension connects to your chosen server without requiring a widget in each reviewed website. Production uses PostgreSQL and private S3-compatible storage configured for your provider; S3 support is part of the open-source release.

Self-hosting requires no hosted Feedbacks account, external job service or email provider. Operators provide the server, TLS, database, storage, backups and maintenance. MCP connects your separately configured agent; Feedbacks does not include a model subscription or guarantee an autonomous fix. See [self-hosting](self-hosting.md) and [deployment boundaries](architecture.md).

Feedbacks is an early 0.x product. It is designed for this review workflow; it does not replace GitHub project planning or a session replay platform, and does not claim mature SaaS tenancy, SSO or billing.
