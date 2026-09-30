export default {
  reviewed: "30 September 2026",
  scope:
    "Usersnap cloud platform, official screenshot/video widgets and extensions, gated mobile SDK and official MCP. Third-party replay integrations are marked external. Export scope distinguishes JSON/CSV records from embedded media and diagnostics.",
  summary:
    "Usersnap supports annotated screenshots, narrated screen recordings, gated browser logs and native mobile feedback forms. MCP reads feedback and creates Opportunities but explicitly cannot edit raw feedback. Whole-service self-hosting is explicitly unavailable.",
  sources: [
    {
      url: "https://help.usersnap.com/docs/track-browser-extensions",
      title: "Browser extension capture and recording limits",
      reviewed: "30 September 2026",
    },
    {
      url: "https://help.usersnap.com/docs/feedback-with-a-screenshot",
      title: "Screenshot modes and complete five-tool annotation inventory",
      reviewed: "30 September 2026",
    },
    {
      url: "https://help.usersnap.com/docs/feedback-with-a-screen-recording",
      title: "Screen recording and microphone restrictions",
      reviewed: "30 September 2026",
    },
    {
      url: "https://help.usersnap.com/docs/development-faq",
      title: "Screenshot dimensions, DOM rendering and explicit cloud-only service",
      reviewed: "30 September 2026",
    },
    {
      url: "https://help.usersnap.com/docs/feedback-restored",
      title: "Feedback statuses, comments, attachments and priorities",
      reviewed: "30 September 2026",
    },
    {
      url: "https://help.usersnap.com/docs/settings-overview",
      title: "Project settings and default assignee",
      reviewed: "30 September 2026",
    },
    {
      url: "https://help.usersnap.com/docs/export-your-project",
      title: "Gated JSON and CSV export fields and limits",
      reviewed: "30 September 2026",
    },
    {
      url: "https://help.usersnap.com/docs/console-recorder-feature",
      title: "Console and XHR/Fetch capture with export restriction",
      reviewed: "30 September 2026",
    },
    {
      url: "https://help.usersnap.com/docs/integrate-with-quantum-metric",
      title: "Quantum Metric session replay integration",
      reviewed: "30 September 2026",
    },
    {
      url: "https://help.usersnap.com/docs/mcp-connector",
      title: "Official MCP scope and read-only feedback limitations",
      reviewed: "30 September 2026",
    },
    {
      url: "https://help.usersnap.com/docs/github",
      title: "GitHub integration configuration",
      reviewed: "30 September 2026",
    },
    {
      url: "https://help.usersnap.com/docs/3rd-party-integrations-customer-feedback-projects",
      title: "Multiple integrations per project",
      reviewed: "30 September 2026",
    },
    {
      url: "https://usersnap.com/terms-of-service",
      title: "Usersnap hosted service terms",
      reviewed: "30 September 2026",
    },
    {
      url: "https://usersnap.com/security",
      title: "Vendor-managed infrastructure",
      reviewed: "30 September 2026",
    },
    {
      url: "https://usersnap.com/pricing",
      title: "Current plan limits and free feedback allowance",
      reviewed: "30 September 2026",
    },
    {
      url: "https://help.usersnap.com/docs/collecting-customer-feedback-on-mobile-apps-beta",
      title: "iOS/Android SDK forms and explicit screen-capture limitation",
      reviewed: "30 September 2026",
    },
  ],
  cells: {
    extension: {
      status: "yes",
      url: "https://help.usersnap.com/docs/track-browser-extensions",
      reviewed: "30 September 2026",
      detail: "Official extensions capture feedback in Chrome and Firefox.",
      basis: "documentation",
    },
    screenshots: {
      status: "yes",
      url: "https://help.usersnap.com/docs/feedback-with-a-screenshot",
      reviewed: "30 September 2026",
      detail: "Widget captures screenshots with optional or required annotation.",
      basis: "documentation",
    },
    fullPage: {
      status: "unknown",
      url: "https://help.usersnap.com/docs/development-faq",
      reviewed: "30 September 2026",
      detail:
        "Screenshot size limits are documented, but full-scroll capture is not established; “full-page collector” means a form.",
      basis: "scope",
    },
    pins: {
      status: "partial",
      url: "https://help.usersnap.com/docs/feedback-with-a-screenshot",
      reviewed: "30 September 2026",
      detail:
        "Comments annotate screenshot regions; persistent live-page element pins are not the documented capture model.",
      basis: "scope",
    },
    originals: {
      status: "partial",
      url: "https://help.usersnap.com/docs/feedback-restored",
      reviewed: "30 September 2026",
      detail:
        "Feedback holds a screenshot with multiple annotation comments; replies do not each capture a fresh image.",
      basis: "scope",
    },
    drafts: {
      status: "no",
      url: "https://help.usersnap.com/docs/feedback-with-a-screenshot",
      reviewed: "30 September 2026",
      detail:
        "Widget submits one annotated feedback item, not a persistent local multi-point review collection.",
      basis: "scope",
    },
    resolved: {
      status: "partial",
      url: "https://help.usersnap.com/docs/feedback-restored",
      reviewed: "30 September 2026",
      detail:
        "Feedback items have independent status; individual annotations within one screenshot are not separate resolvable items.",
      basis: "documentation",
    },
    reviewDefaults: {
      status: "partial",
      url: "https://help.usersnap.com/docs/settings-overview",
      reviewed: "30 September 2026",
      detail:
        "Saves project assignee and console-recording settings; per-review recording presets are not established.",
      basis: "documentation",
    },
    textSuggestions: {
      status: "no",
      url: "https://help.usersnap.com/docs/feedback-with-a-screenshot",
      reviewed: "30 September 2026",
      detail:
        "Five-tool screenshot editor adds comments, not selected-DOM-text replacement suggestions.",
      basis: "scope",
    },
    drawing: {
      status: "partial",
      url: "https://help.usersnap.com/docs/feedback-with-a-screenshot",
      reviewed: "30 September 2026",
      detail:
        "Pen, arrows and comment labels are documented; a general shapes/text-layer editor is not.",
      basis: "documentation",
    },
    highlighter: {
      status: "yes",
      url: "https://help.usersnap.com/docs/feedback-with-a-screenshot",
      reviewed: "30 September 2026",
      detail: "Highlight is an explicit annotation tool.",
      basis: "documentation",
    },
    steps: {
      status: "no",
      url: "https://help.usersnap.com/docs/feedback-with-a-screenshot",
      reviewed: "30 September 2026",
      detail: "Complete five-tool annotation inventory contains no numbered-step tool.",
      basis: "scope",
    },
    blur: {
      status: "no",
      url: "https://help.usersnap.com/docs/feedback-with-a-screenshot",
      reviewed: "30 September 2026",
      detail: "Editor offers Hide rather than a blur tool.",
      basis: "scope",
    },
    redact: {
      status: "yes",
      url: "https://help.usersnap.com/docs/feedback-with-a-screenshot",
      reviewed: "30 September 2026",
      detail: "Hide masks sensitive screenshot areas.",
      basis: "documentation",
    },
    stickers: {
      status: "no",
      url: "https://help.usersnap.com/docs/feedback-with-a-screenshot",
      reviewed: "30 September 2026",
      detail: "The complete annotation inventory has no stamps or stickers.",
      basis: "scope",
    },
    localImages: {
      status: "no",
      url: "https://help.usersnap.com/docs/feedback-with-a-screenshot",
      reviewed: "30 September 2026",
      detail: "The five-tool editor has no movable/resizable image-layer insertion.",
      basis: "scope",
    },
    cropExport: {
      status: "no",
      url: "https://help.usersnap.com/docs/feedback-with-a-screenshot",
      reviewed: "30 September 2026",
      detail:
        "Documented screenshot editor annotates and submits, without an export-cropping control.",
      basis: "scope",
    },
    rasterExport: {
      status: "partial",
      url: "https://help.usersnap.com/docs/export-your-project",
      reviewed: "30 September 2026",
      detail:
        "Structured exports reference screenshot media; PNG/JPEG/WebP format selection is not documented.",
      basis: "documentation",
    },
    pdfExport: {
      status: "no",
      url: "https://help.usersnap.com/docs/export-your-project",
      reviewed: "30 September 2026",
      detail: "Native project export provides JSON and CSV, not a multipage PDF.",
      basis: "scope",
    },
    clipboard: {
      status: "no",
      url: "https://help.usersnap.com/docs/feedback-with-a-screenshot",
      reviewed: "30 September 2026",
      detail:
        "Documented widget editor submits feedback; its tool inventory has no annotated-image clipboard export.",
      basis: "scope",
    },
    video: {
      status: "yes",
      url: "https://help.usersnap.com/docs/feedback-with-a-screen-recording",
      reviewed: "30 September 2026",
      detail: "Records up to three minutes of screen, window or browser-tab feedback.",
      basis: "documentation",
    },
    tabAudio: {
      status: "unknown",
      url: "https://help.usersnap.com/docs/feedback-with-a-screen-recording",
      reviewed: "30 September 2026",
      detail:
        "Microphone audio is specified; the tab’s own audio track is not established.",
      basis: "scope",
    },
    microphone: {
      status: "yes",
      url: "https://help.usersnap.com/docs/feedback-with-a-screen-recording",
      reviewed: "30 September 2026",
      detail: "Users can allow microphone narration.",
      basis: "documentation",
    },
    pauseVideo: {
      status: "unknown",
      url: "https://help.usersnap.com/docs/feedback-with-a-screen-recording",
      reviewed: "30 September 2026",
      detail:
        "Recording guide does not establish pause/resume controls; project pause is unrelated.",
      basis: "scope",
    },
    trimVideo: {
      status: "no",
      url: "https://help.usersnap.com/docs/feedback-with-a-screen-recording",
      reviewed: "30 September 2026",
      detail:
        "Native workflow records then submits for dashboard playback; it contains no video-trimming stage.",
      basis: "scope",
    },
    cropVideo: {
      status: "no",
      url: "https://help.usersnap.com/docs/feedback-with-a-screen-recording",
      reviewed: "30 September 2026",
      detail:
        "Native recording workflow selects screen/window/tab and submits, without a frame-cropping stage.",
      basis: "scope",
    },
    replay: {
      status: "external",
      url: "https://help.usersnap.com/docs/integrate-with-quantum-metric",
      reviewed: "30 September 2026",
      detail: "Connects feedback to an existing Quantum Metric session replay.",
      basis: "documentation",
    },
    timeline: {
      status: "partial",
      url: "https://help.usersnap.com/docs/console-recorder-feature",
      reviewed: "30 September 2026",
      detail:
        "Console/network details accompany feedback separately; synchronized native video/diagnostic scrubbing is not established.",
      basis: "documentation",
    },
    frameAnnotations: {
      status: "no",
      url: "https://help.usersnap.com/docs/feedback-with-a-screen-recording",
      reviewed: "30 September 2026",
      detail:
        "Documented feedback recording produces a playable submission, without a timestamped frame-annotation editor.",
      basis: "scope",
    },
    threadBundle: {
      status: "partial",
      url: "https://help.usersnap.com/docs/export-your-project",
      reviewed: "30 September 2026",
      detail:
        "JSON includes feedback/comments and media URLs, while CSV omits several fields; not an embedded-media archive.",
      basis: "documentation",
    },
    diagnostics: {
      status: "paid",
      url: "https://help.usersnap.com/docs/console-recorder-feature",
      reviewed: "30 September 2026",
      detail:
        "Gated widget feature captures console errors and XHR/Fetch; extensions and mobile are excluded.",
      basis: "documentation",
    },
    discussion: {
      status: "yes",
      url: "https://help.usersnap.com/docs/feedback-restored",
      reviewed: "30 September 2026",
      detail: "Team notes, user replies and conversation attachments are supported.",
      basis: "documentation",
    },
    mcp: {
      status: "yes",
      url: "https://help.usersnap.com/docs/mcp-connector",
      reviewed: "30 September 2026",
      detail:
        "Official MCP queries feedback and creates Opportunities with existing-user permissions.",
      basis: "documentation",
    },
    agentContext: {
      status: "partial",
      url: "https://help.usersnap.com/docs/mcp-connector",
      reviewed: "30 September 2026",
      detail:
        "Feedback context is available; screenshot pixels or full page/diagnostic retrieval are not specified.",
      basis: "documentation",
    },
    expertise: {
      status: "no",
      url: "https://help.usersnap.com/docs/mcp-connector",
      reviewed: "30 September 2026",
      detail:
        "Documented connector scope reads feedback and creates Opportunities, without weighted reviewer guidance.",
      basis: "scope",
    },
    github: {
      status: "yes",
      url: "https://help.usersnap.com/docs/github",
      reviewed: "30 September 2026",
      detail: "Native integration forwards feedback into GitHub issues.",
      basis: "documentation",
    },
    multiRepo: {
      status: "unknown",
      url: "https://help.usersnap.com/docs/3rd-party-integrations-customer-feedback-projects",
      reviewed: "30 September 2026",
      detail:
        "Projects can add integrations, but repeated GitHub connections or multiple repositories per project are not specified.",
      basis: "scope",
    },
    projectContext: {
      status: "no",
      url: "https://help.usersnap.com/docs/mcp-connector",
      reviewed: "30 September 2026",
      detail: "Connector scope has no versioned agent-guidance document capability.",
      basis: "scope",
    },
    source: {
      status: "no",
      url: "https://usersnap.com/terms-of-service",
      reviewed: "30 September 2026",
      detail:
        "The complete hosted service is licensed for access, not distributed as public server source.",
      basis: "scope",
    },
    selfHost: {
      status: "no",
      url: "https://help.usersnap.com/docs/development-faq",
      reviewed: "30 September 2026",
      detail:
        "Official FAQ explicitly says the app/dashboard cannot run on the customer’s servers.",
      basis: "explicit",
    },
    independent: {
      status: "no",
      url: "https://usersnap.com/terms-of-service",
      reviewed: "30 September 2026",
      detail:
        "Running the product requires a Usersnap service account; anonymous feedback submission is different.",
      basis: "scope",
    },
    storage: {
      status: "no",
      url: "https://help.usersnap.com/docs/development-faq",
      reviewed: "30 September 2026",
      detail: "Cloud-only platform cannot supply a no-fee self-hosted S3 deployment.",
      basis: "explicit",
    },
    apacheLicense: {
      status: "no",
      url: "https://usersnap.com/terms-of-service",
      reviewed: "30 September 2026",
      detail:
        "Complete service uses commercial service terms, not an Apache-2.0 product license.",
      basis: "scope",
    },
    allFeaturesFree: {
      status: "no",
      url: "https://usersnap.com/pricing",
      reviewed: "30 September 2026",
      detail: "Free allowance is limited; paid plans and gated capabilities apply.",
      basis: "explicit",
    },
    multiApps: {
      status: "no",
      url: "https://help.usersnap.com/docs/github",
      reviewed: "30 September 2026",
      detail:
        "Uses Usersnap’s authorized OAuth integration, not operator-managed multiple GitHub Apps on a server.",
      basis: "scope",
    },
    agentQueue: {
      status: "partial",
      url: "https://help.usersnap.com/docs/mcp-connector",
      reviewed: "30 September 2026",
      detail:
        "MCP can query feedback but cannot edit it; explicit assignee/priority queue filters are not documented.",
      basis: "documentation",
    },
    sessionOnly: {
      status: "external",
      url: "https://help.usersnap.com/docs/integrate-with-quantum-metric",
      reviewed: "30 September 2026",
      detail:
        "Quantum Metric supplies session history without a Usersnap screen recording.",
      basis: "documentation",
    },
    screenshotDiagnostics: {
      status: "partial",
      url: "https://help.usersnap.com/docs/console-recorder-feature",
      reviewed: "30 September 2026",
      detail:
        "Widget captures browser logs with screenshots, but explicitly cannot export logs as a portable bundle.",
      basis: "documentation",
    },
    nativeClients: {
      status: "paid",
      url: "https://help.usersnap.com/docs/collecting-customer-feedback-on-mobile-apps-beta",
      reviewed: "30 September 2026",
      detail:
        "Gated iOS/Android SDKs collect forms and metadata; screen capture and annotation are explicitly unsupported.",
      basis: "documentation",
    },
  },
};
