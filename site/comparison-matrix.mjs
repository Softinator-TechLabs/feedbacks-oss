// Each verdict links to the vendor's documentation or public source.
// Missing documentation is not evidence of absence. Omitted cells are unverified.
// Each confirmed cell has a source and its own review date.
export const matrixReviewed = "27 September 2026";

export const matrixGroups = [
  {
    id: "capture",
    title: "Capture and page review",
    description:
      "Keep the page, the selected element and its original evidence together.",
    features: [
      ["extension", "Browser extension capture"],
      ["screenshots", "Screenshot capture"],
      ["fullPage", "Full-page capture"],
      ["pins", "Element or page pins"],
      ["originals", "Screenshot saved with each comment"],
      ["drafts", "Local unsent review points"],
      ["resolved", "Resolve individual points"],
      ["reviewDefaults", "Saved review and recording controls"],
    ],
  },
  {
    id: "annotation",
    title: "Annotation and image exports",
    description:
      "Compare specific editing tools and output formats, not just an annotation checkbox.",
    features: [
      ["drawing", "Draw, shapes and text"],
      ["highlighter", "Highlighter"],
      ["steps", "Numbered steps"],
      ["blur", "Blur tool"],
      ["redact", "Mask private pixels"],
      ["stickers", "Stamps or stickers"],
      ["localImages", "Insert, move and resize local images"],
      ["cropExport", "Crop screenshot exports"],
      ["rasterExport", "PNG, JPEG and WebP export"],
      ["pdfExport", "Multi-page PDF export"],
      ["clipboard", "Copy annotated image"],
    ],
  },
  {
    id: "recording",
    title: "Recording and diagnostics",
    description:
      "Recording a new clip and replaying a past session are different capabilities.",
    features: [
      ["video", "Record feedback video"],
      ["tabAudio", "Capture tab audio"],
      ["microphone", "Microphone narration"],
      ["pauseVideo", "Pause and resume recording"],
      ["trimVideo", "Trim video visually"],
      ["cropVideo", "Crop video frame"],
      ["replay", "Session replay"],
      ["diagnostics", "Console or network context"],
    ],
  },
  {
    id: "collaboration",
    title: "Team discussion and agent handoff",
    description: "Check how reviewers, developers and authorized agents share the work.",
    features: [
      ["discussion", "Team comments and replies"],
      ["mcp", "Feedback via MCP"],
      ["agentContext", "Visual or page context for agents"],
      ["expertise", "Owner-approved weighted reviewer guidance in MCP"],
      ["github", "GitHub Issues handoff"],
    ],
  },
  {
    id: "hosting",
    title: "Source and self-hosting",
    description: "Availability in a hosted plan does not establish self-hosting support.",
    features: [
      ["source", "Public server source"],
      ["selfHost", "Whole service self-hosted"],
      ["independent", "No required external account"],
      ["storage", "S3 in no-fee self-hosting"],
    ],
  },
];
export const matrixFeatures = matrixGroups.flatMap((group) => group.features);

