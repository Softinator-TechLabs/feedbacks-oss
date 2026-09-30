export default {
  reviewed: "30 September 2026",
  scope:
    "BugPin Community 1.2.4 source at 4735d4f0f3d29f520d2a909728530fcf428bc331; published Enterprise entitlements noted separately. Negative implementation findings are scoped to this public Community snapshot.",
  summary:
    "Self-hosted screenshot reporting with annotations, local drafts, diagnostics, AI-ready exports and multiple GitHub destinations. Video uploads are supported, but recording and session replay are not implemented in the audited Community widget.",
  sources: [
    {
      url: "https://github.com/aranticlabs/bugpin/blob/4735d4f0f3d29f520d2a909728530fcf428bc331/package.json",
      title: "package.json",
      reviewed: "30 September 2026",
    },
    {
      url: "https://github.com/aranticlabs/bugpin/blob/4735d4f0f3d29f520d2a909728530fcf428bc331/src/widget/capture/screenshot.ts",
      title: "src/widget/capture/screenshot.ts",
      reviewed: "30 September 2026",
    },
    {
      url: "https://github.com/aranticlabs/bugpin/blob/4735d4f0f3d29f520d2a909728530fcf428bc331/src/shared/types.ts",
      title: "src/shared/types.ts",
      reviewed: "30 September 2026",
    },
    {
      url: "https://github.com/aranticlabs/bugpin/blob/4735d4f0f3d29f520d2a909728530fcf428bc331/src/widget/storage/draft-storage.ts",
      title: "src/widget/storage/draft-storage.ts",
      reviewed: "30 September 2026",
    },
    {
      url: "https://github.com/aranticlabs/bugpin/blob/4735d4f0f3d29f520d2a909728530fcf428bc331/src/admin/pages/widget/Screenshot.tsx",
      title: "src/admin/pages/widget/Screenshot.tsx",
      reviewed: "30 September 2026",
    },
    {
      url: "https://github.com/aranticlabs/bugpin/blob/4735d4f0f3d29f520d2a909728530fcf428bc331/src/widget/annotate/AnnotationCanvas.tsx",
      title: "src/widget/annotate/AnnotationCanvas.tsx",
      reviewed: "30 September 2026",
    },
    {
      url: "https://github.com/aranticlabs/bugpin/blob/4735d4f0f3d29f520d2a909728530fcf428bc331/src/widget/components/ScreenshotManager.tsx",
      title: "src/widget/components/ScreenshotManager.tsx",
      reviewed: "30 September 2026",
    },
    {
      url: "https://github.com/aranticlabs/bugpin/blob/4735d4f0f3d29f520d2a909728530fcf428bc331/src/admin/components/report/ExportDiagnosticsMenu.tsx",
      title: "src/admin/components/report/ExportDiagnosticsMenu.tsx",
      reviewed: "30 September 2026",
    },
    {
      url: "https://github.com/aranticlabs/bugpin/blob/4735d4f0f3d29f520d2a909728530fcf428bc331/src/admin/pages/workspace/ReportDetail.tsx",
      title: "src/admin/pages/workspace/ReportDetail.tsx",
      reviewed: "30 September 2026",
    },
    {
      url: "https://github.com/aranticlabs/bugpin/blob/4735d4f0f3d29f520d2a909728530fcf428bc331/src/admin/lib/reportExport.ts",
      title: "src/admin/lib/reportExport.ts",
      reviewed: "30 September 2026",
    },
    {
      url: "https://github.com/aranticlabs/bugpin/blob/4735d4f0f3d29f520d2a909728530fcf428bc331/src/widget/capture/context.ts",
      title: "src/widget/capture/context.ts",
      reviewed: "30 September 2026",
    },
    {
      url: "https://github.com/aranticlabs/bugpin/blob/4735d4f0f3d29f520d2a909728530fcf428bc331/src/server/services/reporter-messages.service.ts",
      title: "src/server/services/reporter-messages.service.ts",
      reviewed: "30 September 2026",
    },
    {
      url: "https://github.com/aranticlabs/bugpin/blob/4735d4f0f3d29f520d2a909728530fcf428bc331/src/server/routes/index.ts",
      title: "src/server/routes/index.ts",
      reviewed: "30 September 2026",
    },
    {
      url: "https://github.com/aranticlabs/bugpin/blob/4735d4f0f3d29f520d2a909728530fcf428bc331/src/server/services/integrations/github.service.ts",
      title: "src/server/services/integrations/github.service.ts",
      reviewed: "30 September 2026",
    },
    {
      url: "https://github.com/aranticlabs/bugpin/blob/4735d4f0f3d29f520d2a909728530fcf428bc331/src/server/services/integrations.service.ts",
      title: "src/server/services/integrations.service.ts",
      reviewed: "30 September 2026",
    },
    {
      url: "https://github.com/aranticlabs/bugpin/blob/4735d4f0f3d29f520d2a909728530fcf428bc331/README.md",
      title: "README.md",
      reviewed: "30 September 2026",
    },
    {
      url: "https://github.com/aranticlabs/bugpin/blob/4735d4f0f3d29f520d2a909728530fcf428bc331/docker-compose.yml",
      title: "docker-compose.yml",
      reviewed: "30 September 2026",
    },
    {
      url: "https://bugpin.io/editions/",
      title: "Official edition comparison",
      reviewed: "30 September 2026",
    },
    {
      url: "https://github.com/aranticlabs/bugpin/blob/4735d4f0f3d29f520d2a909728530fcf428bc331/LICENSE",
      title: "LICENSE",
      reviewed: "30 September 2026",
    },
    {
      url: "https://bugpin.io/",
      title: "Official product features",
      reviewed: "30 September 2026",
    },
  ],
  cells: {
    extension: {
      status: "no",
      url: "https://github.com/aranticlabs/bugpin/blob/4735d4f0f3d29f520d2a909728530fcf428bc331/package.json",
      reviewed: "30 September 2026",
      detail:
        "Reviewed package inventory contains server, admin and embeddable widget; no browser-extension package or extension capture workflow in this Community snapshot.",
      basis: "source",
    },
    screenshots: {
      status: "yes",
      url: "https://github.com/aranticlabs/bugpin/blob/4735d4f0f3d29f520d2a909728530fcf428bc331/src/widget/capture/screenshot.ts",
      reviewed: "30 September 2026",
      detail:
        "Screenshot capture implements visible viewport, full-page and selected-element modes, plus a browser screen-capture fallback.",
      basis: "source",
    },
    fullPage: {
      status: "yes",
      url: "https://github.com/aranticlabs/bugpin/blob/4735d4f0f3d29f520d2a909728530fcf428bc331/src/widget/capture/screenshot.ts",
      reviewed: "30 September 2026",
      detail:
        "Screenshot capture implements visible viewport, full-page and selected-element modes, plus a browser screen-capture fallback.",
      basis: "source",
    },
    pins: {
      status: "no",
      url: "https://github.com/aranticlabs/bugpin/blob/4735d4f0f3d29f520d2a909728530fcf428bc331/src/shared/types.ts",
      reviewed: "30 September 2026",
      detail:
        "Reports store screenshot annotation objects and page metadata; no persistent page/DOM pin entity or on-page pin-thread workflow in the reviewed Community model.",
      basis: "source",
    },
    originals: {
      status: "partial",
      url: "https://github.com/aranticlabs/bugpin/blob/4735d4f0f3d29f520d2a909728530fcf428bc331/src/shared/types.ts",
      reviewed: "30 September 2026",
      detail:
        "Reports can contain captured screenshots; reporter messages are separate text records and do not each capture their own screenshot.",
      basis: "source",
    },
    drafts: {
      status: "partial",
      url: "https://github.com/aranticlabs/bugpin/blob/4735d4f0f3d29f520d2a909728530fcf428bc331/src/widget/storage/draft-storage.ts",
      reviewed: "30 September 2026",
      detail:
        "Unsent report fields persist in localStorage and media in IndexedDB, keyed by project and reporter. These are report drafts rather than separately saved review points.",
      basis: "source",
    },
    resolved: {
      status: "partial",
      url: "https://github.com/aranticlabs/bugpin/blob/4735d4f0f3d29f520d2a909728530fcf428bc331/src/shared/types.ts",
      reviewed: "30 September 2026",
      detail:
        "A report has status and resolved timestamps. Individual shapes inside its annotation object do not have separate resolution states.",
      basis: "source",
    },
    reviewDefaults: {
      status: "partial",
      url: "https://github.com/aranticlabs/bugpin/blob/4735d4f0f3d29f520d2a909728530fcf428bc331/src/admin/pages/widget/Screenshot.tsx",
      reviewed: "30 September 2026",
      detail:
        "Global and project screenshot settings persist. There is no recording-control preset because this widget does not record video.",
      basis: "source",
    },
    textSuggestions: {
      status: "no",
      url: "https://github.com/aranticlabs/bugpin/blob/4735d4f0f3d29f520d2a909728530fcf428bc331/src/widget/annotate/AnnotationCanvas.tsx",
      reviewed: "30 September 2026",
      detail:
        "The complete annotation tool union has drawing and free text, but no selected DOM text plus proposed replacement model or suggestion workflow.",
      basis: "source",
    },
    drawing: {
      status: "yes",
      url: "https://github.com/aranticlabs/bugpin/blob/4735d4f0f3d29f520d2a909728530fcf428bc331/src/widget/annotate/AnnotationCanvas.tsx",
      reviewed: "30 September 2026",
      detail: "The editor provides pen, line, arrow, rectangle, circle and text tools.",
      basis: "source",
    },
    highlighter: {
      status: "no",
      url: "https://github.com/aranticlabs/bugpin/blob/4735d4f0f3d29f520d2a909728530fcf428bc331/src/widget/annotate/AnnotationCanvas.tsx",
      reviewed: "30 September 2026",
      detail:
        "The complete toolbar/tool union has a pen and outline shapes, but no translucent highlighter tool. Marketing says highlight in the general annotation sense.",
      basis: "source",
    },
    steps: {
      status: "no",
      url: "https://github.com/aranticlabs/bugpin/blob/4735d4f0f3d29f520d2a909728530fcf428bc331/src/widget/annotate/AnnotationCanvas.tsx",
      reviewed: "30 September 2026",
      detail:
        "The complete annotation toolbar has no numbered-step tool; ordinary text can be entered manually.",
      basis: "source",
    },
    blur: {
      status: "yes",
      url: "https://github.com/aranticlabs/bugpin/blob/4735d4f0f3d29f520d2a909728530fcf428bc331/src/widget/annotate/AnnotationCanvas.tsx",
      reviewed: "30 September 2026",
      detail:
        "A privacy tool pixelates selected image regions and regenerates them at export resolution; this is pixelation rather than Gaussian blur.",
      basis: "source",
    },
    redact: {
      status: "partial",
      url: "https://github.com/aranticlabs/bugpin/blob/4735d4f0f3d29f520d2a909728530fcf428bc331/src/widget/annotate/AnnotationCanvas.tsx",
      reviewed: "30 September 2026",
      detail:
        "Pixelation obscures selected regions. The reviewed toolbar has no separate opaque-mask redaction tool, and its rectangle/circle shapes use transparent fills.",
      basis: "source",
    },
    stickers: {
      status: "no",
      url: "https://github.com/aranticlabs/bugpin/blob/4735d4f0f3d29f520d2a909728530fcf428bc331/src/widget/annotate/AnnotationCanvas.tsx",
      reviewed: "30 September 2026",
      detail: "The complete editor tool list has no stamp or sticker tool.",
      basis: "source",
    },
    localImages: {
      status: "no",
      url: "https://github.com/aranticlabs/bugpin/blob/4735d4f0f3d29f520d2a909728530fcf428bc331/src/widget/components/ScreenshotManager.tsx",
      reviewed: "30 September 2026",
      detail:
        "Files can be attached as separate report media. AnnotationCanvas edits one background image and has no insert/move/resize local-image layer tool.",
      basis: "source",
    },
    cropExport: {
      status: "no",
      url: "https://github.com/aranticlabs/bugpin/blob/4735d4f0f3d29f520d2a909728530fcf428bc331/src/widget/annotate/AnnotationCanvas.tsx",
      reviewed: "30 September 2026",
      detail:
        "Annotation export resets the viewport and renders the complete image at original resolution. No user-controlled crop-export action exists in this editor.",
      basis: "source",
    },
    rasterExport: {
      status: "partial",
      url: "https://github.com/aranticlabs/bugpin/blob/4735d4f0f3d29f520d2a909728530fcf428bc331/src/widget/annotate/AnnotationCanvas.tsx",
      reviewed: "30 September 2026",
      detail:
        "Annotated output is explicitly PNG. Uploaded JPEG/WebP files can be downloaded unchanged, but there is no three-format annotated-image export selector.",
      basis: "source",
    },
    pdfExport: {
      status: "no",
      url: "https://github.com/aranticlabs/bugpin/blob/4735d4f0f3d29f520d2a909728530fcf428bc331/src/admin/components/report/ExportDiagnosticsMenu.tsx",
      reviewed: "30 September 2026",
      detail:
        "The export menu offers Markdown, plain text, AI prompt and JSON; screenshot output is PNG, with no multi-page PDF compositor.",
      basis: "source",
    },
    clipboard: {
      status: "no",
      url: "https://github.com/aranticlabs/bugpin/blob/4735d4f0f3d29f520d2a909728530fcf428bc331/src/admin/components/report/ExportDiagnosticsMenu.tsx",
      reviewed: "30 September 2026",
      detail:
        "Clipboard actions write diagnostic text. ScreenshotManager downloads media and AnnotationCanvas emits PNG; no annotated-image clipboard action is implemented.",
      basis: "source",
    },
    video: {
      status: "no",
      url: "https://github.com/aranticlabs/bugpin/blob/4735d4f0f3d29f520d2a909728530fcf428bc331/src/widget/components/ScreenshotManager.tsx",
      reviewed: "30 September 2026",
      detail:
        "The widget accepts existing video uploads but its capture path takes still screenshots; no video recorder is implemented. Upload support is not recording.",
      basis: "source",
    },
    tabAudio: {
      status: "no",
      url: "https://github.com/aranticlabs/bugpin/blob/4735d4f0f3d29f520d2a909728530fcf428bc331/src/widget/components/ScreenshotManager.tsx",
      reviewed: "30 September 2026",
      detail:
        "Media workflow uploads/downloads existing video and captures still images; it contains no recorder, audio-input controls, pause/resume, or video-editing workflow.",
      basis: "source",
    },
    microphone: {
      status: "no",
      url: "https://github.com/aranticlabs/bugpin/blob/4735d4f0f3d29f520d2a909728530fcf428bc331/src/widget/components/ScreenshotManager.tsx",
      reviewed: "30 September 2026",
      detail:
        "Media workflow uploads/downloads existing video and captures still images; it contains no recorder, audio-input controls, pause/resume, or video-editing workflow.",
      basis: "source",
    },
    pauseVideo: {
      status: "no",
      url: "https://github.com/aranticlabs/bugpin/blob/4735d4f0f3d29f520d2a909728530fcf428bc331/src/widget/components/ScreenshotManager.tsx",
      reviewed: "30 September 2026",
      detail:
        "Media workflow uploads/downloads existing video and captures still images; it contains no recorder, audio-input controls, pause/resume, or video-editing workflow.",
      basis: "source",
    },
    trimVideo: {
      status: "no",
      url: "https://github.com/aranticlabs/bugpin/blob/4735d4f0f3d29f520d2a909728530fcf428bc331/src/widget/components/ScreenshotManager.tsx",
      reviewed: "30 September 2026",
      detail:
        "Media workflow uploads/downloads existing video and captures still images; it contains no recorder, audio-input controls, pause/resume, or video-editing workflow.",
      basis: "source",
    },
    cropVideo: {
      status: "no",
      url: "https://github.com/aranticlabs/bugpin/blob/4735d4f0f3d29f520d2a909728530fcf428bc331/src/widget/components/ScreenshotManager.tsx",
      reviewed: "30 September 2026",
      detail:
        "Media workflow uploads/downloads existing video and captures still images; it contains no recorder, audio-input controls, pause/resume, or video-editing workflow.",
      basis: "source",
    },
    replay: {
      status: "no",
      url: "https://github.com/aranticlabs/bugpin/blob/4735d4f0f3d29f520d2a909728530fcf428bc331/src/shared/types.ts",
      reviewed: "30 September 2026",
      detail:
        "Report metadata stores bounded console/network errors and activity records, not DOM mutation recordings; no replay session model or replay player exists in the reviewed Community source.",
      basis: "source",
    },
    timeline: {
      status: "no",
      url: "https://github.com/aranticlabs/bugpin/blob/4735d4f0f3d29f520d2a909728530fcf428bc331/src/admin/pages/workspace/ReportDetail.tsx",
      reviewed: "30 September 2026",
      detail:
        "The report detail presents attachments and diagnostic sections, not a replay/video playhead synchronized with diagnostic events.",
      basis: "source",
    },
    frameAnnotations: {
      status: "no",
      url: "https://github.com/aranticlabs/bugpin/blob/4735d4f0f3d29f520d2a909728530fcf428bc331/src/widget/annotate/AnnotationCanvas.tsx",
      reviewed: "30 September 2026",
      detail:
        "AnnotationCanvas receives a still image. There is no video-frame timestamp or annotation-to-recording association in the report model.",
      basis: "source",
    },
    threadBundle: {
      status: "partial",
      url: "https://github.com/aranticlabs/bugpin/blob/4735d4f0f3d29f520d2a909728530fcf428bc331/src/admin/lib/reportExport.ts",
      reviewed: "30 September 2026",
      detail:
        "Report context exports as Markdown, text, AI prompt or JSON with file references; it is not a complete portable archive containing the discussion and media bytes.",
      basis: "source",
    },
    diagnostics: {
      status: "yes",
      url: "https://github.com/aranticlabs/bugpin/blob/4735d4f0f3d29f520d2a909728530fcf428bc331/src/widget/capture/context.ts",
      reviewed: "30 September 2026",
      detail:
        "Captures bounded console errors/warnings, failed network requests and user activity, with configurable privacy handling.",
      basis: "source",
    },
    discussion: {
      status: "partial",
      url: "https://github.com/aranticlabs/bugpin/blob/4735d4f0f3d29f520d2a909728530fcf428bc331/src/server/services/reporter-messages.service.ts",
      reviewed: "30 September 2026",
      detail:
        "Admins can send report-linked messages and view message history. This is reporter messaging, not a general nested team-comment thread.",
      basis: "source",
    },
    mcp: {
      status: "no",
      url: "https://github.com/aranticlabs/bugpin/blob/4735d4f0f3d29f520d2a909728530fcf428bc331/src/server/routes/index.ts",
      reviewed: "30 September 2026",
      detail:
        "The reviewed Community server mounts HTTP report/project/integration routes, with no MCP server or tool registry; assigned/priority reports therefore are not an MCP queue or weighted-reviewer MCP guidance.",
      basis: "source",
    },
    agentContext: {
      status: "yes",
      url: "https://github.com/aranticlabs/bugpin/blob/4735d4f0f3d29f520d2a909728530fcf428bc331/src/admin/lib/reportExport.ts",
      reviewed: "30 September 2026",
      detail:
        "AI-prompt and structured report exports include page metadata, description, diagnostics and attachment references for manual agent handoff; native MCP is not required for this capability.",
      basis: "source",
    },
    expertise: {
      status: "no",
      url: "https://github.com/aranticlabs/bugpin/blob/4735d4f0f3d29f520d2a909728530fcf428bc331/src/server/routes/index.ts",
      reviewed: "30 September 2026",
      detail:
        "The reviewed Community server mounts HTTP report/project/integration routes, with no MCP server or tool registry; assigned/priority reports therefore are not an MCP queue or weighted-reviewer MCP guidance.",
      basis: "source",
    },
    github: {
      status: "yes",
      url: "https://github.com/aranticlabs/bugpin/blob/4735d4f0f3d29f520d2a909728530fcf428bc331/src/server/services/integrations/github.service.ts",
      reviewed: "30 September 2026",
      detail:
        "Community integration creates GitHub Issues from reports with configured credentials and supports synchronization.",
      basis: "source",
    },
    multiRepo: {
      status: "yes",
      url: "https://github.com/aranticlabs/bugpin/blob/4735d4f0f3d29f520d2a909728530fcf428bc331/src/server/services/integrations.service.ts",
      reviewed: "30 September 2026",
      detail:
        "Projects can create multiple named GitHub integration records, each with its own owner/repository/token; forwarding selects the integration. This is not a single-repository project restriction.",
      basis: "source",
    },
    projectContext: {
      status: "no",
      url: "https://github.com/aranticlabs/bugpin/blob/4735d4f0f3d29f520d2a909728530fcf428bc331/src/shared/types.ts",
      reviewed: "30 September 2026",
      detail:
        "Project/report types contain settings, membership and metadata, but no versioned approved project-instruction records or agent-guidance publication workflow.",
      basis: "source",
    },
    source: {
      status: "yes",
      url: "https://github.com/aranticlabs/bugpin/blob/4735d4f0f3d29f520d2a909728530fcf428bc331/README.md",
      reviewed: "30 September 2026",
      detail:
        "Community server and admin source are public under AGPL-3.0; the widget is MIT. Enterprise implementation is a separate proprietary module.",
      basis: "source",
    },
    selfHost: {
      status: "yes",
      url: "https://github.com/aranticlabs/bugpin/blob/4735d4f0f3d29f520d2a909728530fcf428bc331/docker-compose.yml",
      reviewed: "30 September 2026",
      detail:
        "Community runs its own Bun server, SQLite database and local file storage; no vendor account or hosted backend is required for core use.",
      basis: "source",
    },
    independent: {
      status: "yes",
      url: "https://github.com/aranticlabs/bugpin/blob/4735d4f0f3d29f520d2a909728530fcf428bc331/docker-compose.yml",
      reviewed: "30 September 2026",
      detail:
        "Community runs its own Bun server, SQLite database and local file storage; no vendor account or hosted backend is required for core use.",
      basis: "source",
    },
    storage: {
      status: "paid",
      url: "https://bugpin.io/editions/",
      reviewed: "30 September 2026",
      detail:
        "S3 storage integration is explicitly an Enterprise feature; Community uses local storage. It is not included in no-fee self-hosting.",
      basis: "explicit",
    },
    apacheLicense: {
      status: "no",
      url: "https://github.com/aranticlabs/bugpin/blob/4735d4f0f3d29f520d2a909728530fcf428bc331/LICENSE",
      reviewed: "30 September 2026",
      detail:
        "Community server/admin are AGPL-3.0, widget MIT, and Enterprise proprietary; the complete product is not Apache-2.0.",
      basis: "explicit",
    },
    allFeaturesFree: {
      status: "no",
      url: "https://bugpin.io/editions/",
      reviewed: "30 September 2026",
      detail:
        "Community is free, but Enterprise charges for SSO, API/webhooks, S3 and other features.",
      basis: "explicit",
    },
    multiApps: {
      status: "no",
      url: "https://github.com/aranticlabs/bugpin/blob/4735d4f0f3d29f520d2a909728530fcf428bc331/src/shared/types.ts",
      reviewed: "30 September 2026",
      detail:
        "GitHubIntegrationConfig uses owner, repository and accessToken; it does not register/select multiple GitHub App credential sets. Multiple token-based integrations are supported instead.",
      basis: "source",
    },
    agentQueue: {
      status: "no",
      url: "https://github.com/aranticlabs/bugpin/blob/4735d4f0f3d29f520d2a909728530fcf428bc331/src/server/routes/index.ts",
      reviewed: "30 September 2026",
      detail:
        "The reviewed Community server mounts HTTP report/project/integration routes, with no MCP server or tool registry; assigned/priority reports therefore are not an MCP queue or weighted-reviewer MCP guidance.",
      basis: "source",
    },
    sessionOnly: {
      status: "no",
      url: "https://github.com/aranticlabs/bugpin/blob/4735d4f0f3d29f520d2a909728530fcf428bc331/src/shared/types.ts",
      reviewed: "30 September 2026",
      detail:
        "Report metadata stores bounded console/network errors and activity records, not DOM mutation recordings; no replay session model or replay player exists in the reviewed Community source.",
      basis: "source",
    },
    screenshotDiagnostics: {
      status: "partial",
      url: "https://github.com/aranticlabs/bugpin/blob/4735d4f0f3d29f520d2a909728530fcf428bc331/src/widget/capture/context.ts",
      reviewed: "30 September 2026",
      detail:
        "Screenshots include console/network errors and activity metadata. The captured-context schema does not include a serialized DOM snapshot, so the full DOM-plus-console-plus-network bundle is not equivalent.",
      basis: "source",
    },
    nativeClients: {
      status: "no",
      url: "https://github.com/aranticlabs/bugpin/blob/4735d4f0f3d29f520d2a909728530fcf428bc331/package.json",
      reviewed: "30 September 2026",
      detail:
        "The source workspace inventory ships a browser widget and web admin/server only; there is no native iOS/Android feedback SDK package.",
      basis: "source",
    },
  },
};
