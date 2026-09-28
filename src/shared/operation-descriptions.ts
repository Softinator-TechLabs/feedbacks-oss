// Shared discovery guidance for MCP and the JSON CLI; authorization stays in domain services.
export const operationDescriptions: Record<string, string> = {
  "assignments.list":
    "List bounded current or historical member/agent work claims for a project, optionally one thread or member. Active claims expire after two hours unless renewed; expired claims are not proof work stopped. Claims are advisory coordination, not completed fixes.",
  "assignments.claim":
    "Claim authorized work as this credential's member and agent, for a whole thread (annotationIds empty) or selected open points. Requires current thread revision and unique idempotencyKey. Atomically rejects overlapping active claims; disjoint points can proceed. Read assignment owners and coordinate on conflicts. Does not change feedback status or assign another employee.",
  "assignments.renew":
    "Renew your own active work claim for two hours using its current claim revision. Use during authorized work checkpoints, not background polling. Expired claims must be rechecked and claimed again.",
  "assignments.release":
    "Release your own claim, or another claim with project-maintainer authority and explicit intent, using current claim revision. Outcome completed/paused describes the claim only; it does not resolve feedback. Read back and separately verify thread/point status.",
  "members.profile.get":
    "Read a bounded advisory profile. Omit userId for yourself. Reading another member requires a shared projectId or owner administration. Separate from private notes, reviewer guidance and policy.",
  "members.profile.save":
    "Replace your own advisory profile and optional one-line currentWork (300 characters), or another profile as owner administrator, using its current revision (0 if absent). Preserve existing context. Does not change name, account permissions, expertise weights or policy. Requires explicit update intent.",
  "members.responsibility.get":
    "Read one current project member's advisory responsibilities; userId defaults to yourself. Requires project access. No task assignment or policy changes.",
  "members.responsibility.save":
    "Replace your own responsibilities in a writable project, or another current member's as a maintainer, using current revision. Does not grant project membership or assign tasks. Read before writing and preserve context.",
  "projects.context.get":
    "Read bounded collaborative project context and its provenance/revision. This is advisory data, separate from instructions.get approved instructions.",
  "projects.context.save":
    "Replace collaborative project context using current revision (0 if absent). Requires project write access and explicit update intent. Does not publish approved instructions or change project configuration.",
  "qa.get":
    "Read a project's opt-in daily public-page QA configuration. Requires project maintainer access and an explicit qa.get scope for bearer keys.",
  "qa.configure":
    "Enable or disable daily QA for up to three explicit public HTTPS URLs on exact approved project origins. Maintainer access required. This never creates feedback.",
  "qa.runNow":
    "Queue one opted-in project QA scan for the next worker tick. Maintainer access required; results appear in qa.runs.",
  "qa.runs":
    "Read the latest 20 bounded public-page QA reports for human review. Errors and uncertain HEAD outcomes do not prove a page is healthy.",
  "qa.baselineGet":
    "Read the selected baseline image ID for a feedback thread. Requires current project access.",
  "qa.baselineSet":
    "Choose a validated private image from the same thread as its visual baseline. Project maintainer access required.",
  "qa.compare":
    "Compare an existing private image with that thread's selected baseline at equal dimensions. Returns the percentage of pixels differing by more than 20 channel values; it does not establish identical page position or a verified regression.",
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
    "List full feedback records with pagination. Prefer feedbacks_queue for bounded summaries. Filter assignedTo for active delegated open work (whole thread or still-open existing selected points), authorId, createdAfter (inclusive), createdBefore (exclusive), activityAfter, workState, topPriority, page URL or search (body/replies/points). Sort workPlan with explicit local planningDate puts due/today/unscheduled first, future next, Later last, then human priority and stable date order (omitted planningDate uses UTC today). Sort priority needs policy access; topPriority sorts explicit flags without policy weights. Today requires timezone-derived midnight bounds; includeSummary counts threads/points independently of pagination.",
  "threads.neighbors":
    "Find previous and next thread in the same filtered and sorted inbox, across pagination. Returns null neighbors if the thread is outside current filters. This is a live view, not an immutable queue.",
  "threads.organize":
    "Replace optional category and tags using the current revision. Read existing tags first to preserve relevant labels. Does not change workflow status.",
  "threads.plan":
    "Set human-selected work priority and timing using the current thread revision. Requires project write access and explicit user intent. Persist dated choices as calendar scheduledFor plus originating IANA timeZone; unscheduled/later use null. Does not start work, change ownership/status or schedule automatic execution. Preserve choices unless the user asks to change them.",
  "threads.annotationPlan":
    "Set human-selected priority and timing for one existing open point in an open thread using the current thread revision. Requires project write access. Dated choices keep their calendar date and IANA timezone. Does not change status, assignment or start work.",
  "projects.taxonomy.get":
    "Read this project's active and archived category names, used tags and their project colors. Requires project access.",
  "projects.taxonomy.update":
    "Create or rename custom project categories, archive old categories and save reusable tag colors using the current project revision. Requires maintainer access; existing category IDs remain stable.",
  "threads.priority":
    "Mark or unmark one thread as top priority using its current revision. Requires project maintainer access; marked active threads lead the Top priority sort before weighted scores. Does not change work status.",
  "reviewViews.list":
    "Read the authenticated user's personal saved filters for this project. Other users' saved views are never returned.",
  "reviewViews.save":
    "Save personal inbox filters, up to 30 per user/project. Supply viewId and current revision to update; omit viewId and use revision 0 to create.",
  "reviewViews.delete":
    "Remove one personal saved view using its current revision. Does not delete feedback.",
  "threads.get":
    "Read full discussion with assets. Website reviews can include ordered context.annotations; each entry has its own text, selector and pagePoint. Numbered full-page assets have captureRegion in CSS page pixels and normalized markings for point pins, pencil strokes, arrows, rectangles and text. A full-page-combined.webp asset, when present, is the scaled merged overview; captureSections maps each retained source page range into a normalized imageTop/imageBottom range even when screenshots were removed. Its markings use coordinates relative to that merged image. Inspect each numbered screenshot using assets.get with includeImage:true for readable detail. Drawing marks are baked into the approved images. Document feedback has context.document with private document ID, page and normalized point. Reviewer context, when authorized, is owner-approved advisory guidance, distinct from discussion and approvedInstructions.",
  "threads.issueDraft":
    "Get a bounded, read-only Issue draft from the thread. It excludes screenshots, diagnostics, private member notes and reviewer policy. Review for privacy and accuracy before creating an Issue in an authorized tracker. Register the actual GitHub, Jira Cloud or Linear URL with threads.linkIssue; Jira and Linear links are reported, not remotely verified. A connected GitHub App with separately granted github.issueCreate scope can create and verify GitHub Issues directly.",
  "threads.linkIssue":
    "After an agreed engineering handoff, register the actual canonical GitHub, Jira Cloud or Linear Issue URL using the current thread revision. Manually registered links are reported, not remotely verified; linking never resolves the thread. The optional connected GitHub App provides a separate verified creation path.",
  "threads.figmaReference":
    "A signed-in human project maintainer can register, replace or clear one Figma file reference after design work is agreed. Supply a Figma file URL or null to clear. The server stores a canonical file URL with an optional node-id and never transfers discussion or assets to Figma. This browser-only operation does not verify Figma access or change thread work status.",
  "github.connection":
    "Show server App configuration, selected-repository installation and this project's connection separately. A cached connection can remain after installation access is revoked. Human web sessions only; the server never returns App credentials.",
  "github.issueState":
    "Show whether a reviewed GitHub Issue request is pending or linked. A pending request may have succeeded remotely and must be reconciled before any new attempt. Human web sessions only.",
  "github.issueCreate":
    "Create and verify one Issue in a connected GitHub repository from a reviewed title and body. Supply repositoryUrl when the project has multiple connected repositories. Human project maintainers or agents with a separately granted project-scoped github.issueCreate key may call this. The tool records the verified URL on the Feedbacks thread. Use a stable idempotencyKey; if the external result is uncertain, stop and ask a human maintainer to reconcile rather than retrying with a new key.",
  "github.issueCreateQuick":
    "A signed-in human project maintainer creates one Issue directly from the original feedback. The server links each attachment inside its Feedbacks thread. These links do not expire and reuse the browser session; current project access is still required. This deliberate one-click action is unavailable to agent keys. Pending external writes require reconciliation, never a new-key retry.",
  "github.statusSyncConfigure":
    "A signed-in human project maintainer enables or disables periodic open/closed status sync for verified Issues in the connected repository. Enabling starts a new baseline; a mismatch needs manual reconciliation.",
  "github.statusSyncState":
    "Show ready, pending, conflict, uncertain or read-error state for a linked Issue's opt-in status sync. Human project maintainers only.",
  "github.statusSync":
    "A human project maintainer explicitly resolves a status mismatch for a verified Issue. source:github applies open/closed to Feedbacks work; source:feedbacks applies open/resolved to GitHub. Declined has no automatic GitHub equivalent. Read the Issue and thread before choosing; uncertain external writes require manual inspection.",
  "threads.review":
    "Record a human review-round decision: approved or changes_requested. Reopen starts a new round while preserving prior decisions. Agent tokens cannot use this operation. This is separate from thread work status and resolution.",
  "assets.get":
    "Read private attachment metadata, including optional captureRegion, captureSections and normalized markings. Point markings carry annotationId/number when linked to context.annotations; pencil and arrow markings have bounds and endpoints. For a merged full-page asset, captureSections maps each retained source page range to its normalized imageTop/imageBottom range. For images, includeImage:true returns a bounded WebP preview (MCP image block; HTTP/CLI image object with base64 data). Read numbered screenshots for detail before relying on a scaled combined image. Videos are metadata-only here; use the authorized relative url in a browser. maxDimension is 256-2048 pixels, default 1600. The relative url is an authenticated original-asset proxy on the Feedbacks server; never send credentials to the reviewed website.",
  "assets.uploadVideo":
    "Attach a user-approved WebM tab recording to an existing thread. Maximum 40 MiB and declared duration 5 minutes. The asset is private to the project and the caller needs the existing asset-upload scope. Do not treat this API as permission to record a browser tab.",
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
