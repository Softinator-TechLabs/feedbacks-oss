export default {
  reviewed: "30 September 2026",
  scope:
    "Feedbacks public source b9b7df4; source capability, not installed-extension certification.",
  summary:
    "Self-hosted visual review with local drafts, annotation, explicitly started video/session recording, portable evidence and authorized team context for agents.",
  sources: [
    {
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/b9b7df4/docs/mobile-sdk.md",
      title: "nativeClients audit source",
      reviewed: "30 September 2026",
    },
    {
      title: "textSuggestions: reviewed primary source",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/b9b7df4/docs/extension.md",
      reviewed: "30 September 2026",
    },
    {
      title: "timeline: reviewed primary source",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/b9b7df4/docs/session-replay.md",
      reviewed: "30 September 2026",
    },
    {
      title: "multiRepo: reviewed primary source",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/b9b7df4/docs/api.md",
      reviewed: "30 September 2026",
    },
    {
      title: "projectContext: reviewed primary source",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/b9b7df4/docs/agents.md",
      reviewed: "30 September 2026",
    },
    {
      title: "source: reviewed primary source",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/b9b7df4/docs/why-feedbacks.md",
      reviewed: "30 September 2026",
    },
    {
      title: "selfHost: reviewed primary source",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/b9b7df4/docs/self-hosting.md",
      reviewed: "30 September 2026",
    },
    {
      title: "discussion: reviewed primary source",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/b9b7df4/docs/review-workflow.md",
      reviewed: "30 September 2026",
    },
    {
      title: "apacheLicense: reviewed primary source",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/b9b7df4/LICENSE",
      reviewed: "30 September 2026",
    },
  ],
  cells: {
    textSuggestions: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/b9b7df4/docs/extension.md",
      reviewed: "30 September 2026",
      detail:
        "Selected original text and suggested replacement; does not edit the live website.",
      basis: "source",
    },
    timeline: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/b9b7df4/docs/session-replay.md",
      reviewed: "30 September 2026",
      detail:
        "User-started recording. Replay, video and captured event channels share a playhead.",
      basis: "source",
    },
    frameAnnotations: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/b9b7df4/docs/session-replay.md",
      reviewed: "30 September 2026",
      detail: "Saved and annotated frames retain their recording time.",
      basis: "source",
    },
    threadBundle: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/b9b7df4/docs/session-replay.md",
      reviewed: "30 September 2026",
      detail:
        "Authorized thread archive with media, recordings, diagnostics and checksums.",
      basis: "source",
    },
    multiRepo: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/b9b7df4/docs/api.md",
      reviewed: "30 September 2026",
      detail:
        "Multiple configured GitHub Apps; the owner selects one per project, with repositories across that App’s permitted installations.",
      basis: "source",
    },
    projectContext: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/b9b7df4/docs/agents.md",
      reviewed: "30 September 2026",
      detail:
        "Approved project instructions remain separate from untrusted captured content.",
      basis: "source",
    },
    source: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/b9b7df4/docs/why-feedbacks.md",
      reviewed: "30 September 2026",
      basis: "source",
      detail:
        "The complete server, web app, extension and agent interfaces are public source.",
    },
    selfHost: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/b9b7df4/docs/self-hosting.md",
      reviewed: "30 September 2026",
      basis: "source",
      detail: "Run the complete service on your own server and database.",
    },
    independent: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/b9b7df4/docs/why-feedbacks.md",
      reviewed: "30 September 2026",
      basis: "source",
      detail:
        "Local accounts and pairing work without a vendor SaaS account; GitHub and AI services are optional.",
    },
    storage: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/b9b7df4/docs/self-hosting.md",
      reviewed: "30 September 2026",
      basis: "source",
      detail:
        "Configure private S3-compatible object storage; no enterprise license is needed. Infrastructure costs remain yours.",
    },
    extension: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/b9b7df4/docs/extension.md",
      reviewed: "30 September 2026",
      basis: "source",
      detail:
        "Bundled Chromium extension captures browser feedback with optional, explicitly granted permissions.",
    },
    drawing: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/b9b7df4/docs/extension.md",
      reviewed: "30 September 2026",
      basis: "source",
      detail:
        "Pencil, arrow, rectangle, ellipse and text edit screenshot pixels before local export or submission.",
    },
    mcp: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/b9b7df4/docs/agents.md",
      reviewed: "30 September 2026",
      basis: "source",
      detail:
        "Scoped remote HTTP and local stdio MCP expose the shared authorized operation registry.",
    },
    video: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/b9b7df4/docs/extension.md",
      reviewed: "30 September 2026",
      detail:
        "Up to five minutes of active recording; separate recorder tab and preview before Send.",
      basis: "source",
    },
    github: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/b9b7df4/docs/api.md",
      reviewed: "30 September 2026",
      detail:
        "Optional GitHub App; reviewed issue drafts and project opt-in for status sync.",
      basis: "source",
    },
    expertise: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/b9b7df4/docs/agents.md",
      reviewed: "30 September 2026",
      basis: "source",
      detail:
        "Owner-approved subject weights and reviewer guidance help authorized agents interpret feedback; weights do not override human decisions.",
    },
    screenshots: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/b9b7df4/docs/extension.md",
      reviewed: "30 September 2026",
      basis: "source",
      detail:
        "Capture visible screenshots in the extension and retain their page/environment context.",
    },
    fullPage: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/b9b7df4/docs/extension.md",
      reviewed: "30 September 2026",
      basis: "source",
      detail:
        "Full-page capture stitches page sections; point-original images remain separate.",
    },
    pins: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/b9b7df4/docs/extension.md",
      reviewed: "30 September 2026",
      basis: "source",
      detail:
        "Element pins keep geometry, text and original evidence; hidden elements are listed rather than misleadingly repositioned.",
    },
    originals: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/b9b7df4/docs/extension.md",
      reviewed: "30 September 2026",
      basis: "source",
      detail:
        "Each saved point retains its original viewport screenshot, separately from subsequent page captures.",
    },
    drafts: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/b9b7df4/docs/extension.md",
      reviewed: "30 September 2026",
      basis: "source",
      detail:
        "Save multiple points locally, edit them in Review & send, then publish one thread.",
    },
    resolved: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/b9b7df4/docs/extension.md",
      reviewed: "30 September 2026",
      basis: "source",
      detail: "Individual points retain independent progress within a shared thread.",
    },
    reviewDefaults: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/b9b7df4/docs/extension.md",
      reviewed: "30 September 2026",
      detail:
        "Personal defaults retain evidence layers, capture and recording settings across reviews.",
      basis: "source",
    },
    highlighter: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/b9b7df4/docs/extension.md",
      reviewed: "30 September 2026",
      basis: "source",
      detail:
        "Screenshot highlighter marks pixels independently of text-selection evidence.",
    },
    steps: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/b9b7df4/docs/extension.md",
      reviewed: "30 September 2026",
      basis: "source",
      detail: "Numbered step annotations explain an ordered screenshot workflow.",
    },
    blur: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/b9b7df4/docs/extension.md",
      reviewed: "30 September 2026",
      detail:
        "Pixel blur is available in screenshot editing; inspect the result before sharing sensitive evidence.",
      basis: "source",
    },
    redact: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/b9b7df4/docs/extension.md",
      reviewed: "30 September 2026",
      basis: "source",
      detail:
        "Opaque pixel redaction edits screenshot output. Separate recording masking controls do not sanitize every diagnostic artifact.",
    },
    stickers: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/b9b7df4/docs/extension.md",
      reviewed: "30 September 2026",
      basis: "source",
      detail: "Screenshot editor offers stamps and stickers.",
    },
    localImages: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/b9b7df4/docs/extension.md",
      reviewed: "30 September 2026",
      basis: "source",
      detail:
        "Insert a local image as a movable/resizable layer in the screenshot editor.",
    },
    cropExport: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/b9b7df4/docs/extension.md",
      reviewed: "30 September 2026",
      detail:
        "Local clipboard and downloads only; sent feedback retains the complete screenshot.",
      basis: "source",
    },
    rasterExport: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/b9b7df4/docs/extension.md",
      reviewed: "30 September 2026",
      basis: "source",
      detail:
        "Download annotated PNG, JPEG or WebP locally; output format choice does not change the stored original.",
    },
    pdfExport: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/b9b7df4/docs/extension.md",
      reviewed: "30 September 2026",
      basis: "source",
      detail: "Export multiple annotated screenshot pages to a local PDF.",
    },
    clipboard: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/b9b7df4/docs/extension.md",
      reviewed: "30 September 2026",
      basis: "source",
      detail: "Copy annotated screenshot PNG pixels to the image clipboard.",
    },
    tabAudio: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/b9b7df4/docs/extension.md",
      reviewed: "30 September 2026",
      detail:
        "Tab sound and microphone default on; saved choices are preserved. Microphone access requires Chrome permission. Session-only capture creates no audio track.",
      basis: "source",
    },
    microphone: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/b9b7df4/docs/extension.md",
      reviewed: "30 September 2026",
      basis: "source",
      detail:
        "Microphone narration has a separate saved control and defaults on. First use requires Chrome permission; session-only capture has no audio track.",
    },
    pauseVideo: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/b9b7df4/docs/extension.md",
      reviewed: "30 September 2026",
      basis: "source",
      detail:
        "Pause and resume while explicitly recording; only active recording time counts toward the five-minute limit.",
    },
    trimVideo: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/b9b7df4/docs/extension.md",
      reviewed: "30 September 2026",
      basis: "source",
      detail:
        "Preview and adjust the clip time range before sending. Edited video omits DOM replay.",
    },
    cropVideo: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/b9b7df4/docs/extension.md",
      reviewed: "30 September 2026",
      basis: "source",
      detail:
        "Preview and choose a spatial crop before sending. Edited video omits DOM replay.",
    },
    diagnostics: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/b9b7df4/docs/extension.md",
      reviewed: "30 September 2026",
      basis: "source",
      detail:
        "Screenshot and recording evidence can include captured console/network channels; missing coverage is reported.",
    },
    discussion: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/b9b7df4/docs/review-workflow.md",
      reviewed: "30 September 2026",
      basis: "source",
      detail: "Thread comments and replies retain named human/agent attribution.",
    },
    agentContext: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/b9b7df4/docs/agents.md",
      reviewed: "30 September 2026",
      basis: "source",
      detail:
        "Authorized agents can fetch page/element context, visual evidence and bounded diagnostic bytes.",
    },
    replay: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/b9b7df4/docs/session-replay.md",
      reviewed: "30 September 2026",
      basis: "source",
      detail:
        "Explicitly started rrweb DOM replay is bounded to five minutes; it is not passive visitor analytics.",
    },
    apacheLicense: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/b9b7df4/LICENSE",
      reviewed: "30 September 2026",
      detail:
        "Complete product licensed under Apache-2.0, including the server, web app, extension and agent interfaces.",
      basis: "source",
    },
    allFeaturesFree: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/b9b7df4/docs/why-feedbacks.md",
      reviewed: "30 September 2026",
      detail:
        "No feature license fee or proprietary paid edition. Hosting infrastructure and optional external model subscriptions remain your responsibility.",
      basis: "source",
    },
    multiApps: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/b9b7df4/docs/api.md",
      reviewed: "30 September 2026",
      detail:
        "Configure multiple GitHub Apps on one server; owners choose one per project and can use its permitted installations/repositories.",
      basis: "source",
    },
    agentQueue: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/b9b7df4/docs/agents.md",
      reviewed: "30 September 2026",
      detail:
        "MCP supplies assignee-filtered work, human priority flags and authorized advisory rankings. It does not automatically start work or guarantee an agent decision.",
      basis: "source",
    },
    sessionOnly: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/b9b7df4/docs/session-replay.md",
      reviewed: "30 September 2026",
      detail:
        "Explicitly capture a bounded DOM session without recording video; replay and diagnostic channels share its timeline.",
      basis: "source",
    },
    screenshotDiagnostics: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/b9b7df4/docs/agents.md",
      reviewed: "30 September 2026",
      detail:
        "Screenshot threads can retain DOM, console and network artifacts with bounded reads and authorized local materialization. Coverage can be partial.",
      basis: "source",
    },
    nativeClients: {
      status: "yes",
      url: "https://github.com/Softinator-TechLabs/feedbacks-oss/blob/b9b7df4/docs/mobile-sdk.md",
      reviewed: "30 September 2026",
      detail:
        "Ships an iOS Swift package and Android Kotlin library with pairing, in-app screenshot helpers and feedback upload. Integrate locally into a host-owned review UI; no anonymous end-user widget or separately published registry package.",
      basis: "source",
    },
  },
};
