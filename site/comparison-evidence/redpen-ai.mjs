export default {
  reviewed: "30 September 2026",
  scope:
    "Hosted Redpen for Developers/Service, all published support/FAQ/API categories, current plans, capture workflow, independent session replay, diagnostic export and Android SDK; static inspection of current publicly deployed client annotation/control registries. No client code was executed or represented as open server source.",
  summary:
    "Native screenshots, narration, recording pause/resume, standalone replay, GitHub handoff and Android SDK are verified. Diagnostics are portable, but screenshot network logs are explicitly unsupported. Some image export and video-editing specifics remain uncertain despite extensive public-source review.",
  sources: [
    {
      url: "https://www.redpen.ai/faq",
      title: "Detailed Redpen product/integration FAQ",
      reviewed: "30 September 2026",
    },
    {
      url: "https://www.redpen.ai/support",
      title: "Complete Redpen help inventory",
      reviewed: "30 September 2026",
    },
    {
      url: "https://www.redpen.ai/pricing",
      title: "Current Basic/Standard/Enterprise entitlements",
      reviewed: "30 September 2026",
    },
    {
      url: "https://www.redpen.ai/docs/creating-the-first-issue-using-redpen",
      title: "Screenshot/video submission and issue workflow",
      reviewed: "30 September 2026",
    },
    {
      url: "https://www.redpen.ai/docs/session-replay",
      title: "Independent session replay and HTML download",
      reviewed: "30 September 2026",
    },
    {
      url: "https://www.redpen.ai/docs/viewing-diagnostic-information",
      title: "Diagnostics and explicit screenshot/network limits",
      reviewed: "30 September 2026",
    },
    {
      url: "https://www.redpen.ai/docs/pii-redaction",
      title: "Automatic PII masking",
      reviewed: "30 September 2026",
    },
    {
      url: "https://www.redpen.ai/docs/connect-redpen-to-github",
      title: "Native GitHub issue integration",
      reviewed: "30 September 2026",
    },
    {
      url: "https://www.redpen.ai/docs/redpen-widget-javascript-api",
      title: "Complete widget JavaScript API",
      reviewed: "30 September 2026",
    },
    {
      url: "https://www.redpen.ai/terms-of-service",
      title: "SaaS license and ownership terms",
      reviewed: "30 September 2026",
    },
    {
      url: "https://app.redpen.ai/main.f3cda96628072655025d.js",
      title: "Public deployed client annotation configuration and recording controls",
      reviewed: "30 September 2026",
    },
    {
      url: "https://www.redpen.ai/docs/integrate-redpen-android-sdk-into-your-application",
      title: "Native Android feedback SDK",
      reviewed: "30 September 2026",
    },
  ],
  cells: {
    extension: {
      status: "yes",
      url: "https://www.redpen.ai/faq",
      reviewed: "30 September 2026",
      detail: "Chrome, Safari and Edge capture extensions.",
      basis: "documentation",
    },
    screenshots: {
      status: "yes",
      url: "https://www.redpen.ai/docs/creating-the-first-issue-using-redpen",
      reviewed: "30 September 2026",
      detail: "Browser screenshot capture with issue attachments.",
      basis: "documentation",
    },
    fullPage: {
      status: "unknown",
      url: "https://www.redpen.ai/docs/creating-the-first-issue-using-redpen",
      reviewed: "30 September 2026",
      detail:
        "Capture guides establish browser/tab screenshots; neither complete scrolling capture nor a viewport-only limit is specified after checking FAQ, capture guides and client controls.",
      basis: "documentation",
    },
    pins: {
      status: "no",
      url: "https://www.redpen.ai/docs/creating-the-first-issue-using-redpen",
      reviewed: "30 September 2026",
      detail:
        "Image/video annotations submitted to issue trackers; no live page/DOM review-pin workflow.",
      basis: "scope",
    },
    originals: {
      status: "partial",
      url: "https://www.redpen.ai/docs/creating-the-first-issue-using-redpen",
      reviewed: "30 September 2026",
      detail:
        "Captured screenshots attached to the issue, rather than saved for each discussion comment.",
      basis: "documentation",
    },
    drafts: {
      status: "partial",
      url: "https://www.redpen.ai/docs/creating-the-first-issue-using-redpen",
      reviewed: "30 September 2026",
      detail:
        "Assemble screenshots/files before issue submission; no independent local page-point queue.",
      basis: "documentation",
    },
    resolved: {
      status: "external",
      url: "https://www.redpen.ai/docs/creating-the-first-issue-using-redpen",
      reviewed: "30 September 2026",
      detail:
        "Resolution happens in the connected issue tracker, rather than each captured point.",
      basis: "documentation",
    },
    reviewDefaults: {
      status: "partial",
      url: "https://www.redpen.ai/faq",
      reviewed: "30 September 2026",
      detail:
        "Saved widget/diagnostic-policy configuration; no documented full review/recording default set.",
      basis: "documentation",
    },
    textSuggestions: {
      status: "no",
      url: "https://app.redpen.ai/main.f3cda96628072655025d.js",
      reviewed: "30 September 2026",
      detail:
        "Complete annotation config uses text boxes/shapes; no selected original/replacement webpage-text model.",
      basis: "source",
    },
    drawing: {
      status: "yes",
      url: "https://app.redpen.ai/main.f3cda96628072655025d.js",
      reviewed: "30 September 2026",
      detail:
        "Deployed annotation config includes arrow, line, text, rectangle, ellipse and freehand.",
      basis: "source",
    },
    highlighter: {
      status: "yes",
      url: "https://app.redpen.ai/main.f3cda96628072655025d.js",
      reviewed: "30 September 2026",
      detail: "Dedicated Highlighter annotation control.",
      basis: "source",
    },
    steps: {
      status: "no",
      url: "https://app.redpen.ai/main.f3cda96628072655025d.js",
      reviewed: "30 September 2026",
      detail:
        "Complete annotation-tool configuration has text/shapes/freehand/emoji; no numbered-step tool.",
      basis: "source",
    },
    blur: {
      status: "partial",
      url: "https://www.redpen.ai/docs/pii-redaction",
      reviewed: "30 September 2026",
      detail:
        "Enterprise PII processing automatically blurs/anonymizes sensitive content; a dedicated manual blur-region workflow is not established.",
      basis: "documentation",
    },
    redact: {
      status: "paid",
      url: "https://www.redpen.ai/faq",
      reviewed: "30 September 2026",
      detail: "PII redaction explicitly gated to Enterprise.",
      basis: "documentation",
    },
    stickers: {
      status: "yes",
      url: "https://app.redpen.ai/main.f3cda96628072655025d.js",
      reviewed: "30 September 2026",
      detail: "Emoji objects can be placed as annotations.",
      basis: "source",
    },
    localImages: {
      status: "no",
      url: "https://app.redpen.ai/main.f3cda96628072655025d.js",
      reviewed: "30 September 2026",
      detail:
        "Upload/paste media as attachments; complete annotation-object configuration has no movable image-overlay tool.",
      basis: "source",
    },
    cropExport: {
      status: "yes",
      url: "https://app.redpen.ai/main.f3cda96628072655025d.js",
      reviewed: "30 September 2026",
      detail:
        "Crop canvas and save cropped image controls in deployed annotation editor.",
      basis: "source",
    },
    rasterExport: {
      status: "unknown",
      url: "https://app.redpen.ai/main.f3cda96628072655025d.js",
      reviewed: "30 September 2026",
      detail:
        "Deployed client has image Save/Download but no reliable documented PNG+JPEG+WebP export format list; MIME-library strings do not prove export support.",
      basis: "documentation",
    },
    pdfExport: {
      status: "no",
      url: "https://www.redpen.ai/docs/creating-the-first-issue-using-redpen",
      reviewed: "30 September 2026",
      detail:
        "Capture-to-issue attachments and diagnostic/session files, not annotated multi-page PDF export.",
      basis: "scope",
    },
    clipboard: {
      status: "yes",
      url: "https://app.redpen.ai/main.f3cda96628072655025d.js",
      reviewed: "30 September 2026",
      detail: "Copy To Clipboard control in deployed annotation editor.",
      basis: "source",
    },
    video: {
      status: "paid",
      url: "https://www.redpen.ai/pricing",
      reviewed: "30 September 2026",
      detail: "Native browser screen recording in paid plans.",
      basis: "documentation",
    },
    tabAudio: {
      status: "unknown",
      url: "https://www.redpen.ai/docs/creating-the-first-issue-using-redpen",
      reviewed: "30 September 2026",
      detail:
        "Screen/voice recording is documented; tab/system audio capture is not specified in capture guides or recorder control inventory.",
      basis: "documentation",
    },
    microphone: {
      status: "paid",
      url: "https://www.redpen.ai/docs/creating-the-first-issue-using-redpen",
      reviewed: "30 September 2026",
      detail: "Voice narration accompanies captured screen video.",
      basis: "documentation",
    },
    pauseVideo: {
      status: "paid",
      url: "https://app.redpen.ai/main.f3cda96628072655025d.js",
      reviewed: "30 September 2026",
      detail:
        "The deployed recorder has pause/resume controls; browser video recording is plan-gated.",
      basis: "source",
    },
    trimVideo: {
      status: "unknown",
      url: "https://www.redpen.ai/pricing",
      reviewed: "30 September 2026",
      detail:
        "Pricing advertises video editing, but public capture/help/client inventory does not establish a visual trimming workflow.",
      basis: "documentation",
    },
    cropVideo: {
      status: "unknown",
      url: "https://www.redpen.ai/pricing",
      reviewed: "30 September 2026",
      detail:
        "Pricing advertises video editing; documented crop control is an image canvas, not verified video-frame crop.",
      basis: "documentation",
    },
    replay: {
      status: "yes",
      url: "https://www.redpen.ai/docs/session-replay",
      reviewed: "30 September 2026",
      detail: "Records user actions and replays them through the session player.",
      basis: "documentation",
    },
    timeline: {
      status: "partial",
      url: "https://www.redpen.ai/docs/session-replay",
      reviewed: "30 September 2026",
      detail:
        "Replay player supports play/pause/seek; diagnostics use a separate viewer, not a verified shared event timeline.",
      basis: "documentation",
    },
    frameAnnotations: {
      status: "partial",
      url: "https://www.redpen.ai/docs/creating-the-first-issue-using-redpen",
      reviewed: "30 September 2026",
      detail:
        "Can annotate video while recording; timestamped review-frame pin objects not established.",
      basis: "documentation",
    },
    threadBundle: {
      status: "partial",
      url: "https://www.redpen.ai/docs/viewing-diagnostic-information",
      reviewed: "30 September 2026",
      detail:
        "Portable diagnostic JSON plus separate session HTML/media attachments; no complete self-contained thread archive.",
      basis: "documentation",
    },
    diagnostics: {
      status: "paid",
      url: "https://www.redpen.ai/docs/viewing-diagnostic-information",
      reviewed: "30 September 2026",
      detail:
        "Standard or higher captures console/network/storage diagnostics; network requires video recording.",
      basis: "documentation",
    },
    discussion: {
      status: "external",
      url: "https://www.redpen.ai/docs/creating-the-first-issue-using-redpen",
      reviewed: "30 September 2026",
      detail:
        "Issues are created and managed in the connected tracker; native capture model is not a discussion board.",
      basis: "documentation",
    },
    mcp: {
      status: "no",
      url: "https://www.redpen.ai/docs/redpen-widget-javascript-api",
      reviewed: "30 September 2026",
      detail:
        "No first-party MCP connector in the reviewed official product/help/API inventory; widget APIs configure feedback capture, not MCP.",
      basis: "scope",
    },
    agentContext: {
      status: "partial",
      url: "https://www.redpen.ai/docs/viewing-diagnostic-information",
      reviewed: "30 September 2026",
      detail:
        "Diagnostic JSON exports and captured media can be handed to an agent manually. A native MCP workflow is not established.",
      basis: "scope",
    },
    expertise: {
      status: "no",
      url: "https://www.redpen.ai/docs/redpen-widget-javascript-api",
      reviewed: "30 September 2026",
      detail:
        "Published developer interfaces configure/capture widget feedback and custom metadata; no MCP context or prioritized queue service in audited API/help inventory.",
      basis: "scope",
    },
    github: {
      status: "paid",
      url: "https://www.redpen.ai/pricing",
      reviewed: "30 September 2026",
      detail: "Paid GitHub Issues handoff; Standard lists customer-provided storage.",
      basis: "documentation",
    },
    multiRepo: {
      status: "partial",
      url: "https://www.redpen.ai/docs/connect-redpen-to-github",
      reviewed: "30 September 2026",
      detail:
        "Connect a GitHub organization/user and choose issue destinations; no native multi-repository review-project model established.",
      basis: "documentation",
    },
    projectContext: {
      status: "no",
      url: "https://www.redpen.ai/docs/redpen-widget-javascript-api",
      reviewed: "30 September 2026",
      detail:
        "Published developer interfaces configure/capture widget feedback and custom metadata; no MCP context or prioritized queue service in audited API/help inventory.",
      basis: "scope",
    },
    source: {
      status: "no",
      url: "https://www.redpen.ai/terms-of-service",
      reviewed: "30 September 2026",
      detail:
        "SaaS license reserves service/software ownership; no public complete server-source grant.",
      basis: "explicit",
    },
    selfHost: {
      status: "no",
      url: "https://www.redpen.ai/terms-of-service",
      reviewed: "30 September 2026",
      detail:
        "Terms define vendor-hosted SaaS; client widget/SDK is not a complete self-hosted service.",
      basis: "explicit",
    },
    independent: {
      status: "no",
      url: "https://www.redpen.ai/docs/creating-the-first-issue-using-redpen",
      reviewed: "30 September 2026",
      detail:
        "Redpen account and connected issue-tracking service required to create issues.",
      basis: "explicit",
    },
    storage: {
      status: "no",
      url: "https://www.redpen.ai/pricing",
      reviewed: "30 September 2026",
      detail:
        "Customer-provided storage for paid GitHub handoff; not no-fee whole-service S3 hosting.",
      basis: "explicit",
    },
    apacheLicense: {
      status: "no",
      url: "https://www.redpen.ai/terms-of-service",
      reviewed: "30 September 2026",
      detail: "Proprietary SaaS terms, not Apache-2.0 complete-product licensing.",
      basis: "explicit",
    },
    allFeaturesFree: {
      status: "no",
      url: "https://www.redpen.ai/pricing",
      reviewed: "30 September 2026",
      detail:
        "Advanced diagnostics/video and Enterprise capabilities require paid plans.",
      basis: "explicit",
    },
    multiApps: {
      status: "no",
      url: "https://www.redpen.ai/docs/connect-redpen-to-github",
      reviewed: "30 September 2026",
      detail:
        "Hosted GitHub account/organization authorization; no multi-App self-hosted server configuration.",
      basis: "scope",
    },
    agentQueue: {
      status: "no",
      url: "https://www.redpen.ai/docs/redpen-widget-javascript-api",
      reviewed: "30 September 2026",
      detail:
        "Published developer interfaces configure/capture widget feedback and custom metadata; no MCP context or prioritized queue service in audited API/help inventory.",
      basis: "scope",
    },
    sessionOnly: {
      status: "yes",
      url: "https://www.redpen.ai/docs/session-replay",
      reviewed: "30 September 2026",
      detail:
        "Explicitly submits recorded session even when no images/videos were captured.",
      basis: "documentation",
    },
    screenshotDiagnostics: {
      status: "partial",
      url: "https://www.redpen.ai/docs/viewing-diagnostic-information",
      reviewed: "30 September 2026",
      detail:
        "Screenshots include diagnostics, but docs explicitly reserve network logs for video; full DOM+console+network bundle is absent.",
      basis: "documentation",
    },
    nativeClients: {
      status: "yes",
      url: "https://www.redpen.ai/docs/integrate-redpen-android-sdk-into-your-application",
      reviewed: "30 September 2026",
      detail: "Native Android SDK captures screenshots/video/device diagnostics.",
      basis: "documentation",
    },
  },
};