// Dates describe documentation/source review, not installed-product testing.
export const matrixRows = {
  feedbacks: {
    source: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/HEAD/docs/why-feedbacks.md",
      reviewed: "27 September 2026",
    },
    selfHost: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/HEAD/docs/self-hosting.md",
      reviewed: "27 September 2026",
    },
    independent: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/HEAD/docs/why-feedbacks.md",
      reviewed: "27 September 2026",
    },
    storage: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/HEAD/docs/self-hosting.md",
      reviewed: "27 September 2026",
    },
    extension: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/HEAD/docs/extension.md",
      reviewed: "27 September 2026",
    },
    drawing: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/HEAD/docs/extension.md",
      reviewed: "27 September 2026",
    },
    mcp: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/HEAD/docs/agents.md",
      reviewed: "27 September 2026",
    },
    video: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/HEAD/docs/extension.md",
      reviewed: "27 September 2026",
      detail:
        "Up to five minutes of active recording; separate recorder tab and preview before Send.",
    },
    github: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/HEAD/docs/api.md",
      reviewed: "27 September 2026",
      detail:
        "Optional GitHub App; reviewed issue drafts and project opt-in for status sync.",
    },
    expertise: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/HEAD/docs/agents.md",
      reviewed: "27 September 2026",
    },
    screenshots: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/HEAD/docs/extension.md",
      reviewed: "27 September 2026",
    },
    fullPage: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/HEAD/docs/extension.md",
      reviewed: "27 September 2026",
    },
    pins: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/HEAD/docs/extension.md",
      reviewed: "27 September 2026",
    },
    originals: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/HEAD/docs/extension.md",
      reviewed: "27 September 2026",
    },
    drafts: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/HEAD/docs/extension.md",
      reviewed: "27 September 2026",
    },
    resolved: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/HEAD/docs/extension.md",
      reviewed: "27 September 2026",
    },
    reviewDefaults: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/HEAD/docs/extension.md",
      reviewed: "27 September 2026",
      detail:
        "Separate saved controls for review and recording; recording restores prior review controls.",
    },
    highlighter: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/HEAD/docs/extension.md",
      reviewed: "27 September 2026",
    },
    steps: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/HEAD/docs/extension.md",
      reviewed: "27 September 2026",
    },
    blur: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/HEAD/docs/extension.md",
      reviewed: "27 September 2026",
      detail: "Visual softening, not secure redaction. Use Redact for private pixels.",
    },
    redact: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/HEAD/docs/extension.md",
      reviewed: "27 September 2026",
    },
    stickers: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/HEAD/docs/extension.md",
      reviewed: "27 September 2026",
    },
    localImages: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/HEAD/docs/extension.md",
      reviewed: "27 September 2026",
    },
    cropExport: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/HEAD/docs/extension.md",
      reviewed: "27 September 2026",
      detail:
        "Local clipboard and downloads only; sent feedback retains the complete screenshot.",
    },
    rasterExport: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/HEAD/docs/extension.md",
      reviewed: "27 September 2026",
    },
    pdfExport: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/HEAD/docs/extension.md",
      reviewed: "27 September 2026",
    },
    clipboard: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/HEAD/docs/extension.md",
      reviewed: "27 September 2026",
    },
    tabAudio: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/HEAD/docs/extension.md",
      reviewed: "27 September 2026",
      detail: "Tab audio and microphone are separate opt-ins, both off by default.",
    },
    microphone: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/HEAD/docs/extension.md",
      reviewed: "27 September 2026",
    },
    pauseVideo: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/HEAD/docs/extension.md",
      reviewed: "27 September 2026",
    },
    trimVideo: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/HEAD/docs/extension.md",
      reviewed: "27 September 2026",
    },
    cropVideo: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/HEAD/docs/extension.md",
      reviewed: "27 September 2026",
    },
    diagnostics: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/HEAD/docs/extension.md",
      reviewed: "27 September 2026",
    },
    discussion: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/HEAD/docs/review-workflow.md",
      reviewed: "27 September 2026",
    },
    agentContext: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/HEAD/docs/agents.md",
      reviewed: "27 September 2026",
    },
    replay: {
      status: "no",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/HEAD/docs/extension.md",
      reviewed: "27 September 2026",
    },
  },
  bugpin: {
    source: {
      status: "yes",
      url: "https://github.com/aranticlabs/bugpin",
      reviewed: "27 September 2026",
    },
    selfHost: {
      status: "yes",
      url: "https://bugpin.io/editions/",
      reviewed: "27 September 2026",
    },
    independent: {
      status: "yes",
      url: "https://bugpin.io/editions/",
      reviewed: "27 September 2026",
    },
    storage: {
      status: "paid",
      url: "https://bugpin.io/editions/",
      reviewed: "27 September 2026",
    },
    drawing: {
      status: "yes",
      url: "https://bugpin.io/editions/",
      reviewed: "27 September 2026",
    },
    github: {
      status: "yes",
      url: "https://bugpin.io/editions/",
      reviewed: "27 September 2026",
    },
    screenshots: {
      status: "yes",
      url: "https://bugpin.io/editions/",
      reviewed: "27 September 2026",
    },
    blur: {
      status: "yes",
      url: "https://bugpin.io/editions/",
      reviewed: "27 September 2026",
    },
    diagnostics: {
      status: "yes",
      url: "https://github.com/aranticlabs/bugpin",
      reviewed: "27 September 2026",
    },
    agentContext: {
      status: "yes",
      url: "https://github.com/aranticlabs/bugpin",
      reviewed: "27 September 2026",
      detail: "Manual Markdown, JSON or AI prompt export; MCP access is not verified.",
    },
  },
  fasterfixes: {
    source: {
      status: "yes",
      url: "https://github.com/manucoffin/faster-fixes",
      reviewed: "27 September 2026",
    },
    selfHost: {
      status: "yes",
      url: "https://www.faster-fixes.com/docs/self-hosting",
      reviewed: "27 September 2026",
    },
    independent: {
      status: "required",
      url: "https://www.faster-fixes.com/docs/self-hosting",
      reviewed: "27 September 2026",
    },
    storage: {
      status: "yes",
      url: "https://www.faster-fixes.com/docs/self-hosting",
      reviewed: "27 September 2026",
    },
    mcp: {
      status: "yes",
      url: "https://github.com/manucoffin/faster-fixes",
      reviewed: "27 September 2026",
    },
    github: {
      status: "yes",
      url: "https://github.com/manucoffin/faster-fixes",
      reviewed: "27 September 2026",
    },
    screenshots: {
      status: "yes",
      url: "https://github.com/manucoffin/faster-fixes",
      reviewed: "27 September 2026",
    },
    pins: {
      status: "yes",
      url: "https://github.com/manucoffin/faster-fixes",
      reviewed: "27 September 2026",
    },
    originals: {
      status: "yes",
      url: "https://github.com/manucoffin/faster-fixes",
      reviewed: "27 September 2026",
    },
    agentContext: {
      status: "yes",
      url: "https://github.com/manucoffin/faster-fixes",
      reviewed: "27 September 2026",
    },
  },
  siteping: {
    source: {
      status: "yes",
      url: "https://github.com/NeosiaNexus/SitePing",
      reviewed: "27 September 2026",
    },
    selfHost: {
      status: "components",
      url: "https://github.com/NeosiaNexus/SitePing/blob/main/apps/demo/content/docs/index.mdx",
      reviewed: "27 September 2026",
    },
    independent: {
      status: "yes",
      url: "https://github.com/NeosiaNexus/SitePing/blob/main/apps/demo/content/docs/adapters/localstorage.mdx",
      reviewed: "27 September 2026",
    },
    pins: {
      status: "yes",
      url: "https://github.com/NeosiaNexus/SitePing",
      reviewed: "27 September 2026",
    },
    screenshots: {
      status: "yes",
      url: "https://github.com/NeosiaNexus/SitePing",
      reviewed: "27 September 2026",
    },
    diagnostics: {
      status: "yes",
      url: "https://github.com/NeosiaNexus/SitePing",
      reviewed: "27 September 2026",
    },
  },
  openreplay: {
    source: {
      status: "yes",
      url: "https://github.com/openreplay/openreplay",
      reviewed: "27 September 2026",
    },
    selfHost: {
      status: "yes",
      url: "https://github.com/openreplay/openreplay",
      reviewed: "27 September 2026",
    },
    independent: {
      status: "yes",
      url: "https://docs.openreplay.com/en/deployment/",
      reviewed: "27 September 2026",
    },
    storage: {
      status: "yes",
      url: "https://docs.openreplay.com/en/configuration/external-storage/",
      reviewed: "27 September 2026",
    },
    extension: {
      status: "yes",
      url: "https://docs.openreplay.com/en/spot/",
      reviewed: "27 September 2026",
    },
    mcp: {
      status: "yes",
      url: "https://docs.openreplay.com/en/mcp/setup/",
      reviewed: "27 September 2026",
    },
    video: {
      status: "yes",
      url: "https://docs.openreplay.com/en/spot/",
      reviewed: "27 September 2026",
    },
    github: {
      status: "yes",
      url: "https://docs.openreplay.com/en/integrations/github/",
      reviewed: "27 September 2026",
    },
    microphone: {
      status: "yes",
      url: "https://docs.openreplay.com/en/spot/",
      reviewed: "27 September 2026",
    },
    pauseVideo: {
      status: "yes",
      url: "https://docs.openreplay.com/en/spot/",
      reviewed: "27 September 2026",
    },
    diagnostics: {
      status: "yes",
      url: "https://docs.openreplay.com/en/spot/",
      reviewed: "27 September 2026",
    },
    agentContext: {
      status: "yes",
      url: "https://docs.openreplay.com/en/mcp/setup/",
      reviewed: "27 September 2026",
    },
    replay: {
      status: "yes",
      url: "https://github.com/openreplay/openreplay",
      reviewed: "27 September 2026",
    },
  },
  bugherd: {
    extension: {
      status: "yes",
      url: "https://support.bugherd.com/en/articles/11424451-bugherd-browser-extensions",
      reviewed: "27 September 2026",
    },
    mcp: {
      status: "yes",
      url: "https://bugherd.com/feature/mcp",
      reviewed: "27 September 2026",
    },
    video: {
      status: "yes",
      url: "https://bugherd.com/features",
      reviewed: "27 September 2026",
    },
    github: {
      status: "yes",
      url: "https://bugherd.com/features",
      reviewed: "27 September 2026",
    },
    drawing: {
      status: "yes",
      url: "https://bugherd.com/website-annotation-tool",
      reviewed: "27 September 2026",
    },
    screenshots: {
      status: "yes",
      url: "https://bugherd.com/features",
      reviewed: "27 September 2026",
    },
    pins: {
      status: "yes",
      url: "https://bugherd.com/features",
      reviewed: "27 September 2026",
    },
    microphone: {
      status: "yes",
      url: "https://bugherd.com/features",
      reviewed: "27 September 2026",
    },
    agentContext: {
      status: "yes",
      url: "https://bugherd.com/feature/mcp",
      reviewed: "27 September 2026",
    },
    discussion: {
      status: "yes",
      url: "https://bugherd.com/feature/mcp",
      reviewed: "27 September 2026",
    },
  },
  "marker-io": {
    extension: {
      status: "yes",
      url: "https://help.marker.io/en/articles/6495644-browser-extensions",
      reviewed: "27 September 2026",
    },
    drawing: {
      status: "yes",
      url: "https://marker.io/features/website-feedback-widget",
      reviewed: "27 September 2026",
    },
    mcp: {
      status: "yes",
      url: "https://help.marker.io/en/articles/14034657-mcp-integration-model-context-protocol",
      reviewed: "27 September 2026",
    },
    github: {
      status: "yes",
      url: "https://marker.io/features/website-feedback-widget",
      reviewed: "27 September 2026",
    },
    screenshots: {
      status: "yes",
      url: "https://marker.io/features/website-feedback-widget",
      reviewed: "27 September 2026",
    },
    redact: {
      status: "yes",
      url: "https://marker.io/features/website-feedback-widget",
      reviewed: "27 September 2026",
    },
    replay: {
      status: "yes",
      url: "https://marker.io/features/session-replay",
      reviewed: "27 September 2026",
    },
    agentContext: {
      status: "yes",
      url: "https://help.marker.io/en/articles/14034657-mcp-integration-model-context-protocol",
      reviewed: "27 September 2026",
    },
  },
  "markup-io": {
    extension: {
      status: "yes",
      url: "https://www.markup.io/",
      reviewed: "27 September 2026",
    },
    drawing: {
      status: "yes",
      url: "https://www.markup.io/",
      reviewed: "27 September 2026",
    },
    screenshots: {
      status: "yes",
      url: "https://www.markup.io/",
      reviewed: "27 September 2026",
    },
    pins: {
      status: "yes",
      url: "https://www.markup.io/",
      reviewed: "27 September 2026",
    },
    originals: {
      status: "yes",
      url: "https://www.markup.io/",
      reviewed: "27 September 2026",
    },
    highlighter: {
      status: "yes",
      url: "https://www.markup.io/",
      reviewed: "27 September 2026",
    },
    discussion: {
      status: "yes",
      url: "https://www.markup.io/",
      reviewed: "27 September 2026",
    },
    resolved: {
      status: "yes",
      url: "https://www.markup.io/",
      reviewed: "27 September 2026",
    },
  },
  "markup-hero": {
    extension: {
      status: "yes",
      url: "https://markuphero.com/integrations/chrome-extension.html",
      reviewed: "27 September 2026",
    },
    drawing: {
      status: "yes",
      url: "https://markuphero.com/integrations/chrome-extension.html",
      reviewed: "27 September 2026",
    },
    screenshots: {
      status: "yes",
      url: "https://markuphero.com/integrations/chrome-extension.html",
      reviewed: "27 September 2026",
    },
    fullPage: {
      status: "yes",
      url: "https://markuphero.com/integrations/chrome-extension.html",
      reviewed: "27 September 2026",
    },
    highlighter: {
      status: "yes",
      url: "https://markuphero.com/integrations/chrome-extension.html",
      reviewed: "27 September 2026",
    },
    pdfExport: {
      status: "yes",
      url: "https://markuphero.com/integrations/chrome-extension.html",
      reviewed: "27 September 2026",
    },
    rasterExport: {
      status: "partial",
      url: "https://markuphero.com/integrations/chrome-extension.html",
      reviewed: "27 September 2026",
      detail: "PNG download confirmed. JPEG and WebP export not verified.",
    },
  },
  "redpen-ai": {
    extension: {
      status: "yes",
      url: "https://www.redpen.ai/getting-started",
      reviewed: "27 September 2026",
    },
    drawing: {
      status: "yes",
      url: "https://www.redpen.ai/getting-started",
      reviewed: "27 September 2026",
    },
    video: {
      status: "yes",
      url: "https://www.redpen.ai/getting-started",
      reviewed: "27 September 2026",
    },
    github: {
      status: "yes",
      url: "https://www.redpen.ai/getting-started",
      reviewed: "27 September 2026",
    },
    screenshots: {
      status: "yes",
      url: "https://www.redpen.ai/getting-started",
      reviewed: "27 September 2026",
    },
  },
  pastel: {
    screenshots: {
      status: "yes",
      url: "https://help.usepastel.com/en/articles/16399713-connect-your-ai-agent-to-pastel-mcp-server",
      reviewed: "27 September 2026",
    },
    extension: {
      status: "yes",
      url: "https://help.usepastel.com/en/articles/8168731-pastel-chrome-extension",
      reviewed: "27 September 2026",
    },
    mcp: {
      status: "yes",
      url: "https://help.usepastel.com/en/articles/16399713-connect-your-ai-agent-to-pastel-mcp-server",
      reviewed: "27 September 2026",
    },
    pins: {
      status: "yes",
      url: "https://help.usepastel.com/en/articles/16399713-connect-your-ai-agent-to-pastel-mcp-server",
      reviewed: "27 September 2026",
    },
    originals: {
      status: "yes",
      url: "https://help.usepastel.com/en/articles/16399713-connect-your-ai-agent-to-pastel-mcp-server",
      reviewed: "27 September 2026",
    },
    resolved: {
      status: "yes",
      url: "https://help.usepastel.com/en/articles/16399713-connect-your-ai-agent-to-pastel-mcp-server",
      reviewed: "27 September 2026",
    },
    discussion: {
      status: "yes",
      url: "https://help.usepastel.com/en/articles/16399713-connect-your-ai-agent-to-pastel-mcp-server",
      reviewed: "27 September 2026",
    },
    agentContext: {
      status: "yes",
      url: "https://help.usepastel.com/en/articles/16399713-connect-your-ai-agent-to-pastel-mcp-server",
      reviewed: "27 September 2026",
    },
  },
  ruttl: {
    extension: {
      status: "yes",
      url: "https://site.dev.ruttl.com/chrome-extension/",
      reviewed: "27 September 2026",
    },
    drawing: {
      status: "yes",
      url: "https://site.dev.ruttl.com/chrome-extension/",
      reviewed: "27 September 2026",
    },
    mcp: {
      status: "yes",
      url: "https://www.ruttl.com/mcp",
      reviewed: "27 September 2026",
    },
    video: {
      status: "yes",
      url: "https://www.ruttl.com/blog/video-feedback-record-website",
      reviewed: "27 September 2026",
    },
    discussion: {
      status: "yes",
      url: "https://www.ruttl.com/mcp",
      reviewed: "27 September 2026",
    },
    agentContext: {
      status: "yes",
      url: "https://www.ruttl.com/mcp",
      reviewed: "27 September 2026",
    },
  },
  superflow: {
    video: {
      status: "yes",
      url: "https://usesuperflow.ai/recordings",
      reviewed: "27 September 2026",
    },
    screenshots: {
      status: "yes",
      url: "https://usesuperflow.ai/screenshots",
      reviewed: "27 September 2026",
    },
    originals: {
      status: "yes",
      url: "https://usesuperflow.ai/screenshots",
      reviewed: "27 September 2026",
    },
    pins: {
      status: "yes",
      url: "https://usesuperflow.ai/screenshots",
      reviewed: "27 September 2026",
    },
    microphone: {
      status: "yes",
      url: "https://usesuperflow.ai/recordings",
      reviewed: "27 September 2026",
    },
  },
  usersnap: {
    extension: {
      status: "yes",
      url: "https://usersnap.com/features",
      reviewed: "27 September 2026",
    },
    drawing: {
      status: "yes",
      url: "https://usersnap.com/features",
      reviewed: "27 September 2026",
    },
    mcp: {
      status: "yes",
      url: "https://usersnap.com/integrations/mcp",
      reviewed: "27 September 2026",
    },
    video: {
      status: "yes",
      url: "https://usersnap.com/features",
      reviewed: "27 September 2026",
    },
    github: {
      status: "yes",
      url: "https://help.usersnap.com/docs/github",
      reviewed: "27 September 2026",
    },
    screenshots: {
      status: "yes",
      url: "https://usersnap.com/features",
      reviewed: "27 September 2026",
    },
    discussion: {
      status: "yes",
      url: "https://usersnap.com/features",
      reviewed: "27 September 2026",
    },
    agentContext: {
      status: "yes",
      url: "https://usersnap.com/integrations/mcp",
      reviewed: "27 September 2026",
    },
  },
  userback: {
    extension: {
      status: "yes",
      url: "https://userback.io/ai-info/",
      reviewed: "27 September 2026",
    },
    drawing: {
      status: "yes",
      url: "https://userback.io/ai-info/",
      reviewed: "27 September 2026",
    },
    mcp: {
      status: "yes",
      url: "https://userback.io/ai-info/",
      reviewed: "27 September 2026",
    },
    video: {
      status: "yes",
      url: "https://userback.io/ai-info/",
      reviewed: "27 September 2026",
    },
    github: {
      status: "yes",
      url: "https://userback.io/ai-info/",
      reviewed: "27 September 2026",
    },
    screenshots: {
      status: "yes",
      url: "https://userback.io/ai-info/",
      reviewed: "27 September 2026",
    },
    highlighter: {
      status: "yes",
      url: "https://userback.io/ai-info/",
      reviewed: "27 September 2026",
    },
    replay: {
      status: "yes",
      url: "https://userback.io/ai-info/",
      reviewed: "27 September 2026",
    },
    agentContext: {
      status: "yes",
      url: "https://userback.io/ai-info/",
      reviewed: "27 September 2026",
    },
    diagnostics: {
      status: "yes",
      url: "https://userback.io/ai-info/",
      reviewed: "27 September 2026",
    },
  },
  atarim: {
    extension: {
      status: "yes",
      url: "https://atarim.io/help/visual-collaboration/how-to-use-the-annotation-tools-for-feedback-in-atarim/",
      reviewed: "27 September 2026",
    },
    drawing: {
      status: "yes",
      url: "https://atarim.io/help/visual-collaboration/how-to-use-the-annotation-tools-for-feedback-in-atarim/",
      reviewed: "27 September 2026",
    },
    mcp: {
      status: "yes",
      url: "https://atarim.io/mcp/",
      reviewed: "27 September 2026",
    },
    screenshots: {
      status: "yes",
      url: "https://atarim.io/mcp/",
      reviewed: "27 September 2026",
    },
    pins: {
      status: "yes",
      url: "https://atarim.io/mcp/",
      reviewed: "27 September 2026",
    },
    originals: {
      status: "yes",
      url: "https://atarim.io/mcp/",
      reviewed: "27 September 2026",
    },
    discussion: {
      status: "yes",
      url: "https://atarim.io/mcp/",
      reviewed: "27 September 2026",
    },
    agentContext: {
      status: "yes",
      url: "https://atarim.io/mcp/",
      reviewed: "27 September 2026",
    },
  },
};
