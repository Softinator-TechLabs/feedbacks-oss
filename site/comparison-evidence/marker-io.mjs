export default {
  reviewed: "30 September 2026",
  scope:
    "Current Marker.io hosted service, website widget, browser extensions, documented React Native beta and official MCP. Legacy editor release notes are used only for explicitly shipped annotation capabilities.",
  summary:
    "Official MCP, full-page screenshots, replay and developer logs are available. Native screen recording is explicitly not built in; replay and uploaded videos must not be counted as its recorder. Mobile support currently means a React Native beta, with native Swift/Kotlin still unshipped.",
  sources: [
    {
      url: "https://help.marker.io/en/articles/6495644-browser-extensions",
      title: "Browser extensions and full-page capture",
      reviewed: "30 September 2026",
    },
    {
      url: "https://help.marker.io/en/articles/11588554-how-to-report-an-issue",
      title: "Issue reporting workflow",
      reviewed: "30 September 2026",
    },
    {
      url: "https://help.marker.io/en/articles/6559060-issue-page",
      title: "Issue page and collaboration",
      reviewed: "30 September 2026",
    },
    {
      url: "https://marker.io/blog/new-annotation-tools",
      title: "Shipped annotation tools: pen, shapes, text, emoji, blur and images",
      reviewed: "30 September 2026",
    },
    {
      url: "https://chromewebstore.google.com/detail/markerio-visual-bug-repor/jofhoojcehdmaiibilpcoofpdbbddkkl?hl=en",
      title: "Publisher’s Chrome extension description",
      reviewed: "30 September 2026",
    },
    {
      url: "https://help.marker.io/en/articles/4406960-forms",
      title: "Saved form defaults and presets",
      reviewed: "30 September 2026",
    },
    {
      url: "https://help.marker.io/en/articles/9657817-sensitive-data-masking",
      title: "Enterprise sensitive-data masking",
      reviewed: "30 September 2026",
    },
    {
      url: "https://help.marker.io/en/articles/6523327-managing-your-workspace",
      title: "Workspace issue history and screenshot downloads",
      reviewed: "30 September 2026",
    },
    {
      url: "https://help.marker.io/en/articles/952693-how-to-record-videos-or-gifs",
      title: "Explicit screen-recording limitation and external uploads",
      reviewed: "30 September 2026",
    },
    {
      url: "https://help.marker.io/en/articles/6673880-session-replay-videos",
      title: "Session Replay Videos",
      reviewed: "30 September 2026",
    },
    {
      url: "https://help.marker.io/en/articles/1669763-console-logs",
      title: "Console log capture",
      reviewed: "30 September 2026",
    },
    {
      url: "https://help.marker.io/en/articles/14430683-why-are-console-logs-network-requests-and-replays-linked-instead-of-attached",
      title: "Diagnostic data links versus attachments",
      reviewed: "30 September 2026",
    },
    {
      url: "https://help.marker.io/en/articles/14034657-mcp-integration-model-context-protocol",
      title: "Official MCP inventory: 33 tools",
      reviewed: "30 September 2026",
    },
    {
      url: "https://help.marker.io/en/articles/6442000-github-integration",
      title: "GitHub target and synchronization",
      reviewed: "30 September 2026",
    },
    {
      url: "https://marker.io/terms",
      title: "Cloud service terms and use restrictions",
      reviewed: "30 September 2026",
    },
    {
      url: "https://help.marker.io/en/articles/12383990-data-privacy-security-overview",
      title: "Cloud hosting and data storage architecture",
      reviewed: "30 September 2026",
    },
    {
      url: "https://help.marker.io/en/articles/16000817-mobile-sdk-overview",
      title: "Mobile SDK beta availability and limits",
      reviewed: "30 September 2026",
    },
  ],
  cells: {
    extension: {
      status: "yes",
      url: "https://help.marker.io/en/articles/6495644-browser-extensions",
      reviewed: "30 September 2026",
      detail: "Chrome, Firefox and Edge extensions capture and submit website issues.",
      basis: "documentation",
    },
    screenshots: {
      status: "yes",
      url: "https://help.marker.io/en/articles/11588554-how-to-report-an-issue",
      reviewed: "30 September 2026",
      detail: "Screenshot capture is part of the native issue-reporting flow.",
      basis: "documentation",
    },
    fullPage: {
      status: "yes",
      url: "https://help.marker.io/en/articles/6495644-browser-extensions",
      reviewed: "30 September 2026",
      detail: "Browser extension offers full-page and desktop capture.",
      basis: "documentation",
    },
    pins: {
      status: "partial",
      url: "https://help.marker.io/en/articles/11588554-how-to-report-an-issue",
      reviewed: "30 September 2026",
      detail:
        "Marks locations on captured screenshots; persistent element-anchored page pins are not the documented workflow.",
      basis: "scope",
    },
    originals: {
      status: "partial",
      url: "https://help.marker.io/en/articles/6559060-issue-page",
      reviewed: "30 September 2026",
      detail:
        "A screenshot belongs to each issue; subsequent discussion replies do not automatically capture fresh screenshots.",
      basis: "scope",
    },
    drafts: {
      status: "no",
      url: "https://help.marker.io/en/articles/11588554-how-to-report-an-issue",
      reviewed: "30 September 2026",
      detail:
        "Native flow annotates and submits one issue; it is not a local collection of unsent review points.",
      basis: "scope",
    },
    resolved: {
      status: "yes",
      url: "https://help.marker.io/en/articles/6559060-issue-page",
      reviewed: "30 September 2026",
      detail: "Individual issues can be resolved and reopened.",
      basis: "documentation",
    },
    reviewDefaults: {
      status: "partial",
      url: "https://help.marker.io/en/articles/4406960-forms",
      reviewed: "30 September 2026",
      detail:
        "Stores form presets and default values; there is no built-in recording preset because no recorder exists.",
      basis: "documentation",
    },
    textSuggestions: {
      status: "no",
      url: "https://help.marker.io/en/articles/11588554-how-to-report-an-issue",
      reviewed: "30 September 2026",
      detail:
        "The documented screenshot/form reporting flow annotates images and issue fields; it does not retain a selected-DOM-text original/replacement pair.",
      basis: "scope",
    },
    drawing: {
      status: "yes",
      url: "https://marker.io/blog/new-annotation-tools",
      reviewed: "30 September 2026",
      detail: "Pen, shapes, arrows and text annotations are documented.",
      basis: "documentation",
    },
    highlighter: {
      status: "partial",
      url: "https://chromewebstore.google.com/detail/markerio-visual-bug-repor/jofhoojcehdmaiibilpcoofpdbbddkkl?hl=en",
      reviewed: "30 September 2026",
      detail:
        "Publisher advertises highlighting; dedicated translucent-highlighter behavior is not specified.",
      basis: "documentation",
    },
    steps: {
      status: "unknown",
      url: "https://help.marker.io/en/articles/11588554-how-to-report-an-issue",
      reviewed: "30 September 2026",
      detail:
        "Current reporting guides list example annotation tools, not an exhaustive inventory. The 2018 update cannot rule out a current numbered-step tool.",
      basis: "scope",
    },
    blur: {
      status: "yes",
      url: "https://marker.io/blog/new-annotation-tools",
      reviewed: "30 September 2026",
      detail: "A native blur tool hides selected screenshot regions.",
      basis: "documentation",
    },
    redact: {
      status: "paid",
      url: "https://help.marker.io/en/articles/9657817-sensitive-data-masking",
      reviewed: "30 September 2026",
      detail:
        "Enterprise masking removes sensitive elements before screenshot/replay capture.",
      basis: "documentation",
    },
    stickers: {
      status: "yes",
      url: "https://marker.io/blog/new-annotation-tools",
      reviewed: "30 September 2026",
      detail: "Emoji annotation objects are documented.",
      basis: "documentation",
    },
    localImages: {
      status: "partial",
      url: "https://marker.io/blog/new-annotation-tools",
      reviewed: "30 September 2026",
      detail:
        "Images can be inserted into existing screenshots; move/resize behavior is not expressly documented.",
      basis: "documentation",
    },
    cropExport: {
      status: "yes",
      url: "https://chromewebstore.google.com/detail/markerio-visual-bug-repor/jofhoojcehdmaiibilpcoofpdbbddkkl?hl=en",
      reviewed: "30 September 2026",
      detail:
        "Publisher documents cropping captures; workspace history supports screenshot download.",
      basis: "documentation",
    },
    rasterExport: {
      status: "partial",
      url: "https://help.marker.io/en/articles/6523327-managing-your-workspace",
      reviewed: "30 September 2026",
      detail:
        "Screenshots can be downloaded; selection among PNG, JPEG and WebP is not established.",
      basis: "documentation",
    },
    pdfExport: {
      status: "no",
      url: "https://help.marker.io/en/articles/6523327-managing-your-workspace",
      reviewed: "30 September 2026",
      detail:
        "Native issue-history exports download individual screenshots, not a multipage annotated PDF.",
      basis: "scope",
    },
    clipboard: {
      status: "unknown",
      url: "https://marker.io/blog/new-annotation-tools",
      reviewed: "30 September 2026",
      detail:
        "Editor copy/paste shortcuts concern annotation elements; flattened-image clipboard export is unresolved.",
      basis: "scope",
    },
    video: {
      status: "no",
      url: "https://help.marker.io/en/articles/952693-how-to-record-videos-or-gifs",
      reviewed: "30 September 2026",
      detail:
        "Official help explicitly says built-in screen recording is not available; upload or link external videos instead.",
      basis: "explicit",
    },
    tabAudio: {
      status: "no",
      url: "https://help.marker.io/en/articles/952693-how-to-record-videos-or-gifs",
      reviewed: "30 September 2026",
      detail:
        "No native screen recorder; tab-audio capture therefore requires an external recording tool.",
      basis: "scope",
    },
    microphone: {
      status: "no",
      url: "https://help.marker.io/en/articles/952693-how-to-record-videos-or-gifs",
      reviewed: "30 September 2026",
      detail: "No native screen recorder; narration requires an external recording tool.",
      basis: "scope",
    },
    pauseVideo: {
      status: "no",
      url: "https://help.marker.io/en/articles/952693-how-to-record-videos-or-gifs",
      reviewed: "30 September 2026",
      detail: "There is no native recording session to pause or resume.",
      basis: "scope",
    },
    trimVideo: {
      status: "no",
      url: "https://help.marker.io/en/articles/952693-how-to-record-videos-or-gifs",
      reviewed: "30 September 2026",
      detail:
        "The native workflow accepts externally recorded videos; it does not provide a recording editor.",
      basis: "scope",
    },
    cropVideo: {
      status: "no",
      url: "https://help.marker.io/en/articles/952693-how-to-record-videos-or-gifs",
      reviewed: "30 September 2026",
      detail:
        "The native workflow accepts externally recorded videos, without a frame-cropping editor.",
      basis: "scope",
    },
    replay: {
      status: "paid",
      url: "https://help.marker.io/en/articles/6673880-session-replay-videos",
      reviewed: "30 September 2026",
      detail: "Team plan and above capture roughly 2.5 minutes preceding an issue.",
      basis: "documentation",
    },
    timeline: {
      status: "partial",
      url: "https://help.marker.io/en/articles/6559060-issue-page",
      reviewed: "30 September 2026",
      detail:
        "Replay and console/network context share an issue; synchronized diagnostic scrubbing is not established.",
      basis: "documentation",
    },
    frameAnnotations: {
      status: "no",
      url: "https://help.marker.io/en/articles/952693-how-to-record-videos-or-gifs",
      reviewed: "30 September 2026",
      detail:
        "External video attachment workflow does not provide timestamped annotated-frame editing.",
      basis: "scope",
    },
    threadBundle: {
      status: "partial",
      url: "https://help.marker.io/en/articles/14430683-why-are-console-logs-network-requests-and-replays-linked-instead-of-attached",
      reviewed: "30 September 2026",
      detail:
        "Screenshot attaches, while logs, replay and further attachments remain hosted links; not a complete portable media archive.",
      basis: "documentation",
    },
    diagnostics: {
      status: "yes",
      url: "https://help.marker.io/en/articles/1669763-console-logs",
      reviewed: "30 September 2026",
      detail:
        "Captures browser console output, errors and rejected promises with submitted issues.",
      basis: "documentation",
    },
    discussion: {
      status: "yes",
      url: "https://help.marker.io/en/articles/6559060-issue-page",
      reviewed: "30 September 2026",
      detail: "Issue pages support discussion, mentions and attachments.",
      basis: "documentation",
    },
    mcp: {
      status: "yes",
      url: "https://help.marker.io/en/articles/14034657-mcp-integration-model-context-protocol",
      reviewed: "30 September 2026",
      detail: "Official authenticated MCP exposes 33 tools.",
      basis: "documentation",
    },
    agentContext: {
      status: "yes",
      url: "https://help.marker.io/en/articles/14034657-mcp-integration-model-context-protocol",
      reviewed: "30 September 2026",
      detail:
        "Tools return screenshot/attachment URLs and detailed console/network context.",
      basis: "documentation",
    },
    expertise: {
      status: "no",
      url: "https://help.marker.io/en/articles/14034657-mcp-integration-model-context-protocol",
      reviewed: "30 September 2026",
      detail:
        "Complete MCP inventory has no owner-approved weighted reviewer-guidance facility.",
      basis: "scope",
    },
    github: {
      status: "yes",
      url: "https://help.marker.io/en/articles/6442000-github-integration",
      reviewed: "30 September 2026",
      detail:
        "Native integration creates GitHub issues and synchronizes supported fields/status.",
      basis: "documentation",
    },
    multiRepo: {
      status: "no",
      url: "https://help.marker.io/en/articles/6442000-github-integration",
      reviewed: "30 September 2026",
      detail:
        "Native project setup selects one GitHub target; multiple repositories require separate projects.",
      basis: "scope",
    },
    projectContext: {
      status: "no",
      url: "https://help.marker.io/en/articles/14034657-mcp-integration-model-context-protocol",
      reviewed: "30 September 2026",
      detail:
        "Project and monitoring tools do not implement versioned agent-guidance documents.",
      basis: "scope",
    },
    source: {
      status: "no",
      url: "https://marker.io/terms",
      reviewed: "30 September 2026",
      detail:
        "Complete service has proprietary access rights and prohibits source extraction/derivative works.",
      basis: "explicit",
    },
    selfHost: {
      status: "no",
      url: "https://marker.io/terms",
      reviewed: "30 September 2026",
      detail:
        "Contract defines the product as a cloud-based service, not a whole-service self-hosted distribution.",
      basis: "scope",
    },
    independent: {
      status: "no",
      url: "https://marker.io/terms",
      reviewed: "30 September 2026",
      detail:
        "Service use requires the customer’s Marker.io account and subscription access.",
      basis: "explicit",
    },
    storage: {
      status: "no",
      url: "https://help.marker.io/en/articles/12383990-data-privacy-security-overview",
      reviewed: "30 September 2026",
      detail:
        "Marker.io hosts customer data; no no-fee self-hosted S3 deployment is offered in this architecture.",
      basis: "scope",
    },
    apacheLicense: {
      status: "no",
      url: "https://marker.io/terms",
      reviewed: "30 September 2026",
      detail: "The complete service is governed by proprietary terms, not Apache-2.0.",
      basis: "explicit",
    },
    allFeaturesFree: {
      status: "no",
      url: "https://marker.io/terms",
      reviewed: "30 September 2026",
      detail: "Subscription access and plan restrictions apply to the service.",
      basis: "explicit",
    },
    multiApps: {
      status: "no",
      url: "https://help.marker.io/en/articles/6442000-github-integration",
      reviewed: "30 September 2026",
      detail:
        "Account-authorized hosted integration is not operator configuration of several GitHub Apps on one server.",
      basis: "scope",
    },
    agentQueue: {
      status: "partial",
      url: "https://help.marker.io/en/articles/14034657-mcp-integration-model-context-protocol",
      reviewed: "30 September 2026",
      detail:
        "MCP lists issues with priority/status filters and manages assignees; an assigned-to list filter is not documented.",
      basis: "documentation",
    },
    sessionOnly: {
      status: "paid",
      url: "https://help.marker.io/en/articles/6673880-session-replay-videos",
      reviewed: "30 September 2026",
      detail: "Session replay works without recording a feedback video.",
      basis: "documentation",
    },
    screenshotDiagnostics: {
      status: "partial",
      url: "https://help.marker.io/en/articles/14430683-why-are-console-logs-network-requests-and-replays-linked-instead-of-attached",
      reviewed: "30 September 2026",
      detail:
        "Screenshots and console/network evidence are linked together, not delivered as a self-contained DOM/diagnostic bundle.",
      basis: "documentation",
    },
    nativeClients: {
      status: "partial",
      url: "https://help.marker.io/en/articles/16000817-mobile-sdk-overview",
      reviewed: "30 September 2026",
      detail:
        "React Native beta supports mobile feedback; standalone Swift/Kotlin SDKs are listed as not yet available.",
      basis: "documentation",
    },
  },
};
