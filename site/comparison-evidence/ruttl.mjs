export default {
  reviewed: "30 September 2026",
  scope:
    "Ruttl hosted website, web-app, mobile and file review; official support, MCP, extension listing, integration catalog and feature-specific product posts. Public web capture/editor clients were inspected at ruttl/scripts commit a0967f7a5213faf0c328c5dee0dd61a9aba7f985; source-based editor negatives are scoped to those controls. Separate mobile, PDF/export and authenticated MCP contracts remain bounded gaps.",
  summary:
    "Ruttl combines live-page comments and visual changes, mobile feedback, video review, page versions and an MCP connector.",
  sources: [
    {
      title:
        "Published web capture/editor implementation; commit a0967f7; SHA256 4cef222275c08fe1b448515092b98d6013ba5b97e12e58f508c79348f51c49cb",
      url: "https://github.com/ruttl/scripts/blob/a0967f7a5213faf0c328c5dee0dd61a9aba7f985/ruttl.min.js",
      reviewed: "30 September 2026",
    },
    {
      title:
        "Published iframe capture/editor implementation; commit a0967f7; SHA256 282394d8cfd31402d5a1fca45158a886eef136361fe8c5afb9a7eb2c419979fb",
      url: "https://github.com/ruttl/scripts/blob/a0967f7a5213faf0c328c5dee0dd61a9aba7f985/frame.min.js",
      reviewed: "30 September 2026",
    },
    {
      title: "Current hosted web review route and Attachment viewer",
      url: "https://web.ruttl.com/_next/static/chunks/1548-340797c28eafd048.js",
      reviewed: "30 September 2026",
    },
    {
      title: "Website and image review workflow",
      url: "https://www.ruttl.com/support/using-ruttl",
      reviewed: "30 September 2026",
    },
    {
      title: "Versioning and complete native integration list",
      url: "https://www.ruttl.com/support/tools-and-tips",
      reviewed: "30 September 2026",
    },
    {
      title: "Published Ruttl Chrome extension",
      url: "https://chromewebstore.google.com/detail/ruttl/doecfodblgfnjmmphbedjgllipnbgbld",
      reviewed: "30 September 2026",
    },
    {
      title: "Ruttl feedback MCP",
      url: "https://www.ruttl.com/mcp",
      reviewed: "30 September 2026",
    },
    {
      title: "Image review and visual editing",
      url: "https://www.ruttl.com/blog/what-is-image-annotation",
      reviewed: "30 September 2026",
    },
    {
      title: "Frame-accurate video annotation",
      url: "https://www.ruttl.com/blog/what-is-video-annotation-and-how-to-annotate-video-online",
      reviewed: "30 September 2026",
    },
    {
      title: "Screen recording walkthrough",
      url: "https://www.ruttl.com/blog/video-commenting",
      reviewed: "30 September 2026",
    },
    {
      title: "Bug capture product",
      url: "https://site.dev.ruttl.com/bug-tracking-tool/",
      reviewed: "30 September 2026",
    },
    {
      title: "Mobile SDK and product catalog",
      url: "https://www.ruttl.com/",
      reviewed: "30 September 2026",
    },
    {
      title: "Hosted proprietary service terms",
      url: "https://www.ruttl.com/terms-and-conditions",
      reviewed: "30 September 2026",
    },
    {
      title: "Free and paid plan boundaries",
      url: "https://www.ruttl.com/pricing",
      reviewed: "30 September 2026",
    },
  ],
  cells: {
    extension: {
      status: "yes",
      url: "https://chromewebstore.google.com/detail/ruttl/doecfodblgfnjmmphbedjgllipnbgbld",
      reviewed: "30 September 2026",
      detail:
        "Published first-party Chrome extension reviews logged-in web apps and creates bug tickets.",
      basis: "documentation",
    },
    screenshots: {
      status: "yes",
      url: "https://www.ruttl.com/support/using-ruttl",
      reviewed: "30 September 2026",
      detail:
        "Element comments and bug screenshots feed collaborative threads with individual resolve/edit/delete controls.",
      basis: "documentation",
    },
    pins: {
      status: "yes",
      url: "https://www.ruttl.com/support/using-ruttl",
      reviewed: "30 September 2026",
      detail:
        "Element comments and bug screenshots feed collaborative threads with individual resolve/edit/delete controls.",
      basis: "documentation",
    },
    discussion: {
      status: "yes",
      url: "https://www.ruttl.com/support/using-ruttl",
      reviewed: "30 September 2026",
      detail:
        "Element comments and bug screenshots feed collaborative threads with individual resolve/edit/delete controls.",
      basis: "documentation",
    },
    resolved: {
      status: "yes",
      url: "https://www.ruttl.com/support/using-ruttl",
      reviewed: "30 September 2026",
      detail:
        "Element comments and bug screenshots feed collaborative threads with individual resolve/edit/delete controls.",
      basis: "documentation",
    },
    fullPage: {
      status: "no",
      url: "https://github.com/ruttl/scripts/blob/a0967f7a5213faf0c328c5dee0dd61a9aba7f985/ruttl.min.js",
      reviewed: "30 September 2026",
      detail:
        "The published web capture controls offer a dragged visible region or an element bounding box with padding. Neither control requests a full scrolling-page capture; imported tall images are separate.",
      basis: "source",
    },
    originals: {
      status: "partial",
      url: "https://github.com/ruttl/scripts/blob/a0967f7a5213faf0c328c5dee0dd61a9aba7f985/ruttl.min.js",
      reviewed: "30 September 2026",
      detail:
        "The published plugin can capture an element screenshot on the initial pin. The shared NewComment flow makes capture optional, and replies can have no image, so an original screenshot is not guaranteed for every comment.",
      basis: "source",
    },
    drafts: {
      status: "no",
      url: "https://www.ruttl.com/support/using-ruttl",
      reviewed: "30 September 2026",
      detail:
        "Comments publish individually with Comment/Enter; the documented workflow does not stage a local multi-point submission.",
      basis: "scope",
    },
    reviewDefaults: {
      status: "unknown",
      url: "https://github.com/ruttl/scripts/blob/a0967f7a5213faf0c328c5dee0dd61a9aba7f985/ruttl.min.js",
      reviewed: "30 September 2026",
      detail:
        "Inspected recorder/editor choices use fresh component state. The plugin persists widget position, but that does not establish saved review/recording preferences across the separate hosted and extension surfaces.",
      basis: "source",
    },
    textSuggestions: {
      status: "partial",
      url: "https://www.ruttl.com/blog/what-is-image-annotation",
      reviewed: "30 September 2026",
      detail:
        "Reviewers can edit text and compare page versions; this differs from retaining a structured original/replacement suggestion.",
      basis: "documentation",
    },
    drawing: {
      status: "yes",
      url: "https://github.com/ruttl/scripts/blob/a0967f7a5213faf0c328c5dee0dd61a9aba7f985/ruttl.min.js",
      reviewed: "30 September 2026",
      detail:
        "The current published screenshot editor has an explicit five-tool toolbar: draw, arrow, rectangle, circle and text. The attachment re-editor supports freehand and text.",
      basis: "source",
    },
    highlighter: {
      status: "no",
      url: "https://github.com/ruttl/scripts/blob/a0967f7a5213faf0c328c5dee0dd61a9aba7f985/ruttl.min.js",
      reviewed: "30 September 2026",
      detail:
        "Both published screenshot editors have fixed tool lists and opaque drawing handlers; neither exposes translucent highlighting.",
      basis: "source",
    },
    steps: {
      status: "no",
      url: "https://github.com/ruttl/scripts/blob/a0967f7a5213faf0c328c5dee0dd61a9aba7f985/ruttl.min.js",
      reviewed: "30 September 2026",
      detail:
        "The complete screenshot toolbar has draw, arrow, rectangle, circle and text; no automatic numbered-step tool. Thread pin numbers are separate from raster annotation.",
      basis: "source",
    },
    blur: {
      status: "no",
      url: "https://github.com/ruttl/scripts/blob/a0967f7a5213faf0c328c5dee0dd61a9aba7f985/ruttl.min.js",
      reviewed: "30 September 2026",
      detail:
        "The complete screenshot toolbar and pixel handlers have no blur or pixelation tool. Text shadowBlur is a text-rendering effect, not screenshot redaction.",
      basis: "source",
    },
    redact: {
      status: "no",
      url: "https://github.com/ruttl/scripts/blob/a0967f7a5213faf0c328c5dee0dd61a9aba7f985/ruttl.min.js",
      reviewed: "30 September 2026",
      detail:
        "The complete screenshot editor has outline rectangles via strokeRect and fixed-width freehand drawing; no filled mask or dedicated pixel-redaction control.",
      basis: "source",
    },
    stickers: {
      status: "no",
      url: "https://github.com/ruttl/scripts/blob/a0967f7a5213faf0c328c5dee0dd61a9aba7f985/ruttl.min.js",
      reviewed: "30 September 2026",
      detail:
        "The complete screenshot editor has five drawing tools and colour choices, with no stamp/sticker palette or stamp-placement handler.",
      basis: "source",
    },
    localImages: {
      status: "no",
      url: "https://github.com/ruttl/scripts/blob/a0967f7a5213faf0c328c5dee0dd61a9aba7f985/ruttl.min.js",
      reviewed: "30 September 2026",
      detail:
        "Screenshot files load as the base canvas image. The complete editor has no additional image insertion, move or resize tool; comment file attachments are separate.",
      basis: "source",
    },
    cropExport: {
      status: "partial",
      url: "https://github.com/ruttl/scripts/blob/a0967f7a5213faf0c328c5dee0dd61a9aba7f985/ruttl.min.js",
      reviewed: "30 September 2026",
      detail:
        "ScreenshotCapture lets the reviewer drag a region and captures those exact bounds before annotation. The annotated PNG uses that region; there is no separate post-annotation crop/export control.",
      basis: "source",
    },
    rasterExport: {
      status: "unknown",
      url: "https://github.com/ruttl/scripts/blob/a0967f7a5213faf0c328c5dee0dd61a9aba7f985/ruttl.min.js",
      reviewed: "30 September 2026",
      detail:
        "The editors demonstrably create annotated PNG files for comment attachment, while the reviewed Attachment viewer only displays images. A user-facing image download/format-export workflow is not established by these routes; internal PNG serialization alone does not prove PNG/JPEG/WebP export.",
      basis: "source",
    },
    clipboard: {
      status: "no",
      url: "https://github.com/ruttl/scripts/blob/a0967f7a5213faf0c328c5dee0dd61a9aba7f985/ruttl.min.js",
      reviewed: "30 September 2026",
      detail:
        "The screenshot editors save PNG attachments to comments. Their complete controls and the reviewed attachment viewer provide no annotated-image clipboard action; observed clipboard actions copy links/text.",
      basis: "source",
    },
    pdfExport: {
      status: "unknown",
      url: "https://web.ruttl.com/_next/static/chunks/1548-340797c28eafd048.js",
      reviewed: "30 September 2026",
      detail:
        "The complete inspected screenshot editors save PNG attachments and the web attachment viewer has no PDF-export control. The separate PDF-review/project export surface was not covered, so its multipage output capability remains unresolved.",
      basis: "source",
    },
    video: {
      status: "yes",
      url: "https://www.ruttl.com/blog/video-commenting",
      reviewed: "30 September 2026",
      detail:
        "Screen/window/tab recording supports spoken feedback, preview and attachment to a comment.",
      basis: "documentation",
    },
    microphone: {
      status: "yes",
      url: "https://www.ruttl.com/blog/video-commenting",
      reviewed: "30 September 2026",
      detail:
        "Screen/window/tab recording supports spoken feedback, preview and attachment to a comment.",
      basis: "documentation",
    },
    tabAudio: {
      status: "no",
      url: "https://github.com/ruttl/scripts/blob/a0967f7a5213faf0c328c5dee0dd61a9aba7f985/ruttl.min.js",
      reviewed: "30 September 2026",
      detail:
        "Both published web recorder implementations explicitly call getDisplayMedia with audio:false. Microphone audio is obtained separately through getUserMedia; no tab/system audio capture control is exposed.",
      basis: "source",
    },
    pauseVideo: {
      status: "no",
      url: "https://github.com/ruttl/scripts/blob/a0967f7a5213faf0c328c5dee0dd61a9aba7f985/ruttl.min.js",
      reviewed: "30 September 2026",
      detail:
        "The recorder helper contains pause/resume methods, but the complete ScreenRecorderCapture toolbar exposes only microphone, Stop and Cancel. No user-facing recording pause/resume action is wired in the inspected web clients.",
      basis: "source",
    },
    trimVideo: {
      status: "no",
      url: "https://github.com/ruttl/scripts/blob/a0967f7a5213faf0c328c5dee0dd61a9aba7f985/ruttl.min.js",
      reviewed: "30 September 2026",
      detail:
        "VideoCommentModal offers a playback seek slider but submits the original recorded File unchanged. There are no trim handles, in/out values or trimming transform in the inspected recording flow.",
      basis: "source",
    },
    cropVideo: {
      status: "no",
      url: "https://github.com/ruttl/scripts/blob/a0967f7a5213faf0c328c5dee0dd61a9aba7f985/ruttl.min.js",
      reviewed: "30 September 2026",
      detail:
        "VideoCommentModal offers playback, seek, mute and comment submission; it passes the original recorded File to onSubmit without a spatial crop control or transform.",
      basis: "source",
    },
    frameAnnotations: {
      status: "yes",
      url: "https://www.ruttl.com/blog/what-is-video-annotation-and-how-to-annotate-video-online",
      reviewed: "30 September 2026",
      detail:
        "Video review supports frame-accurate timestamps, shapes and freehand comments on uploaded video.",
      basis: "documentation",
    },
    diagnostics: {
      status: "yes",
      url: "https://site.dev.ruttl.com/bug-tracking-tool/",
      reviewed: "30 September 2026",
      detail:
        "The bug-tracking product advertises console and network logs. Its brief page does not specify retention or request-body coverage.",
      basis: "documentation",
    },
    screenshotDiagnostics: {
      status: "partial",
      url: "https://site.dev.ruttl.com/bug-tracking-tool/",
      reviewed: "30 September 2026",
      detail:
        "Bug screenshots and console/network context are advertised; a downloadable DOM plus console plus network bundle is not established.",
      basis: "documentation",
    },
    replay: {
      status: "unknown",
      url: "https://web.ruttl.com/_next/static/chunks/1548-340797c28eafd048.js",
      reviewed: "30 September 2026",
      detail:
        "The inspected public web clients capture manual screenshot/video comments. That inventory does not cover the separate mobile SDK or every hosted feature, so whole-product session-replay availability remains unresolved; the privacy clause is not a feature exclusion.",
      basis: "source",
    },
    sessionOnly: {
      status: "unknown",
      url: "https://web.ruttl.com/_next/static/chunks/1548-340797c28eafd048.js",
      reviewed: "30 September 2026",
      detail:
        "The inspected web capture flow contains screenshot selection and a MediaRecorder video flow, but does not establish a separate event-session mode. Mobile and hosted capture contracts were not available for a whole-product absence finding.",
      basis: "source",
    },
    timeline: {
      status: "unknown",
      url: "https://web.ruttl.com/_next/static/chunks/1548-340797c28eafd048.js",
      reviewed: "30 September 2026",
      detail:
        "The reviewed web video preview has playback/seek and timestamped comments, without diagnostic-track controls. Separate bug/mobile playback surfaces were not fully exposed, so a synchronized diagnostic timeline cannot be ruled out for the whole product.",
      basis: "source",
    },
    threadBundle: {
      status: "unknown",
      url: "https://web.ruttl.com/_next/static/chunks/1548-340797c28eafd048.js",
      reviewed: "30 September 2026",
      detail:
        "The inspected web review route displays threads and individual attachments. It does not expose the full project/account export surface or a complete export API, so a portable whole-thread archive cannot be ruled out from this route alone.",
      basis: "source",
    },
    mcp: {
      status: "yes",
      url: "https://www.ruttl.com/mcp",
      reviewed: "30 September 2026",
      detail:
        "MCP reads feedback with page, version and comment context, and can resolve feedback after an authorized fix.",
      basis: "documentation",
    },
    agentContext: {
      status: "yes",
      url: "https://www.ruttl.com/mcp",
      reviewed: "30 September 2026",
      detail:
        "MCP reads feedback with page, version and comment context, and can resolve feedback after an authorized fix.",
      basis: "documentation",
    },
    agentQueue: {
      status: "partial",
      url: "https://www.ruttl.com/mcp",
      reviewed: "30 September 2026",
      detail:
        "MCP advertises AI priority analysis and ticket retrieval; assignee filters and a server-ranked task queue are not documented.",
      basis: "documentation",
    },
    expertise: {
      status: "unknown",
      url: "https://www.ruttl.com/mcp",
      reviewed: "30 September 2026",
      detail:
        "Published MCP examples do not enumerate the full tool schemas. The MCP endpoint returns 401 Missing token to an unauthenticated tools/list request, so owner-approved reviewer weights cannot be confirmed or ruled out without authorized schema access.",
      basis: "documentation",
    },
    projectContext: {
      status: "unknown",
      url: "https://www.ruttl.com/mcp",
      reviewed: "30 September 2026",
      detail:
        "Published MCP examples establish page/version/comment context, not an exhaustive contract for project guidance. The MCP endpoint requires a token for tools/list, so versioned project instructions remain unresolved.",
      basis: "documentation",
    },
    github: {
      status: "no",
      url: "https://www.ruttl.com/support/tools-and-tips",
      reviewed: "30 September 2026",
      detail:
        "The explicit native list is Jira, Slack, Trello, ClickUp, Zapier, Asana and Unsplash. Custom Zapier handoff is not native GitHub App management.",
      basis: "explicit",
    },
    multiRepo: {
      status: "no",
      url: "https://www.ruttl.com/support/tools-and-tips",
      reviewed: "30 September 2026",
      detail:
        "The explicit native list is Jira, Slack, Trello, ClickUp, Zapier, Asana and Unsplash. Custom Zapier handoff is not native GitHub App management.",
      basis: "explicit",
    },
    multiApps: {
      status: "no",
      url: "https://www.ruttl.com/support/tools-and-tips",
      reviewed: "30 September 2026",
      detail:
        "The explicit native list is Jira, Slack, Trello, ClickUp, Zapier, Asana and Unsplash. Custom Zapier handoff is not native GitHub App management.",
      basis: "explicit",
    },
    source: {
      status: "no",
      url: "https://www.ruttl.com/terms-and-conditions",
      reviewed: "30 September 2026",
      detail:
        "Ruttl is a proprietary hosted/proxied service with vendor cloud storage and no complete service source distribution.",
      basis: "explicit",
    },
    apacheLicense: {
      status: "no",
      url: "https://www.ruttl.com/terms-and-conditions",
      reviewed: "30 September 2026",
      detail:
        "Ruttl is a proprietary hosted/proxied service with vendor cloud storage and no complete service source distribution.",
      basis: "explicit",
    },
    selfHost: {
      status: "no",
      url: "https://www.ruttl.com/terms-and-conditions",
      reviewed: "30 September 2026",
      detail:
        "Ruttl is a proprietary hosted/proxied service with vendor cloud storage and no complete service source distribution.",
      basis: "explicit",
    },
    storage: {
      status: "no",
      url: "https://www.ruttl.com/terms-and-conditions",
      reviewed: "30 September 2026",
      detail:
        "Ruttl is a proprietary hosted/proxied service with vendor cloud storage and no complete service source distribution.",
      basis: "explicit",
    },
    independent: {
      status: "no",
      url: "https://www.ruttl.com/support/using-ruttl",
      reviewed: "30 September 2026",
      detail:
        "Creating a project requires Ruttl sign-up/login. Guest links remove guest sign-in, not the operator’s hosted account.",
      basis: "explicit",
    },
    allFeaturesFree: {
      status: "no",
      url: "https://www.ruttl.com/pricing",
      reviewed: "30 September 2026",
      detail:
        "Basic is limited; paid Pro/Business add integrations, device sizes and team-management features.",
      basis: "documentation",
    },
    nativeClients: {
      status: "yes",
      url: "https://www.ruttl.com/",
      reviewed: "30 September 2026",
      detail:
        "The mobile-feedback setup publishes the first-party @ruttl/mobile-sdk package.",
      basis: "documentation",
    },
  },
};
