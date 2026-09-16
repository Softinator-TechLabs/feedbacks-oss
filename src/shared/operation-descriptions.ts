// Shared discovery guidance for MCP and the JSON CLI; authorization stays in domain services.
export const operationDescriptions: Record<string, string> = {
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
    "Read full discussion with assets. Inspect relevant uploads using assets.get with includeImage:true. Reviewer context, when authorized, is owner-approved advisory guidance, distinct from discussion and approvedInstructions.",
  "assets.get":
    "Read private attachment metadata. Set includeImage:true to view a bounded WebP preview (MCP image block; HTTP/CLI image object with base64 data). maxDimension is 256-2048 pixels, default 1600. Metadata dimensions describe the original. The relative url is an authenticated original-image proxy on the Feedbacks server; never send credentials to the reviewed website.",
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
