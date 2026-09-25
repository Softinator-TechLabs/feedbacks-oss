// Shared discovery guidance for MCP and the JSON CLI; authorization stays in domain services.
export const operationDescriptions: Record<string, string> = {
  "surveys.create":
    "Create an opt-in project survey and one-time expiring public link. Human project maintainer only; questions are immutable. NPS uses a 0–10 answer. Requires Turnstile configuration.",
  "surveys.list":
    "List up to 100 surveys and response counts for a project. Requires current project maintainer access; link tokens are never returned.",
  "surveys.results":
    "Read project-private survey distributions, NPS and up to 100 written answers per question. Requires current project maintainer access.",
  "surveys.revoke":
    "Revoke a survey link for new visitors. Existing results remain readable. Human project maintainer only.",
  "survey.inspect":
    "Public survey link bootstrap; returns the frozen questions and Turnstile site key, without responses or project-private data.",
  "survey.submit":
    "Public anonymous survey submission. Requires an active link, Turnstile proof, exact question answers and remaining capacity; responseKey makes retries idempotent.",
  "documents.upload":
    "Add a private PDF or image to a project. A signed-in human maintainer must approve the file; agent keys cannot upload. The source is not exposed by metadata reads.",
  "documents.list":
    "List up to 100 private PDF/image documents in a project. Requires an explicit document read scope on agent keys and current project access.",
  "documents.get":
    "Read private document metadata and its authenticated file path. The file path still requires current project access and documents.get scope for bearer tokens.",
  "documents.threads":
    "List bounded page/coordinate feedback points for one private document. Use threads.get for full discussion. Requires current project access.",
  "guestProjectLinks.create":
    "Issue a private, expiring project feedback link as a signed-in project maintainer. Set widget:true to receive a one-time launcher script for exact approved origins. Both modes permit new submissions only and do not expose existing feedback.",
  "guestProjectLinks.list":
    "List project guest feedback links with expiry, revocation and submission counts. Token values are never returned.",
  "guestProjectLinks.revoke":
    "Revoke a project guest feedback link immediately. New submissions and inspections stop.",
  "widget.inspect":
    "Public widget bootstrap. Requires a live widget-enabled link, its one-time token and an approved website Origin; returns only the project name and Turnstile site key.",
  "widget.submit":
    "Public website feedback submission. Requires an approved Origin, page URL matching it, Turnstile verification and remaining link capacity. Accepts optional explicit screenshot data; never reads existing feedback.",
  "threads.list":
    "List feedback summaries; follow pagination and sort by activity to find recent replies/uploads. Use threads.get for full discussion, attachment metadata and available reviewer context.",
  "threads.neighbors":
    "Find previous and next thread in the same filtered and sorted inbox, across pagination. Returns null neighbors if the thread is outside current filters. This is a live view, not an immutable queue.",
  "threads.organize":
    "Replace optional category and tags using the current revision. Read existing tags first to preserve relevant labels. Does not change workflow status.",
  "reviewViews.list":
    "Read the authenticated user's personal saved filters for this project. Other users' saved views are never returned.",
  "reviewViews.save":
    "Save personal inbox filters, up to 30 per user/project. Supply viewId and current revision to update; omit viewId and use revision 0 to create.",
  "reviewViews.delete":
    "Remove one personal saved view using its current revision. Does not delete feedback.",
  "threads.get":
    "Read full discussion with assets. Document feedback has context.document with private document ID, page and normalized point. Inspect screenshots using assets.get with includeImage:true. Reviewer context, when authorized, is owner-approved advisory guidance, distinct from discussion and approvedInstructions.",
  "threads.issueDraft":
    "Get a bounded, read-only GitHub Issue draft from the thread. It excludes screenshots, diagnostics, private member notes and reviewer policy. Review for privacy and accuracy before creating an Issue. With an explicitly granted github.issueCreate scope and connected GitHub App, the agent can create and link it through Feedbacks. Otherwise use a separately authorized GitHub tool and then threads.linkIssue.",
  "threads.linkIssue":
    "After an agreed engineering handoff using a separately authorized GitHub tool, read back the actual Issue URL and register it here using the current thread revision. A connected GitHub App plus an explicitly granted github.issueCreate scope offers direct creation and verified linking instead. Linking never resolves the thread.",
  "github.connection":
    "Show whether this project has an optional GitHub App connection. Human web sessions only; the server never returns App credentials.",
  "github.issueState":
    "Show whether a reviewed GitHub Issue request is pending or linked. A pending request may have succeeded remotely and must be reconciled before any new attempt. Human web sessions only.",
  "github.issueCreate":
    "Create and verify one Issue in the project's connected GitHub repository from a reviewed title and body. Human project maintainers or agents with a separately granted project-scoped github.issueCreate key may call this. The tool records the verified URL on the Feedbacks thread. Use a stable idempotencyKey; if the external result is uncertain, stop and ask a human maintainer to reconcile rather than retrying with a new key.",
  "threads.review":
    "Record a human review-round decision: approved or changes_requested. Reopen starts a new round while preserving prior decisions. Agent tokens cannot use this operation. This is separate from thread work status and resolution.",
  "assets.get":
    "Read private attachment metadata. For images, includeImage:true returns a bounded WebP preview (MCP image block; HTTP/CLI image object with base64 data). Videos are metadata-only here; use the authorized relative url in a browser. maxDimension is 256-2048 pixels, default 1600. The relative url is an authenticated original-asset proxy on the Feedbacks server; never send credentials to the reviewed website.",
  "assets.uploadVideo":
    "Attach a user-approved WebM tab recording to an existing thread. Maximum 8 MiB and declared duration 30 seconds. The asset is private to the project and the caller needs the existing asset-upload scope. Do not treat this API as permission to record a browser tab.",
  "context.export":
    "Export a paginated immutable snapshot with full threads, assets and approvedInstructions. Continue with snapshotId/nextOffset. For later changes use context.changes and refetch affected threads; snapshot reviewer guidance is not live.",
  "context.changes":
    "Read changes after a cursor; continue while hasMore. Refetch affected threads to obtain current discussion/uploads. After reviewer.guidance.changed, refresh context.reviewers. Events are change notices, not complete thread content.",
  "context.reviewers":
    "Read owner-approved advisory reviewer guidance (role/expertise), separate from approved project instructions. Requires context.policy for ordinary agents. Private member notes are excluded.",
  "members.guidance.get":
    "Read a member's Agent guidance Markdown and revision. This is the role/expertise profile shared with authorized agents. Primary-owner administration required.",
  "members.guidance.save":
    "Save Agent guidance Markdown using the current revision (0 if empty). Preserve existing relevant text; on conflict reload before applying changes. Guidance is advisory, not a permission or score change.",
  "members.notes.get":
    "Read primary-owner-private member Markdown and revision. Private notes are excluded from reviewer context and exports; use members.guidance for agent-visible role/expertise.",
  "members.notes.save":
    "Save primary-owner-private member Markdown using its current revision. Use members.guidance for context intended for authorized agents; never copy private notes there automatically.",
};
