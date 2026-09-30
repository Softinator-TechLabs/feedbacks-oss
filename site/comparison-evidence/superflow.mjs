export default {
  reviewed: "30 September 2026",
  scope:
    "Hosted Superflow website/file review and the authenticated workspace MCP; official documentation source e3deb1d92caf7cb3e1336e354d71e84443b3ea2e. The separate unauthenticated tools MCP is not the workspace connector. Production toolbar f5ad64a9f01630d52078b2d64b9ad61b149de722b6ee635ac43e5187f4b9c6dd and its Velt 6.0.12 capture/comment graph inspected on the review date. Optional disabled SDK features are not credited as Superflow features.",
  summary:
    "Superflow combines element-pinned review, automatic full-page snapshots, screen/camera/voice comments, AI review agents and an authenticated workspace MCP.",
  sources: [
    {
      title: "Automatic screenshots",
      url: "https://usesuperflow.ai/screenshots",
      reviewed: "30 September 2026",
    },
    {
      title: "Recording capabilities",
      url: "https://usesuperflow.ai/recordings",
      reviewed: "30 September 2026",
    },
    {
      title: "Screen recording walkthrough",
      url: "https://usesuperflow.ai/docs/how-to-guides/how-to-record-screen-and-add-it-to-comments",
      reviewed: "30 September 2026",
    },
    {
      title: "Comment on an element",
      url: "https://usesuperflow.ai/docs/how-to-guides/how-to-add-a-comment-on-an-element",
      reviewed: "30 September 2026",
    },
    {
      title: "Box comment walkthrough",
      url: "https://usesuperflow.ai/docs/how-to-guides/how-to-draw-a-box-comment-on-the-page",
      reviewed: "30 September 2026",
    },
    {
      title: "Selected-text rewrite workflow",
      url: "https://usesuperflow.ai/docs/agents/how-to-use-the-AI-co-pilot",
      reviewed: "30 September 2026",
    },
    {
      title: "Export limitation",
      url: "https://usesuperflow.ai/docs/how-to-guides/how-can-I-export-comments",
      reviewed: "30 September 2026",
    },
    {
      title: "Workspace MCP tools and permissions",
      url: "https://usesuperflow.ai/docs/mcp/overview",
      reviewed: "30 September 2026",
    },
    {
      title: "Workspace agent knowledge base",
      url: "https://usesuperflow.ai/docs/agents/how-to-use-your-workspace-agent",
      reviewed: "30 September 2026",
    },
    {
      title: "Integration inventory",
      url: "https://usesuperflow.ai/integrations",
      reviewed: "30 September 2026",
    },
    {
      title: "Plans and hosted storage",
      url: "https://usesuperflow.ai/pricing",
      reviewed: "30 September 2026",
    },
    {
      title: "File attachments",
      url: "https://usesuperflow.ai/docs/how-to-guides/how-to-attach-files",
      reviewed: "30 September 2026",
    },
    {
      title: "Change comment status",
      url: "https://usesuperflow.ai/docs/how-to-guides/how-to-change-status",
      reviewed: "30 September 2026",
    },
    {
      title: "Hosted architecture",
      url: "https://usesuperflow.ai/docs/product-features/how-secure-is-Superflow",
      reviewed: "30 September 2026",
    },
    {
      title: "superflow reviewed capture, editor or workspace source",
      url: "https://cdn.velt.dev/lib/sdk@6.0.12/velt-comment.js",
      reviewed: "30 September 2026",
    },
    {
      title: "superflow reviewed capture, editor or workspace source",
      url: "https://cdn.velt.dev/lib/sdk@6.0.12/velt-recorder.js",
      reviewed: "30 September 2026",
    },
    {
      title: "superflow reviewed capture, editor or workspace source",
      url: "https://cdn.velt.dev/lib/sdk@6.0.12/chunk-O4AYM5FK.js",
      reviewed: "30 September 2026",
    },
    {
      title: "superflow reviewed capture, editor or workspace source",
      url: "https://cdn.jsdelivr.net/npm/@usesuperflow/toolbar/superflow.min.js",
      reviewed: "30 September 2026",
    },
    {
      title: "superflow reviewed capture, editor or workspace source",
      url: "https://app.usesuperflow.com/chunk-N7FDPAKK.js",
      reviewed: "30 September 2026",
    },
  ],
  cells: {
    extension: {
      status: "no",
      url: "https://usesuperflow.ai/screenshots",
      reviewed: "30 September 2026",
      detail:
        "Capture runs in the installed website review layer; the current snapshot page explicitly describes capture without a browser extension.",
      basis: "explicit",
    },
    screenshots: {
      status: "yes",
      url: "https://usesuperflow.ai/screenshots",
      reviewed: "30 September 2026",
      detail:
        "Automatically keeps a full-page snapshot with each comment, including authenticated pages.",
      basis: "documentation",
    },
    fullPage: {
      status: "yes",
      url: "https://usesuperflow.ai/screenshots",
      reviewed: "30 September 2026",
      detail:
        "Automatically keeps a full-page snapshot with each comment, including authenticated pages.",
      basis: "documentation",
    },
    originals: {
      status: "yes",
      url: "https://usesuperflow.ai/screenshots",
      reviewed: "30 September 2026",
      detail:
        "Automatically keeps a full-page snapshot with each comment, including authenticated pages.",
      basis: "documentation",
    },
    pins: {
      status: "yes",
      url: "https://usesuperflow.ai/docs/how-to-guides/how-to-add-a-comment-on-an-element",
      reviewed: "30 September 2026",
      detail: "Element-pinned comment threads support teammate mentions and replies.",
      basis: "documentation",
    },
    discussion: {
      status: "yes",
      url: "https://usesuperflow.ai/docs/how-to-guides/how-to-add-a-comment-on-an-element",
      reviewed: "30 September 2026",
      detail: "Element-pinned comment threads support teammate mentions and replies.",
      basis: "documentation",
    },
    drafts: {
      status: "no",
      url: "https://usesuperflow.ai/docs/how-to-guides/how-to-add-a-comment-on-an-element",
      reviewed: "30 September 2026",
      detail:
        "The documented workflow posts each comment individually; it has no local multi-point review-and-send queue.",
      basis: "scope",
    },
    resolved: {
      status: "yes",
      url: "https://usesuperflow.ai/docs/how-to-guides/how-to-change-status",
      reviewed: "30 September 2026",
      detail: "Each comment has its own workflow status.",
      basis: "documentation",
    },
    reviewDefaults: {
      status: "unknown",
      url: "https://usesuperflow.ai/docs/how-to-guides/how-to-record-screen-and-add-it-to-comments",
      reviewed: "30 September 2026",
      detail:
        "Recording and review guides do not establish whether a reviewer’s capture preferences persist between sessions.",
      basis: "documentation",
    },
    textSuggestions: {
      status: "yes",
      url: "https://usesuperflow.ai/docs/agents/how-to-use-the-AI-co-pilot",
      reviewed: "30 September 2026",
      detail:
        "Select text, request rewrites, choose a replacement and create a task; this is not a direct production edit.",
      basis: "documentation",
    },
    drawing: {
      status: "partial",
      url: "https://cdn.velt.dev/lib/sdk@6.0.12/velt-comment.js",
      reviewed: "30 September 2026",
      detail:
        "The current area annotation and text/element comment paths support box feedback, without a complete raster drawing editor. Arrow creation was removed in the August 2026 changelog; existing arrows may still display.",
      basis: "source",
    },
    highlighter: {
      status: "partial",
      url: "https://usesuperflow.ai/docs/how-to-guides/how-to-add-a-comment-on-an-element",
      reviewed: "30 September 2026",
      detail:
        "Text-selection comments highlight a text range; a pixel highlighter in a screenshot editor is not the same workflow.",
      basis: "documentation",
    },
    steps: {
      status: "no",
      url: "https://cdn.velt.dev/lib/sdk@6.0.12/velt-comment.js",
      reviewed: "30 September 2026",
      detail:
        "The inspected production toolbar, comment composer, area annotation and screenshot attachment paths expose page/text/area comments and image downloads. They contain no raster screenshot editor with this tool.",
      basis: "source",
    },
    blur: {
      status: "no",
      url: "https://cdn.velt.dev/lib/sdk@6.0.12/velt-comment.js",
      reviewed: "30 September 2026",
      detail:
        "The inspected production toolbar, comment composer, area annotation and screenshot attachment paths expose page/text/area comments and image downloads. They contain no raster screenshot editor with this tool.",
      basis: "source",
    },
    redact: {
      status: "unknown",
      url: "https://cdn.velt.dev/lib/sdk@6.0.12/velt-comment.js",
      reviewed: "30 September 2026",
      detail:
        "The inspected screenshot surface has no post-capture pixel redaction editor. This does not establish whether server-side or pre-capture masking options exist.",
      basis: "source",
    },
    stickers: {
      status: "no",
      url: "https://cdn.velt.dev/lib/sdk@6.0.12/velt-comment.js",
      reviewed: "30 September 2026",
      detail:
        "The inspected production toolbar, comment composer, area annotation and screenshot attachment paths expose page/text/area comments and image downloads. They contain no raster screenshot editor with this tool.",
      basis: "source",
    },
    cropExport: {
      status: "no",
      url: "https://cdn.velt.dev/lib/sdk@6.0.12/velt-comment.js",
      reviewed: "30 September 2026",
      detail:
        "The inspected production toolbar, comment composer, area annotation and screenshot attachment paths expose page/text/area comments and image downloads. They contain no raster screenshot editor with this tool.",
      basis: "source",
    },
    localImages: {
      status: "no",
      url: "https://cdn.velt.dev/lib/sdk@6.0.12/velt-comment.js",
      reviewed: "30 September 2026",
      detail:
        "Pasted or inserted images become comment attachments. The inspected area annotation path has no movable/resizable image-layer composition inside a screenshot.",
      basis: "source",
    },
    rasterExport: {
      status: "partial",
      url: "https://cdn.velt.dev/lib/sdk@6.0.12/velt-comment.js",
      reviewed: "30 September 2026",
      detail:
        "Native capture creates PNG/WebP screenshot attachments and comment images can be downloaded. The inspected surface has no PNG/JPEG/WebP export format selector.",
      basis: "source",
    },
    pdfExport: {
      status: "no",
      url: "https://cdn.velt.dev/lib/sdk@6.0.12/velt-comment.js",
      reviewed: "30 September 2026",
      detail:
        "Screenshot output is a downloadable image attachment, without a combined screenshot PDF export in the inspected path. Uploaded PDF review and generated QA-report PDFs are separate workflows.",
      basis: "source",
    },
    clipboard: {
      status: "no",
      url: "https://cdn.velt.dev/lib/sdk@6.0.12/velt-comment.js",
      reviewed: "30 September 2026",
      detail:
        "The inspected comment/image actions offer download. Clipboard utilities write text or links, without an annotated-image copy action.",
      basis: "source",
    },
    threadBundle: {
      status: "no",
      url: "https://usesuperflow.ai/docs/how-to-guides/how-can-I-export-comments",
      reviewed: "30 September 2026",
      detail:
        "The official export guide explicitly says comment export is not developed; request exports from support. This is not a self-service annotated-image or complete thread export.",
      basis: "explicit",
    },
    video: {
      status: "yes",
      url: "https://usesuperflow.ai/recordings",
      reviewed: "30 September 2026",
      detail:
        "Records screen with narration, camera video or voice notes directly into a pinned comment.",
      basis: "documentation",
    },
    microphone: {
      status: "yes",
      url: "https://usesuperflow.ai/recordings",
      reviewed: "30 September 2026",
      detail:
        "Records screen with narration, camera video or voice notes directly into a pinned comment.",
      basis: "documentation",
    },
    tabAudio: {
      status: "yes",
      url: "https://cdn.velt.dev/lib/sdk@6.0.12/chunk-O4AYM5FK.js",
      reviewed: "30 September 2026",
      detail:
        "Screen capture requests getDisplayMedia with audio enabled; collectMediaTracks mixes supported tab-audio and microphone tracks. Availability depends on the browser and selected share surface.",
      basis: "source",
    },
    pauseVideo: {
      status: "yes",
      url: "https://cdn.velt.dev/lib/sdk@6.0.12/velt-recorder.js",
      reviewed: "30 September 2026",
      detail:
        "The enabled feedback recorder exposes Pause/Resume and calls MediaRecorder.pause() and resume().",
      basis: "source",
    },
    trimVideo: {
      status: "no",
      url: "https://cdn.jsdelivr.net/npm/@usesuperflow/toolbar/superflow.min.js",
      reviewed: "30 September 2026",
      detail:
        "The shipped comment recorder uses sourceFeature=comment, excluding the Edit button. Superflow does not enable the optional SDK video editor; a standalone recorder toolbar entry is staging-only.",
      basis: "source",
    },
    cropVideo: {
      status: "no",
      url: "https://cdn.jsdelivr.net/npm/@usesuperflow/toolbar/superflow.min.js",
      reviewed: "30 September 2026",
      detail:
        "The shipped comment recorder uses sourceFeature=comment, excluding the Edit button. Superflow does not enable the optional SDK video editor; a standalone recorder toolbar entry is staging-only.",
      basis: "source",
    },
    replay: {
      status: "no",
      url: "https://cdn.jsdelivr.net/npm/@usesuperflow/toolbar/superflow.min.js",
      reviewed: "30 September 2026",
      detail:
        "The inspected customer feedback capture graph records screen/camera/voice media, without a reviewed-site DOM session capture or console/network diagnostic playback channel. Product analytics are separate from customer feedback evidence.",
      basis: "source",
    },
    sessionOnly: {
      status: "no",
      url: "https://cdn.jsdelivr.net/npm/@usesuperflow/toolbar/superflow.min.js",
      reviewed: "30 September 2026",
      detail:
        "The inspected customer feedback capture graph records screen/camera/voice media, without a reviewed-site DOM session capture or console/network diagnostic playback channel. Product analytics are separate from customer feedback evidence.",
      basis: "source",
    },
    timeline: {
      status: "no",
      url: "https://cdn.jsdelivr.net/npm/@usesuperflow/toolbar/superflow.min.js",
      reviewed: "30 September 2026",
      detail:
        "The inspected customer feedback capture graph records screen/camera/voice media, without a reviewed-site DOM session capture or console/network diagnostic playback channel. Product analytics are separate from customer feedback evidence.",
      basis: "source",
    },
    screenshotDiagnostics: {
      status: "no",
      url: "https://cdn.jsdelivr.net/npm/@usesuperflow/toolbar/superflow.min.js",
      reviewed: "30 September 2026",
      detail:
        "Ordinary project screenshot comments attach image bytes, without the combined DOM/console/network debugging bundle. A separate Report a bug support flow sends telemetry to Superflow and is not attached to these comments.",
      basis: "source",
    },
    diagnostics: {
      status: "partial",
      url: "https://cdn.jsdelivr.net/npm/@usesuperflow/toolbar/superflow.min.js",
      reviewed: "30 September 2026",
      detail:
        "A separate Report a bug support flow collects bounded console/errors and network failures for Superflow support. These diagnostics are not a synchronized recorded-journey channel in ordinary project comments.",
      basis: "source",
    },
    frameAnnotations: {
      status: "partial",
      url: "https://app.usesuperflow.com/chunk-N7FDPAKK.js",
      reviewed: "30 September 2026",
      detail:
        "Uploaded-video comments store currentMediaPosition, version and player ID, and seek to that position when selected. This supports timestamped comments, rather than saved annotated raster frames.",
      basis: "source",
    },
    mcp: {
      status: "yes",
      url: "https://usesuperflow.ai/docs/mcp/overview",
      reviewed: "30 September 2026",
      detail:
        "Authenticated OAuth workspace MCP reads comment threads, projects and agent findings; it is separate from public utility tools.",
      basis: "documentation",
    },
    agentContext: {
      status: "yes",
      url: "https://usesuperflow.ai/docs/mcp/overview",
      reviewed: "30 September 2026",
      detail:
        "Authenticated OAuth workspace MCP reads comment threads, projects and agent findings; it is separate from public utility tools.",
      basis: "documentation",
    },
    expertise: {
      status: "unknown",
      url: "https://usesuperflow.ai/docs/mcp/overview",
      reviewed: "30 September 2026",
      detail:
        "Workspace MCP documentation gives selected examples, without the complete authenticated policy schema. The public demo exposes only two preview tools and cannot settle owner-approved reviewer subject weights.",
      basis: "documentation",
    },
    projectContext: {
      status: "partial",
      url: "https://usesuperflow.ai/docs/agents/how-to-use-your-workspace-agent",
      reviewed: "30 September 2026",
      detail:
        "A knowledge base stores brand guidelines and agent checks. An agent-readable revisioned project-instruction contract is not established.",
      basis: "documentation",
    },
    agentQueue: {
      status: "partial",
      url: "https://usesuperflow.ai/docs/mcp/overview",
      reviewed: "30 September 2026",
      detail:
        "Workspace MCP can summarize open threads. Selected public examples do not establish the exact assignee and priority filter schema; the two-tool preview demo is not the workspace inventory.",
      basis: "documentation",
    },
    github: {
      status: "no",
      url: "https://usesuperflow.ai/integrations",
      reviewed: "30 September 2026",
      detail:
        "The native task integrations are Asana, Trello, Monday, ClickUp and Jira. Webhooks/REST enable custom handoff, not native GitHub Issues or GitHub App management.",
      basis: "scope",
    },
    multiRepo: {
      status: "no",
      url: "https://usesuperflow.ai/integrations",
      reviewed: "30 September 2026",
      detail:
        "The native task integrations are Asana, Trello, Monday, ClickUp and Jira. Webhooks/REST enable custom handoff, not native GitHub Issues or GitHub App management.",
      basis: "scope",
    },
    multiApps: {
      status: "no",
      url: "https://usesuperflow.ai/integrations",
      reviewed: "30 September 2026",
      detail:
        "The native task integrations are Asana, Trello, Monday, ClickUp and Jira. Webhooks/REST enable custom handoff, not native GitHub Issues or GitHub App management.",
      basis: "scope",
    },
    source: {
      status: "no",
      url: "https://usesuperflow.ai/docs/product-features/how-secure-is-Superflow",
      reviewed: "30 September 2026",
      detail:
        "The reviewed product is a managed multi-tenant service with vendor-operated databases/storage. Its public docs repository is not a distributable server.",
      basis: "scope",
    },
    apacheLicense: {
      status: "no",
      url: "https://usesuperflow.ai/docs/product-features/how-secure-is-Superflow",
      reviewed: "30 September 2026",
      detail:
        "The reviewed product is a managed multi-tenant service with vendor-operated databases/storage. Its public docs repository is not a distributable server.",
      basis: "scope",
    },
    selfHost: {
      status: "no",
      url: "https://usesuperflow.ai/docs/product-features/how-secure-is-Superflow",
      reviewed: "30 September 2026",
      detail:
        "The reviewed product is a managed multi-tenant service with vendor-operated databases/storage. Its public docs repository is not a distributable server.",
      basis: "scope",
    },
    storage: {
      status: "no",
      url: "https://usesuperflow.ai/docs/product-features/how-secure-is-Superflow",
      reviewed: "30 September 2026",
      detail:
        "The reviewed product is a managed multi-tenant service with vendor-operated databases/storage. Its public docs repository is not a distributable server.",
      basis: "scope",
    },
    independent: {
      status: "no",
      url: "https://usesuperflow.ai/docs/mcp/overview",
      reviewed: "30 September 2026",
      detail:
        "Workspace access requires Superflow sign-in/OAuth. Guest review links and a sample-data MCP demo do not remove that dependency.",
      basis: "explicit",
    },
    allFeaturesFree: {
      status: "no",
      url: "https://usesuperflow.ai/pricing",
      reviewed: "30 September 2026",
      detail:
        "Free Starter has limited projects/storage/credits; Growth, Scale and Enterprise add paid capabilities.",
      basis: "documentation",
    },
    nativeClients: {
      status: "unknown",
      url: "https://usesuperflow.ai/integrations",
      reviewed: "30 September 2026",
      detail:
        "The public catalog covers website snippets, frameworks and CMS plugins. The catalog and inspected web client do not establish or conclusively exclude separately distributed native iOS/Android feedback SDKs.",
      basis: "documentation",
    },
  },
};
