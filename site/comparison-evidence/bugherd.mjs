export default {
  reviewed: "30 September 2026",
  scope:
    "BugHerd hosted product, browser extension and official MCP. External LogRocket integration is identified separately; platform-operation rows concern the complete service.",
  summary:
    "Native pinned feedback, screenshot markup, selected-text edits, video narration and task-aware MCP are documented. Replay and deep diagnostics use a documented external integration. Public documents leave full-page capture and some recording controls unresolved.",
  sources: [
    {
      url: "https://support.bugherd.com/en/articles/11424451-bugherd-browser-extensions",
      title: "BugHerd browser extensions",
      reviewed: "30 September 2026",
    },
    {
      url: "https://support.bugherd.com/en/articles/11424269-how-do-i-give-feedback-or-log-a-bug",
      title: "How to give feedback or log a bug",
      reviewed: "30 September 2026",
    },
    {
      url: "https://bugherd.com/use-case/markup-tool",
      title: "BugHerd markup product and published editor illustration",
      reviewed: "30 September 2026",
    },
    {
      url: "https://cdn.prod.website-files.com/5f348cefc28f73bfbed5b00a/603f101221397c8aee515d2e_feature-tile-annotations%402x.png",
      title: "Official screenshot annotation toolbar illustration",
      reviewed: "30 September 2026",
    },
    {
      url: "https://bugherd.com/website-annotation-tool",
      title: "BugHerd website annotation",
      reviewed: "30 September 2026",
    },
    {
      url: "https://support.bugherd.com/en/articles/11424287-7-create-task-improvements-you-asked-for",
      title: "Remember task settings",
      reviewed: "30 September 2026",
    },
    {
      url: "https://support.bugherd.com/en/articles/13680452-suggest-text-edits",
      title: "Suggest Text Edits",
      reviewed: "30 September 2026",
    },
    {
      url: "https://support.bugherd.com/en/articles/11467195-chapter-5-managing-your-feedback-efficiently",
      title: "Managing feedback efficiently",
      reviewed: "30 September 2026",
    },
    {
      url: "https://bugherd.com/pricing",
      title: "BugHerd plans and CSV/XML/JSON export",
      reviewed: "30 September 2026",
    },
    {
      url: "https://updates.bugherd.com/release/Jfp4G-react-to-a-comment-view-attachments-plus-4-shortcuts-to-speed-up-task-creation",
      title: "Attachment viewing and downloading",
      reviewed: "30 September 2026",
    },
    {
      url: "https://support.bugherd.com/en/articles/11430562-how-to-export-your-bugs-from-bugherd",
      title: "Export bugs",
      reviewed: "30 September 2026",
    },
    {
      url: "https://support.bugherd.com/en/articles/11430571-bugherd-and-logrocket-integration",
      title: "LogRocket integration",
      reviewed: "30 September 2026",
    },
    {
      url: "https://bugherd.com/cp/marker-alternative",
      title: "BugHerd comparison: console logs via LogRocket",
      reviewed: "30 September 2026",
    },
    {
      url: "https://bugherd.com/blog/website-annotation-a-complete-guide-on-annotating-web-projects",
      title: "General annotation guide with conflicting console claim",
      reviewed: "30 September 2026",
    },
    {
      url: "https://support.bugherd.com/en/articles/14835206-getting-started-with-the-bugherd-mcp-server",
      title: "Official BugHerd MCP tools",
      reviewed: "30 September 2026",
    },
    {
      url: "https://support.bugherd.com/en/articles/11430519-bugherd-and-github-integration",
      title: "GitHub integration and target repository",
      reviewed: "30 September 2026",
    },
    {
      url: "https://bugherd.com/terms",
      title: "BugHerd proprietary platform terms",
      reviewed: "30 September 2026",
    },
    {
      url: "https://support.bugherd.com/en/articles/11430635-can-i-use-bugherd-to-test-a-native-app",
      title: "Native app support limitation",
      reviewed: "30 September 2026",
    },
    {
      url: "https://support.bugherd.com/en/articles/11430545-bugherd-zapier-triggers-action-api-references",
      title: "Task and comment data inventory",
      reviewed: "30 September 2026",
    },
  ],
  cells: {
    extension: {
      status: "yes",
      url: "https://support.bugherd.com/en/articles/11424451-bugherd-browser-extensions",
      reviewed: "30 September 2026",
      detail: "Official extensions support Chrome, Edge, Firefox and Safari.",
      basis: "documentation",
    },
    screenshots: {
      status: "yes",
      url: "https://support.bugherd.com/en/articles/11424451-bugherd-browser-extensions",
      reviewed: "30 September 2026",
      detail: "Captures screenshots with website feedback tasks.",
      basis: "documentation",
    },
    fullPage: {
      status: "unknown",
      url: "https://support.bugherd.com/en/articles/11424269-how-do-i-give-feedback-or-log-a-bug",
      reviewed: "30 September 2026",
      detail:
        "Whole-page feedback is documented; whether it captures the full scroll height is unspecified.",
      basis: "scope",
    },
    pins: {
      status: "yes",
      url: "https://bugherd.com/website-annotation-tool",
      reviewed: "30 September 2026",
      detail: "Feedback pins attach to the selected page element.",
      basis: "documentation",
    },
    originals: {
      status: "yes",
      url: "https://bugherd.com/website-annotation-tool",
      reviewed: "30 September 2026",
      detail: "Each new pinned feedback task receives its own screenshot or video.",
      basis: "documentation",
    },
    drafts: {
      status: "no",
      url: "https://support.bugherd.com/en/articles/11424269-how-do-i-give-feedback-or-log-a-bug",
      reviewed: "30 September 2026",
      detail:
        "The documented workflow saves each point with Create Task; no local multi-point review collection.",
      basis: "scope",
    },
    resolved: {
      status: "yes",
      url: "https://support.bugherd.com/en/articles/11467195-chapter-5-managing-your-feedback-efficiently",
      reviewed: "30 September 2026",
      detail: "Tasks can be moved independently through the completion workflow.",
      basis: "documentation",
    },
    reviewDefaults: {
      status: "partial",
      url: "https://support.bugherd.com/en/articles/11424287-7-create-task-improvements-you-asked-for",
      reviewed: "30 September 2026",
      detail:
        "Remembers assignee, severity, status and tags; not a saved recording-control preset.",
      basis: "documentation",
    },
    textSuggestions: {
      status: "yes",
      url: "https://support.bugherd.com/en/articles/13680452-suggest-text-edits",
      reviewed: "30 September 2026",
      detail: "Select original page text and submit a suggested replacement.",
      basis: "documentation",
    },
    drawing: {
      status: "yes",
      url: "https://bugherd.com/use-case/markup-tool",
      reviewed: "30 September 2026",
      detail: "Published editor supports drawing, rectangles, arrows and text.",
      basis: "documentation",
    },
    highlighter: {
      status: "partial",
      url: "https://bugherd.com/use-case/markup-tool",
      reviewed: "30 September 2026",
      detail:
        "Highlights are advertised, but the illustrated editor shows shape/pen emphasis rather than a dedicated highlighter.",
      basis: "documentation",
    },
    steps: {
      status: "no",
      url: "https://cdn.prod.website-files.com/5f348cefc28f73bfbed5b00a/603f101221397c8aee515d2e_feature-tile-annotations%402x.png",
      reviewed: "30 September 2026",
      detail:
        "Published toolbar has shapes, arrows, pen and text, without a numbered-step tool.",
      basis: "scope",
    },
    blur: {
      status: "no",
      url: "https://cdn.prod.website-files.com/5f348cefc28f73bfbed5b00a/603f101221397c8aee515d2e_feature-tile-annotations%402x.png",
      reviewed: "30 September 2026",
      detail: "The published native screenshot editor toolbar has no blur control.",
      basis: "scope",
    },
    redact: {
      status: "no",
      url: "https://cdn.prod.website-files.com/5f348cefc28f73bfbed5b00a/603f101221397c8aee515d2e_feature-tile-annotations%402x.png",
      reviewed: "30 September 2026",
      detail:
        "No dedicated pixel-redaction control in the published toolbar; drawing over content is not verified masking.",
      basis: "scope",
    },
    stickers: {
      status: "no",
      url: "https://cdn.prod.website-files.com/5f348cefc28f73bfbed5b00a/603f101221397c8aee515d2e_feature-tile-annotations%402x.png",
      reviewed: "30 September 2026",
      detail:
        "Published screenshot toolbar has no stamp/sticker tool; comment reactions are separate.",
      basis: "scope",
    },
    localImages: {
      status: "no",
      url: "https://cdn.prod.website-files.com/5f348cefc28f73bfbed5b00a/603f101221397c8aee515d2e_feature-tile-annotations%402x.png",
      reviewed: "30 September 2026",
      detail:
        "Published screenshot editor has no image-layer insertion or resize tool; file attachments are separate.",
      basis: "scope",
    },
    cropExport: {
      status: "unknown",
      url: "https://cdn.prod.website-files.com/5f348cefc28f73bfbed5b00a/603f101221397c8aee515d2e_feature-tile-annotations%402x.png",
      reviewed: "30 September 2026",
      detail:
        "Published annotation toolbar illustrates Save/Cancel. It does not settle whether separate cropped-image export exists elsewhere in the product.",
      basis: "scope",
    },
    rasterExport: {
      status: "partial",
      url: "https://updates.bugherd.com/release/Jfp4G-react-to-a-comment-view-attachments-plus-4-shortcuts-to-speed-up-task-creation",
      reviewed: "30 September 2026",
      detail:
        "Images can be downloaded; selectable PNG, JPEG and WebP conversion is not established.",
      basis: "documentation",
    },
    pdfExport: {
      status: "no",
      url: "https://bugherd.com/pricing",
      reviewed: "30 September 2026",
      detail:
        "Documented native data exports are CSV, XML and JSON, not a multipage PDF.",
      basis: "scope",
    },
    clipboard: {
      status: "unknown",
      url: "https://cdn.prod.website-files.com/5f348cefc28f73bfbed5b00a/603f101221397c8aee515d2e_feature-tile-annotations%402x.png",
      reviewed: "30 September 2026",
      detail:
        "Published annotation toolbar saves to tasks; other annotated-image clipboard/export surfaces are not specified.",
      basis: "scope",
    },
    video: {
      status: "yes",
      url: "https://support.bugherd.com/en/articles/11424269-how-do-i-give-feedback-or-log-a-bug",
      reviewed: "30 September 2026",
      detail: "Records screen, window or tab feedback, with a one-minute countdown.",
      basis: "documentation",
    },
    tabAudio: {
      status: "unknown",
      url: "https://support.bugherd.com/en/articles/11424269-how-do-i-give-feedback-or-log-a-bug",
      reviewed: "30 September 2026",
      detail:
        "Microphone audio is explicit; capture of the tab’s own audio is unspecified.",
      basis: "scope",
    },
    microphone: {
      status: "yes",
      url: "https://support.bugherd.com/en/articles/11424269-how-do-i-give-feedback-or-log-a-bug",
      reviewed: "30 September 2026",
      detail: "Requests microphone permission for narrated feedback.",
      basis: "documentation",
    },
    pauseVideo: {
      status: "unknown",
      url: "https://support.bugherd.com/en/articles/11424269-how-do-i-give-feedback-or-log-a-bug",
      reviewed: "30 September 2026",
      detail: "Start and stop are documented; pause/resume behavior is not established.",
      basis: "scope",
    },
    trimVideo: {
      status: "no",
      url: "https://support.bugherd.com/en/articles/11424269-how-do-i-give-feedback-or-log-a-bug",
      reviewed: "30 September 2026",
      detail:
        "Documented recording flow goes from Stop to Create Task, with no trimming stage.",
      basis: "scope",
    },
    cropVideo: {
      status: "no",
      url: "https://support.bugherd.com/en/articles/11424269-how-do-i-give-feedback-or-log-a-bug",
      reviewed: "30 September 2026",
      detail:
        "Documented recording flow selects a capture surface, then submits; it has no frame-cropping stage.",
      basis: "scope",
    },
    replay: {
      status: "external",
      url: "https://support.bugherd.com/en/articles/11430571-bugherd-and-logrocket-integration",
      reviewed: "30 September 2026",
      detail: "Links a LogRocket session when LogRocket is already installed.",
      basis: "documentation",
    },
    timeline: {
      status: "external",
      url: "https://support.bugherd.com/en/articles/11430571-bugherd-and-logrocket-integration",
      reviewed: "30 September 2026",
      detail:
        "Diagnostic replay is opened through LogRocket; no native shared video/diagnostic timeline is established.",
      basis: "scope",
    },
    frameAnnotations: {
      status: "no",
      url: "https://support.bugherd.com/en/articles/11424269-how-do-i-give-feedback-or-log-a-bug",
      reviewed: "30 September 2026",
      detail:
        "Video feedback is one task attachment; the documented workflow has no timestamped frame-annotation editor.",
      basis: "scope",
    },
    threadBundle: {
      status: "partial",
      url: "https://support.bugherd.com/en/articles/11430562-how-to-export-your-bugs-from-bugherd",
      reviewed: "30 September 2026",
      detail:
        "Project export exists; the guide does not establish a complete archive with embedded media.",
      basis: "documentation",
    },
    diagnostics: {
      status: "external",
      url: "https://bugherd.com/cp/marker-alternative",
      reviewed: "30 September 2026",
      detail:
        "Dedicated comparison identifies LogRocket for console logs; a general blog contradicts native availability.",
      basis: "documentation",
    },
    discussion: {
      status: "yes",
      url: "https://support.bugherd.com/en/articles/11430545-bugherd-zapier-triggers-action-api-references",
      reviewed: "30 September 2026",
      detail: "Tasks have separate comments and author metadata.",
      basis: "documentation",
    },
    mcp: {
      status: "yes",
      url: "https://support.bugherd.com/en/articles/14835206-getting-started-with-the-bugherd-mcp-server",
      reviewed: "30 September 2026",
      detail:
        "Official authenticated MCP reads and updates projects, tasks, comments and attachments.",
      basis: "documentation",
    },
    agentContext: {
      status: "yes",
      url: "https://support.bugherd.com/en/articles/14835206-getting-started-with-the-bugherd-mcp-server",
      reviewed: "30 September 2026",
      detail:
        "Task context includes screenshots/recordings, page URL, selector and browser details.",
      basis: "documentation",
    },
    expertise: {
      status: "no",
      url: "https://support.bugherd.com/en/articles/14835206-getting-started-with-the-bugherd-mcp-server",
      reviewed: "30 September 2026",
      detail:
        "The complete MCP tool inventory has no owner-approved weighted reviewer-guidance capability.",
      basis: "scope",
    },
    github: {
      status: "yes",
      url: "https://support.bugherd.com/en/articles/11430519-bugherd-and-github-integration",
      reviewed: "30 September 2026",
      detail: "Creates GitHub issues from BugHerd tasks and forwards task updates.",
      basis: "documentation",
    },
    multiRepo: {
      status: "no",
      url: "https://support.bugherd.com/en/articles/11430519-bugherd-and-github-integration",
      reviewed: "30 September 2026",
      detail: "The native integration nominates one repository for each BugHerd project.",
      basis: "scope",
    },
    projectContext: {
      status: "no",
      url: "https://support.bugherd.com/en/articles/14835206-getting-started-with-the-bugherd-mcp-server",
      reviewed: "30 September 2026",
      detail:
        "MCP project settings/assets do not provide a versioned project-guidance contract.",
      basis: "scope",
    },
    source: {
      status: "no",
      url: "https://bugherd.com/terms",
      reviewed: "30 September 2026",
      detail:
        "The complete platform is proprietary, with modification and reverse-engineering restrictions.",
      basis: "explicit",
    },
    selfHost: {
      status: "no",
      url: "https://bugherd.com/terms",
      reviewed: "30 September 2026",
      detail:
        "Offered as access to Splitrock’s proprietary web platform, not a deployable whole-service edition.",
      basis: "scope",
    },
    independent: {
      status: "no",
      url: "https://bugherd.com/terms",
      reviewed: "30 September 2026",
      detail:
        "A subscribing customer account is required, although invited clients can submit without accounts.",
      basis: "explicit",
    },
    storage: {
      status: "no",
      url: "https://bugherd.com/terms",
      reviewed: "30 September 2026",
      detail: "The hosted subscription has no no-fee self-hosted S3 deployment.",
      basis: "scope",
    },
    apacheLicense: {
      status: "no",
      url: "https://bugherd.com/terms",
      reviewed: "30 September 2026",
      detail:
        "The proprietary service license is not Apache-2.0 for the complete product.",
      basis: "explicit",
    },
    allFeaturesFree: {
      status: "no",
      url: "https://bugherd.com/pricing",
      reviewed: "30 September 2026",
      detail:
        "Paid subscriptions follow the free trial; higher-tier capabilities remain plan-gated.",
      basis: "explicit",
    },
    multiApps: {
      status: "no",
      url: "https://support.bugherd.com/en/articles/11430519-bugherd-and-github-integration",
      reviewed: "30 September 2026",
      detail:
        "Hosted account authorization configures the integration, not multiple operator-owned GitHub App credentials.",
      basis: "scope",
    },
    agentQueue: {
      status: "yes",
      url: "https://support.bugherd.com/en/articles/14835206-getting-started-with-the-bugherd-mcp-server",
      reviewed: "30 September 2026",
      detail: "MCP exposes assigned tasks, severity and assignees for agent triage.",
      basis: "documentation",
    },
    sessionOnly: {
      status: "external",
      url: "https://support.bugherd.com/en/articles/11430571-bugherd-and-logrocket-integration",
      reviewed: "30 September 2026",
      detail:
        "LogRocket supplies session capture without recording a BugHerd feedback video.",
      basis: "documentation",
    },
    screenshotDiagnostics: {
      status: "no",
      url: "https://support.bugherd.com/en/articles/11430545-bugherd-zapier-triggers-action-api-references",
      reviewed: "30 September 2026",
      detail:
        "Task evidence contains screenshots, environment fields and custom data, not a native DOM/console/network bundle.",
      basis: "scope",
    },
    nativeClients: {
      status: "no",
      url: "https://support.bugherd.com/en/articles/11430635-can-i-use-bugherd-to-test-a-native-app",
      reviewed: "30 September 2026",
      detail:
        "Official guidance explicitly limits BugHerd to websites/web apps, not native mobile apps.",
      basis: "explicit",
    },
  },
};
